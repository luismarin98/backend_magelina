import mongoose from 'mongoose';

const characterSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true, immutable: true },
  alias: { type: String, required: true, minlength: 2, maxlength: 32 },
  currentGuildId: { type: String, default: null },
  currentGuildName: { type: String, default: null },
  profession: { type: String, enum: ['hunter', 'merchant', null], default: null },
  level: { type: Number, default: 1, min: 1 },
  rank: { type: String, default: 'F' },
  coins: { type: Number, default: 0, min: 0 },
  experience: { type: Number, default: 0, min: 0 },
  version: { type: Number, default: 0, required: true },
}, { timestamps: true });

const membershipSchema = new mongoose.Schema({
  userId: { type: String, required: true, immutable: true },
  guildId: { type: String, required: true, immutable: true },
  announcement: { type: String, enum: ['skipped', 'pending', 'processing', 'sent', 'failed'], default: 'skipped' },
  announcementAttempts: { type: Number, default: 0 },
  announcementDueAt: { type: Date, default: Date.now },
  announcementToken: String,
  announcementChannelId: String,
  announcementAlias: String,
  announcementError: String,
  localAlias: { type: String, default: null, maxlength: 32 },
  version: { type: Number, default: 0, required: true },
}, { timestamps: true });
membershipSchema.index({ announcement: 1, announcementDueAt: 1 });
membershipSchema.index({ guildId: 1, userId: 1 }, { unique: true });

const configSchema = new mongoose.Schema({
  commerceRevision: { type: Number, default: 0 },
  integration: {
    enabled: { type: Boolean, default: false },
    categoryId: { type: String, default: null },
    channelId: { type: String, default: null },
    announceArrivals: { type: Boolean, default: true },
    announceJoins: { type: Boolean, default: true },
    delegateRoleIds: { type: [String], default: [] },
  },
  guildId: { type: String, required: true, unique: true, immutable: true },
  enabled: { type: Boolean, default: false, required: true },
  version: { type: Number, default: 0, required: true },
}, { timestamps: true });

export const AdventureCharacter = mongoose.model('AdventureCharacter', characterSchema);
export const AdventureMembership = mongoose.model('AdventureMembership', membershipSchema);
export const AdventureConfig = mongoose.model('AdventureConfig', configSchema);
