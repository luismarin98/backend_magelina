import { reportTypes } from './report-types.js';
import { Router, type Request } from 'express';
import { ChannelType, PermissionFlagsBits as P } from 'discord.js';
import { SupportTicket } from '../../database/models/SupportTicket.js';
import type { guildAuthorization } from '../permissions/access.js';
import { object, text, id, routeParam, version, cursor, page } from '../common/input.js';
import { workflowError } from '../workflow/rules.js';
import { canReview } from '../moderation/rules.js';
import { supportContext, ticketScope, supportConfig, faqInput, submitSupport, assignSupport } from './service.js';
import { SupportConfig } from '../../database/models/SupportConfig.js';
import { publishSupportPanel } from './panel.js';
import { hasCode } from '../../types/errors.js';
import { supportOverviewPipeline } from './overview.js';
import { archiveAndDeleteChannel, transcriptFiles } from './transcript.js';
import { SupportMessage } from '../../database/models/SupportMessage.js';
import { ObjectId } from 'mongodb';
import { pipeline } from 'node:stream/promises';

async function context(req: Request) {
  return supportContext(req.managedGuild!, req.session.user!.id, req.guildAccess!.source === 'bot-owner');
}
async function visibleTicket(req: Request) {
  const ctx = await context(req), actorId = req.session.user!.id;
  const ticket = await SupportTicket.findOne({ _id: id(routeParam(req, 'ticketId')), guildId: req.managedGuild!.id, ...ticketScope(actorId, ctx) });
  if (!ticket) throw workflowError(404, 'Caso no encontrado.');
  return { ctx, ticket };
}
async function ticketChannel(req: Request, ticket: { channelId?: string | null }, ctx: Awaited<ReturnType<typeof context>>) {
  if (!ticket.channelId) throw workflowError(409, 'El canal todavía no está disponible. Revisa el caso con un administrador.');
  const channel = await req.managedGuild!.channels.fetch(ticket.channelId);
  if (!channel || channel.type !== ChannelType.GuildText || !channel.permissionsFor(ctx.me)?.has([P.ViewChannel, P.ReadMessageHistory]) || (ctx.actor && !channel.permissionsFor(ctx.actor)?.has([P.ViewChannel, P.ReadMessageHistory]))) throw workflowError(403, 'No se puede acceder al canal de este caso.');
  return channel;
}

