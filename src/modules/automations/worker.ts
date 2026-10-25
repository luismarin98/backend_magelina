import { randomUUID } from 'node:crypto';
import { logRecord } from '../../observability/logging.js';
import type { Client } from 'discord.js';
import { AutomationJob, AutomationRule } from '../../database/models/Automation.js';
import { KnowledgeArticle } from '../../database/models/KnowledgeArticle.js';
import { Project } from '../../database/models/Project.js';
import { WorkItem } from '../../database/models/WorkItem.js';
import { getControls, logEvent } from '../operations/service.js';
import { getSettings } from '../settings/service.js';
import { enqueue } from './service.js';

export function retryDelay(attempts: number): number { return Math.min(3600000, 30000 * 2 ** Math.max(0, attempts - 1)); }

export interface AutomationTransport { isReady: () => boolean; send: (guildId: string, channelId: string, content: string) => Promise<void> }
export function createAutomationWorker(transport: AutomationTransport) {
  let stopping = false; let running: Promise<void> | undefined;
  let ruleCursor: import('mongoose').Types.ObjectId | undefined;
  const resourceCursors = new Map<string, import('mongoose').Types.ObjectId>();
  async function discover() {
    const controls = await getControls(); if (controls.maintenance || controls.disabledModules.includes('automations')) return;
    const rules = await AutomationRule.find({ enabled: true, guildId: { $nin: controls.blockedGuildIds }, ...(ruleCursor ? { _id: { $gt: ruleCursor } } : {}) }).sort({ _id: 1 }).limit(25).lean();
    ruleCursor = rules.length === 25 ? rules.at(-1)!._id : undefined;
    for (const rule of rules) {
      if (stopping) break;
      const settings = await getSettings(rule.guildId);
      const module = rule.trigger.startsWith('task.') ? 'workflow' : rule.trigger === 'knowledge.review_due' ? 'knowledge' : 'projects';
      if (!settings.modules.automations || !settings.modules[module] || controls.disabledModules.includes(module)) continue;
      const key = String(rule._id); const after = resourceCursors.get(key);
      const filter = { guildId: rule.guildId, archived: false, ...(after ? { _id: { $gt: after } } : {}) };
      const taskStatus = rule.trigger === 'task.accepted' ? 'accepted' : 'completed';
      const resources = rule.trigger.startsWith('task.') ?
        (await WorkItem.find({ guildId: rule.guildId, history: { $elemMatch: { status: taskStatus, at: { $gte: rule.createdAt }, note: { $exists: false } } }, ...(after ? { _id: { $gt: after } } : {}) }).sort({ _id: 1 }).limit(50).lean())
          .map((item) => ({ _id: item._id, date: [...item.history].reverse().find((entry) => !entry.note && entry.status === taskStatus)?.at ?? new Date(0) })) : rule.trigger === 'knowledge.review_due' ?
        (await KnowledgeArticle.find({ ...filter, reviewDueAt: { $lte: new Date() } }).sort({ _id: 1 }).limit(50).lean()).map((item) => ({ _id: item._id, date: item.reviewDueAt })) :
        (await Project.find({ ...filter, dueAt: { $ne: null, $lte: new Date() } }).sort({ _id: 1 }).limit(50).lean()).map((item) => ({ _id: item._id, date: item.dueAt! }));
      if (resources.length === 50) resourceCursors.set(key, resources.at(-1)!._id); else resourceCursors.delete(key);
      for (const item of resources) if (!rule.trigger.startsWith('task.') || item.date >= rule.createdAt) await enqueue(rule, item._id, item.date.toISOString(), new Date(item.date.getTime() + rule.delayMinutes * 60000));
    }
    if (resourceCursors.size > 10000) resourceCursors.clear();
  }
  async function deliver() {
    const controls = await getControls();
    if (controls.maintenance || controls.disabledModules.includes('automations') || !transport.isReady()) return;
    await AutomationJob.updateMany({ status: 'processing', lockUntil: { $lte: new Date() }, attempts: { $gte: 5 } }, { $set: { status: 'failed', error: 'Se agoto el numero de intentos tras un reinicio.' } });
    for (let index = 0; index < controls.jobsPerTick && !stopping; index++) {
      const token = randomUUID(); const now = new Date();
      const job = await AutomationJob.findOneAndUpdate({ guildId: { $nin: controls.blockedGuildIds }, attempts: { $lt: 5 }, $or: [{ status: 'pending', dueAt: { $lte: now } }, { status: 'processing', lockUntil: { $lte: now } }] }, {
        $set: { status: 'processing', lockToken: token, lockUntil: new Date(Date.now() + 120000) }, $inc: { attempts: 1 },
      }, { new: true, sort: { dueAt: 1 } });
      if (!job) break;
      const claim = { _id: job._id, status: 'processing', lockToken: token };
      try {
        const latest = await getControls(); const settings = await getSettings(job.guildId);
        if (latest.maintenance || latest.blockedGuildIds.includes(job.guildId) || latest.disabledModules.includes('automations') || !settings.modules.automations) {
          await AutomationJob.updateOne(claim, { $set: { status: 'pending', dueAt: new Date(Date.now() + 60000), lockToken: null, lockUntil: null }, $inc: { attempts: -1 } }); continue;
        }
        const module = job.trigger.startsWith('task.') ? 'workflow' : job.trigger === 'project.deadline' ? 'projects' : 'knowledge';
        if (!settings.modules[module] || latest.disabledModules.includes(module)) {
          await AutomationJob.updateOne(claim, { $set: { status: 'pending', dueAt: new Date(Date.now() + 60000), lockToken: null, lockUntil: null }, $inc: { attempts: -1 } }); continue;
        }
        const rule = await AutomationRule.findOne({ _id: job.ruleId, guildId: job.guildId, enabled: true, version: job.ruleVersion }).lean();
        let valid = Boolean(rule);
        if (job.trigger === 'knowledge.review_due') {
          const source = await KnowledgeArticle.findOne({ _id: job.resourceId, guildId: job.guildId, archived: false }).lean(); valid = valid && source?.reviewDueAt.toISOString() === job.fingerprint;
        } else if (job.trigger === 'project.deadline') {
          const source = await Project.findOne({ _id: job.resourceId, guildId: job.guildId, archived: false }).lean(); valid = valid && source?.dueAt?.toISOString() === job.fingerprint;
        } else {
          const source = await WorkItem.findOne({ _id: job.resourceId, guildId: job.guildId }).lean();
          const status = job.trigger === 'task.accepted' ? 'accepted' : 'completed';
          valid = valid && Boolean(source?.history.some((entry) => !entry.note && entry.status === status && entry.at.toISOString() === job.fingerprint));
        }
        if (!valid || !rule) { await AutomationJob.updateOne(claim, { $set: { status: 'cancelled', lockToken: null, lockUntil: null } }); continue; }
        const label = { 'task.accepted': 'Tarea aceptada', 'task.completed': 'Tarea completada', 'knowledge.review_due': 'Solucion pendiente de revision', 'project.deadline': 'Proyecto con plazo vencido' }[job.trigger];
        await transport.send(job.guildId, rule.channelId, `${label}. Referencia: ${job.resourceId}. Consulta el gestor para mas detalles.`);
        logRecord('automation.delivered', { guildId: job.guildId, action: job.trigger, outcome: 'completed' });
        await AutomationJob.updateOne(claim, { $set: { status: 'delivered', error: null, lockToken: null, lockUntil: null } });
      } catch {
        await AutomationJob.updateOne(claim, { $set: { status: job.attempts >= 5 ? 'failed' : 'pending', error: 'No se pudo procesar o entregar el aviso.', dueAt: new Date(Date.now() + retryDelay(job.attempts)), lockToken: null, lockUntil: null } });
        await logEvent('automation.error', `Fallo del aviso ${job.id}, intento ${job.attempts}.`, job.guildId);
      }
    }
  }
  function tick(): Promise<void> {
    if (stopping) return Promise.resolve();
    if (running) return running;
    running = (async () => { try { await discover(); await deliver(); } catch { await logEvent('worker.error', 'No se pudo completar el ciclo de automatizaciones.'); } })().finally(() => { running = undefined; });
    return running;
  }
  return { tick, stop: async () => { stopping = true; await running; } };
}
export function startAutomationWorker(bot: Client) {
  const worker = createAutomationWorker({ isReady: () => bot.isReady(), send: async (guildId, channelId, content) => {
    const channel = await bot.channels.fetch(channelId);
    if (!channel?.isSendable() || !('guildId' in channel) || channel.guildId !== guildId) throw new Error('Channel unavailable');
    await channel.send({ content, allowedMentions: { parse: [] } });
  } });
  const timer = setInterval(() => { void worker.tick(); }, 15000); timer.unref(); void worker.tick();
  return async () => { clearInterval(timer); await worker.stop(); };
}
