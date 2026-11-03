import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { AdventureCharacter } from '../src/database/models/Adventure.js';
import { AdventureItem } from '../src/database/models/AdventureItem.js';
import { AdventureInventory, AdventureListing, AdventureReceipt } from '../src/database/models/AdventureEconomy.js';
import { economyOperation } from '../src/modules/adventure/economy.js';
import { baseItems, craft, positiveInteger, changeCoins, changeStack, ECONOMY } from '../src/modules/adventure/economy-rules.js';

test('crafting validates entire recipe before consuming materials, bounds quantities and protects balances', () => {
  const stacks = new Map([['wood', 2], ['herb', 1]]);
  assert.throws(() => craft(stacks, baseItems[2]!, 1)); assert.equal(stacks.get('wood'), 2);
  stacks.set('herb', 2);
  const output = craft(stacks, baseItems[2]!, 1);
  assert.deepEqual([...output], [['wooden-charm', 1]]); assert.equal(stacks.get('wood'), 2);
  for (const quantity of [0, -1, 1.5, NaN, Infinity, '1', 101]) assert.throws(() => positiveInteger(quantity));
  assert.throws(() => changeCoins(0, -1)); assert.throws(() => changeCoins(ECONOMY.maxCoins, 1));
  assert.throws(() => changeStack(stacks, 'wood', -3)); assert.throws(() => changeStack(stacks, 'gem', ECONOMY.maxStack + 1));
});

