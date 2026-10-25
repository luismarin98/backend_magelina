import mongoose from 'mongoose';
import type { ModerationAction } from '../../types/contracts.js';

export interface ModerationCaseRecord {
  guildId: string; requestId: string; actorId: string; targetId: string;
  action: ModerationAction; reason: string; evidence: string[]; durationMinutes: number | null;
  status: 'pending' | 'applied' | 'failed' | 'uncertain'; createdAt: Date; updatedAt: Date;
}
const schema = new mongoose.Schema<ModerationCaseRecord>({
  guildId: { type: String, required: true, immutable: true },
  requestId: { type: String, required: true, immutable: true },
  actorId: { type: String, required: true, immutable: true },
  targetId: { type: String, required: true, immutable: true },
  action: { type: String, required: true, enum: ['warning', 'timeout', 'untimeout', 'kick', 'ban'], immutable: true },
  reason: { type: String, required: true, maxlength: 1000, immutable: true },
  evidence: { type: [String], default: [], immutable: true },
  durationMinutes: { type: Number, default: null, immutable: true },
  status: { type: String, required: true, enum: ['pending', 'applied', 'failed', 'uncertain'] },
}, { timestamps: true });
schema.index({ guildId: 1, requestId: 1 }, { unique: true });
schema.index({ guildId: 1, targetId: 1, _id: -1 });
schema.index({ guildId: 1, _id: -1 });
export const ModerationCase = mongoose.model('ModerationCase', schema);
