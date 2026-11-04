import mongoose from 'mongoose';

const offerSchema = new mongoose.Schema({
  guildId: { type: String, required: true, immutable: true },
  cycle: { type: Number, required: true, immutable: true },
  templateId: { type: String, required: true, immutable: true },
  definition: { type: mongoose.Schema.Types.Mixed, required: true, immutable: true },
  expiresAt: { type: Date, required: true, immutable: true },
}, { timestamps: true });
offerSchema.index({ guildId: 1, cycle: 1, templateId: 1 }, { unique: true });
offerSchema.index({ guildId: 1, expiresAt: 1 });
const lootSchema = new mongoose.Schema({ itemId: { type: String, required: true }, quantity: { type: Number, required: true, min: 1 } }, { _id: false });
const runSchema = new mongoose.Schema({
  userId: { type: String, required: true, immutable: true },
  guildId: { type: String, required: true, immutable: true },
  offerId: { type: String, required: true, immutable: true },
  definition: { type: mongoose.Schema.Types.Mixed, required: true, immutable: true },
  seed: { type: String, required: true, immutable: true, select: false },
  active: { type: Boolean, default: true },
  status: { type: String, enum: ['active', 'ready', 'completed', 'abandoned', 'failed'], default: 'active' },
  stage: { type: Number, default: 0 }, dueAt: { type: Date, required: true },
  version: { type: Number, default: 0 },
  rewards: { wood: { type: Number, default: 0 }, herb: { type: Number, default: 0 }, experience: { type: Number, default: 0 } },
  loot: { type: [lootSchema], default: [] },
  events: { type: [{ stage: Number, choice: String, text: String, at: Date, loot: { type: [lootSchema], default: [] } }], default: [] },
}, { timestamps: true });
runSchema.index({ userId: 1 }, { unique: true, partialFilterExpression: { active: true } });
runSchema.index({ userId: 1, _id: -1 });
export const AdventureOffer = mongoose.model('AdventureOffer', offerSchema);
export const AdventureRun = mongoose.model('AdventureRun', runSchema);
