import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { ChannelType, PermissionsBitField, PermissionFlagsBits as P } from 'discord.js';
import { AdventureConfig, AdventureMembership } from '../src/database/models/Adventure.js';
import { adventureIntegrationRoutes, integrationDefaults, joinAnnouncement } from '../src/modules/adventure/integration.js';
import { deliverAdventureAnnouncements } from '../src/modules/adventure/worker.js';
import { BotControl } from '../src/database/models/BotControl.js';

test('Discord integration is optional and only queues new game registrations when explicitly enabled', () => {
  assert.equal(integrationDefaults(null).enabled, false);
  assert.deepEqual(joinAnnouncement(null, 'Luna'), { announcement: 'skipped' });
  assert.deepEqual(joinAnnouncement({ enabled: true }, 'Luna'), { announcement: 'skipped' });
  assert.equal(joinAnnouncement({ enabled: true, integration: { enabled: true, announceJoins: true, channelId: 'channel' } }, 'Luna').announcement, 'pending');
});

test('configuration requires admin or explicit delegation, validates category, and creates channels only on request', async t => {
  const categoryId = '100000000000000002', channelId = '100000000000000003', roleId = '100000000000000004';
  let admin = true, delegated = false, creates = 0, writes = 0;
  let config: any = { version: 1, enabled: true, integration: { enabled: false, categoryId: null, channelId: null, announceJoins: true, delegateRoleIds: [roleId] } };
  const category = { id: categoryId, name: 'Juego', type: ChannelType.GuildCategory, permissionsFor: () => new PermissionsBitField(P.Administrator) };
  const channel = { id: channelId, name: 'avisos', type: ChannelType.GuildText, parentId: categoryId, permissionsFor: () => new PermissionsBitField(P.Administrator) };
  const channels = new Map([[categoryId, category], [channelId, channel]] as any);
  const guild = { id: '100000000000000001', channels: { fetch: async (id?: string) => id ? channels.get(id) : channels, create: async (input: any) => { creates++; return input.type === ChannelType.GuildCategory ? category : channel; } }, members: { fetchMe: async () => ({ permissions: new PermissionsBitField(P.Administrator) }) }, roles: { fetch: async () => new Map([[roleId, { id: roleId, name: 'Mods', managed: false }]]) } };
  t.mock.method(AdventureConfig, 'findOne', (() => ({ lean: async () => config })) as never);
  t.mock.method(AdventureConfig, 'findOneAndUpdate', (async (filter: any, update: any) => { if (filter.version !== config.version) return null; writes++; config = { ...config, ...update.$set, version: config.version + 1 }; return config; }) as never);
  const app = express(); app.use(express.json()); app.use((req, res, next) => { req.managedGuild = guild as any; res.locals.canConfigureAdventure = admin; res.locals.adventureMember = { roles: { cache: new Map(delegated ? [[roleId, {}]] : []) } }; next(); });
  app.use('/integration', adventureIntegrationRoutes());
  app.use(((error, _req, res, _next) => res.status(error.status ?? 500).json({ error: error.message })) as express.ErrorRequestHandler);
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/integration`;
  const write = (path: string, body: unknown, method = 'PUT') => fetch(url + path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    assert.equal((await fetch(url)).status, 200); assert.equal(creates, 0); assert.equal(writes, 0);
    admin = false; assert.equal((await fetch(url)).status, 403);
    delegated = true; assert.equal((await fetch(url)).status, 200);
    const settings = { enabled: true, categoryId, channelId, announceJoins: true, version: 1 };
    assert.equal((await write('', { ...settings, delegateRoleIds: [] })).status, 403);
    assert.equal((await write('', { ...settings, categoryId: channelId })).status, 400);
    assert.equal((await write('', settings)).status, 200); assert.equal(creates, 0);
    assert.equal((await write('', settings)).status, 409);
    assert.equal((await write('/provision', { categoryId }, 'POST')).status, 201); assert.equal(creates, 1);
    assert.equal((await write('/provision', { categoryId: null }, 'POST')).status, 201); assert.equal(creates, 3);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('worker delivers persisted notices without mentions and skips notices after integration is disabled', async t => {
  // getControls reads the persistent singleton using findOne().lean().
  t.mock.method(BotControl, 'findOne', (() => ({ lean: async () => null })) as never);
  let enabled = true, sends = 0, processed: any, delivered = false, fail = false;
  const job = { _id: 'abcdefabcdefabcdefabcdef', guildId: 'guild', announcementChannelId: 'channel', announcementAlias: '@everyone *Luna*', announcementAttempts: 1 };
  t.mock.method(AdventureConfig, 'findOne', (() => ({ lean: async () => ({ enabled: true, integration: { enabled, announceJoins: true, categoryId: 'category', channelId: 'channel' } }) })) as never);
  t.mock.method(AdventureMembership, 'updateMany', (async () => ({})) as never);
  t.mock.method(AdventureMembership, 'findOneAndUpdate', (async () => { if (delivered) return null; delivered = true; return job; }) as never);
  t.mock.method(AdventureMembership, 'updateOne', (async (_filter: any, update: any) => { processed = update.$set; }) as never);
  const bot = { isReady: () => true, guilds: { fetch: async () => ({ channels: { fetch: async () => ({ type: ChannelType.GuildText, parentId: 'category', send: async (message: any) => { if (fail) throw new Error('Discord unavailable'); sends++; assert.deepEqual(message.allowedMentions.parse, []); assert.equal(message.nonce, job._id); assert.equal(message.enforceNonce, true); } }) } }) } };
  await deliverAdventureAnnouncements(bot as any); assert.equal(sends, 1); assert.equal(processed.announcement, 'sent');
  enabled = false; delivered = false;
  await deliverAdventureAnnouncements(bot as any); assert.equal(sends, 1); assert.equal(processed.announcement, 'skipped');
  enabled = true; delivered = false; fail = true;
  await deliverAdventureAnnouncements(bot as any); assert.equal(processed.announcement, 'pending'); assert.ok(processed.announcementDueAt > new Date());
  delivered = false; job.announcementAttempts = 5;
  await deliverAdventureAnnouncements(bot as any); assert.equal(processed.announcement, 'failed');
});
