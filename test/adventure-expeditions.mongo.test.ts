import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setServers } from 'node:dns/promises';
import mongoose from 'mongoose';
import { readConfig } from '../src/config/env.js';
import { expeditionModels, expeditionOperation } from '../src/modules/adventure/expeditions.js';
import { economyModels, economyOperation } from '../src/modules/adventure/economy.js';
import { generateExpeditions } from '../src/modules/adventure/expedition-rules.js';

test('real transactions allow one expedition and exactly one reward claim with durable stages and rollback', { skip: process.env.ADVENTURE_EXPEDITION_MONGO_TEST !== '1', timeout: 120000 }, async t => {
  const config = readConfig(), prefix = `tmp_exp_${randomUUID().replaceAll('-', '').slice(0, 12)}_`;
  if (config.dnsServers.length) setServers(config.dnsServers);
  await mongoose.connect(config.mongoUri, { autoCreate: false, autoIndex: false, serverSelectionTimeoutMS: 10000 });
  const originals = { ...economyModels, ...expeditionModels };
  const models = Object.fromEntries(Object.entries(originals).map(([name, model]) => [name, mongoose.model(prefix + name, model.schema.clone(), prefix + name)])) as unknown as typeof originals;
  const { AdventureCharacter, AdventureConfig, AdventureMembership, AdventureOffer, AdventureRun, AdventureInventory, AdventureReceipt } = models;
  const world = { list: async () => [], verify: async () => 'Pais de prueba' };
  const country = '100000000000000001';
  const call = (user: string, action: string, body: Record<string, unknown> = {}, key = randomUUID()) => expeditionOperation(user, action, { ...body, key }, world, models);
  try {
    for (const model of Object.values(models)) { await model.createCollection(); await model.createIndexes(); }
    await AdventureConfig.create({ guildId: country, enabled: true });
    await AdventureMembership.create(['alice', 'bob'].map(userId => ({ userId, guildId: country })));
    await AdventureCharacter.create(['alice', 'bob'].map(userId => ({ userId, alias: userId, currentGuildId: country })));
    const definitions = generateExpeditions(country, 1);
    const generation = definitions.map(definition => ({ updateOne: { filter: { guildId: country, cycle: 1, templateId: definition.templateId }, update: { $setOnInsert: { definition, expiresAt: new Date(Date.now() + 3600000) } }, upsert: true } }));
    await AdventureOffer.bulkWrite(generation); await AdventureOffer.bulkWrite(generation);
    assert.equal(await AdventureOffer.countDocuments(), 3);
    const offers = await AdventureOffer.find().sort({ 'definition.minLevel': 1, templateId: 1 });
    await assert.rejects(call('alice', 'start', { offerId: String(offers[2]!._id) }), /nivel/);
    const startKeys = [randomUUID(), randomUUID()];
    const starts = await Promise.allSettled([call('alice', 'start', { offerId: String(offers[0]!._id) }, startKeys[0]), call('alice', 'start', { offerId: String(offers[1]!._id) }, startKeys[1])]);
    assert.equal(starts.filter(value => value.status === 'fulfilled').length, 1);
    let run = (await AdventureRun.findOne({ userId: 'alice', active: true }))!;
    assert.equal(await AdventureRun.countDocuments({ userId: 'alice', active: true }), 1);
    assert.equal(run.seed, undefined);
    await assert.rejects(call('alice', 'decide', { runId: String(run._id), version: 0, choice: 'careful' }), /lista/);
    await assert.rejects(call('bob', 'decide', { runId: String(run._id), version: 0, choice: 'careful' }), /pertenece/);
    await assert.rejects(economyOperation('alice', 'travel', { guildId: null, version: 1, key: randomUUID() }, models, world), /aventura/);
    const guaranteed = structuredClone(run.definition);
    guaranteed.steps.forEach((step: any) => { step.encounter = { name: 'Bandido errante', level: 1, fightChance: 100, avoidChance: 80 }; });
    await AdventureRun.collection.updateOne({ _id: run._id }, { $set: { definition: guaranteed, dueAt: new Date(0) } });
    run = (await AdventureRun.findById(run._id))!;
    const decisions = await Promise.allSettled([call('alice', 'decide', { runId: String(run._id), version: 0, choice: run.definition.steps[0].encounter ? 'fight' : 'careful' }), call('alice', 'decide', { runId: String(run._id), version: 0, choice: run.definition.steps[0].encounter ? 'fight' : 'bold' })]);
    assert.equal(decisions.filter(value => value.status === 'fulfilled').length, 1);
    assert.equal(await AdventureInventory.countDocuments({ userId: 'alice' }), 0);
    run = (await AdventureRun.findById(run._id))!;
    assert.equal(run.stage, 1); assert.equal(run.version, 1);
    await assert.rejects(call('alice', 'claim', { runId: String(run._id), version: 1 }), /etapas/);
    await AdventureOffer.deleteOne({ _id: run.offerId }); // The accepted snapshot survives board rotation/removal.
    await AdventureRun.updateOne({ _id: run._id }, { $set: { dueAt: new Date(Date.now() - 1000) } });
    await call('alice', 'decide', { runId: String(run._id), version: 1, choice: run.definition.steps[1].encounter ? 'fight' : 'careful' });
    run = (await AdventureRun.findById(run._id))!; assert.equal(run.status, 'ready');
    const fault = t.mock.method(AdventureReceipt, 'create', (async () => { throw new Error('injected failure'); }) as never);
    await assert.rejects(call('alice', 'claim', { runId: String(run._id), version: 2 }), /injected failure/);
    fault.mock.restore();
    assert.equal((await AdventureCharacter.findOne({ userId: 'alice' }))!.experience, 0);
    assert.equal(await AdventureInventory.countDocuments({ userId: 'alice' }), 0);
    assert.equal((await AdventureRun.findById(run._id))!.status, 'ready');
    const claimKeys = [randomUUID(), randomUUID()];
    const claims = await Promise.allSettled(claimKeys.map(key => call('alice', 'claim', { runId: String(run._id), version: 2 }, key)));
    assert.equal(claims.filter(value => value.status === 'fulfilled').length, 1);
    const winningKey = claimKeys[claims[0].status === 'fulfilled' ? 0 : 1];
    await call('alice', 'claim', { runId: String(run._id), version: 2 }, winningKey);
    const character = (await AdventureCharacter.findOne({ userId: 'alice' }))!, bag = (await AdventureInventory.findOne({ userId: 'alice' }))!;
    for (const item of run.loot) assert.equal(bag.stacks.get(item.itemId), item.quantity);
    assert.ok(run.loot.length > 0);
    assert.equal(character.experience, run.rewards!.experience); assert.equal(character.activeAdventureId, null);
    assert.equal(bag.stacks.get('herb') ?? 0, run.rewards!.herb);
    assert.equal(bag.stacks.get('wood') ?? 0, run.rewards!.wood);
    const bobOffer = offers.find(offer => String(offer._id) !== run.offerId && offer.definition.minLevel === 1)!;
    const bob = await call('bob', 'start', { offerId: String(bobOffer._id) });
    const bobRun = (await AdventureRun.findById(bob.runId))!;
    const definition = structuredClone(bobRun.definition);
    definition.steps[0].encounter = { name: 'Enemigo de prueba', level: 1, fightChance: 0, avoidChance: 0 };
    // Force an isolated fixture outcome; production snapshots remain immutable.
    await AdventureRun.collection.updateOne({ _id: bobRun._id }, { $set: { definition, dueAt: new Date(0), rewards: { wood: 7, herb: 3, experience: 9 }, loot: [{ itemId: 'enemy-hide', quantity: 3 }] } });
    await AdventureInventory.create({ userId: 'bob', stacks: { wood: 20 } });
    await call('bob', 'decide', { runId: bob.runId, version: 0, choice: 'fight' });
    const wounded = (await AdventureRun.findById(bobRun._id))!;
    assert.equal(wounded.loot[0]!.quantity, 1);
    assert.equal(wounded.rewards!.wood, 3); assert.equal(wounded.rewards!.herb, 1); assert.equal(wounded.rewards!.experience, 4);
    definition.steps[1].encounter = { name: 'Enemigo de prueba', level: 1, fightChance: 0, avoidChance: 0 };
    await AdventureRun.collection.updateOne({ _id: bobRun._id }, { $set: { definition, dueAt: new Date(0) } });
    const failureKey = randomUUID();
    await call('bob', 'decide', { runId: bob.runId, version: 1, choice: 'avoid' }, failureKey);
    await call('bob', 'decide', { runId: bob.runId, version: 1, choice: 'avoid' }, failureKey);
    const failed = (await AdventureRun.findById(bobRun._id))!;
    assert.equal(failed.loot.length, 0);
    assert.equal(failed.status, 'failed'); assert.equal(failed.active, false); assert.equal(failed.rewards!.wood, 0);
    assert.equal((await AdventureCharacter.findOne({ userId: 'bob' }))!.activeAdventureId, null);
    assert.equal((await AdventureInventory.findOne({ userId: 'bob' }))!.stacks.get('wood'), 20);
    await assert.rejects(call('bob', 'start', { offerId: String(bobOffer._id) }), /descansar/);
    assert.equal((await AdventureCharacter.findOne({ userId: 'bob' }))!.experience, 0);
    assert.equal(await AdventureInventory.countDocuments({ userId: 'bob' }), 1);
  } finally {
    try {
      for (const model of Object.values(models)) {
        const name = model.collection.collectionName;
        assert.ok(name.startsWith(prefix)); assert.match(name, /^tmp_exp_[a-f0-9]{12}_Adventure(?:Config|Membership|Character|Item|Inventory|Listing|Receipt|Offer|Run)$/);
        try { await mongoose.connection.db!.dropCollection(name); }
        catch (error) { if (!(error && typeof error === 'object' && 'code' in error && error.code === 26)) throw error; }
      }
    } finally { await mongoose.disconnect(); }
  }
});
