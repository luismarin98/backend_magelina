import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import session from 'express-session';
import type { AddressInfo } from 'node:net';
import { ChannelType, Collection, PermissionsBitField, PermissionFlagsBits as P, type Guild } from 'discord.js';
import { teamSpaceRoutes } from '../src/modules/moderation/team-space.js';
import { TeamSpace } from '../src/database/models/TeamSpace.js';
import { SystemEvent } from '../src/database/models/BotControl.js';
import type { guildAuthorization } from '../src/modules/permissions/access.js';

test('staff edits require admin and explicit consent for linked channels; unlink never deletes Discord channels', async t => {
  const guildId = '100000000000000001', roleId = '100000000000000002', botId = '100000000000000003', categoryId = '100000000000000004', channelId = '100000000000000005';
  let admin = false, edits = 0;
  const permissions = new PermissionsBitField(P.Administrator);
  const overwrites = new Collection([
    [guildId, { id: guildId, deny: new PermissionsBitField(P.ViewChannel), allow: new PermissionsBitField() }],
    [roleId, { id: roleId, allow: new PermissionsBitField(P.ViewChannel), deny: new PermissionsBitField() }],
    [botId, { id: botId, allow: new PermissionsBitField(P.ViewChannel), deny: new PermissionsBitField() }],
  ]);
  const channel = (id: string, type: number, name: string, parentId: string | null) => ({ id, type, name, parentId, guild: { id: guildId }, permissionOverwrites: { cache: overwrites }, permissionsFor: () => permissions, edit: async (value: any) => { edits++; Object.assign(channels.get(id)!, { name: value.name, ...(value.parent ? { parentId: value.parent } : {}) }); }, delete: async () => { throw new Error('Must not delete'); } });
  const channels = new Collection<string, ReturnType<typeof channel>>();
  channels.set(categoryId, channel(categoryId, ChannelType.GuildCategory, 'Staff', null));
  channels.set(channelId, channel(channelId, ChannelType.GuildText, 'avisos', categoryId));
  const space: any = { _id: 'space', guildId, roleIds: [roleId], categoryId, categoryManaged: false, channels: [{ key: 'notices', name: 'avisos', type: 'text', channelId, status: 'ready', managed: false }], version: 0, locked: false, save: async () => {} };
  t.mock.method(TeamSpace, 'findOne', (() => Object.assign(Promise.resolve(space), { lean: async () => space })) as never);
  t.mock.method(TeamSpace, 'findOneAndUpdate', (async (filter: any, update: any) => { if (filter.version !== space.version || space.locked) return null; Object.assign(space, update.$set); space.version++; return space; }) as never);
  t.mock.method(TeamSpace, 'updateOne', (async (_filter: any, update: any) => Object.assign(space, update.$set)) as never);
  t.mock.method(SystemEvent, 'create', (async () => ({})) as never);
  const guild = { id: guildId, ownerId: '100000000000000099', members: { fetchMe: async () => ({ id: botId, permissions }), fetch: async () => ({ permissions: new PermissionsBitField(admin ? P.Administrator : P.ModerateMembers | P.ManageChannels | P.ManageRoles) }) }, channels: { fetch: async () => channels }, roles: { fetch: async () => new Collection([[roleId, { id: roleId, name: 'Equipo', managed: false }]]) } } as unknown as Guild;
  const app = express(); app.use(express.json()); app.use(session({ secret: 'staff-test', resave: false, saveUninitialized: false }));
  const access = { requireAny: (req, _res, next) => { req.managedGuild = guild; req.guildAccess = { source: 'delegated', canConfigure: false, capabilities: [] }; req.session.user = { id: '100000000000000010', username: 'admin', name: 'Admin' }; next(); } } as ReturnType<typeof guildAuthorization>;
  app.use('/staff', teamSpaceRoutes(access));
  app.use(((error, _req, res, _next) => res.status(error.status ?? 500).json({ error: error.publicMessage ?? error.message })) as express.ErrorRequestHandler);
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/staff`;
  const body = () => ({ version: space.version, roleIds: [roleId], categoryId, categoryName: 'Staff', channels: [{ key: 'notices', name: 'avisos-renombrados', type: 'text', channelId }] });
  const write = (value: unknown) => fetch(base + '/prepare', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
  try {
    assert.equal((await write(body())).status, 403); assert.equal(edits, 0);
    admin = true;
    assert.equal((await write(body())).status, 400); assert.equal(edits, 0);
    const foreignId = '100000000000000020';
    channels.set(foreignId, channel(foreignId, ChannelType.GuildText, 'otro-espacio', categoryId));
    assert.equal((await write({ ...body(), applyPermissions: true })).status, 400); assert.equal(edits, 0);
    channels.delete(foreignId);
    const result = await write({ ...body(), applyPermissions: true }); assert.equal(result.status, 200, await result.text());
    assert.equal(channels.get(channelId)!.name, 'avisos-renombrados'); assert.equal(space.channels[0].managed, false);
    channels.get(channelId)!.name = 'cambio-desde-discord';
    const snapshot = await (await fetch(base)).json();
    assert.equal(snapshot.space.channels[0].currentName, 'cambio-desde-discord');
    channels.get(channelId)!.name = 'avisos-renombrados';
    const before = edits;
    assert.equal((await write({ ...body(), version: 0, applyPermissions: true })).status, 409); assert.equal(edits, before);
    space.channels[0].managed = true;
    assert.equal((await write(body())).status, 200);
    assert.equal((await write({ ...body(), channels: [{ key: 'coordination', name: 'avisos-renombrados', type: 'text', channelId }] })).status, 200);
    assert.deepEqual(space.channels.map((row: any) => row.key), ['coordination']);
    assert.equal(channels.has(channelId), true); assert.equal(space.summaryMessageId, null);
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});
