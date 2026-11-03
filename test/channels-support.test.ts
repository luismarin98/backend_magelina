import { SupportConfig } from '../src/database/models/SupportConfig.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import session from 'express-session';
import { Collection, ChannelType, PermissionFlagsBits as P, PermissionsBitField, type Guild } from 'discord.js';
import type { AddressInfo } from 'node:net';
import type { guildAuthorization } from '../src/modules/permissions/access.js';
import { channelRoutes } from '../src/modules/channels/routes.js';
import { channelInput, privateOverwrites } from '../src/modules/channels/service.js';
import { supportRoutes } from '../src/modules/support/routes.js';
import { SupportMessage } from '../src/database/models/SupportMessage.js';
import { SupportTicket } from '../src/database/models/SupportTicket.js';

const adminId = '100000000000000088';
const guildId = '100000000000000001', userId = '100000000000000002', moderatorId = '100000000000000003', botId = '100000000000000004', staffRoleId = '100000000000000005', otherId = '100000000000000006';

test('channel validation and private overwrites deny everyone and allow only selected members and staff', () => {
  assert.throws(() => channelInput({ name: 'Canal', type: 'category', private: true }));
  assert.throws(() => channelInput({ name: 'Canal', type: 'text', private: false, memberIds: [userId] }));
  assert.throws(() => channelInput({ name: 'Canal', type: 'voice', private: true, memberIds: ['bad'] }));
  const overwrites = privateOverwrites(guildId, botId, [userId, userId], [staffRoleId]);
  assert.deepEqual(overwrites.find(row => row.id === guildId)?.deny, [P.ViewChannel]);
  assert.equal(overwrites.filter(row => row.id === userId).length, 1);
  assert.ok(overwrites.find(row => row.id === staffRoleId)?.allow?.includes(P.ViewChannel));
  assert.equal(overwrites.some(row => row.id === otherId), false);
});

