import type { KnowledgeArticleDto, KnowledgeAction } from '../../types/contracts.js';
export interface KnowledgeArticleRecord extends Omit<KnowledgeArticleDto, '_id' | 'sourceItemId' | 'history' | 'createdAt' | 'updatedAt' | 'reviewedAt' | 'reviewDueAt'> {
 sourceItemId: mongoose.Types.ObjectId;
 createdAt: Date; updatedAt: Date; reviewedAt: Date; reviewDueAt: Date;
 history: { actorId: string; action: KnowledgeAction; at: Date }[];
}
import mongoose from 'mongoose';

const eventSchema = new mongoose.Schema({
  actorId: { type: String, required: true },
  action: { type: String, enum: ['created', 'updated', 'reviewed', 'archived', 'restored'], required: true },
  at: { type: Date, required: true },
}, { _id: false });

const schema = new mongoose.Schema<KnowledgeArticleRecord>({
  guildId: { type: String, required: true, immutable: true },
  sourceItemId: { type: mongoose.Schema.Types.ObjectId, required: true, immutable: true, ref: 'WorkItem' },
  createdBy: { type: String, required: true, immutable: true },
  title: { type: String, required: true, maxlength: 160 },
  content: { type: String, required: true, maxlength: 8000 },
  tags: { type: [String], default: [] },
  archived: { type: Boolean, default: false },
  reviewedAt: { type: Date, required: true },
  reviewDueAt: { type: Date, required: true },
  version: { type: Number, default: 0 },
  history: { type: [eventSchema], required: true },
}, { timestamps: true });
schema.index({ guildId: 1, sourceItemId: 1 }, { unique: true });
schema.index({ guildId: 1, archived: 1, _id: -1 });
export const KnowledgeArticle = mongoose.model('KnowledgeArticle', schema);

