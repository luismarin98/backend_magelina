import mongoose from 'mongoose';
import type { AutomationTrigger } from '../../types/contracts.js';
export interface RuleRecord { guildId: string; title: string; trigger: AutomationTrigger; channelId: string; delayMinutes: number; enabled: boolean; version: number; createdBy: string; createdAt: Date; history: { actorId: string; at: Date }[] }
const rule = new mongoose.Schema<RuleRecord>({ guildId: { type: String, required: true }, title: String, trigger: { type: String, enum: ['task.accepted', 'task.completed', 'knowledge.review_due', 'project.deadline'] },
  channelId: String, delayMinutes: Number, enabled: Boolean, version: { type: Number, default: 0 }, createdBy: String, createdAt: { type: Date, default: Date.now },
  history: { type: [new mongoose.Schema({ actorId: String, at: Date }, { _id: false })], default: [] } });
rule.index({ guildId: 1, _id: -1 });
export const AutomationRule = mongoose.model('AutomationRule', rule);
export interface JobRecord { guildId: string; ruleId: mongoose.Types.ObjectId; ruleVersion: number; resourceId: mongoose.Types.ObjectId; fingerprint: string; trigger: AutomationTrigger;
  dueAt: Date; status: 'pending' | 'processing' | 'delivered' | 'failed' | 'cancelled'; attempts: number; error: string | null; lockUntil: Date | null; lockToken: string | null; createdAt: Date }
const job = new mongoose.Schema<JobRecord>({ guildId: { type: String, required: true }, ruleId: mongoose.Schema.Types.ObjectId, ruleVersion: Number, resourceId: mongoose.Schema.Types.ObjectId,
  fingerprint: String, trigger: String, dueAt: Date, status: { type: String, enum: ['pending', 'processing', 'delivered', 'failed', 'cancelled'], default: 'pending' },
  attempts: { type: Number, default: 0 }, error: { type: String, default: null }, lockUntil: { type: Date, default: null }, lockToken: { type: String, default: null }, createdAt: { type: Date, default: Date.now } });
job.index({ ruleId: 1, ruleVersion: 1, resourceId: 1, fingerprint: 1 }, { unique: true });
job.index({ status: 1, dueAt: 1, lockUntil: 1 }); job.index({ guildId: 1, _id: -1 });
export const AutomationJob = mongoose.model('AutomationJob', job);
