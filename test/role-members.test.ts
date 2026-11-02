import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import session from 'express-session';
import { Collection, PermissionsBitField, PermissionFlagsBits as P, type Guild } from 'discord.js';
import type { AddressInfo } from 'node:net';
import type { guildAuthorization } from '../src/modules/permissions/access.js';
import { roleRoutes } from '../src/modules/roles/routes.js';

test('role members require live administrator authority and role hierarchy for assignment', async () => {
  const guildId = '100000000000000001', actorId = '100000000000000002', roleId = '100000000000000003', memberId = '100000000000000004';
  let bits = P.ManageRoles, hierarchy = 1, botBits = P.ManageRoles, writes = 0;
  const role = { id: roleId, managed: false };
  const cache = new Collection([[roleId, role]]);
  const member = { id: memberId, displayName: 'Ana', user: { username: 'ana' }, roles: { cache: new Collection([[roleId, role]]), add: async () => { writes++; } } };
  const actor = { get permissions() { return new PermissionsBitField(bits); }, roles: { highest: { comparePositionTo: () => hierarchy } } };
  const guild = { id: guildId, ownerId: '100000000000000009', roles: { cache, fetch: async () => cache }, members: {
    fetchMe: async () => ({ permissions: new PermissionsBitField(botBits), roles: { highest: { comparePositionTo: () => 1 } } }),
    fetch: async ({ user }: { user: string }) => user === actorId ? actor : member,
    list: async () => new Collection([[memberId, member]]),
  } } as unknown as Guild;
  const app = express(); app.use(express.json()); app.use(session({ secret: 'test-only', resave: false, saveUninitialized: false }));
  const access = { requireAny: (req, _res, next) => { req.managedGuild = guild; req.guildAccess = { canManageRoles: true, canConfigure: false, capabilities: [] }; req.session.user = { id: actorId, name: 'Test', username: 'test' }; next(); }, requireNative: (_req, _res, next) => next() } as ReturnType<typeof guildAuthorization>;
  app.use('/guilds/:guildId/roles', roleRoutes(access));
  app.use(((err, _req, res, _next) => res.status(err.status ?? 500).json({ error: err.publicMessage })) as express.ErrorRequestHandler);
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/guilds/${guildId}/roles/${roleId}/members`;
  const put = () => fetch(`${url}/${memberId}`, { method: 'PUT' });
  try {
    const data = await (await fetch(url)).json(); assert.equal(data.members[0].assigned, true); assert.equal(data.canAssign, false);
    assert.equal((await put()).status, 403); assert.equal(writes, 0);
    bits = P.Administrator; assert.equal((await put()).status, 200); assert.equal(writes, 1);
    hierarchy = 0; assert.equal((await put()).status, 403); assert.equal(writes, 1);
    hierarchy = 1; botBits = 0n; assert.equal((await put()).status, 403); assert.equal(writes, 1);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