// Persistence double with serialized transactions and rollback. It verifies the service's
// multi-document protocol, not MongoDB's deployment topology or write-conflict implementation.
test('economy transfers escrow and money atomically, replays retries, and rejects forged or concurrent purchases', async t => {
  type Collection = 'characters' | 'bags' | 'listings' | 'receipts' | 'designs';
  let state: Record<Collection, any[]> = { characters: ['alice', 'bob', 'carol'].map((userId, index) => ({ userId, profession: index ? 'merchant' : 'hunter', coins: index ? 20 : 0, version: 0 })), bags: [], listings: [], receipts: [], designs: [] };
  let sequence = 0, queue = Promise.resolve(), failReceipt = false;
  const find = (collection: Collection, filter: any) => state[collection].find(row => Object.entries(filter).every(([key, value]) => row[key] === value));
  const doc = (collection: Collection, row: any) => {
    if (!row) return null;
    const copy = structuredClone(row);
    Object.defineProperties(copy, {
      set: { value: (key: string, value: unknown) => { copy[key] = value; } },
      save: { value: async () => { const index = state[collection].findIndex(item => item._id ? item._id === copy._id : item.userId === copy.userId); state[collection][index] = structuredClone(copy); } },
    });
    return copy;
  };
  const query = (collection: Collection, filter: any): any => {
    const q = { session: () => q, lean: async () => structuredClone(find(collection, filter) ?? null), then: (resolve: any, reject: any) => Promise.resolve(doc(collection, find(collection, filter))).then(resolve, reject) };
    return q;
  };
  for (const [model, collection] of [[AdventureCharacter, 'characters'], [AdventureInventory, 'bags'], [AdventureListing, 'listings'], [AdventureReceipt, 'receipts'], [AdventureItem, 'designs']] as const) {
    t.mock.method(model, 'findOne', ((filter: any) => query(collection, filter)) as never);
  }
  for (const [model, collection] of [[AdventureInventory, 'bags'], [AdventureListing, 'listings'], [AdventureReceipt, 'receipts']] as const) {
    t.mock.method(model, 'create', (async (rows: any[]) => rows.map(fields => {
      if (collection === 'receipts' && failReceipt) throw new Error('simulated write failure');
      if ((collection === 'bags' && find(collection, { userId: fields.userId })) || (collection === 'receipts' && find(collection, { userId: fields.userId, key: fields.key }))) throw Object.assign(new Error('duplicate'), { code: 11000 });
      const row = { _id: (++sequence).toString(16).padStart(24, '0'), ...(collection === 'bags' ? { stacks: new Map(), gatheredAt: null } : collection === 'listings' ? { status: 'open' } : {}), ...structuredClone(fields) };
      state[collection].push(row); return doc(collection, row);
    })) as never);
  }
  t.mock.method(mongoose, 'startSession', (async () => ({ endSession: async () => {}, withTransaction: async (callback: () => Promise<void>) => {
    const beforeQueue = queue; let release!: () => void; queue = new Promise<void>(resolve => { release = resolve; });
    await beforeQueue; const snapshot = structuredClone(state);
    try { await callback(); } catch (error) { state = snapshot; throw error; } finally { release(); }
  } })) as never);
  let keyCount = 0;
  const operation = (user: string, action: string, fields: any = {}, key = `operation-${String(++keyCount).padStart(16, '0')}`) => economyOperation(user, action, { ...fields, key });
  const bag = (userId: string) => find('bags', { userId })?.stacks as Map<string, number>;
  const balance = (userId: string) => find('characters', { userId }).coins;
  const sharedKey = 'gather-operation-0001';
  await operation('alice', 'gather', {}, sharedKey); await operation('alice', 'gather', {}, sharedKey);
  assert.equal(bag('alice').get('wood'), 2); assert.equal(state.receipts.length, 1);
  await assert.rejects(operation('alice', 'gather'), /recolectar/);
  await assert.rejects(operation('alice', 'sell', { itemId: 'wood', quantity: 1 }, sharedKey), /identificador/);
  await assert.rejects(operation('alice', 'craft', { itemId: 'design:abcdefabcdefabcdefabcdef', quantity: 1 }), /aprobado/);
  await operation('alice', 'craft', { itemId: 'wooden-charm', quantity: 1 });
  assert.equal(bag('alice').get('wooden-charm'), 1); assert.equal(bag('alice').has('wood'), false);
  await assert.rejects(operation('alice', 'list', { itemId: 'wooden-charm', quantity: 2, unitPrice: 10 }), /unidades/);
  const offer = await operation('alice', 'list', { itemId: 'wooden-charm', quantity: 1, unitPrice: 10 });
  assert.equal(bag('alice').has('wooden-charm'), false);
  await assert.rejects(operation('alice', 'buy', { listingId: offer.listingId }), /propia/);
  await assert.rejects(operation('bob', 'cancel', { listingId: offer.listingId }), /vendedor/);
  find('characters', { userId: 'bob' }).coins = 0;
  await assert.rejects(operation('bob', 'buy', { listingId: offer.listingId }), /Saldo/);
  assert.equal(find('listings', { _id: offer.listingId }).status, 'open');
  find('characters', { userId: 'bob' }).coins = 20;
  failReceipt = true;
  await assert.rejects(operation('bob', 'buy', { listingId: offer.listingId }), /write failure/);
  assert.equal(balance('bob'), 20); assert.equal(balance('alice'), 0);
  assert.equal(find('listings', { _id: offer.listingId }).status, 'open'); assert.equal(bag('bob'), undefined);
  failReceipt = false;
  const purchases = await Promise.allSettled([operation('bob', 'buy', { listingId: offer.listingId }), operation('carol', 'buy', { listingId: offer.listingId })]);
  assert.equal(purchases.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(balance('alice'), 10); assert.equal(balance('bob') + balance('carol'), 30);
  assert.equal((bag('bob')?.get('wooden-charm') ?? 0) + (bag('carol')?.get('wooden-charm') ?? 0), 1);
  await operation('carol', 'gather');
  const cancelled = await operation('carol', 'list', { itemId: 'wood', quantity: 2, unitPrice: 3 });
  const cancelKey = 'cancel-operation-0001';
  await operation('carol', 'cancel', { listingId: cancelled.listingId }, cancelKey);
  await operation('carol', 'cancel', { listingId: cancelled.listingId }, cancelKey);
  assert.equal(bag('carol').get('wood'), 2);
  const saleKey = 'system-sale-operation-0001';
  const before = balance('carol');
  await operation('carol', 'sell', { itemId: 'wood', quantity: 2 }, saleKey);
  await operation('carol', 'sell', { itemId: 'wood', quantity: 2 }, saleKey);
  assert.equal(balance('carol'), before + 4); assert.equal(bag('carol').has('wood'), false);
  await assert.rejects(operation('carol', 'sell', { itemId: 'wood', quantity: -1 }), /entero/);
  await assert.rejects(operation('nobody', 'gather'), /aventura/);
});

test('standalone MongoDB transaction errors fail closed without unsafe fallback', async t => {
  t.mock.method(AdventureReceipt, 'findOne', (() => ({ lean: async () => null })) as never);
  t.mock.method(mongoose, 'startSession', (async () => ({ withTransaction: async () => { throw Object.assign(new Error('replica set required'), { code: 20 }); }, endSession: async () => {} })) as never);
  await assert.rejects(economyOperation('player', 'gather', { key: 'standalone-operation-0001' }), /replica set/);
});
