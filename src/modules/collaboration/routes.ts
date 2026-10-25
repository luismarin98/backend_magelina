import { routeParam } from '../common/input.js';
import { Router } from 'express';
import { CollaborationProfile, Mentorship } from '../../database/models/Collaboration.js';
import type { MentorshipRecord } from '../../database/models/Collaboration.js';
import type { Types } from 'mongoose';
import type { RequireCapability } from '../permissions/access.js';
import { requireModule } from '../settings/service.js';
import { object, text, strings, boolean, version, id, cursor, page } from '../common/input.js';
import { workflowError } from '../workflow/rules.js';
import { hasCode } from '../../types/errors.js';

export function profileFields(value: unknown) {
  const body = object(value, ['bio', 'offers', 'seeks', 'available', 'version']);
  return { bio: text(body.bio, 1200, true), offers: strings(body.offers, 12, 50).map((s) => s.toLowerCase()), seeks: strings(body.seeks, 12, 50).map((s) => s.toLowerCase()), available: boolean(body.available) };
}
const serialize = (item: MentorshipRecord & { _id: Types.ObjectId }) => ({ _id: String(item._id), mentorId: item.mentorId, learnerId: item.learnerId, goal: item.goal,
  status: item.status, acceptedBy: item.acceptedBy, version: item.version, history: item.history.map((entry) => ({ actorId: entry.actorId, action: entry.action, at: entry.at.toISOString() })) });