export function supportRoutes(access: ReturnType<typeof guildAuthorization>) {
  const router = Router({ mergeParams: true });
  router.use(access.requireMember);
  router.get('/', async (req, res) => {
    const ctx = await context(req), guildId = req.managedGuild!.id;
    const state = req.query.state;
    if (state !== undefined && (typeof state !== 'string' || !['pending', 'in_progress', 'escalated', 'closed', 'uncertain'].includes(state))) throw workflowError(400, 'Estado no válido.');
    const assigneeId = req.query.assigneeId === undefined ? undefined : id(req.query.assigneeId, true);
    const requesterId = req.query.requesterId === undefined ? undefined : id(req.query.requesterId, true);
    if ((assigneeId || requesterId) && !ctx.canAdmin) throw workflowError(403, 'Solo un administrador puede consultar pendientes por persona.');
    if (req.query.active !== undefined && req.query.active !== 'true') throw workflowError(400, 'Filtro de pendientes no válido.');
    const activeOnly = req.query.active === 'true' && state !== 'closed';
    const items = await SupportTicket.find({ guildId, ...ticketScope(req.session.user!.id, ctx), ...(activeOnly ? { active: true, state: { $ne: 'closed' } } : {}), ...(state ? { state } : {}), ...(assigneeId ? { assigneeId } : {}), ...(requesterId ? { requesterId } : {}), ...cursor(req.query.before) }).sort({ _id: -1 }).limit(21).lean();
    res.json({ ...page(items, 20), canModerate: ctx.canModerate, canAdmin: ctx.canAdmin, canRequest: true, reportTypes });
  });
  router.get('/overview', async (req, res) => {
    const ctx = await context(req), guild = req.managedGuild!;
    if (!ctx.canAdmin) throw workflowError(403, 'Solo un administrador puede ver los pendientes de todo el equipo.');
    const group = req.query.group;
    if (group !== 'moderators' && group !== 'users') throw workflowError(400, 'Agrupación no válida.');
    const rawPage = req.query.page ?? '0';
    if (typeof rawPage !== 'string' || !/^\d{1,6}$/.test(rawPage)) throw workflowError(400, 'Página no válida.');
    const currentPage = Number(rawPage);
    const [result] = await SupportTicket.aggregate(supportOverviewPipeline(guild.id, group, currentPage));
    const total = result?.total[0]?.count ?? 0;
    const groups = await Promise.all((result?.groups ?? []).map(async (entry: { _id: string; pendingCount: number; awaitingReview: number; escalatedCount: number; oldestAt: Date }) => {
      const member = await guild.members.fetch(entry._id).catch(() => null);
      return { id: entry._id, name: member?.displayName ?? entry._id, pendingCount: entry.pendingCount, awaitingReview: entry.awaitingReview, escalatedCount: entry.escalatedCount, oldestAt: entry.oldestAt };
    }));
    res.json({ groups, total, page: currentPage, nextPage: (currentPage + 1) * 10 < total ? currentPage + 1 : null });
  });
  router.get('/help', async (req, res) => {
    const ctx = await context(req), config = await supportConfig(req.managedGuild!.id);
    const channels = ctx.canModerate ? [...(await req.managedGuild!.channels.fetch()).values()].filter(channel => channel && channel.type === ChannelType.GuildText && (!ctx.actor || channel.permissionsFor(ctx.actor)?.has(channel.id === config.panelChannelId ? [P.ViewChannel] : [P.ViewChannel, P.SendMessages]))).map(channel => ({ id: channel!.id, name: channel!.name })) : [];
    res.json({ version: config.version, faqs: config.faqs.map(faq => ({ question: faq.question, answer: faq.answer })), categoryId: config.categoryId, panelChannelId: config.panelChannelId, panelMessageId: config.panelMessageId, canManage: ctx.canModerate, channels });
  });
  router.patch('/help', async (req, res) => {
    const ctx = await context(req);
    if (!ctx.canModerate) throw workflowError(403, 'Solo el equipo puede publicar respuestas.');
    const faqs = faqInput(req.body), expected = version(req.body.version);
    try {
      const config = await SupportConfig.findOneAndUpdate({ guildId: req.managedGuild!.id, version: expected, publishing: false }, { $set: { faqs }, $inc: { version: 1 } }, { new: true, upsert: expected === 0, runValidators: true });
      if (!config) throw workflowError(409, 'Las respuestas cambiaron. Actualiza antes de guardar.');
      res.json({ config });
    } catch (error) { if (hasCode(error, 11000)) throw workflowError(409, 'La configuraci?n cambi?. Actualiza.'); throw error; }
  });
  router.post('/panel', async (req, res) => {
    const input = object(req.body, ['channelId']), ctx = await context(req);
    res.json({ config: await publishSupportPanel(req.managedGuild!, req.session.user!.id, ctx, input.channelId ? id(input.channelId, true) : undefined) });
  });
  router.get('/moderators', async (req, res) => {
    const ctx = await context(req), guild = req.managedGuild!;
    if (!ctx.canAdmin) throw workflowError(403, 'Solo un administrador puede asignar el equipo.');
    const members = [];
    let after: string | undefined;
    for (;;) {
      const batch = await guild.members.list({ limit: 1000, ...(after ? { after } : {}) });
      for (const member of batch.values()) if (!member.user.bot && (member.id === guild.ownerId || canReview(member))) members.push({ id: member.id, name: member.displayName });
      if (batch.size < 1000) break;
      after = batch.last()!.id;
    }
    res.json({ members });
  });
  router.post('/', async (req, res) => {
    res.status(201).json({ item: await submitSupport(req.managedGuild!.id, req.session.user!.id, req.body) });
  });
  router.patch('/:ticketId', async (req, res) => {
    const { ctx, ticket } = await visibleTicket(req), actorId = req.session.user!.id;
    const input = object(req.body, ['action', 'version', 'assigneeId', 'reason']), expected = version(input.version);
    if (input.action === 'assign') {
      res.json({ item: await assignSupport(req.managedGuild!, actorId, ctx, ticket, expected, id(input.assigneeId, true)) }); return;
    }
    if (!['close', 'escalate'].includes(String(input.action))) throw workflowError(400, 'Accion no valida.');
    if (!ctx.canAdmin && !(ctx.canModerate && ticket.assigneeId === actorId)) throw workflowError(403, 'Solo el moderador asignado o un administrador puede gestionar el caso.');
    if (ticket.state === 'closed') throw workflowError(409, 'El caso ya esta cerrado.');
    if (ticket.state === 'creating' && Date.now() - ticket.createdAt.getTime() < 120000) throw workflowError(409, 'Espera a que termine la preparacion del canal.');
    const reason = input.action === 'escalate' ? text(input.reason, 1000) : undefined;
    if (reason && ticket.state !== 'in_progress') throw workflowError(409, 'Solo puedes escalar un caso en atencion.');
    const item = await SupportTicket.findOneAndUpdate({ _id: ticket._id, guildId: req.managedGuild!.id, version: expected, state: ticket.state }, {
      $set: reason ? { state: 'escalated', escalationReason: reason } : { state: 'closed', active: false }, $inc: { version: 1 }, $push: { history: { actorId, action: input.action, reason, at: new Date() } },
    }, { new: true });
    if (!item) throw workflowError(409, 'El caso cambio. Actualiza antes de continuar.');
    res.json({ item });
  });
  router.get('/:ticketId/messages', async (req, res) => {
    const { ctx, ticket } = await visibleTicket(req);
    if (ticket.transcriptArchivedAt && ticket.transcriptRunId) {
      const before = req.query.before === undefined ? undefined : id(req.query.before, true);
      const messages = await SupportMessage.find({ guildId: req.managedGuild!.id, ticketId: ticket._id, runId: ticket.transcriptRunId, ...(before ? { messageOrder: { $lt: before } } : {}) }).sort({ messageOrder: -1 }).limit(51).lean();
      const more = messages.length > 50; if (more) messages.pop();
      const nextCursor = more ? messages.at(-1)!.messageId : null;
      res.json({ source: 'archive', archivedAt: ticket.transcriptArchivedAt, total: ticket.transcriptMessageCount, nextCursor, messages: messages.reverse().map(message => ({ id: message.messageId, channelId: message.channelId, channelName: message.channelName, author: message.author, content: message.content, createdAt: message.createdAt.toISOString(), url: '', embeds: message.embeds, stickers: message.stickers, attachments: message.attachments.map(attachment => ({ id: attachment.id, name: attachment.name, size: attachment.size, url: `/guilds/${req.managedGuild!.id}/support/${ticket._id}/attachments/${attachment.id}` })) })) }); return;
    }
    if (ticket.state === 'closed' && !ticket.channelId) { res.json({ source: 'archive', total: 0, nextCursor: null, messages: [] }); return; }
    const channel = await ticketChannel(req, ticket, ctx);
    const messages = await channel.messages.fetch({ limit: 50 });
    res.json({ source: 'discord', messages: [...messages.values()].sort((a, b) => a.createdTimestamp - b.createdTimestamp).map(message => ({ id: message.id, author: message.author.globalName ?? message.author.username, content: message.content, createdAt: message.createdAt.toISOString(), url: message.url, embeds: message.embeds.map(embed => embed.toJSON()), attachments: [...message.attachments.values()].map(attachment => ({ id: attachment.id, name: attachment.name, size: attachment.size, url: attachment.url })) })) });
  });
  router.post('/:ticketId/archive-channel', async (req, res) => {
    const { ctx, ticket } = await visibleTicket(req), input = object(req.body, ['version']);
    res.json({ item: await archiveAndDeleteChannel(req.managedGuild!, req.session.user!.id, ctx, ticket, version(input.version)) });
  });
  router.get('/:ticketId/attachments/:attachmentId', async (req, res) => {
    const { ticket } = await visibleTicket(req), attachmentId = id(routeParam(req, 'attachmentId'), true);
    if (!ticket.transcriptArchivedAt || !ticket.transcriptRunId) throw workflowError(404, 'Adjunto archivado no encontrado.');
    const message = await SupportMessage.findOne({ guildId: req.managedGuild!.id, ticketId: ticket._id, runId: ticket.transcriptRunId, 'attachments.id': attachmentId }).lean();
    const attachment = message?.attachments.find(entry => entry.id === attachmentId);
    if (!attachment?.storageId || !ObjectId.isValid(attachment.storageId)) throw workflowError(404, 'Adjunto no encontrado.');
    const bucket = transcriptFiles(), fileId = new ObjectId(attachment.storageId);
    const file = await bucket.find({ _id: fileId, 'metadata.guildId': req.managedGuild!.id, 'metadata.ticketId': String(ticket._id) }).next();
    if (!file) throw workflowError(404, 'Archivo no encontrado.');
    res.set({ 'Content-Type': 'application/octet-stream', 'Content-Length': String(file.length), 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(attachment.name ?? 'adjunto')}`, 'X-Content-Type-Options': 'nosniff' });
    try { await pipeline(bucket.openDownloadStream(fileId), res); }
    catch (cause) { if (!res.headersSent) throw cause; res.destroy(); }
  });
  router.post('/:ticketId/messages', async (req, res) => {
    const { ctx, ticket } = await visibleTicket(req);
    if (!['open', 'in_progress', 'escalated'].includes(ticket.state)) throw workflowError(409, 'Este caso no admite mensajes nuevos.');
    const input = object(req.body, ['content']), content = text(input.content, 1500);
    const channel = await ticketChannel(req, ticket, ctx);
    if (!channel.permissionsFor(ctx.me)?.has(P.SendMessages) || (ctx.actor && !channel.permissionsFor(ctx.actor)?.has(P.SendMessages))) throw workflowError(403, 'No tienes permiso para enviar mensajes en este canal.');
    const message = await channel.send({ content: `**Dashboard · <@${req.session.user!.id}>**\n${content}`, allowedMentions: { parse: [] } });
    res.status(201).json({ id: message.id });
  });
  return router;
}
