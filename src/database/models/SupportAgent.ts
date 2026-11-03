import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  guildId: { type: String, required: true, immutable: true },
  userId: { type: String, required: true, immutable: true },
  available: { type: Boolean, default: false },
  maxCases: { type: Number, default: 3, min: 1, max: 50 },
  specialties: { type: [String], default: [] },
  version: { type: Number, default: 0 },
}, { timestamps: true });
schema.index({ guildId: 1, userId: 1 }, { unique: true });
export const SupportAgent = mongoose.model('SupportAgent', schema);
