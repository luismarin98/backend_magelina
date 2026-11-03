import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import session from 'express-session';
import type { AddressInfo } from 'node:net';
import { PermissionsBitField, PermissionFlagsBits as P } from 'discord.js';
import { AdventureCharacter, AdventureConfig, AdventureMembership } from '../src/database/models/Adventure.js';
import { adventureRoutes, characterAlias } from '../src/modules/adventure/routes.js';
import type { guildAuthorization } from '../src/modules/permissions/access.js';

test('character aliases reject invisible characters, empty values and long names', () => {
  assert.equal(characterAlias('  Luna  '), 'Luna');
  for (const alias of ['', 'a', 'a'.repeat(33), 'Luna\nAdmin', 'Luna\u200b']) assert.throws(() => characterAlias(alias));
});

test('game signup is voluntary, global progress survives guild changes, and players cannot edit currency or other accounts', async t => {
  const user = '100000000000000001', guildA = '100000000000000010', guildB = '100000000000000020';
  let actorId = user, admin = false, present = true;
  const characters = new Map<string, any>(), memberships = new Map<string, any>(), configs = new Map<string, any>();
  const key = (filter: any) => `${filter.guildId}:${filter.userId}`;
  t.mock.method(AdventureCharacter, 'findOne', ((filter: any) => Object.assign(Promise.resolve(characters.get(filter.userId) ?? null), { lean: async () => characters.get(filter.userId) ?? null })) as never);
  t.mock.method(AdventureCharacter, 'create', (async (input: any) => {
    if (characters.has(input.userId)) throw Object.assign(new Error('duplicate'), { code: 11000 });
    const character = { ...input, level: 1, rank: 'F', experience: 0, coins: 0, version: 0 }; characters.set(input.userId, character); return character;
  }) as never);
  t.mock.method(AdventureCharacter, 'findOneAndUpdate', (async (filter: any, update: any) => {
    const character = characters.get(filter.userId); if (!character || character.version !== filter.version) return null;
    Object.assign(character, update.$set); character.version++; return character;
  }) as never);
  t.mock.method(AdventureMembership, 'findOne', ((filter: any) => Object.assign(Promise.resolve(memberships.get(key(filter)) ?? null), { lean: async () => memberships.get(key(filter)) ?? null })) as never);
  t.mock.method(AdventureMembership, 'findOneAndUpdate', (async (filter: any, update: any) => {
    let membership = memberships.get(key(filter));
    if (update.$setOnInsert) { if (!membership) { membership = { ...filter, localAlias: null, version: 0, createdAt: new Date() }; memberships.set(key(filter), membership); } return membership; }
    if (!membership || membership.version !== filter.version) return null;
    Object.assign(membership, update.$set); membership.version++; return membership;
  }) as never);
  t.mock.method(AdventureConfig, 'findOne', ((filter: any) => ({ lean: async () => configs.get(filter.guildId) ?? null })) as never);
  t.mock.method(AdventureConfig, 'findOneAndUpdate', (async (filter: any, update: any) => {
    const current = configs.get(filter.guildId); if (current && current.version !== filter.version) throw Object.assign(new Error('duplicate'), { code: 11000 });
    const config = { ...update.$set, version: (current?.version ?? 0) + 1 }; configs.set(filter.guildId, config); return config;
  }) as never);
  const app = express(); app.use(express.json()); app.use(session({ secret: 'adventure-test', resave: false, saveUninitialized: false }));
  const access = { requireMember: (req, _res, next) => {
    req.session.user = { id: actorId, name: 'Player', username: 'player' };
    req.managedGuild = { id: req.params.guildId, ownerId: '100000000000000099', members: { fetch: async () => {
      if (!present) throw Object.assign(new Error('not a member'), { code: 10007 });
      return { id: actorId, permissions: new PermissionsBitField(admin ? P.Administrator : 0n) };
    } } } as any; next();
  } } as ReturnType<typeof guildAuthorization>;
  app.use('/guilds/:guildId/adventure', adventureRoutes(access));
  app.use(((error, _req, res, _next) => res.status(error.status ?? 500).json({ error: error.publicMessage ?? error.message })) as express.ErrorRequestHandler);
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const url = (guild: string) => `${base}/guilds/${guild}/adventure`;
  const write = (guild: string, endpoint: string, body: unknown, method = 'POST') => fetch(url(guild) + endpoint, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    const initial = await (await fetch(url(guildA))).json();
    assert.equal(initial.character, null); assert.equal(initial.membership, null); assert.equal(initial.enabled, false);
    assert.equal(characters.size + memberships.size + configs.size, 0);
    assert.equal((await write(guildA, '/join', { alias: 'Luna' })).status, 409);
    assert.equal((await write(guildA, '/settings', { enabled: true, version: 0 }, 'PUT')).status, 403);
    admin = true;
    for (const guild of [guildA, guildB]) assert.equal((await write(guild, '/settings', { enabled: true, version: 0 }, 'PUT')).status, 200);
    admin = false;
    assert.equal((await write(guildA, '/join', { alias: 'Luna', userId: 'other' })).status, 400);
    const concurrent = await Promise.all([write(guildA, '/join', { alias: 'Luna' }), write(guildA, '/join', { alias: 'Luna' })]);
    assert.deepEqual(concurrent.map(response => response.status), [200, 200]);
    assert.equal(characters.size, 1); assert.equal(memberships.size, 1);
    Object.assign(characters.get(user), { level: 5, rank: 'D', coins: 42, experience: 1500 });
    const outside = await (await fetch(url(guildB))).json();
    assert.equal(outside.character.coins, 42); assert.equal(outside.membership, null);
    for (let retry = 0; retry < 2; retry++) assert.equal((await write(guildB, '/join', { alias: 'No sobrescribir' })).status, 200);
    assert.equal(characters.size, 1); assert.equal(memberships.size, 2);
    assert.equal(characters.get(user).coins, 42); assert.equal(characters.get(user).alias, 'Luna');
    assert.equal((await write(guildB, '/membership', { localAlias: 'Luna del norte', version: 0 }, 'PATCH')).status, 200);
    assert.equal((await write(guildB, '/character', { alias: 'Selene', version: 0 }, 'PATCH')).status, 200);
    const first = await (await fetch(url(guildA))).json(), second = await (await fetch(url(guildB))).json();
    assert.deepEqual(first.character, second.character); assert.equal(first.character.alias, 'Selene');
    assert.equal(first.membership.localAlias, null); assert.equal(second.membership.localAlias, 'Luna del norte');
    assert.equal((await write(guildA, '/character', { alias: 'Stale', version: 0 }, 'PATCH')).status, 409);
    assert.equal((await write(guildA, '/character', { alias: 'Cheat', version: 1, coins: 9999 }, 'PATCH')).status, 400);
    actorId = '100000000000000002';
    assert.equal((await (await fetch(url(guildA))).json()).character, null);
    assert.equal((await write(guildA, '/character', { alias: 'Other', version: 1 }, 'PATCH')).status, 409);
    present = false;
    assert.equal((await fetch(url(guildA))).status, 403);
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});