export function collaborationRoutes(requireCapability: RequireCapability) {
  const router = Router({ mergeParams: true });
  router.get('/', requireCapability('collaboration.read'), async (req, res) => {
    const profiles = page(await CollaborationProfile.find({ guildId: routeParam(req, 'guildId'), ...cursor(req.query.before) }).sort({ _id: -1 }).limit(31).lean());
    const mentorships = page(await Mentorship.find({ guildId: routeParam(req, 'guildId'), ...cursor(req.query.mentorshipBefore) }).sort({ _id: -1 }).limit(31).lean());
    res.json({ profiles: profiles.items.map(({ userId, bio, offers, seeks, available, version }) => ({ userId, bio, offers, seeks, available, version })),
      mentorships: mentorships.items.map(serialize), nextCursor: profiles.nextCursor, nextMentorshipCursor: mentorships.nextCursor });
  });
  router.get('/me', requireCapability('collaboration.read'), async (req, res) => {
    const profile = await CollaborationProfile.findOne({ guildId: routeParam(req, 'guildId'), userId: req.session.user!.id }).lean();
    res.json({ profile: profile ? { userId: profile.userId, bio: profile.bio, offers: profile.offers, seeks: profile.seeks, available: profile.available, version: profile.version } : null });
  });
  router.get('/matches', requireCapability('collaboration.read'), async (req, res) => {
    const own = await CollaborationProfile.findOne({ guildId: routeParam(req, 'guildId'), userId: req.session.user!.id }).lean();
    if (!own || !own.available || (!own.offers.length && !own.seeks.length)) return res.json({ profiles: [], nextCursor: null });
    const result = page(await CollaborationProfile.find({ guildId: routeParam(req, 'guildId'), userId: { $ne: own.userId }, available: true,
      $or: [{ offers: { $in: own.seeks } }, { seeks: { $in: own.offers } }], ...cursor(req.query.before) }).sort({ _id: -1 }).limit(31).lean());
    res.json({ profiles: result.items.map((profile) => ({ userId: profile.userId, bio: profile.bio, offers: profile.offers, seeks: profile.seeks, available: profile.available, version: profile.version,
      matches: [...new Set([...profile.offers.filter((skill) => own.seeks.includes(skill)), ...profile.seeks.filter((skill) => own.offers.includes(skill))])] })), nextCursor: result.nextCursor });
  });
  router.put('/me', requireCapability('collaboration.read'), async (req, res) => {
    await requireModule(routeParam(req, 'guildId'), 'collaboration');
    const fields = profileFields(req.body); const expected = version((req.body as Record<string, unknown>).version);
    try {
      const profile = await CollaborationProfile.findOneAndUpdate({ guildId: routeParam(req, 'guildId'), userId: req.session.user!.id, version: expected }, { $set: fields, $inc: { version: 1 } }, { new: true, upsert: expected === 0, runValidators: true });
      if (!profile) throw workflowError(409, 'Tu perfil cambio. Recarga antes de guardar.');
      res.json({ profile: { userId: profile.userId, bio: profile.bio, offers: profile.offers, seeks: profile.seeks, available: profile.available, version: profile.version } });
    } catch (error) { if (hasCode(error, 11000)) throw workflowError(409, 'Tu perfil cambio. Recarga antes de guardar.'); throw error; }
  });
  router.post('/mentorships', requireCapability('collaboration.manage'), async (req, res) => {
    await requireModule(routeParam(req, 'guildId'), 'collaboration'); const body = object(req.body, ['mentorId', 'learnerId', 'goal']);
    const mentorId = id(body.mentorId, true); const learnerId = id(body.learnerId, true); if (mentorId === learnerId) throw workflowError(400, 'Selecciona dos personas distintas.');
    const profiles = await CollaborationProfile.countDocuments({ guildId: routeParam(req, 'guildId'), userId: { $in: [mentorId, learnerId] }, available: true });
    if (profiles !== 2) throw workflowError(400, 'Ambos participantes deben tener un perfil disponible.');
    for (const user of [mentorId, learnerId]) {
      const member = await req.managedGuild!.members.fetch({ user, force: true }).catch((error: unknown) => {
        if (hasCode(error, 10007) || hasCode(error, 10013)) throw workflowError(400, 'Un participante ya no pertenece al servidor.');
        throw workflowError(502, 'No se pudo verificar a los participantes en Discord.');
      });
      if (member.user.bot) throw workflowError(400, 'Los participantes deben ser personas.');
    }
    const item = await Mentorship.create({ guildId: routeParam(req, 'guildId'), mentorId, learnerId, goal: text(body.goal, 1000), history: [{ actorId: req.session.user!.id, action: 'proposed', at: new Date() }] });
    res.status(201).json({ mentorship: serialize(item) });
  });
  router.patch('/mentorships/:mentorshipId', requireCapability('collaboration.read'), async (req, res) => {
    await requireModule(routeParam(req, 'guildId'), 'collaboration'); const body = object(req.body, ['action', 'version']); const expected = version(body.version);
    const item = await Mentorship.findOne({ _id: id(routeParam(req, 'mentorshipId')), guildId: routeParam(req, 'guildId') }).lean();
    if (!item) throw workflowError(404, 'Mentoria no encontrada.');
    if (item.version !== expected) throw workflowError(409, 'La mentoria cambio. Actualiza la lista.');
    const actor = req.session.user!.id; const participant = actor === item.mentorId || actor === item.learnerId;
    const manager = req.guildAccess!.capabilities.includes('collaboration.manage');
    let status = item.status; let acceptedBy = item.acceptedBy;
    if (body.action === 'accept' && participant && item.status === 'pending' && !item.acceptedBy.includes(actor)) {
      acceptedBy = [...item.acceptedBy, actor]; if (acceptedBy.length === 2) status = 'active';
    } else if (body.action === 'complete' && (participant || manager) && item.status === 'active') status = 'completed';
    else if (body.action === 'cancel' && (participant || manager) && ['pending', 'active'].includes(item.status)) status = 'cancelled';
    else throw workflowError(403, 'No puedes realizar esa transicion. Cada participante debe aceptar por si mismo.');
    const updated = await Mentorship.findOneAndUpdate({ _id: item._id, guildId: routeParam(req, 'guildId'), version: expected, status: item.status }, { $set: { status, acceptedBy }, $inc: { version: 1 },
      $push: { history: { $each: [{ actorId: actor, action: String(body.action), at: new Date() }], $slice: -100 } } }, { new: true });
    if (!updated) throw workflowError(409, 'La mentoria cambio. Actualiza la lista.'); res.json({ mentorship: serialize(updated) });
  });
  return router;
}
