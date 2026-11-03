import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  guildId: { type: String, required: true, immutable: true, unique: true },
  version: { type: Number, default: 0, required: true },
  faqs: { type: [{ question: { type: String, maxlength: 100, required: true }, answer: { type: String, maxlength: 600, required: true } }], default: [] },
  categoryId: { type: String, default: null },
  panelChannelId: { type: String, default: null },
  panelMessageId: { type: String, default: null },
  publishing: { type: Boolean, default: false },
}, { timestamps: true });
export const SupportConfig = mongoose.model('SupportConfig', schema);
