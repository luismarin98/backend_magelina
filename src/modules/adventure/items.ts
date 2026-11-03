import { Router } from 'express';
import { AdventureItem } from '../../database/models/AdventureItem.js';
import { AdventureCharacter, AdventureMembership } from '../../database/models/Adventure.js';
import { object, text, version, cursor, page, id, routeParam } from '../common/input.js';
import { workflowError } from '../workflow/rules.js';

export const itemIcons = ['sword', 'shield', 'potion', 'gem', 'leaf', 'scroll', 'crown', 'sparkles'];
export const itemCategories = ['cosmetic', 'equipment', 'material', 'consumable'];
export function itemInput(body: unknown) {
  const input = object(body, ['name', 'description', 'category', 'icon', 'version']);
  if (!itemCategories.includes(String(input.category)) || !itemIcons.includes(String(input.icon))) throw workflowError(400, 'Selecciona una categoría e icono válidos.');
  return { name: text(input.name, 80), description: text(input.description, 1000), category: String(input.category), icon: String(input.icon),
    hasImage: false };
}

export function adventureItemRoutes() {
  const router = Router({ mergeParams: true });
  router.use(async (req, _res, next) => {
    const reviewRead = ['GET', 'HEAD'].includes(req.method) && (['review', 'catalog'].includes(String(req.query.mode)) || /^\/[^/]+\/image$/.test(req.path));
    const reviewWrite = req.method === 'POST' && /^\/[^/]+\/review$/.test(req.path);
    if (reviewer(req) && (reviewRead || reviewWrite)) { next(); return; }
    const userId = req.session.user!.id;
    const [character, membership] = await Promise.all([AdventureCharacter.findOne({ userId }).lean(), AdventureMembership.findOne({ userId, guildId: req.managedGuild!.id }).lean()]);
    if (!character || !membership) throw workflowError(409, 'Crea tu personaje e inscríbete en este gremio antes de diseñar objetos.');
    next();
  });
  const reviewer = (req: Parameters<import('express').RequestHandler>[0]) => req.guildAccess?.source === 'bot-owner';
  const dto = (item: any, userId: string) => ({ _id: String(item._id), name: item.name, description: item.description, category: item.category, icon: item.icon, hasImage: item.hasImage, status: item.status, version: item.version, reviewReason: item.status === 'rejected' ? item.reviewReason : null, canEdit: item.creatorId === userId && ['draft', 'rejected'].includes(item.status) });
  router.get('/', async (req, res) => {
    const mode = req.query.mode ?? 'mine';
    if (!['mine', 'catalog', 'review'].includes(String(mode))) throw workflowError(400, 'Vista de objetos no válida.');
    if (mode === 'review' && !reviewer(req)) throw workflowError(403, 'La revisión global está reservada al propietario de Magelina.');
    const filter = mode === 'mine' ? { creatorId: req.session.user!.id } : { status: mode === 'catalog' ? 'approved' : 'submitted' };
    const result = page(await AdventureItem.find({ ...filter, ...cursor(req.query.before) }).sort({ _id: -1 }).limit(11).lean(), 10);
    res.json({ items: result.items.map(item => dto(item, req.session.user!.id)), nextCursor: result.nextCursor, canReview: reviewer(req) });
  });
  router.get('/:itemId/image', async (req, res) => {
    const item = await AdventureItem.findOne({ _id: id(routeParam(req, 'itemId')), $or: [{ creatorId: req.session.user!.id }, { status: 'approved' }, ...(reviewer(req) ? [{ status: 'submitted' }] : [])] }).select('+imageData');
    if (!item?.imageData) throw workflowError(404, 'Imagen no encontrada.');
    res.set({ 'Content-Type': 'image/png', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store' }).send(item.imageData);
  });
  router.post('/', async (req, res) => {
    const fields = itemInput(req.body);
    const item = await AdventureItem.create({ ...fields, creatorId: req.session.user!.id, originGuildId: req.managedGuild!.id, history: [{ actorId: req.session.user!.id, action: 'created', at: new Date() }] });
    res.status(201).json({ item: dto(item, req.session.user!.id) });
  });
  router.patch('/:itemId', async (req, res) => {
    const fields = itemInput(req.body);
    const item = await AdventureItem.findOneAndUpdate({ _id: id(routeParam(req, 'itemId')), creatorId: req.session.user!.id, status: { $in: ['draft', 'rejected'] }, version: version(req.body.version) }, { $set: { ...fields, status: 'draft', reviewReason: null }, $unset: { imageData: 1 }, $inc: { version: 1 }, $push: { history: { actorId: req.session.user!.id, action: 'edited', at: new Date() } } }, { new: true, runValidators: true });
    if (!item) throw workflowError(409, 'El diseño cambió, no te pertenece o ya está en revisión.');
    res.json({ item: dto(item, req.session.user!.id) });
  });
  router.post('/:itemId/submit', async (req, res) => {
    const input = object(req.body, ['version']);
    const item = await AdventureItem.findOneAndUpdate({ _id: id(routeParam(req, 'itemId')), creatorId: req.session.user!.id, category: 'cosmetic', status: 'draft', version: version(input.version) }, { $set: { status: 'submitted' }, $inc: { version: 1 }, $push: { history: { actorId: req.session.user!.id, action: 'submitted', at: new Date() } } }, { new: true });
    if (!item) throw workflowError(409, 'Solo se pueden enviar borradores cosméticos propios y actualizados.');
    res.json({ item: dto(item, req.session.user!.id) });
  });
  router.post('/:itemId/review', async (req, res) => {
    if (!reviewer(req)) throw workflowError(403, 'Solo el propietario de Magelina puede aprobar contenido global.');
    const input = object(req.body, ['version', 'decision', 'reason']);
    if (!['approved', 'rejected'].includes(String(input.decision))) throw workflowError(400, 'Decisión no válida.');
    const reason = input.decision === 'rejected' ? text(input.reason, 600) : null;
    const item = await AdventureItem.findOneAndUpdate({ _id: id(routeParam(req, 'itemId')), category: 'cosmetic', status: 'submitted', version: version(input.version) }, { $set: { status: input.decision, reviewReason: reason }, $inc: { version: 1 }, $push: { history: { actorId: req.session.user!.id, action: input.decision, reason, at: new Date() } } }, { new: true, runValidators: true });
    if (!item) throw workflowError(409, 'La propuesta cambió o ya fue revisada.');
    res.json({ item: dto(item, req.session.user!.id) });
  });
  return router;
}
