import mongoose from 'mongoose';

const inventorySchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true, immutable: true },
  stacks: { type: Map, of: Number, default: () => new Map() },
  gatheredAt: { type: Date, default: null },
}, { timestamps: true });
const listingSchema = new mongoose.Schema({
  guildId: { type: String, default: null, immutable: true },
  guildName: { type: String, default: null, immutable: true },
  sellerId: { type: String, required: true, immutable: true },
  itemId: { type: String, required: true, immutable: true },
  itemName: { type: String, required: true, immutable: true },
  icon: { type: String, required: true, immutable: true },
  quantity: { type: Number, required: true, min: 1, immutable: true },
  unitPrice: { type: Number, required: true, min: 1, immutable: true },
  status: { type: String, enum: ['open', 'sold', 'cancelled'], default: 'open' },
  buyerId: { type: String, default: null },
}, { timestamps: true });
listingSchema.index({ guildId: 1, status: 1, _id: -1 });
listingSchema.index({ status: 1, _id: -1 });
listingSchema.index({ sellerId: 1, status: 1, _id: -1 });
const receiptSchema = new mongoose.Schema({
  notice: {
    state: { type: String, enum: ['pending', 'processing', 'sent', 'skipped', 'failed'], default: 'skipped' },
    dueAt: Date, token: String, attempts: { type: Number, default: 0 },
    guildId: String, channelId: String, categoryId: String, alias: String,
  },
  userId: { type: String, required: true, immutable: true },
  key: { type: String, required: true, immutable: true },
  fingerprint: { type: String, required: true, immutable: true },
  result: { type: mongoose.Schema.Types.Mixed, required: true, immutable: true },
}, { timestamps: true });
receiptSchema.index({ 'notice.state': 1, 'notice.dueAt': 1 });
receiptSchema.index({ userId: 1, key: 1 }, { unique: true });

export const AdventureInventory = mongoose.model('AdventureInventory', inventorySchema);
export const AdventureListing = mongoose.model('AdventureListing', listingSchema);
export const AdventureReceipt = mongoose.model('AdventureReceipt', receiptSchema);
