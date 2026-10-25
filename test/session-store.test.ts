import test from 'node:test';
import assert from 'node:assert/strict';
import { MongoClient } from 'mongodb';
import session from 'express-session';
import type { SessionData } from 'express-session';
import { createSessionStore, deserializeSession } from '../src/auth/session-store.js';

test('las sesiones cifradas se guardan y se recuperan sin doble JSON.parse', async (t) => {
  // Driver real con operaciones Mongo simuladas: prueba el cifrado de produccion sin red ni base de datos.
  const client = new MongoClient('mongodb://127.0.0.1:27017/session_store_test');
  const db = client.db(); const collection = db.collection('sessions');
  let stored: Record<string, unknown> | undefined;
  t.mock.method(client, 'db', () => db);
  t.mock.method(db, 'collection', () => collection);
  t.mock.method(collection, 'createIndex', async () => 'expires_1');
  t.mock.method(collection, 'updateOne', async (_filter: unknown, update: { $set: Record<string, unknown> }) => {
    stored = structuredClone(update.$set);
    return { acknowledged: true, matchedCount: 0, modifiedCount: 0, upsertedCount: 1, upsertedId: null };
  });
  t.mock.method(collection, 'findOne', async () => stored ? structuredClone(stored) : null);
  const store = createSessionStore(client, 'Test-only-AAaa11!!-session-secret-12345678');
  const cookie = new session.Cookie(); cookie.maxAge = 60000;
  const state: SessionData = { cookie, oauthState: 'synthetic-state', accessToken: 'synthetic-access-token' };
  await new Promise<void>((resolve, reject) => store.set('synthetic-session', state, (error) => error ? reject(error) : resolve()));
  assert.equal(typeof stored?.session, 'string');
  assert.ok(!String(stored?.session).includes('synthetic-access-token'));
  const recovered = await new Promise<SessionData | null | undefined>((resolve, reject) => store.get('synthetic-session', (error, value) => error ? reject(error) : resolve(value)));
  assert.equal(recovered?.oauthState, state.oauthState);
  assert.equal(recovered?.accessToken, state.accessToken);
  await store.close();
});

test('la deserializacion admite objetos y JSON y rechaza formatos que no son sesiones', () => {
  assert.deepEqual(deserializeSession('{"oauthState":"example"}'), { oauthState: 'example' });
  assert.deepEqual(deserializeSession({ oauthState: 'example' }), { oauthState: 'example' });
  for (const value of [null, [], 'null', '[]', '1', 'invalid-json']) assert.throws(() => deserializeSession(value));
});