test('HTTP channels and support enforce live permissions, case isolation and idempotency', async t => {
  let actorBits = 0n, botBits = P.Administrator, channelReadable = true, creations = 0, failSave = false;
  let lastListFilter: any, channelFetches = 0;
  t.mock.method(SupportConfig, 'findOne', (() => ({ lean: async () => ({ categoryId: 'support-category' }) })) as never);
  const createdOptions: any[] = [], sent: any[] = [], records = new Map<string, any>();
  const channel = { id: '100000000000000007', name: 'soporte', type: ChannelType.GuildText,
    permissionsFor: () => new PermissionsBitField(channelReadable ? P.Administrator : 0n),
    send: async (payload: unknown) => { sent.push(payload); return { id: '100000000000000008' }; },
    setParent: async () => {}, setName: async () => {}, permissionOverwrites: { set: async () => {} },
    messages: { fetch: async () => new Collection([['message', { id: 'message', author: { username: 'Ana', globalName: 'Ana' }, content: 'Hola', createdAt: new Date(), createdTimestamp: Date.now(), url: 'https://discord.com/channels/a/b/c' }]]) },
  };
  const guild = { id: guildId, ownerId: '100000000000000099',
    members: { fetchMe: async () => ({ id: botId, permissions: new PermissionsBitField(botBits) }), fetch: async ({ user }: { user: string }) => ({ id: user, displayName: 'Ana', user: { bot: false, username: 'ana' }, permissions: new PermissionsBitField(user === adminId ? P.Administrator : [moderatorId, otherId].includes(user) ? P.ModerateMembers : actorBits) }) },
    roles: { fetch: async () => new Collection([[guildId, { id: guildId, permissions: new PermissionsBitField(0n) }], [staffRoleId, { id: staffRoleId, permissions: new PermissionsBitField(P.ModerateMembers) }]]) },
    channels: { fetch: async (id?: string) => { channelFetches++; return id === 'support-category' ? { id, type: ChannelType.GuildCategory } : id ? channel : new Collection([[channel.id, channel]]); }, create: async (options: unknown) => { creations++; createdOptions.push(options); return channel; } },
  } as unknown as Guild;
  t.mock.method(SupportTicket, 'find', ((filter: any) => (lastListFilter = filter, { sort: () => ({ limit: () => ({ lean: async () => [...records.values()].filter(row => row.guildId === filter.guildId && (!filter.requesterId || row.requesterId === filter.requesterId) && (!filter.$or || filter.$or.some((condition: any) => Object.entries(condition).every(([key, value]) => row[key] === value)))) }) }) })) as never);
  t.mock.method(SupportTicket, 'findOne', ((filter: any) => {
    const record = [...records.values()].find(row => row.guildId === filter.guildId && (filter._id ? row._id === filter._id : row.requestId === filter.requestId) && (!filter.requesterId || row.requesterId === filter.requesterId) && (!filter.$or || filter.$or.some((condition: any) => Object.entries(condition).every(([key, value]) => row[key] === value))));
    return Promise.resolve(record ?? null);
  }) as never);
  t.mock.method(SupportTicket, 'create', (async (input: any) => {
    if ([...records.values()].some(row => row.guildId === input.guildId && row.requesterId === input.requesterId && row.active)) throw Object.assign(new Error('Duplicate'), { code: 11000 });
    const record: any = { ...input, _id: 'abcdefabcdefabcdefabcdef', active: true, version: 0, channelId: null, assigneeId: null, createdAt: new Date(), save: async () => { if (failSave) throw new Error('Database unavailable'); } };
    records.set(record._id, record); return record;
  }) as never);
  t.mock.method(SupportTicket, 'findOneAndUpdate', (async (filter: any, update: any) => {
    const row = records.get(filter._id); if (!row || row.version !== filter.version || row.state !== filter.state) return null;
    Object.assign(row, update.$set); row.version++; return row;
  }) as never);
  t.mock.method(SupportTicket, 'updateOne', (async (filter: any, update: any) => { Object.assign(records.get(filter._id), update.$set); }) as never);
  t.mock.method(SupportTicket, 'aggregate', (async (pipeline: any[]) => {
    assert.equal(pipeline[0].$match.guildId, guildId);
    assert.equal(pipeline[0].$match.active, true);
    return [{ groups: [{ _id: moderatorId, pendingCount: 25, awaitingReview: 0, escalatedCount: 2, oldestAt: new Date() }], total: [{ count: 1 }] }];
  }) as never);
  t.mock.method(SupportMessage, 'find', (() => ({ sort: () => ({ limit: () => ({ lean: async () => Array.from({ length: 51 }, (_, index) => ({ messageId: String(200000000000000120n - BigInt(index)), author: 'Ana', content: 'Archivado', createdAt: new Date(), embeds: [], stickers: [], attachments: [] })) }) }) })) as never);
  const app = express(); app.use(express.json()); app.use(session({ secret: 'only-test', resave: false, saveUninitialized: false }));
  const access = { requireMember: (req, _res, next) => { req.managedGuild = guild; req.guildAccess = { canConfigure: false, capabilities: [], source: 'delegated' }; req.session.user = { id: req.get('x-user') ?? userId, username: 'ana', name: 'Ana' }; next(); } } as ReturnType<typeof guildAuthorization>;
  app.use('/guilds/:guildId/channels', channelRoutes(access)); app.use('/guilds/:guildId/support', supportRoutes(access));
  app.use(((error, _req, res, _next) => res.status(error.status ?? 500).json({ error: error.publicMessage })) as express.ErrorRequestHandler);
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/guilds/${guildId}`;
  const write = (path: string, body: unknown, method = 'POST', user = userId) => fetch(base + path, { method, headers: { 'Content-Type': 'application/json', 'x-user': user }, body: JSON.stringify(body) });
  try {
    const privateChannel = { name: 'Privado', type: 'voice', private: true, memberIds: [moderatorId] };
    assert.equal((await write('/channels', privateChannel)).status, 403); assert.equal(creations, 0);
    actorBits = P.ManageChannels; assert.equal((await write('/channels', privateChannel)).status, 403);
    actorBits |= P.ManageRoles; assert.equal((await write('/channels', privateChannel)).status, 201);
    assert.equal(createdOptions[0].type, ChannelType.GuildVoice);
    assert.deepEqual(createdOptions[0].permissionOverwrites.find((row: any) => row.id === guildId).deny, [P.ViewChannel]);
    assert.ok(createdOptions[0].permissionOverwrites.some((row: any) => row.id === userId));
    assert.equal((await write('/channels', { name: 'Público', type: 'text', private: false, memberIds: [] })).status, 201);
    assert.equal(createdOptions[1].type, ChannelType.GuildText); assert.deepEqual(createdOptions[1].permissionOverwrites, []);
    actorBits = 0n;
    assert.equal((await fetch(base + '/support/overview?group=moderators')).status, 403);
    assert.equal((await fetch(base + '/support/overview?group=users', { headers: { 'x-user': moderatorId } })).status, 403);
    const overview = await fetch(base + '/support/overview?group=moderators', { headers: { 'x-user': adminId } });
    assert.equal(overview.status, 200); assert.equal((await overview.json()).groups[0].pendingCount, 25);
    assert.equal((await fetch(base + '/support/overview?group=other', { headers: { 'x-user': adminId } })).status, 400);
    assert.equal((await fetch(base + `/support?assigneeId=${moderatorId}`)).status, 403);
    await fetch(base + `/support?assigneeId=${moderatorId}&active=true`, { headers: { 'x-user': adminId } });
    assert.equal(lastListFilter.assigneeId, moderatorId); assert.equal(lastListFilter.active, true);
    await fetch(base + `/support?requesterId=${userId}&active=true`, { headers: { 'x-user': adminId } });
    assert.equal(lastListFilter.requesterId, userId);
    const request = { requestId: '12345678-1234-4234-8234-123456789abc', subject: 'Necesito ayuda', description: 'No puedo acceder a un canal' };
    botBits = 0n;
    const opened = await write('/support', request); assert.equal(opened.status, 201);
    const { item } = await opened.json(); assert.equal(item.state, 'pending'); assert.equal(item.channelId, null); assert.equal(creations, 2);
    assert.equal((await (await fetch(base + '/support')).json()).items.length, 1);
    assert.equal((await (await fetch(base + '/support', { headers: { 'x-user': otherId } })).json()).items.length, 0);
    assert.equal((await write('/support', request)).status, 201); assert.equal(creations, 2);
    assert.equal((await write('/support', { ...request, requestId: '22345678-1234-4234-8234-123456789abc' })).status, 409);
    const ticketPath = `/support/${item._id}`;
    assert.equal((await write(ticketPath, { action: 'assign', version: 0, assigneeId: userId }, 'PATCH')).status, 403);
    assert.equal((await write(ticketPath, { action: 'assign', version: 0, assigneeId: moderatorId }, 'PATCH', adminId)).status, 403);
    botBits = P.Administrator;
    assert.equal((await write(ticketPath, { action: 'assign', version: 0, assigneeId: userId }, 'PATCH', adminId)).status, 400);
    assert.equal((await write(ticketPath, { action: 'assign', version: 0, assigneeId: moderatorId }, 'PATCH', adminId)).status, 200);
    assert.equal(creations, 3);
    assert.equal(createdOptions[2].parent, 'support-category');
    assert.match(createdOptions[2].name, /^soporte-ana-consulta-/);
    assert.ok(createdOptions[2].permissionOverwrites.some((row: any) => row.id === moderatorId));
    assert.equal(createdOptions[2].permissionOverwrites.some((row: any) => row.id === staffRoleId), false);
    assert.equal((await fetch(base + ticketPath + '/messages', { headers: { 'x-user': otherId } })).status, 404);
    assert.equal((await write(ticketPath, { action: 'assign', version: 1, assigneeId: otherId }, 'PATCH', moderatorId)).status, 403);
    assert.equal((await write(ticketPath + '/messages', { content: 'Hola @everyone' })).status, 201);
    assert.deepEqual(sent.at(-1).allowedMentions, { parse: [] });
    channelReadable = false; assert.equal((await fetch(base + ticketPath + '/messages')).status, 403); channelReadable = true;
    assert.equal((await write(ticketPath, { action: 'escalate', version: 1, reason: 'Requiere una decision administrativa' }, 'PATCH', moderatorId)).status, 200);
    const adminList = await (await fetch(base + '/support', { headers: { 'x-user': adminId } })).json();
    assert.equal(adminList.items[0].state, 'escalated'); assert.equal(adminList.canAdmin, true);
    assert.equal((await write(ticketPath, { action: 'close', version: 1 }, 'PATCH', adminId)).status, 409);
    assert.equal((await write(ticketPath, { action: 'close', version: 2 }, 'PATCH', adminId)).status, 200);
    assert.equal((await write(ticketPath + '/messages', { content: 'Otro mensaje' })).status, 409);
    assert.equal(records.get(item._id).active, false);
    const resolvedList = await fetch(base + `/support?state=closed&active=true&assigneeId=${moderatorId}`, { headers: { 'x-user': adminId } });
    assert.equal(resolvedList.status, 200); assert.equal(lastListFilter.state, 'closed'); assert.equal('active' in lastListFilter, false); assert.equal(lastListFilter.assigneeId, moderatorId);
    assert.equal((await resolvedList.json()).items[0].state, 'closed');
    await fetch(base + `/support?state=closed&active=true&requesterId=${userId}`, { headers: { 'x-user': adminId } });
    assert.equal(lastListFilter.requesterId, userId); assert.equal('active' in lastListFilter, false);

    assert.equal((await write(ticketPath + '/archive-channel', { version: 3 })).status, 403);
    Object.assign(records.get(item._id), { transcriptArchivedAt: new Date(), transcriptRunId: 'run', transcriptMessageCount: 120, channelDeletedAt: new Date() });
    const previousFetches = channelFetches;
    const archive = await fetch(base + ticketPath + '/messages'); assert.equal(archive.status, 200);
    const transcript = await archive.json(); assert.equal(transcript.source, 'archive'); assert.equal(transcript.messages.length, 50); assert.ok(transcript.nextCursor);
    assert.equal(channelFetches, previousFetches);
    assert.equal((await fetch(base + ticketPath + '/messages', { headers: { 'x-user': otherId } })).status, 404);
    assert.equal((await fetch(base + ticketPath + '/attachments/100000000000000050', { headers: { 'x-user': otherId } })).status, 404);
    failSave = true;
    const ambiguous = { ...request, requestId: '32345678-1234-4234-8234-123456789abc' };
    const pending = await (await write('/support', ambiguous)).json();
    assert.equal((await write(`/support/${pending.item._id}`, { action: 'assign', version: 0, assigneeId: moderatorId }, 'PATCH', adminId)).status, 503);
    const creationCount = creations;
    const retry = await write('/support', ambiguous); assert.equal(retry.status, 201);
    assert.equal((await retry.json()).item.state, 'uncertain'); assert.equal(creations, creationCount);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
