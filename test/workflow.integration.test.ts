import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { WorkItem } from '../src/database/models/WorkItem.js';
import { createRequest, changeRequest, notifyChange } from '../src/modules/workflow/service.js';

test('aislamiento, duplicados y cambios concurrentes en MongoDB', { skip: !process.env.TEST_MONGODB_URI }, async () => {
  // Base exclusiva de pruebas: nunca usa la base de datos configurada para la app.
  await mongoose.connect(process.env.TEST_MONGODB_URI!, { dbName: 'discord_dashboard_workflow_test' });
  const guildId = new mongoose.Types.ObjectId().toHexString();
  const actorId = '100000000000000001';
  const guild = { members: { fetch: async () => ({ user: { bot: false } }) } };
  try {
    await WorkItem.init();
    const input = { guildId, sourceChannelId: '100000000000000002', sourceMessageId: '100000000000000003', createdBy: actorId, title: 'Revisar propuesta' };
    const item = await createRequest(input);
    await assert.rejects(() => createRequest(input), { status: 409 });
    await assert.rejects(() => changeRequest({ guildId: 'otro-servidor', itemId: item.id, actorId, guild,
      body: { status: 'accepted', version: 0, assigneeId: actorId } }), { status: 404 });
    await assert.rejects(() => changeRequest({ guildId, itemId: item.id, actorId, guild,
      body: { status: 'completed', version: 0 } }), { status: 409 });
    const change = () => changeRequest({ guildId, itemId: item.id, actorId, guild,
      body: { status: 'accepted', version: 0, assigneeId: actorId } });
    const results = await Promise.allSettled([change(), change()]);
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    const rejected = results.find((result) => result.status === 'rejected');
    assert.ok(rejected && rejected.status === 'rejected');
    assert.equal(rejected.reason.status, 409);
    const stored = await WorkItem.findById(item.id).lean();
    assert.ok(stored);
    assert.equal(stored.version, 1);
    assert.equal(stored.history.length, 2);
    assert.equal(stored.history[1].actorId, actorId);
    assert.equal(await notifyChange({ channels: { fetch: async () => { throw new Error('Sin acceso'); } } }, {
      id: String(item._id), guildId: item.guildId, status: item.status, sourceChannelId: item.sourceChannelId,
    }), false);
  } finally {
    await WorkItem.deleteMany({ guildId });
    await mongoose.disconnect();
  }
});
