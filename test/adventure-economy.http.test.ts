import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import session from 'express-session';
import type { AddressInfo } from 'node:net';
import mongoose from 'mongoose';
import { AdventureCharacter } from '../src/database/models/Adventure.js';
import { BotControl } from '../src/database/models/BotControl.js';
import { globalAdventureRoutes } from '../src/modules/adventure/global.js';

test('economy API requires an authenticated character and rejects client-defined balances, recipes and owners', async t => {
  let signedIn = false, registered = true, transactions = 0;
  t.mock.method(AdventureCharacter, 'exists', (async () => registered ? { _id: 'character' } : null) as never);
  t.mock.method(BotControl, 'findOne', (() => ({ lean: async () => null })) as never);
  t.mock.method(mongoose, 'startSession', (async () => { transactions++; throw new Error('Unexpected transaction'); }) as never);
  const app = express(); app.use(express.json()); app.use(session({ secret: 'economy-http-test', resave: false, saveUninitialized: false }));
  app.use((req, _res, next) => {
    if (signedIn) { req.session.user = { id: 'player', name: 'Player', username: 'player' }; req.session.accessToken = 'test-token'; req.session.tokenExpiresAt = Date.now() + 60000; }
    next();
  });
  app.use('/adventure', globalAdventureRoutes());
  app.use(((error, _req, res, _next) => res.status(error.status ?? 500).json({ error: error.message })) as express.ErrorRequestHandler);
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/adventure/economy`;
  const post = (action: string, body: unknown) => fetch(`${base}/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    assert.equal((await post('gather', {})).status, 401);
    signedIn = true; registered = false;
    assert.equal((await post('gather', {})).status, 409);
    registered = true;
    for (const [action, body] of [
      ['gather', { key: 'request-key-00000001', coins: 999 }],
      ['craft', { key: 'request-key-00000002', itemId: 'wooden-charm', quantity: 1, ingredients: {} }],
      ['list', { key: 'request-key-00000003', itemId: 'wood', quantity: 1, unitPrice: 2, sellerId: 'other' }],
      ['buy', { key: 'request-key-00000004', listingId: 'abcdefabcdefabcdefabcdef', total: 0 }],
      ['sell', { itemId: 'wood', quantity: 1 }],
    ] as const) assert.equal((await post(action, body)).status, 400);
    assert.equal(transactions, 0);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
