import { Router } from 'express';
import { SupportAgent } from '../../database/models/SupportAgent.js';
import { SupportTicket } from '../../database/models/SupportTicket.js';
import { supportContext } from './service.js';
import { reportTypes } from './report-types.js';
import { object, id, version, routeParam } from '../common/input.js';
import { workflowError } from '../workflow/rules.js';
import { canReview } from '../moderation/rules.js';
import { hasCode } from '../../types/errors.js';

export function agentFields(body: unknown) {
  const input = object(body, ['userId', 'available', 'maxCases', 'specialties', 'version']);
  if (typeof input.available !== 'boolean' || !Number.isInteger(input.maxCases) || Number(input.maxCases) < 1 || Number(input.maxCases) > 50) throw workflowError(400, 'Indica disponibilidad y un límite de 1 a 50 casos.');
  if (!Array.isArray(input.specialties) || input.specialties.length > reportTypes.length || input.specialties.some(value => !reportTypes.some(type => type.value === value))) throw workflowError(400, 'Selecciona especialidades válidas.');
  return { available: input.available, maxCases: Number(input.maxCases), specialties: [...new Set(input.specialties as string[])] };
}

export function supportTeamRoutes() {
  const router = Router({ mergeParams: true });
  router.use(async (req, _res, next) => {
    const ctx = await supportContext(req.managedGuild!, req.session.user!.id, req.guildAccess!.source === 'bot-owner');
    if (!ctx.canModerate) throw workflowError(403, 'Esta sección está reservada al equipo de soporte.');
    next();
  });
  router.get('/', async (req, res) => {
    const guild = req.managedGuild!, actorId = req.session.user!.id;
    const ctx = await supportContext(guild, actorId, req.guildAccess!.source === 'bot-owner');
    const agents = await SupportAgent.find({ guildId: guild.id, ...(!ctx.canAdmin ? { userId: actorId } : {}) }).sort({ userId: 1 }).limit(100).lean();
    const members = await Promise.all(agents.map(async agent => {
      const member = await guild.members.fetch({ user: agent.userId, force: true }).catch(() => null);
      const activeCases = await SupportTicket.countDocuments({ guildId: guild.id, assigneeId: agent.userId, active: true });
      return { ...agent, name: member?.displayName ?? agent.userId, eligible: Boolean(member && !member.user.bot && (member.id === guild.ownerId || canReview(member))), activeCases };
    }));
    res.json({ members, canAdmin: ctx.canAdmin, reportTypes });
  });
  router.put('/:userId', async (req, res) => {
    const guild = req.managedGuild!, actorId = req.session.user!.id, userId = id(routeParam(req, 'userId'), true);
    const ctx = await supportContext(guild, actorId, req.guildAccess!.source === 'bot-owner');
    const fields = agentFields(req.body), expected = version(req.body.version);
    if (!ctx.canAdmin) {
      const current = await SupportAgent.findOne({ guildId: guild.id, userId }).lean();
      if (userId !== actorId || !current || fields.maxCases !== current.maxCases || JSON.stringify([...fields.specialties].sort()) !== JSON.stringify([...current.specialties].sort())) throw workflowError(403, 'Solo puedes cambiar tu disponibilidad. El administrador configura capacidad y especialidades.');
    }
    const member = await guild.members.fetch({ user: userId, force: true });
    if (member.user.bot || (member.id !== guild.ownerId && !canReview(member))) throw workflowError(400, 'Selecciona un moderador o administrador actual del servidor.');
    try {
      const item = await SupportAgent.findOneAndUpdate({ guildId: guild.id, userId, version: expected }, { $set: fields, $inc: { version: 1 } }, { new: true, upsert: ctx.canAdmin && expected === 0, runValidators: true });
      if (!item) throw workflowError(409, 'La configuración cambió. Actualiza antes de guardar.');
      res.json({ item });
    } catch (error) { if (hasCode(error, 11000)) throw workflowError(409, 'La configuración cambió. Actualiza antes de guardar.'); throw error; }
  });
  return router;
}
