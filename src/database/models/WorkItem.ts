import type { WorkItemDto, WorkStatus } from '../../types/contracts.js';
export interface WorkItemRecord extends Omit<WorkItemDto, '_id' | 'history' | 'createdAt' | 'updatedAt' | 'projectId'> {
 projectId: mongoose.Types.ObjectId | null;
 createdAt: Date; updatedAt: Date;
 history: { actorId: string; status: WorkStatus; at: Date; note?: string }[];
}
import mongoose from 'mongoose';
import { transitions } from '../../modules/workflow/rules.js';

const historySchema = new mongoose.Schema({
  actorId: { type: String, required: true },
  status: { type: String, enum: Object.keys(transitions), required: true },
  at: { type: Date, required: true },
  note: { type: String, maxlength: 240 },
}, { _id: false });

const schema = new mongoose.Schema<WorkItemRecord>({
  guildId: { type: String, required: true, immutable: true },
  sourceChannelId: { type: String, required: true, immutable: true },
  sourceMessageId: { type: String, required: true, immutable: true },
  createdBy: { type: String, required: true, immutable: true },
  title: { type: String, required: true, maxlength: 160, trim: true },
  status: { type: String, enum: Object.keys(transitions), default: 'submitted', required: true },
  assigneeId: { type: String, default: null },
  projectId: { type: mongoose.Schema.Types.ObjectId, default: null },
  version: { type: Number, default: 0, required: true },
  history: { type: [historySchema], required: true },
}, { timestamps: true });

schema.index({ guildId: 1, sourceMessageId: 1 }, { unique: true });
schema.index({ guildId: 1, _id: -1 });
schema.index({ guildId: 1, projectId: 1 });
export const WorkItem = mongoose.model('WorkItem', schema);

