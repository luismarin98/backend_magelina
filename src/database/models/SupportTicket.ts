import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  guildId: { type: String, required: true, immutable: true },
  requestId: { type: String, required: true, immutable: true },
  requesterId: { type: String, required: true, immutable: true },
  reportType: { type: String, enum: ['consulta', 'tecnico', 'acceso', 'usuario', 'otro'], default: 'consulta', immutable: true },
  subject: { type: String, required: true, maxlength: 100, immutable: true },
  description: { type: String, required: true, maxlength: 1500, immutable: true },
  channelId: { type: String, default: null },
  state: { type: String, enum: ['pending', 'creating', 'open', 'in_progress', 'escalated', 'closed', 'uncertain'], default: 'pending', required: true },
  active: { type: Boolean, default: true, required: true },
  assigneeId: { type: String, default: null },
  version: { type: Number, default: 0, required: true },
  escalationReason: { type: String, default: null, maxlength: 1000 },
  archiveStatus: { type: String, enum: ['idle', 'archiving', 'ready', 'failed'], default: 'idle' },
  archiveHeartbeatAt: { type: Date, default: null },
  transcriptRunId: { type: String, default: null },
  transcriptArchivedAt: { type: Date, default: null },
  transcriptMessageCount: { type: Number, default: 0 },
  channelDeletedAt: { type: Date, default: null },
  archiveError: { type: String, default: null },
  history: { type: [{ actorId: String, action: String, assigneeId: String, reason: String, at: Date }], default: [] },
}, { timestamps: true });
schema.index({ guildId: 1, requestId: 1 }, { unique: true });
schema.index({ guildId: 1, requesterId: 1 }, { unique: true, partialFilterExpression: { active: true } });
schema.index({ guildId: 1, _id: -1 });
schema.index({ guildId: 1, state: 1, _id: -1 });
schema.index({ guildId: 1, active: 1, assigneeId: 1 });
schema.index({ guildId: 1, active: 1, requesterId: 1 });
export const SupportTicket = mongoose.model('SupportTicket', schema);
