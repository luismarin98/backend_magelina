import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  creatorId: { type: String, required: true, immutable: true },
  originGuildId: { type: String, required: true, immutable: true },
  name: { type: String, required: true, maxlength: 80 },
  description: { type: String, required: true, maxlength: 1000 },
  category: { type: String, enum: ['cosmetic', 'equipment', 'material', 'consumable'], required: true },
  icon: { type: String, required: true },
  imageData: { type: Buffer, default: null, select: false },
  hasImage: { type: Boolean, default: false },
  status: { type: String, enum: ['draft', 'submitted', 'approved', 'rejected'], default: 'draft' },
  reviewReason: { type: String, default: null, maxlength: 600 },
  version: { type: Number, default: 0 },
  history: { type: [{ actorId: String, action: String, reason: String, at: Date }], default: [] },
}, { timestamps: true });
schema.index({ creatorId: 1, _id: -1 });
schema.index({ status: 1, _id: -1 });
export const AdventureItem = mongoose.model('AdventureItem', schema);
