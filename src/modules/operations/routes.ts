import { routeParam } from '../common/input.js';
import { Router } from 'express';
import type { Config } from '../../config/env.js';
import { getControls, saveControls, logEvent } from './service.js';
import { SystemEvent } from '../../database/models/BotControl.js';
import { AutomationJob } from '../../database/models/Automation.js';
import { serializeJob } from '../automations/service.js';
import { cursor, page, id } from '../common/input.js';
import { workflowError } from '../workflow/rules.js';

export function operationRoutes(config: Config) {
  const router = Router();
  router.get('/', async (req, res) => {
    const controls = await getControls();
    const jobs = page(await AutomationJob.find(cursor(req.query.jobBefore)).sort({ _id: -1 }).limit(31).lean());
    const events = page(await SystemEvent.find(cursor(req.query.eventBefore)).sort({ _id: -1 }).limit(31).lean());
    res.json({ controls: { maintenance: controls.maintenance, disabledModules: controls.disabledModules, blockedGuildIds: controls.blockedGuildIds,
      requestsPerMinute: controls.requestsPerMinute, jobsPerTick: controls.jobsPerTick, operatorIds: controls.version === 0 ? config.operatorIds : controls.operatorIds, version: controls.version,
      history: controls.history.map((entry) => ({ actorId: entry.actorId, at: entry.at.toISOString(), before: entry.before, after: entry.after })) },
      jobs: jobs.items.map(serializeJob), events: events.items.map((event) => ({ _id: String(event._id), kind: event.kind, guildId: event.guildId, message: event.message, at: event.at.toISOString() })), nextJobCursor: jobs.nextCursor, nextEventCursor: events.nextCursor });
  });
  router.patch('/', async (req, res) => {
    if (!config.ownerIds.includes(req.session.user!.id)) throw workflowError(403, 'Solo el propietario del bot puede cambiar los controles globales.');
    await saveControls(req.session.user!.id, req.body, config.operatorIds);
    res.status(204).end();
  });
  router.post('/jobs/:jobId/retry', async (req, res) => {
    const job = await AutomationJob.findOneAndUpdate({ _id: id(routeParam(req, 'jobId')), status: 'failed' }, { $set: { status: 'pending', attempts: 0, error: null, dueAt: new Date(), lockToken: null, lockUntil: null } }, { new: true });
    if (!job) throw workflowError(409, 'Solo se pueden reintentar avisos fallidos.');
    await logEvent('admin.job.retry', `Aviso ${job.id} reintentado por ${req.session.user!.id}`, job.guildId);
    res.json({ job: serializeJob(job) });
  });
  return router;
}
