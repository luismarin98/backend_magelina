import mongoose from 'mongoose';
const schema = new mongoose.Schema({
  guildId: { type: String, required: true, immutable: true },
  roleId: { type: String, required: true, immutable: true },
  kind: { type: String, enum: ['administrator', 'moderator', 'coordinator', 'collaborator', 'reader', 'custom'], required: true },
  version: { type: Number, default: 0, required: true },
  actorId: { type: String, required: true },
}, { timestamps: true });
schema.index({ guildId: 1, roleId: 1 }, { unique: true });
export const GuildRoleBinding = mongoose.model('GuildRoleBinding', schema);
