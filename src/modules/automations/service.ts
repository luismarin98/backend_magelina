import type { Types } from 'mongoose';
import { AutomationRule, AutomationJob } from '../../database/models/Automation.js';
import type { RuleRecord, JobRecord } from '../../database/models/Automation.js';
import type { AutomationJobDto, AutomationRuleDto, AutomationTrigger } from '../../types/contracts.js';
import { object, text, id, boolean } from '../common/input.js';
import { workflowError } from '../workflow/rules.js';
import { getSettings } from '../settings/service.js';
import { getControls } from '../operations/service.js';
import { hasCode } from '../../types/errors.js';

export const triggers: AutomationTrigger[] = ['task.accepted', 'task.completed', 'knowledge.review_due', 'project.deadline'];
export function ruleFields(value: unknown) {
  const body = object(value, ['title', 'trigger', 'channelId', 'delayMinutes', 'enabled', 'version']);
  if (typeof body.trigger !== 'string' || !triggers.includes(body.trigger as AutomationTrigger) || typeof body.delayMinutes !== 'number' || !Number.isInteger(body.delayMinutes) || body.delayMinutes < 0 || body.delayMinutes > 10080) throw workflowError(400, 'Disparador o retraso no valido (0 a 10080 minutos).');
  return { title: text(body.title, 160), trigger: body.trigger as AutomationTrigger, channelId: id(body.channelId, true), delayMinutes: body.delayMinutes, enabled: boolean(body.enabled) };
}
export const serializeRule = (rule: RuleRecord & { _id: Types.ObjectId }): AutomationRuleDto => ({ _id: String(rule._id), title: rule.title, trigger: rule.trigger, channelId: rule.channelId, delayMinutes: rule.delayMinutes, enabled: rule.enabled, version: rule.version, history: rule.history.map((entry) => ({ actorId: entry.actorId, at: entry.at.toISOString() })) });
export const serializeJob = (job: JobRecord & { _id: Types.ObjectId }): AutomationJobDto => ({ _id: String(job._id), guildId: job.guildId, ruleId: String(job.ruleId), resourceId: String(job.resourceId), status: job.status, dueAt: job.dueAt.toISOString(), attempts: job.attempts, error: job.error });
export async function enqueue(rule: RuleRecord & { _id: Types.ObjectId }, resourceId: Types.ObjectId, fingerprint: string, dueAt: Date) {
  try { await AutomationJob.create({ guildId: rule.guildId, ruleId: rule._id, ruleVersion: rule.version, resourceId, fingerprint, trigger: rule.trigger, dueAt }); }
  catch (error) { if (!hasCode(error, 11000)) throw error; }
}
export async function enqueueTaskEvent(item: { guildId: string; _id: Types.ObjectId; status: string; version: number; history: { status: string; at: Date; note?: string }[] }) {
  if (!['accepted', 'completed'].includes(item.status)) return;
  const controls = await getControls();
  if (controls.maintenance || controls.blockedGuildIds.includes(item.guildId) || controls.disabledModules.includes('automations')) return;
  if (!(await getSettings(item.guildId)).modules.automations) return;
  const rules = await AutomationRule.find({ guildId: item.guildId, trigger: `task.${item.status}`, enabled: true }).lean();
  const transition = [...item.history].reverse().find((entry) => !entry.note && entry.status === item.status);
  if (!transition) return;
  for (const rule of rules) if (transition.at >= rule.createdAt) await enqueue(rule, item._id, transition.at.toISOString(), new Date(transition.at.getTime() + rule.delayMinutes * 60000));
}
