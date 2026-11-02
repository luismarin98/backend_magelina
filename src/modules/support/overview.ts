import type { PipelineStage } from 'mongoose';

export function supportOverviewPipeline(guildId: string, group: 'moderators' | 'users', page: number): PipelineStage[] {
  const field = group === 'moderators' ? 'assigneeId' : 'requesterId';
  return [
    { $match: { guildId, active: true, state: { $ne: 'closed' }, ...(group === 'moderators' ? { assigneeId: { $type: 'string', $ne: '' } } : {}) } },
    { $group: { _id: `$${field}`, pendingCount: { $sum: 1 }, awaitingReview: { $sum: { $cond: [{ $eq: ['$state', 'pending'] }, 1, 0] } }, escalatedCount: { $sum: { $cond: [{ $eq: ['$state', 'escalated'] }, 1, 0] } }, oldestAt: { $min: '$createdAt' } } },
    { $sort: { pendingCount: -1, oldestAt: 1, _id: 1 } },
    { $facet: { groups: [{ $skip: page * 10 }, { $limit: 10 }], total: [{ $count: 'count' }] } },
  ];
}
