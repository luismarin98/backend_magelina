import mongoose from 'mongoose';
import type { BotControlValues } from '../../types/contracts.js';
export interface BotControlRecord extends BotControlValues { key: string; version: number; history: { actorId: string; at: Date; before: BotControlValues; after: BotControlValues }[] }
const schema = new mongoose.Schema<BotControlRecord>({
  key: { type: String, required: true }, version: { type: Number, default: 0 }, maintenance: { type: Boolean, required: true },
  operatorIds: { type: [String], default: [] }, disabledModules: { type: [String], default: [] }, blockedGuildIds: { type: [String], default: [] },
  requestsPerMinute: { type: Number, required: true }, jobsPerTick: { type: Number, required: true },
  history: { type: [new mongoose.Schema({ actorId: String, at: Date, before: mongoose.Schema.Types.Mixed, after: mongoose.Schema.Types.Mixed }, { _id: false })], default: [] },
});
schema.index({ key: 1 }, { unique: true });
export const BotControl = mongoose.model('BotControl', schema);
const eventSchema = new mongoose.Schema({ kind: { type: String, required: true }, guildId: { type: String, default: null }, message: { type: String, maxlength: 500, required: true }, at: { type: Date, default: Date.now } });
eventSchema.index({ at: 1 }, { expireAfterSeconds: 30 * 86400 });
export const SystemEvent = mongoose.model('SystemEvent', eventSchema);
