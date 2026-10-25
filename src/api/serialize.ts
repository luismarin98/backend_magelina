import type { Types } from 'mongoose';
import type { WorkItemRecord } from '../database/models/WorkItem.js';
import type { KnowledgeArticleRecord } from '../database/models/KnowledgeArticle.js';
import type { WorkItemDto, KnowledgeArticleDto } from '../types/contracts.js';

export function serializeWorkItem(item: WorkItemRecord & { _id: Types.ObjectId }): WorkItemDto {
  return {
    _id: String(item._id), guildId: item.guildId, title: item.title, status: item.status,
    sourceChannelId: item.sourceChannelId, sourceMessageId: item.sourceMessageId,
    projectId: item.projectId ? String(item.projectId) : null, createdBy: item.createdBy, assigneeId: item.assigneeId, version: item.version,
    createdAt: item.createdAt.toISOString(), updatedAt: item.updatedAt.toISOString(),
    history: item.history.map((entry) => ({ actorId: entry.actorId, status: entry.status, at: entry.at.toISOString(), ...(entry.note ? { note: entry.note } : {}) })),
  };
}

export function serializeArticle(article: KnowledgeArticleRecord & { _id: Types.ObjectId }): KnowledgeArticleDto {
  return {
    _id: String(article._id), sourceItemId: String(article.sourceItemId), guildId: article.guildId,
    title: article.title, content: article.content, tags: [...article.tags], createdBy: article.createdBy,
    archived: article.archived, version: article.version,
    reviewedAt: article.reviewedAt.toISOString(), reviewDueAt: article.reviewDueAt.toISOString(),
    createdAt: article.createdAt.toISOString(), updatedAt: article.updatedAt.toISOString(),
    history: article.history.map((entry) => ({ actorId: entry.actorId, action: entry.action, at: entry.at.toISOString() })),
  };
}
