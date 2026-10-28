import { Router } from 'express';
import { ModerationFollowup } from '../../database/models/ModerationFollowup.js';
import { ModerationCase } from '../../database/models/ModerationCase.js';
import { id, routeParam } from '../common/input.js';
import { workflowError } from '../workflow/rules.js';
import { hasCode } from '../../types/errors.js';
import { followupInput, newFollowupInput } from './followup-rules.js';
// Mounted after the live moderation authorization middleware.
export function followupRoutes() {
  const router = Router({ mergeParams: true });
  router.get('/', async (req,res) => {
    const filter = req.query.state;
    if (filter !== undefined && !['report','review','followup','closed'].includes(String(filter))) throw workflowError(400,'Filtro no valido.');
    const before = req.query.before === undefined ? undefined : id(req.query.before);
    const items = await ModerationFollowup.find({ guildId: req.managedGuild!.id, ...(filter ? { state: String(filter) } : { state: { $ne: 'closed' } }), ...(before ? { _id: { $lt: before } } : {}) }).sort({ _id: -1 }).limit(31).lean();
    const more = items.length > 30; if (more) items.pop();
    res.json({ items, nextCursor: more ? String(items.at(-1)!._id) : null });
  });
  router.post('/', async (req,res) => {
    const input = newFollowupInput(req.body), guildId = req.managedGuild!.id, actorId = req.session.user!.id;
    if (input.caseId && !await ModerationCase.exists({ _id: input.caseId, guildId, targetId: input.targetId })) throw workflowError(404,'La medida no corresponde a este miembro y servidor.');
    const existing = await ModerationFollowup.findOne({ guildId, requestId: input.requestId });
    if (existing) {
      if (existing.actorId !== actorId || existing.targetId !== input.targetId || existing.summary !== input.summary || existing.caseId !== input.caseId || existing.history[0]?.reviewAt?.getTime() !== input.reviewAt.getTime()) throw workflowError(409,'La solicitud ya pertenece a otro seguimiento.');
      res.json({ item: existing }); return;
    }
    try {
      const item = await ModerationFollowup.create({ ...input, guildId, actorId, history: [{ actorId, at: new Date(), state: 'report', assessment: 'unconfirmed', note: input.summary, reviewAt: input.reviewAt }] });
      res.status(201).json({ item });
    } catch (error) { if (hasCode(error,11000)) throw workflowError(409,'La solicitud ya se registro. Actualiza la lista antes de reintentar.'); throw error; }
  });
  router.patch('/:followupId', async (req,res) => {
    const input = followupInput(req.body), guildId = req.managedGuild!.id, actorId = req.session.user!.id;
    const current = await ModerationFollowup.findOne({ _id: id(routeParam(req,'followupId')), guildId }).lean();
    if (!current) throw workflowError(404,'Seguimiento no encontrado.');
    if (current.history.length >= 200) throw workflowError(409,'Se alcanzo el limite de revisiones de este seguimiento.');
    if (current.assigneeId && current.assigneeId !== actorId && !req.guildAccess!.canConfigure && req.guildAccess!.source !== 'bot-owner') throw workflowError(403,'Este seguimiento esta asignado a otro moderador. Solicita al responsable del servidor que lo reasigne.');
    if (input.state !== 'report' && !current.assigneeId && !input.claim) throw workflowError(400,'Asume el seguimiento antes de revisarlo.');
    const assigneeId = input.claim ? actorId : current.assigneeId;
    const { version, note, claim, ...changes } = input;
    const item = await ModerationFollowup.findOneAndUpdate({ _id: current._id, guildId, version }, { $set: { ...changes, assigneeId }, $inc: { version: 1 }, $push: { history: { actorId, at: new Date(), ...changes, assigneeId, note } } }, { new: true, runValidators: true });
    if (!item) throw workflowError(409,'Otro moderador actualizo el seguimiento. Recarga antes de guardar.');
    res.json({ item });
  });
  return router;
}
