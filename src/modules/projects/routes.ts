import { routeParam } from '../common/input.js';
import { Router } from 'express';
import { Project } from '../../database/models/Project.js';
import type { ProjectRecord } from '../../database/models/Project.js';
import type { Types } from 'mongoose';
import { WorkItem } from '../../database/models/WorkItem.js';
import { serializeWorkItem } from '../../api/serialize.js';
import type { RequireCapability } from '../permissions/access.js';
import { requireModule } from '../settings/service.js';
import { object, text, strings, date, version, id, cursor, page, boolean } from '../common/input.js';
import { workflowError } from '../workflow/rules.js';

export function projectFields(value: unknown) {
  const body = object(value, ['title', 'description', 'objectives', 'dueAt', 'version', 'archived', 'completedObjectives']);
  return { title: text(body.title, 160), description: text(body.description, 4000, true), objectives: strings(body.objectives, 30, 200), dueAt: date(body.dueAt) };
}
async function serialize(project: ProjectRecord & { _id: Types.ObjectId }) {
  const [counts] = await WorkItem.aggregate<{ taskCount: number; completedTasks: number }>([
    { $match: { guildId: project.guildId, projectId: project._id } },
    { $group: { _id: null, taskCount: { $sum: 1 }, completedTasks: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } } } },
  ]);
  return { _id: String(project._id), guildId: project.guildId, title: project.title, description: project.description,
    objectives: project.objectives, completedObjectives: project.completedObjectives, dueAt: project.dueAt?.toISOString() ?? null,
    archived: project.archived, version: project.version, taskCount: counts?.taskCount ?? 0, completedTasks: counts?.completedTasks ?? 0,
    history: project.history.map((entry) => ({ actorId: entry.actorId, action: entry.action, at: entry.at.toISOString() })) };
}
export function projectRoutes(requireCapability: RequireCapability) {
  const router = Router({ mergeParams: true });
  router.get('/', requireCapability('projects.read'), async (req, res) => {
    const result = page(await Project.find({ guildId: routeParam(req, 'guildId'), ...cursor(req.query.before) }).sort({ _id: -1 }).limit(31).lean());
    const projects = []; for (const project of result.items) projects.push(await serialize(project));
    res.json({ projects, nextCursor: result.nextCursor });
  });
  router.post('/', requireCapability('projects.manage'), async (req, res) => {
    await requireModule(routeParam(req, 'guildId'), 'projects'); const fields = projectFields(req.body);
    const project = await Project.create({ ...fields, guildId: routeParam(req, 'guildId'), history: [{ actorId: req.session.user!.id, action: 'created', at: new Date() }] });
    res.status(201).json({ project: await serialize(project) });
  });
  router.patch('/:projectId', requireCapability('projects.manage'), async (req, res) => {
    await requireModule(routeParam(req, 'guildId'), 'projects');
    const fields = projectFields(req.body); const body = object(req.body, ['title', 'description', 'objectives', 'dueAt', 'version', 'archived', 'completedObjectives']);
    const expected = version(body.version); const archived = boolean(body.archived);
    if (!Array.isArray(body.completedObjectives) || body.completedObjectives.some((index: unknown) => typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= fields.objectives.length)) throw workflowError(400, 'Objetivos completados no validos.');
    const project = await Project.findOneAndUpdate({ guildId: routeParam(req, 'guildId'), _id: id(routeParam(req, 'projectId')), version: expected }, {
      $set: { ...fields, archived, completedObjectives: [...new Set(body.completedObjectives as number[])] }, $inc: { version: 1 },
      $push: { history: { $each: [{ actorId: req.session.user!.id, action: archived ? 'archived' : 'updated', at: new Date() }], $slice: -100 } },
    }, { new: true, runValidators: true });
    if (!project) throw workflowError(409, 'El proyecto cambio o no existe. Actualiza la lista.');
    res.json({ project: await serialize(project) });
  });
  router.get('/:projectId/tasks', requireCapability('projects.read'), requireCapability('workflow.read'), async (req, res) => {
    const projectId = id(routeParam(req, 'projectId'));
    if (!await Project.exists({ _id: projectId, guildId: routeParam(req, 'guildId') })) throw workflowError(404, 'Proyecto no encontrado.');
    const result = page(await WorkItem.find({ guildId: routeParam(req, 'guildId'), projectId, ...cursor(req.query.before) }).sort({ _id: -1 }).limit(31).lean());
    res.json({ items: result.items.map(serializeWorkItem), nextCursor: result.nextCursor });
  });
  router.patch('/:projectId/tasks/:itemId', requireCapability('projects.manage'), requireCapability('workflow.manage'), async (req, res) => {
    await requireModule(routeParam(req, 'guildId'), 'projects'); await requireModule(routeParam(req, 'guildId'), 'workflow');
    const body = object(req.body, ['version', 'attached']); const attached = boolean(body.attached); const projectId = id(routeParam(req, 'projectId'));
    if (!await Project.exists({ _id: projectId, guildId: routeParam(req, 'guildId'), ...(attached ? { archived: false } : {}) })) throw workflowError(404, 'Proyecto no encontrado o archivado.');
    const item = await WorkItem.findOne({ _id: id(routeParam(req, 'itemId')), guildId: routeParam(req, 'guildId') }).lean();
    if (!item || (!attached && String(item.projectId) !== projectId)) throw workflowError(404, 'Tarea no encontrada en este contexto.');
    if (item.version !== version(body.version)) throw workflowError(409, 'La tarea cambio. Actualiza la lista.');
    const updated = await WorkItem.findOneAndUpdate({ _id: item._id, guildId: routeParam(req, 'guildId'), version: version(body.version) }, {
      $set: { projectId: attached ? projectId : null }, $inc: { version: 1 },
      $push: { history: { $each: [{ actorId: req.session.user!.id, status: item.status, at: new Date(), note: `${attached ? 'Vinculada a' : 'Retirada de'} proyecto ${projectId}` }], $slice: -100 } },
    }, { new: true });
    if (!updated) throw workflowError(409, 'La tarea cambio. Actualiza la lista.'); res.json({ item: serializeWorkItem(updated) });
  });
  return router;
}
