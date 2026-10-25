import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import session from 'express-session';
import { Client, GatewayIntentBits } from 'discord.js';
import type { AddressInfo } from 'node:net';
import { guildAuthorization } from '../src/modules/permissions/access.js';
import { capabilities, emptyGrants, resolveAccess } from '../src/modules/permissions/rules.js';
import { BotControl } from '../src/database/models/BotControl.js';
import { GuildPolicy } from '../src/database/models/GuildPolicy.js';
import { defaultControls } from '../src/modules/operations/service.js';
import { roleRoutes } from '../src/modules/roles/routes.js';

const ownerId = '100000000000000001'; const memberId = '100000000000000002'; const guildId = '100000000000000003';

test('solo el owner global recibe todas las capacidades sin permisos locales', () => {
  assert.deepEqual(resolveAccess(false, [], emptyGrants(), 'owner').capabilities, capabilities);
  assert.equal(resolveAccess(false, [], emptyGrants(), 'owner').canConfigure, true);
  for (const role of ['operator', 'member'] as const) assert.deepEqual(resolveAccess(false, [], emptyGrants(), role), { canConfigure: false, capabilities: [] });
});

test('HTTP: owner global ve comunidades y pantallas; otros roles no pueden escalar acceso', async (t) => {
  const bot = new Client({ intents: [GatewayIntentBits.Guilds] });
  const guild = { id: guildId, name: 'Comunidad del bot' };
  t.mock.method(bot.guilds.cache, 'get', (id: string) => id === guildId ? guild : undefined);
  t.mock.method(bot.guilds.cache, 'values', () => [guild].values());
  let blocked = false; let discordPermissions = '0';
  let guildOwnerId = '100000000000000004', roleIds: string[] = [], memberPresent = true;
  const grants = emptyGrants();
  Object.defineProperties(guild, {
    ownerId: { get: () => guildOwnerId },
    members: { value: { fetch: async () => {
      if (!memberPresent) throw Object.assign(new Error('No member'), { code: 10007 });
      return { id: memberId, roles: { cache: new Map(roleIds.map(id => [id, {}])) }, permissions: { has: (bit: bigint) => (BigInt(discordPermissions) & bit) !== 0n } };
    } } },
  });
  t.mock.method(BotControl, 'findOne', () => ({ lean: async () => ({ key: 'global', version: 0, ...defaultControls(), blockedGuildIds: blocked ? [guildId] : [], history: [] }) }));
  t.mock.method(GuildPolicy, 'findOne', () => ({ lean: async () => ({ grants, history: [], version: 1 }) }));
  const originalFetch = globalThis.fetch;
  const fetch = t.mock.method(globalThis, 'fetch', originalFetch);
  // Solo intercepta Discord; las peticiones de prueba a localhost siguen siendo HTTP real.
  fetch.mock.mockImplementation(async (input: string | URL | Request, init?: RequestInit) => {
    if (String(input).startsWith('https://discord.com/')) return new Response(JSON.stringify([{ id: guildId, name: guild.name, permissions: discordPermissions }]), { status: 200 });
    return originalFetch(input, init);
  });
  const access = guildAuthorization(bot, { ownerIds: [ownerId] });
  const app = express();
  app.use(express.json());
  app.use(session({ secret: 'only-test-secret-AAaa11!!-not-production', resave: false, saveUninitialized: false }));
  app.use((req, _res, next) => { req.session.user = { id: req.get('x-test-user') ?? ownerId, username: 'test', name: 'Test' }; req.session.accessToken = 'synthetic-user-token'; next(); });
  app.get('/guilds', async (req, res) => res.json(await access.listGuilds(req.session.accessToken!, req.session.user!.id)));
  app.get('/guilds/:guildId/access', access.requireMember, (req, res) => res.json(req.guildAccess));
  app.get('/guilds/:guildId/settings', access.requireNative, (_req, res) => res.json({ available: true }));
  app.get('/guilds/:guildId/tasks', access.requireCapability('workflow.read'), (_req, res) => res.json({ available: true }));
  app.post('/guilds/:guildId/settings', access.requireNative, (_req, res) => res.json({ available: true }));
  app.use('/guilds/:guildId/roles', roleRoutes(access));
  app.use(((error, _req, res, _next) => { res.status(error.status ?? 500).json({ error: 'Acceso rechazado' }); }) as express.ErrorRequestHandler);
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const list = await globalThis.fetch(`${base}/guilds`);
    assert.deepEqual(await list.json(), [{ ...guild, icon: null, banner: null, botInstalled: true }]);
    const owner = await globalThis.fetch(`${base}/guilds/${guildId}/access`);
    assert.equal(owner.status, 200);
    assert.deepEqual(await owner.json(), { canConfigure: true, canManageRoles: true, canModerate: true, capabilities, source: 'bot-owner' });
    assert.equal((await globalThis.fetch(`${base}/guilds/${guildId}/settings`)).status, 200);
    assert.equal(fetch.mock.calls.filter((call) => String(call.arguments[0]).startsWith('https://discord.com/')).length, 0);
    assert.equal((await globalThis.fetch(`${base}/guilds/${guildId}/settings?role=owner`, { headers: { 'x-test-user': memberId } })).status, 403);
    assert.equal((await globalThis.fetch(`${base}/guilds/100000000000000099/access`)).status, 404);
    discordPermissions = '268435456';
    const moderator = await globalThis.fetch(`${base}/guilds/${guildId}/access`, { headers: { 'x-test-user': memberId } });
    assert.equal(moderator.status, 200);
    const moderatorAccess = await moderator.json() as { canConfigure: boolean; canManageRoles: boolean };
    assert.equal(moderatorAccess.canManageRoles, true);
    assert.equal(moderatorAccess.canConfigure, false);
    assert.equal((await globalThis.fetch(`${base}/guilds/${guildId}/settings`, { headers: { 'x-test-user': memberId } })).status, 403);
    // Visibility of a shared guild does not grant access to any module.
    discordPermissions = '0';
    const ordinary = await globalThis.fetch(`${base}/guilds/${guildId}/access`, { headers: { 'x-test-user': memberId } });
    assert.equal(ordinary.status, 200);
    assert.deepEqual((await ordinary.json() as { capabilities: string[] }).capabilities, []);
    assert.equal((await globalThis.fetch(`${base}/guilds`, { headers: { 'x-test-user': memberId } })).status, 200);
    assert.equal((await globalThis.fetch(`${base}/guilds/${guildId}/tasks`, { headers: { 'x-test-user': memberId } })).status, 403);
    // Native Administrator and Manage Guild cannot claim governance or module access.
    for (const permissions of ['8', '32']) {
      discordPermissions = permissions;
      assert.equal((await globalThis.fetch(`${base}/guilds/${guildId}/settings`, { headers: { 'x-test-user': memberId } })).status, 403);
      assert.equal((await globalThis.fetch(`${base}/guilds/${guildId}/settings`, { method: 'POST', headers: { 'x-test-user': memberId } })).status, 403);
      assert.equal((await globalThis.fetch(`${base}/guilds/${guildId}/tasks`, { headers: { 'x-test-user': memberId } })).status, 403);
    }
    discordPermissions = '8';
    for (const [method, action] of [['PATCH', 'type'], ['POST', 'apply-template']]) {
      const response = await globalThis.fetch(`${base}/guilds/${guildId}/roles/100000000000000005/${action}`, {
        method, headers: { 'x-test-user': memberId, 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'administrator', version: 0, bindingVersion: 0 }),
      });
      assert.equal(response.status, 403);
    }
    // Dynamic role IDs are resolved again on the next request.
    const roleId = '100000000000000005';
    grants['workflow.read'] = [roleId]; roleIds = [roleId];
    assert.equal((await globalThis.fetch(`${base}/guilds/${guildId}/tasks`, { headers: { 'x-test-user': memberId } })).status, 200);
    assert.equal((await globalThis.fetch(`${base}/guilds/${guildId}/settings`, { headers: { 'x-test-user': memberId } })).status, 403);
    roleIds = [];
    assert.equal((await globalThis.fetch(`${base}/guilds/${guildId}/tasks`, { headers: { 'x-test-user': memberId } })).status, 403);
    // Ownership is checked against the actual guild, not a role label or OAuth flag.
    guildOwnerId = memberId; discordPermissions = '0';
    assert.equal((await globalThis.fetch(`${base}/guilds/${guildId}/settings`, { headers: { 'x-test-user': memberId } })).status, 200);
    guildOwnerId = '100000000000000004'; memberPresent = false;
    assert.equal((await globalThis.fetch(`${base}/guilds/${guildId}/access`, { headers: { 'x-test-user': memberId } })).status, 403);
    memberPresent = true;
    blocked = true;
    assert.equal((await globalThis.fetch(`${base}/guilds/${guildId}/settings`)).status, 200);
    assert.equal((await globalThis.fetch(`${base}/guilds/${guildId}/settings`, { method: 'POST' })).status, 403);
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); await bot.destroy(); }
});
