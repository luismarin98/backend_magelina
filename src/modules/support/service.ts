import { ChannelType, PermissionFlagsBits as P, type Guild } from 'discord.js';
import { SupportTicket } from '../../database/models/SupportTicket.js';
import { SupportConfig } from '../../database/models/SupportConfig.js';
import { channelContext, privateOverwrites } from '../channels/service.js';
import { canReview } from '../moderation/rules.js';
import { workflowError } from '../workflow/rules.js';
import { object, text } from '../common/input.js';
import { hasCode } from '../../types/errors.js';
import { logRecord } from '../../observability/logging.js';

export async function supportContext(guild: Guild, actorId: string, owner: boolean) {
  const ctx = await channelContext(guild, actorId, owner);
  return { ...ctx, canModerate: !ctx.actor || canReview(ctx.actor), canAdmin: !ctx.actor || ctx.actor.permissions.has(P.Administrator) };
}
export function ticketScope(actorId: string, ctx: { canAdmin: boolean; canModerate: boolean }) {
  return ctx.canAdmin ? {} : ctx.canModerate ? { $or: [{ requesterId: actorId }, { assigneeId: actorId }] } : { requesterId: actorId };
}
export async function supportConfig(guildId: string) {
  return await SupportConfig.findOne({ guildId }).lean() ?? { guildId, version: 0, faqs: [], panelChannelId: null, panelMessageId: null, publishing: false };
}
export function faqInput(body: unknown) {
  const input = object(body, ['version', 'faqs']);
  if (!Array.isArray(input.faqs) || input.faqs.length > 5) throw workflowError(400, 'Publica hasta cinco respuestas de autoatención.');
  return input.faqs.map(entry => { const value = object(entry, ['question', 'answer']); return { question: text(value.question, 100), answer: text(value.answer, 600) }; });
}
export async function submitSupport(guildId: string, requesterId: string, body: unknown) {
  const input = object(body, ['requestId', 'subject', 'description']);
  if (typeof input.requestId !== 'string' || !/^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(input.requestId)) throw workflowError(400, 'Identificador de solicitud no válido.');
  const subject = text(input.subject, 100), description = text(input.description, 1500);
  const existing = await SupportTicket.findOne({ guildId, requestId: input.requestId });
  if (existing) {
    if (existing.requesterId !== requesterId) throw workflowError(409, 'Identificador ya utilizado.');
    return existing;
  }
  try {
    return await SupportTicket.create({ guildId, requestId: input.requestId, requesterId, subject, description, state: 'pending', history: [{ actorId: requesterId, action: 'requested', at: new Date() }] });
  } catch (error) {
    if (hasCode(error, 11000)) throw workflowError(409, 'Ya tienes una solicitud activa. Revisa su estado antes de enviar otra.');
    throw error;
  }
}

export async function assignSupport(guild: Guild, actorId: string, ctx: Awaited<ReturnType<typeof supportContext>>, ticket: { _id: unknown; state: string; version: number; channelId?: string | null; requesterId: string; subject: string; description: string }, expected: number, assigneeId: string) {
  if (!ctx.canAdmin) throw workflowError(403, 'Solo un administrador puede revisar y asignar solicitudes.');
  if (!['pending', 'open', 'in_progress', 'escalated'].includes(ticket.state)) throw workflowError(409, 'Este caso no admite una asignación.');
  if (!ctx.me.permissions.has([P.ManageChannels, P.ManageRoles, P.ViewChannel, P.SendMessages, P.ReadMessageHistory])) throw workflowError(403, 'Magelina necesita permisos para crear y gestionar canales privados y sus mensajes.');
  const assignee = await guild.members.fetch({ user: assigneeId, force: true }).catch(() => { throw workflowError(400, 'El moderador no está disponible en el servidor.'); });
  if (assignee.user.bot || (assignee.id !== guild.ownerId && !canReview(assignee))) throw workflowError(400, 'Selecciona un moderador o administrador de Discord.');
  const saved = await SupportTicket.findOneAndUpdate({ _id: ticket._id, guildId: guild.id, version: expected, state: ticket.state }, {
    $set: { state: 'creating', assigneeId, escalationReason: null }, $inc: { version: 1 }, $push: { history: { actorId, action: 'assigned', assigneeId, at: new Date() } },
  }, { new: true });
  if (!saved) throw workflowError(409, 'La solicitud cambió. Actualiza antes de asignar.');
  try {
    const overwrites = privateOverwrites(guild.id, ctx.me.id, [saved.requesterId, assigneeId]);
    if (saved.channelId) {
      const channel = await guild.channels.fetch(saved.channelId);
      if (!channel || channel.type !== ChannelType.GuildText) throw workflowError(409, 'El canal ya no está disponible.');
      await channel.permissionOverwrites.set(overwrites, `Magelina: asignación por ${actorId}`);
    } else {
      const channel = await guild.channels.create({ name: `soporte-${String(saved._id).slice(-8)}`, type: ChannelType.GuildText, permissionOverwrites: overwrites, reason: `Magelina: asignación por ${actorId}` });
      saved.channelId = channel.id;
    }
    saved.state = 'in_progress'; await saved.save();
  } catch {
    await SupportTicket.updateOne({ _id: saved._id }, { $set: { state: 'uncertain', ...(saved.channelId ? { channelId: saved.channelId } : {}) } }).catch(() => {});
    throw workflowError(503, 'No se pudo confirmar el canal. El administrador debe revisar el caso antes de intentar otra asignación.');
  }
  try {
    const channel = await guild.channels.fetch(saved.channelId!);
    if (channel?.type === ChannelType.GuildText) await channel.send({ content: `<@${saved.requesterId}> <@${assigneeId}>\nUn administrador ha asignado la atención de este caso.\n${saved.subject}\n\n${saved.description}`, allowedMentions: { parse: [], users: [...new Set([saved.requesterId, assigneeId])] } });
  } catch { logRecord('support.assignment-notification.failed', { guildId: guild.id, outcome: 'failed' }); }
  return saved;
}
