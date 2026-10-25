import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { GuildPolicy } from '../src/database/models/GuildPolicy.js';
import { getPolicy, savePolicy, serializePolicy } from '../src/modules/permissions/service.js';
import { emptyGrants, resolveAccess } from '../src/modules/permissions/rules.js';

test('politicas: aislamiento, concurrencia, historial y revocacion', { skip: !process.env.TEST_MONGODB_URI }, async () => {
  await mongoose.connect(process.env.TEST_MONGODB_URI!, { dbName: 'discord_dashboard_workflow_test' });
  const guildId = new mongoose.Types.ObjectId().toHexString();
  const otherGuildId = new mongoose.Types.ObjectId().toHexString();
  const actorId = '100000000000000001';
  const role = '100000000000000002';
  try {
    await GuildPolicy.init();
    assert.equal((await getPolicy(guildId)).version, 0);
    assert.equal(await GuildPolicy.countDocuments({ guildId }), 0);
    const grants = emptyGrants(); grants['knowledge.manage'] = [role];
    const save = () => savePolicy({ guildId, actorId, body: { version: 0, grants } });
    const results = await Promise.allSettled([save(), save()]);
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    const rejected = results.find((result) => result.status === 'rejected');
    assert.ok(rejected && rejected.status === 'rejected'); assert.equal(rejected.reason.status, 409);
    const saved = await getPolicy(guildId);
    assert.equal(saved.version, 1); assert.equal(saved.history[0].actorId, actorId);
    assert.deepEqual(resolveAccess(false, [role], saved.grants).capabilities, ['knowledge.read', 'knowledge.manage']);
    assert.deepEqual(resolveAccess(false, [role], (await getPolicy(otherGuildId)).grants).capabilities, []);
    const revoked = await savePolicy({ guildId, actorId, body: { version: 1, grants: emptyGrants() } });
    assert.deepEqual(resolveAccess(false, [role], revoked.grants).capabilities, []);
    const dto = serializePolicy(revoked);
    assert.equal(dto.history[1].actorId, actorId);
    assert.equal(typeof dto.history[1].at, 'string');
    assert.deepEqual(dto.history[1].before['knowledge.manage'], [role]);
    assert.deepEqual(dto.history[1].after['knowledge.manage'], []);
    await assert.rejects(() => savePolicy({ guildId, actorId, body: { version: 1, grants } }), { status: 409 });
  } finally { await GuildPolicy.deleteMany({ guildId }); await mongoose.disconnect(); }
});
