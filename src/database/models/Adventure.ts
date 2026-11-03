import mongoose from 'mongoose';

const characterSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true, immutable: true },
  alias: { type: String, required: true, minlength: 2, maxlength: 32 },
  level: { type: Number, default: 1, min: 1 },
  rank: { type: String, default: 'F' },
  coins: { type: Number, default: 0, min: 0 },
  experience: { type: Number, default: 0, min: 0 },
  version: { type: Number, default: 0, required: true },
}, { timestamps: true });

const membershipSchema = new mongoose.Schema({
  userId: { type: String, required: true, immutable: true },
  guildId: { type: String, required: true, immutable: true },
  localAlias: { type: String, default: null, maxlength: 32 },
  version: { type: Number, default: 0, required: true },
}, { timestamps: true });
membershipSchema.index({ guildId: 1, userId: 1 }, { unique: true });

const configSchema = new mongoose.Schema({
  guildId: { type: String, required: true, unique: true, immutable: true },
  enabled: { type: Boolean, default: false, required: true },
  version: { type: Number, default: 0, required: true },
}, { timestamps: true });

export const AdventureCharacter = mongoose.model('AdventureCharacter', characterSchema);
export const AdventureMembership = mongoose.model('AdventureMembership', membershipSchema);
export const AdventureConfig = mongoose.model('AdventureConfig', configSchema);
