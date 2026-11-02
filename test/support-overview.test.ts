import test from 'node:test';
import assert from 'node:assert/strict';
import { supportOverviewPipeline } from '../src/modules/support/overview.js';

test('support overview groups all active cases before paginating people', () => {
  const pipeline = supportOverviewPipeline('guild', 'moderators', 2) as any[];
  assert.deepEqual(pipeline[0].$match, { guildId: 'guild', active: true, state: { $ne: 'closed' }, assigneeId: { $type: 'string', $ne: '' } });
  assert.equal(pipeline[1].$group._id, '$assigneeId');
  assert.deepEqual(pipeline[1].$group.pendingCount, { $sum: 1 });
  assert.deepEqual(pipeline[1].$group.escalatedCount, { $sum: { $cond: [{ $eq: ['$state', 'escalated'] }, 1, 0] } });
  assert.deepEqual(pipeline[3].$facet.groups, [{ $skip: 20 }, { $limit: 10 }]);
  assert.deepEqual(pipeline[3].$facet.total, [{ $count: 'count' }]);
  const users = supportOverviewPipeline('guild', 'users', 0) as any[];
  assert.equal(users[1].$group._id, '$requesterId');
  assert.equal('assigneeId' in users[0].$match, false);
});
