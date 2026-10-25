import mongoose from 'mongoose';
import type { RoleGrants } from '../../types/contracts.js';

export interface GuildPolicyRecord { guildId: string; version: number; grants: RoleGrants;
  history: { actorId: string; at: Date; before: RoleGrants; after: RoleGrants }[] }
// Mixed solo persiste los mapas que validatePolicy valida y normaliza previamente.
const history = new mongoose.Schema({ actorId: { type: String, required: true }, at: { type: Date, required: true },
  before: { type: mongoose.Schema.Types.Mixed, required: true }, after: { type: mongoose.Schema.Types.Mixed, required: true } }, { _id: false });
const schema = new mongoose.Schema<GuildPolicyRecord>({
  guildId: { type: String, required: true, immutable: true }, version: { type: Number, required: true, default: 0 },
  grants: { type: mongoose.Schema.Types.Mixed, required: true }, history: { type: [history], default: [] },
});
schema.index({ guildId: 1 }, { unique: true });
export const GuildPolicy = mongoose.model('GuildPolicy', schema);
