import test from 'node:test';
import assert from 'node:assert/strict';
import type { Client } from 'discord.js';
import type { Request, Response } from 'express';
import { userIdentities } from '../src/discord/user-identities.js';

test('identidades: valida lotes antes de consultar Discord y elimina duplicados', async () => {
  let calls = 0;
  const id = '100000000000000001';
  const bot = { users: { fetch: async () => { calls++; return { username: 'modeldevep', globalName: 'Model' }; } }, guilds: { cache: new Map() } } as unknown as Client;
  const handler = userIdentities(bot);
  let status = 200; let body: unknown;
  const response = { status(code: number) { status = code; return this; }, json(value: unknown) { body = value; }, setHeader() {} } as unknown as Response;
  await handler({ query: { ids: 'invalid' }, params: {} } as unknown as Request, response, () => {});
  assert.equal(status, 400); assert.equal(calls, 0);
  await handler({ query: { ids: Array(51).fill(id).join(',') }, params: {} } as unknown as Request, response, () => {});
  assert.equal(calls, 0);
  await handler({ query: { ids: `${id},${id}` }, params: {} } as unknown as Request, response, () => {});
  assert.equal(calls, 1);
  assert.deepEqual(body, { users: [{ id, name: 'Model', username: 'modeldevep' }] });
});

test('identidades: usa el apodo del servidor y tolera usuarios no disponibles sin filtrar errores', async () => {
  const id = '100000000000000001'; const missing = '100000000000000002';
  const bot = { users: { fetch: async (value: string) => { if (value === missing) throw new Error('private detail'); return { username: 'modeldevep', globalName: 'Model' }; } }, guilds: { cache: new Map([['guild', { members: { cache: new Map([[id, { displayName: 'Moderador' }]]) } }]]) } } as unknown as Client;
  let body: unknown;
  await userIdentities(bot)({ query: { ids: `${id},${missing}` }, params: { guildId: 'guild' } } as unknown as Request, { json(value: unknown) { body = value; }, setHeader() {} } as unknown as Response, () => {});
  assert.deepEqual(body, { users: [{ id, name: 'Moderador', username: 'modeldevep' }, { id: missing, name: null, username: null }] });
});
