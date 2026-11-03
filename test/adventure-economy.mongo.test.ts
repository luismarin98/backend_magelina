import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setServers } from 'node:dns/promises';
import mongoose from 'mongoose';
import { readConfig } from '../src/config/env.js';
import { AdventureCharacter } from '../src/database/models/Adventure.js';
import { AdventureItem } from '../src/database/models/AdventureItem.js';
import { AdventureInventory, AdventureListing, AdventureReceipt } from '../src/database/models/AdventureEconomy.js';
import { economyOperation, economyModels } from '../src/modules/adventure/economy.js';

test('real MongoDB transactions preserve inventory and currency during concurrent purchases and failures', { skip: process.env.ADVENTURE_ECONOMY_MONGO_TEST !== '1', timeout: 60000 }, async t => {
  const config = readConfig();
  const prefix = `tmp_eco_${randomUUID().replaceAll('-', '').slice(0, 12)}_`;
  assert.match(prefix, /^tmp_eco_[a-f0-9]{12}_$/);
  if (config.dnsServers.length) setServers(config.dnsServers);
  // Disable implicit collection/index creation for all application models.
  await mongoose.connect(config.mongoUri, { autoCreate: false, autoIndex: false, serverSelectionTimeoutMS: 10000 });
  const models = Object.fromEntries(Object.entries(economyModels).map(([name, model]) => [name, mongoose.model(prefix + name, model.schema.clone(), prefix + name)])) as unknown as typeof economyModels;
  const { AdventureCharacter, AdventureItem, AdventureInventory, AdventureListing, AdventureReceipt } = models;
  try {
    for (const model of Object.values(models)) { await model.createCollection(); await model.createIndexes(); }
    await AdventureCharacter.create([{ userId: 'alice', alias: 'Alice', profession: 'hunter' }, { userId: 'bob', alias: 'Bob', profession: 'merchant', coins: 20 }, { userId: 'carol', alias: 'Carol', profession: 'hunter', coins: 20 }]);
    const call = (userId: string, action: string, fields: Record<string, unknown> = {}, key = randomUUID()) => economyOperation(userId, action, { ...fields, key }, models);
    const gatherKey = randomUUID();
    await Promise.all([call('alice', 'gather', {}, gatherKey), call('alice', 'gather', {}, gatherKey)]);
    assert.equal((await AdventureInventory.findOne({ userId: 'alice' }))!.stacks.get('wood'), 2);
    assert.equal(await AdventureReceipt.countDocuments({ userId: 'alice', key: gatherKey }), 1);
    await assert.rejects(call('alice', 'gather'), /recolectar/);
    await call('alice', 'craft', { itemId: 'wooden-charm', quantity: 1 });
    const offer = await call('alice', 'list', { itemId: 'wooden-charm', quantity: 1, unitPrice: 10 });
    assert.equal((await AdventureInventory.findOne({ userId: 'alice' }))!.stacks.has('wooden-charm'), false);
    const fault = t.mock.method(AdventureReceipt, 'create', (async () => { throw new Error('injected failure'); }) as never);
    await assert.rejects(call('bob', 'buy', { listingId: offer.listingId }), /injected failure/);
    fault.mock.restore();
    assert.equal((await AdventureCharacter.findOne({ userId: 'bob' }))!.coins, 20);
    assert.equal((await AdventureCharacter.findOne({ userId: 'alice' }))!.coins, 0);
    assert.equal((await AdventureListing.findById(offer.listingId))!.status, 'open');
    assert.equal(await AdventureInventory.countDocuments({ userId: 'bob' }), 0);
    const purchaseKeys = [randomUUID(), randomUUID()];
    const outcomes = await Promise.allSettled([call('bob', 'buy', { listingId: offer.listingId }, purchaseKeys[0]), call('carol', 'buy', { listingId: offer.listingId }, purchaseKeys[1])]);
    assert.equal(outcomes.filter(outcome => outcome.status === 'fulfilled').length, 1);
    const listing = await AdventureListing.findById(offer.listingId);
    const winner = listing!.buyerId!, winnerKey = purchaseKeys[winner === 'bob' ? 0 : 1];
    await call(winner, 'buy', { listingId: offer.listingId }, winnerKey);
    assert.equal((await AdventureInventory.findOne({ userId: winner }))!.stacks.get('wooden-charm'), 1);
    assert.equal((await AdventureCharacter.find()).reduce((sum, character) => sum + character.coins, 0), 40);
    await assert.rejects(call(winner, 'sell', { itemId: 'wooden-charm', quantity: 2 }), /unidades/);
    await call(winner, 'gather');
    const approved = await AdventureItem.create({ creatorId: winner, originGuildId: 'test-country', name: 'Corona de prueba', description: 'Cosmético de prueba', category: 'cosmetic', icon: 'crown', status: 'approved' });
    await call(winner, 'craft', { itemId: `design:${approved._id}`, quantity: 1 });
    const custom = await call(winner, 'list', { itemId: `design:${approved._id}`, quantity: 1, unitPrice: 4 });
    const cancelKey = randomUUID();
    await Promise.all([call(winner, 'cancel', { listingId: custom.listingId }, cancelKey), call(winner, 'cancel', { listingId: custom.listingId }, cancelKey)]);
    assert.equal((await AdventureInventory.findOne({ userId: winner }))!.stacks.get(`design:${approved._id}`), 1);
  } finally {
    try {
      for (const model of Object.values(models)) {
        const name = model.collection.collectionName;
        assert.ok(name.startsWith(prefix));
        assert.match(name, /^tmp_eco_[a-f0-9]{12}_Adventure(?:Character|Item|Inventory|Listing|Receipt)$/);
        try { await mongoose.connection.db!.dropCollection(name); }
        catch (error) { if (!(error && typeof error === 'object' && 'code' in error && error.code === 26)) throw error; }
      }
    } finally { await mongoose.disconnect(); }
  }
});
