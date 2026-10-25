import mongoose from 'mongoose';
import type { GuildSettingsValues } from '../../types/contracts.js';

export interface SettingsHistoryRecord { actorId: string; at: Date; changes: string[]; before: GuildSettingsValues; after: GuildSettingsValues }
export interface GuildSettingsRecord extends GuildSettingsValues { guildId: string; version: number; history: SettingsHistoryRecord[] }

const valuesSchema = new mongoose.Schema({
  modules: { workflow: { type: Boolean, required: true }, knowledge: { type: Boolean, required: true }, projects: { type: Boolean, default: true }, collaboration: { type: Boolean, default: true }, automations: { type: Boolean, default: false }, audit: { type: Boolean, default: true }, music: { type: Boolean, default: false } },
  notifications: { enabled: { type: Boolean, required: true }, channelId: { type: String, default: null } },
  knowledge: { reviewDays: { type: Number, required: true, min: 1, max: 365 } },
}, { _id: false });
const historySchema = new mongoose.Schema({
  actorId: { type: String, required: true }, at: { type: Date, required: true }, changes: { type: [String], required: true },
  before: { type: valuesSchema, required: true }, after: { type: valuesSchema, required: true },
}, { _id: false });

const schema = new mongoose.Schema<GuildSettingsRecord>({
  guildId: { type: String, required: true, immutable: true }, version: { type: Number, required: true, default: 0 },
  modules: { workflow: { type: Boolean, required: true }, knowledge: { type: Boolean, required: true }, projects: { type: Boolean, default: true }, collaboration: { type: Boolean, default: true }, automations: { type: Boolean, default: false }, audit: { type: Boolean, default: true }, music: { type: Boolean, default: false } },
  notifications: { enabled: { type: Boolean, required: true }, channelId: { type: String, default: null } },
  knowledge: { reviewDays: { type: Number, required: true, min: 1, max: 365 } },
  history: { type: [historySchema], default: [] },
});
schema.index({ guildId: 1 }, { unique: true });
export const GuildSettings = mongoose.model('GuildSettings', schema);
