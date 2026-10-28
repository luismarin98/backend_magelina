import mongoose from 'mongoose';
const event = new mongoose.Schema({ actorId: String, at: Date, state: String, assessment: String, note: String, assigneeId: String, reviewAt: Date }, { _id: false });
const schema = new mongoose.Schema({
  guildId: { type: String, required: true, immutable: true },
  requestId: { type: String, required: true, immutable: true },
  targetId: { type: String, required: true, immutable: true },
  actorId: { type: String, required: true, immutable: true },
  summary: { type: String, required: true, maxlength: 1000, immutable: true },
  caseId: { type: String, default: null, immutable: true },
  state: { type: String, enum: ['report', 'review', 'followup', 'closed'], default: 'report' },
  assessment: { type: String, enum: ['unconfirmed', 'confirmed', 'dismissed', 'revoked'], default: 'unconfirmed' },
  assigneeId: { type: String, default: null }, reviewAt: { type: Date, default: null },
  version: { type: Number, default: 0 }, history: { type: [event], default: [] },
}, { timestamps: true });
schema.index({ guildId: 1, requestId: 1 }, { unique: true });
schema.index({ guildId: 1, state: 1, _id: -1 });
export const ModerationFollowup = mongoose.model('ModerationFollowup', schema);
