import { PermissionFlagsBits } from 'discord.js';
import { requireModule } from '../settings/service.js';
import { assertAvailable } from '../operations/service.js';
import { Router } from 'express';
import type { Guild, GuildMember } from 'discord.js';
import { ModerationCase } from '../../database/models/ModerationCase.js';
import type { ModerationCaseRecord } from '../../database/models/ModerationCase.js';
import type { ModerationMember } from '../../types/contracts.js';
import type { guildAuthorization } from '../permissions/access.js';
import { routeParam, id } from '../common/input.js';
import { workflowError } from '../workflow/rules.js';
import { hasCode } from '../../types/errors.js';
import { serializeSessionUser, discordImage } from '../../discord/images.js';
import { canReview, allowedActions, validateCase } from './rules.js';

async function context(guild: Guild, actorId: string, globalOwner: boolean) {
  await guild.roles.fetch();
  const actor = globalOwner || guild.ownerId === actorId ? null : await guild.members.fetch({ user: actorId, force: true });
  if (actor && !canReview(actor)) throw workflowError(403, 'Necesitas Moderar, Expulsar, Banear miembros o Gestionar servidor en Discord.');
  const me = await guild.members.fetchMe({ force: true });
  return { actor, me, ownerId: guild.ownerId, actorId };
}
async function fetchMember(guild: Guild, memberId: string) {
  try { return await guild.members.fetch({ user: memberId, force: true }); }
  catch (error) {
    if (hasCode(error, 10007)) throw workflowError(404, 'Este usuario no es miembro del servidor. Puedes consultar sus incidentes por ID.');
    throw workflowError(502, 'No se pudo consultar el miembro en Discord.');
  }
}
function serializeMember(member: GuildMember, ctx: Awaited<ReturnType<typeof context>>): ModerationMember {
  const user = serializeSessionUser({ id: member.id, username: member.user.username, global_name: member.user.globalName, avatar: member.user.avatar, discriminator: member.user.discriminator });
  return { id: member.id, name: member.displayName, username: user.username,
    avatar: discordImage(`guilds/${member.guild.id}/users/${member.id}/avatars`, member.avatar) ?? user.avatar ?? null,
    bot: member.user.bot, joinedAt: member.joinedAt?.toISOString() ?? null, createdAt: member.user.createdAt.toISOString(),
    timeoutUntil: member.communicationDisabledUntil?.toISOString() ?? null,
    roles: [...member.roles.cache.values()].filter((role) => role.id !== member.guild.id).sort((a, b) => b.comparePositionTo(a)).map((role) => ({ id: role.id, name: role.name, color: role.hexColor })),
    allowedActions: allowedActions({ ...ctx, target: member }) };
}
function serializeCase(item: ModerationCaseRecord & { _id: unknown }) {
  return { _id: String(item._id), guildId: item.guildId, actorId: item.actorId, targetId: item.targetId, action: item.action,
    reason: item.reason, evidence: item.evidence, durationMinutes: item.durationMinutes, status: item.status, createdAt: item.createdAt.toISOString() };
}
export function moderationRoutes(access: ReturnType<typeof guildAuthorization>) {
  const router = Router({ mergeParams: true });
  router.use(access.requireAny);
  router.use(async (req, res, next) => {
    // Every request verifies live native permissions, including delegated dashboard users.
    res.locals.moderationContext = await context(req.managedGuild!, req.session.user!.id, req.guildAccess!.source === 'bot-owner');
    next();
  });
  router.get('/members', async (req, res) => {
    const guild = req.managedGuild!;
    const after = req.query.after === undefined ? undefined : id(req.query.after, true);
    const ctx = res.locals.moderationContext as Awaited<ReturnType<typeof context>>;
    let members;
    try { members = await guild.members.list({ limit: 31, ...(after ? { after } : {}) }); }
    catch { throw workflowError(502, 'No se pudo listar miembros. Comprueba Server Members Intent en Discord Developer Portal. Puedes consultar un miembro por su ID sin cargar la lista.'); }
    const items = [...members.values()]; const more = items.length > 30; if (more) items.pop();
    res.json({ members: items.map((member) => serializeMember(member, ctx)), nextCursor: more ? items.at(-1)!.id : null });
  });
  router.get('/members/:memberId', async (req, res) => {
    const ctx = res.locals.moderationContext as Awaited<ReturnType<typeof context>>;
    const member = await fetchMember(req.managedGuild!, id(routeParam(req, 'memberId'), true));
    res.json({ member: serializeMember(member, ctx) });
  });
  router.get('/activity', async (req, res) => {
    const guild = req.managedGuild!;
    const ctx = res.locals.moderationContext as Awaited<ReturnType<typeof context>>;
    if (!ctx.me.permissions.has(PermissionFlagsBits.ViewAuditLog) || (ctx.actor && !ctx.actor.permissions.has(PermissionFlagsBits.ViewAuditLog))) throw workflowError(403, 'El usuario y el bot necesitan Ver registro de auditoria en Discord.');
    await assertAvailable(guild.id, 'audit', false);
    await requireModule(guild.id, 'audit');
    const user = req.query.memberId === undefined ? undefined : id(req.query.memberId, true);
    const before = req.query.before === undefined ? undefined : id(req.query.before, true);
    const logs = await guild.fetchAuditLogs({ limit: 31, ...(user ? { user } : {}), ...(before ? { before } : {}) });
    const entries = [...logs.entries.values()]; const more = entries.length > 30; if (more) entries.pop();
    res.json({ entries: entries.map((entry) => ({ id: entry.id, actorId: entry.executorId, action: entry.action, targetId: entry.targetId, reason: entry.reason, at: entry.createdAt.toISOString() })), nextCursor: more ? entries.at(-1)!.id : null });
  });
  router.get('/cases', async (req, res) => {
    const guildId = routeParam(req, 'guildId');
    const targetId = req.query.memberId === undefined ? undefined : id(req.query.memberId, true);
    const before = req.query.before === undefined ? undefined : id(req.query.before);
    const items = await ModerationCase.find({ guildId, ...(targetId ? { targetId } : {}), ...(before ? { _id: { $lt: before } } : {}) }).sort({ _id: -1 }).limit(31).lean();
    const more = items.length > 30; if (more) items.pop();
    res.json({ cases: items.map(serializeCase), nextCursor: more ? String(items.at(-1)!._id) : null });
  });
  router.post('/members/:memberId/cases', async (req, res) => {
    const guild = req.managedGuild!, targetId = id(routeParam(req, 'memberId'), true), actorId = req.session.user!.id;
    const input = validateCase(req.body, guild.id);
    const existing = await ModerationCase.findOne({ guildId: guild.id, requestId: input.requestId });
    if (existing) {
      if (existing.actorId !== actorId || existing.targetId !== targetId || existing.action !== input.action || existing.reason !== input.reason || existing.durationMinutes !== input.durationMinutes || JSON.stringify(existing.evidence) !== JSON.stringify(input.evidence)) throw workflowError(409, 'Este identificador ya pertenece a otra operacion.');
      res.json({ item: serializeCase(existing) }); return;
    }
    const ctx = await context(guild, actorId, req.guildAccess!.source === 'bot-owner');
    const target = await fetchMember(guild, targetId);
    if (!allowedActions({ ...ctx, target }).includes(input.action)) throw workflowError(403, 'La accion no esta permitida por tus permisos, los del bot o la jerarquia de este miembro.');
    let item;
    try { item = await ModerationCase.create({ guildId: guild.id, actorId, targetId, ...input, status: 'pending' }); }
    catch (error) {
      if (hasCode(error, 11000)) throw workflowError(409, 'La operacion ya esta registrada. Recarga el historial; no repitas la accion con otro identificador.');
      throw error;
    }
    const auditReason = `Magelina / ${actorId} / caso ${item.id}: ${input.reason}`.slice(0, 480);
    let outcome: 'applied' | 'failed' | 'uncertain' = 'applied';
    try {
      if (input.action === 'timeout') await target.timeout(input.durationMinutes! * 60_000, auditReason);
      else if (input.action === 'untimeout') await target.timeout(null, auditReason);
      else if (input.action === 'kick') await target.kick(auditReason);
      else if (input.action === 'ban') await target.ban({ deleteMessageSeconds: 0, reason: auditReason });
      // warning is an internal record: no unsolicited DM or channel message.
    } catch (error) {
      // A Discord rejection is definitive. Network failures may follow an applied action.
      outcome = typeof error === 'object' && error !== null && 'status' in error && typeof error.status === 'number' && error.status >= 400 && error.status < 500 && error.status !== 429 ? 'failed' : 'uncertain';
    }
    item.status = outcome;
    logRecord('moderation.action', { guildId: guild.id, action: input.action, outcome });
    let warning: string | undefined;
    try { await item.save(); }
    catch { item.status = 'pending'; warning = 'Discord ya recibio la operacion, pero no se pudo guardar su resultado. Verifica el miembro y la auditoria antes de intentar otra accion.'; }
    if (outcome === 'failed') warning = 'Discord rechazo la accion. Comprueba los permisos y la jerarquia; el intento quedo registrado.';
    if (outcome === 'uncertain') warning = 'No se pudo confirmar el resultado de Discord. Verifica el miembro y la auditoria antes de intentar otra accion.';
    res.status(201).json({ item: serializeCase(item), warning });
  });
  return router;
}
import { logRecord } from '../../observability/logging.js';
