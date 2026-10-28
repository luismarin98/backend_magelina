import test from 'node:test';
import assert from 'node:assert/strict';
import { followupInput, newFollowupInput } from '../src/modules/moderation/followup-rules.js';
const reviewAt = new Date(Date.now()+86400000).toISOString();
const input = { version: 0, state: 'followup', assessment: 'unconfirmed', reviewAt, note: 'Revisar el contexto con el equipo.', claim: true };
test('reports start without a verdict and cannot inject sanctions or guild data', () => {
  const body = { requestId: 'ae9d3848-1bb4-4070-998d-61ec1bdef019', targetId: '100000000000000001', summary: 'Reporte pendiente de comprobacion.', reviewAt };
  assert.equal(newFollowupInput(body).targetId,body.targetId);
  for (const patch of [{ state: 'confirmed' }, { guildId: 'foreign' }, { action: 'ban' }, { summary: 'x' }, { reviewAt: null }]) assert.throws(()=>newFollowupInput({ ...body,...patch }));
});
test('followups require a future date and explanatory notes', () => {
  assert.equal(followupInput(input).assessment,'unconfirmed');
  for (const patch of [{ reviewAt: null }, { reviewAt: '2020-01-01T00:00:00Z' }, { version: -1 }, { note: 'x' }, { state: 'ban' }, { assigneeId: 'injected' }]) assert.throws(()=>followupInput({ ...input,...patch }));
});
test('dismissals and revocations close reminders without changing Discord sanctions', () => {
  for (const assessment of ['dismissed','revoked']) {
    assert.throws(()=>followupInput({ ...input,assessment }));
    const result = followupInput({ ...input,assessment,state:'closed',reviewAt:null });
    assert.equal(result.reviewAt,null);
  }
});
