import { routeParam } from '../common/input.js';
import { Router } from 'express';
import type { RequireCapability } from '../permissions/access.js';
import { AutomationRule, AutomationJob } from '../../database/models/Automation.js';
import { requireModule } from '../settings/service.js';
import { availableChannels } from '../settings/routes.js';
import { ruleFields, serializeJob, serializeRule } from './service.js';
import { object, id, version, cursor, page } from '../common/input.js';
import { workflowError } from '../workflow/rules.js';
import { logEvent } from '../operations/service.js';

export function automationRoutes(requireCapability: RequireCapability) {
  const router = Router({ mergeParams: true });
  router.get('/', requireCapability('automations.read'), async (req, res) => {
    const rules = page(await AutomationRule.find({ guildId: routeParam(req, 'guildId'), ...cursor(req.query.before) }).sort({ _id: -1 }).limit(31).lean());
    const jobs = page(await AutomationJob.find({ guildId: routeParam(req, 'guildId'), ...cursor(req.query.jobBefore) }).sort({ _id: -1 }).limit(31).lean());
    res.json({ rules: rules.items.map(serializeRule), jobs: jobs.items.map(serializeJob), nextCursor: rules.nextCursor, nextJobCursor: jobs.nextCursor });
  });
  router.get('/channels', requireCapability('automations.manage'), async (req, res) => { res.json({ channels: await availableChannels(req.managedGuild!, req.session.user!.id, req.guildAccess?.source === 'bot-owner') }); });
  const validateChannel = async (req: import('express').Request, channelId: string) => {
    const channels = await availableChannels(req.managedGuild!, req.session.user!.id, req.guildAccess?.source === 'bot-owner');
    if (!channels.some((channel) => channel.id === channelId && channel.canSend)) throw workflowError(400, 'Selecciona un canal del servidor donde tu y el bot tengais acceso para enviar avisos.');
  };
  router.post('/', requireCapability('automations.manage'), async (req, res) => {
    await requireModule(routeParam(req, 'guildId'), 'automations'); const fields = ruleFields(req.body); await validateChannel(req, fields.channelId);
    const rule = await AutomationRule.create({ ...fields, guildId: routeParam(req, 'guildId'), createdBy: req.session.user!.id, history: [{ actorId: req.session.user!.id, at: new Date() }] });
    res.status(201).json({ rule: serializeRule(rule) });
  });
  router.patch('/:ruleId', requireCapability('automations.manage'), async (req, res) => {
    await requireModule(routeParam(req, 'guildId'), 'automations'); const fields = ruleFields(req.body); await validateChannel(req, fields.channelId);
    const body = object(req.body, ['title', 'trigger', 'channelId', 'delayMinutes', 'enabled', 'version']);
    const rule = await AutomationRule.findOneAndUpdate({ _id: id(routeParam(req, 'ruleId')), guildId: routeParam(req, 'guildId'), version: version(body.version) }, { $set: fields, $inc: { version: 1 },
      $push: { history: { $each: [{ actorId: req.session.user!.id, at: new Date() }], $slice: -100 } } }, { new: true, runValidators: true });
    if (!rule) throw workflowError(409, 'La regla cambio. Actualiza la lista.'); res.json({ rule: serializeRule(rule) });
  });
  router.post('/jobs/:jobId/retry', requireCapability('automations.manage'), async (req, res) => {
    await requireModule(routeParam(req, 'guildId'), 'automations');
    const job = await AutomationJob.findOneAndUpdate({ _id: id(routeParam(req, 'jobId')), guildId: routeParam(req, 'guildId'), status: 'failed' }, { $set: { status: 'pending', attempts: 0, dueAt: new Date(), error: null, lockToken: null, lockUntil: null } }, { new: true });
    if (!job) throw workflowError(409, 'Solo se pueden reintentar avisos fallidos.');
    await logEvent('job.retry', `Aviso ${job.id} reintentado por ${req.session.user!.id}`, job.guildId);
    res.json({ job: serializeJob(job) });
  });
  return router;
}
