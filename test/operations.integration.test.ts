import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { BotControl } from '../src/database/models/BotControl.js';
import { defaultControls, assertAvailable, saveControls } from '../src/modules/operations/service.js';
import { effectiveRole } from '../src/modules/operations/roles.js';

test('controles globales: mantenimiento, bloqueo e historial atomico', { skip: !process.env.TEST_MONGODB_URI }, async () => {
  // Base exclusiva para la politica singleton; requiere estar vacia.
  await mongoose.connect(process.env.TEST_MONGODB_URI!, { dbName: 'discord_dashboard_operations_test' });
  const actorId = '100000000000000001'; const guildId = '100000000000000002'; let ownsDocument = false;
  try {
    await BotControl.init(); assert.equal(await BotControl.countDocuments({ key: 'global' }), 0, 'Usa una base de pruebas vacia.');
    const roles = { ownerIds: [actorId], operatorIds: ['100000000000000003'] };
    assert.equal(await effectiveRole('100000000000000003', roles), 'operator');
    const saved = await saveControls(actorId, { ...defaultControls(), version: 0, maintenance: true, operatorIds: ['100000000000000004'] }); ownsDocument = true;
    assert.equal(await effectiveRole('100000000000000003', roles), 'member');
    assert.equal(await effectiveRole('100000000000000004', roles), 'operator');
    assert.equal(await effectiveRole(actorId, roles), 'owner');
    assert.equal(saved.version, 1); assert.equal(saved.history[0].actorId, actorId);
    await assert.rejects(() => assertAvailable(guildId, 'projects'), { status: 503 });
    await assert.doesNotReject(() => assertAvailable(guildId, undefined, false));
    await assert.rejects(() => saveControls(actorId, { ...defaultControls(), version: 0 }), { status: 409 });
    await saveControls(actorId, { ...defaultControls(), version: 1, blockedGuildIds: [guildId] });
    await assert.rejects(() => assertAvailable(guildId, undefined, false), { status: 403 });
    await saveControls(actorId, { ...defaultControls(), version: 2, disabledModules: ['projects'] });
    await assert.rejects(() => assertAvailable(guildId, 'projects'), { status: 503 });
    await assert.doesNotReject(() => assertAvailable(guildId, 'knowledge'));
  } finally { if (ownsDocument) await BotControl.deleteOne({ key: 'global' }); await mongoose.disconnect(); }
});
