import test from 'node:test';
import assert from 'node:assert/strict';
import { generateExpeditions, expeditionCycle, resolveExpeditionStep, prepareEncounters, resolveEnemyEncounter, rollEnemyLoot, CYCLE_MS } from '../src/modules/adventure/expedition-rules.js';
import { runDto } from '../src/modules/adventure/expeditions.js';
import { generateCountryExpeditions } from '../src/modules/adventure/expedition-generator.js';
import { AdventureConfig } from '../src/database/models/Adventure.js';
import { AdventureOffer } from '../src/database/models/AdventureExpedition.js';
import { BotControl } from '../src/database/models/BotControl.js';

test('procedural definitions are stable per country and six-hour cycle with bounded costs and outcomes', () => {
  const definitions = generateExpeditions('country', 20);
  assert.deepEqual(definitions, generateExpeditions('country', 20));
  assert.equal(definitions.length, 3); assert.equal(new Set(definitions.map(item => item.templateId)).size, 3);
  assert.equal(definitions.filter(item => item.minLevel === 1).length, 2);
  assert.equal(expeditionCycle(new Date(CYCLE_MS - 1)), 0); assert.equal(expeditionCycle(new Date(CYCLE_MS)), 1);
  for (const definition of definitions) for (const step of definition.steps) assert.ok(step.seconds >= 180 && step.seconds <= 300);
  let failures = 0;
  for (let index = 0; index < 100; index++) {
    const seed = `private-seed-${index}`;
    const safe = resolveExpeditionStep(seed, 0, 'careful');
    assert.equal(safe.quantity, 1); assert.equal(safe.experience, 4);
    const risky = resolveExpeditionStep(seed, 0, 'bold');
    assert.deepEqual(risky, resolveExpeditionStep(seed, 0, 'bold'));
    assert.ok([0, 3].includes(risky.quantity)); if (!risky.quantity) failures++;
  }
  assert.ok(failures > 0 && failures < 100);
  assert.throws(() => resolveExpeditionStep('seed', 0, 'cheat'));
});
test('run DTO never exposes the private random seed or internal snapshot', () => {
  const dto = runDto({ _id: 'run', guildId: 'country', definition: generateExpeditions('country', 20)[0], status: 'active', stage: 0, dueAt: new Date(), version: 0, seed: 'private-secret', rewards: { wood: 1, herb: 0, experience: 4 }, events: [] });
  assert.equal(JSON.stringify(dto).includes('private-secret'), false); assert.equal('definition' in dto!, false);
});
test('generation recovers after a partial failure without duplicating offers', async t => {
  const now = new Date(), cycle = expeditionCycle(now);
  let lastCycle: number | null = null, fail = true;
  const offers = new Set<string>();
  t.mock.method(BotControl, 'findOne', (() => ({ lean: async () => null })) as never);
  t.mock.method(AdventureConfig, 'find', (() => ({ sort: () => ({ limit: () => ({ lean: async () => lastCycle === cycle ? [] : [{ _id: 'config', guildId: 'country' }] }) }) })) as never);
  t.mock.method(AdventureOffer, 'bulkWrite', (async (operations: any[]) => { for (const operation of operations) offers.add(JSON.stringify(operation.updateOne.filter)); return {}; }) as never);
  t.mock.method(AdventureConfig, 'updateOne', (async () => { if (fail) { fail = false; throw new Error('interrupted'); } lastCycle = cycle; }) as never);
  await assert.rejects(generateCountryExpeditions(now), /interrupted/); assert.equal(offers.size, 3);
  await generateCountryExpeditions(now); await generateCountryExpeditions(now);
  assert.equal(offers.size, 3); assert.equal(lastCycle, cycle);
});

test('enemy encounters are stable snapshots, bounded by level, and reject exploration choices', () => {
  const definition = generateExpeditions('country', 20)[0]!;
  let encounters = 0, clear = 0;
  for (let i = 0; i < 100; i++) {
    const prepared = prepareEncounters(definition, `seed-${i}`, 1);
    assert.deepEqual(prepared, prepareEncounters(definition, `seed-${i}`, 1));
    for (const [stage, step] of prepared.steps.entries()) {
      if (!step.encounter) { clear++; continue; }
      encounters++;
      assert.ok(step.encounter.fightChance >= 35 && step.encounter.fightChance <= 90);
      assert.equal(step.encounter.avoidChance, 80);
      assert.throws(() => resolveEnemyEncounter(`seed-${i}`, stage, 'careful', step.encounter!));
      const outcome = resolveEnemyEncounter(`seed-${i}`, stage, 'fight', step.encounter);
      assert.deepEqual(outcome, resolveEnemyEncounter(`seed-${i}`, stage, 'fight', step.encounter));
      assert.equal(outcome.failed, false);
      assert.equal(resolveEnemyEncounter('seed', stage, 'avoid', { ...step.encounter, avoidChance: 0 }).failed, true);
      assert.equal(resolveEnemyEncounter('seed', stage, 'fight', { ...step.encounter, fightChance: 100 }).quantity, 3);
    }
  }
  assert.ok(encounters > 0 && clear > 0);
  assert.equal(definition.steps.some(step => step.encounter), false);
});

test('enemy loot is stable per stage and uses only supported, bounded items', () => {
  const seen = new Set<string>();
  for (let i = 0; i < 200; i++) {
    const enemy = { name: 'Bandido errante', level: 1, fightChance: 65, avoidChance: 80 };
    const loot = rollEnemyLoot(`seed-${i}`, 0, enemy);
    assert.deepEqual(loot, rollEnemyLoot(`seed-${i}`, 0, enemy));
    assert.equal(loot.length, 1);
    assert.ok(loot[0]!.quantity >= 1 && loot[0]!.quantity <= 2);
    seen.add(loot[0]!.itemId);
  }
  assert.deepEqual([...seen].sort(), ['metal-scrap', 'recovered-shield', 'recovered-sword']);
});
