import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  guildId: { type: String, required: true },
  ticketId: { type: mongoose.Schema.Types.ObjectId, required: true },
  runId: { type: String, required: true },
  messageId: { type: String, required: true },
  messageOrder: { type: mongoose.Schema.Types.Decimal128, required: true },
  channelId: { type: String, default: null },
  channelName: { type: String, default: null },
  authorId: { type: String, required: true },
  author: { type: String, required: true },
  content: { type: String, default: '' },
  createdAt: { type: Date, required: true },
  editedAt: { type: Date, default: null },
  type: { type: Number, required: true },
  replyTo: { type: String, default: null },
  embeds: { type: [mongoose.Schema.Types.Mixed], default: [] },
  components: { type: [mongoose.Schema.Types.Mixed], default: [] },
  stickers: { type: [mongoose.Schema.Types.Mixed], default: [] },
  attachments: { type: [{ id: String, name: String, size: Number, storageId: String }], default: [] },
});
schema.index({ guildId: 1, ticketId: 1, runId: 1, messageId: 1 }, { unique: true });
schema.index({ guildId: 1, ticketId: 1, runId: 1, messageOrder: -1 });
export const SupportMessage = mongoose.model('SupportMessage', schema);
