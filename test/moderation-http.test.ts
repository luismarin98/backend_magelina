import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import session from 'express-session';
import type { AddressInfo } from 'node:net';
import { PermissionsBitField, PermissionFlagsBits as P, type Guild } from 'discord.js';
import type { guildAuthorization } from '../src/modules/permissions/access.js';
import { moderationRoutes } from '../src/modules/moderation/routes.js';
import { ModerationCase } from '../src/database/models/ModerationCase.js';
import type { ModerationCaseRecord } from '../src/database/models/ModerationCase.js';

test('HTTP moderation verifies live authority, prevents repeated sanctions and records uncertain outcomes', async (t) => {
  const guildId = '100000000000000001', actorId = '100000000000000002', targetId = '100000000000000003';
  let permissions = P.KickMembers | P.ModerateMembers;
  let kicks = 0, timeouts = 0;
  const highest = (rank: number) => ({ rank, comparePositionTo: (other: { rank: number }) => rank - other.rank });
  const actor = { id: actorId, get permissions() { return new PermissionsBitField(permissions); }, roles: { highest: highest(5) } };
  const me = { id: '100000000000000004', permissions: new PermissionsBitField(P.KickMembers | P.ModerateMembers), roles: { highest: highest(9) } };
  const target = { id: targetId, user: { bot: false }, permissions: new PermissionsBitField(0n), roles: { highest: highest(1) },
    kick: async () => { kicks++; }, timeout: async () => { timeouts++; throw new Error('simulated network failure'); } };
  const guild = { id: guildId, ownerId: '100000000000000009', roles: { fetch: async () => null }, members: { fetchMe: async () => me, fetch: async ({ user }: { user: string }) => user === actorId ? actor : target } } as unknown as Guild;
  type Stored = ModerationCaseRecord & { _id: string; id: string; save: () => Promise<void> };
  const stored: Stored[] = [];
  t.mock.method(ModerationCase, 'findOne', async (filter: { guildId: string; requestId: string }) => stored.find((item) => item.guildId === filter.guildId && item.requestId === filter.requestId) ?? null);
  t.mock.method(ModerationCase, 'create', async (input: ModerationCaseRecord) => {
    const item: Stored = { ...input, _id: 'abcdefabcdefabcdefabcdef', id: 'abcdefabcdefabcdefabcdef', createdAt: new Date(), updatedAt: new Date(), save: async () => {} }; stored.push(item); return item;
  });
  const app = express(); app.use(express.json());
  app.use(session({ secret: 'unit-test-only-secret', resave: false, saveUninitialized: false }));
  const access = { requireAny: (req, _res, next) => { req.managedGuild = guild; req.guildAccess = { canConfigure: false, canModerate: true, capabilities: [] }; req.session.user = { id: actorId, name: 'Test', username: 'test' }; next(); } } as ReturnType<typeof guildAuthorization>;
  app.use('/guilds/:guildId/moderation', moderationRoutes(access));
  app.use(((error, _req, res, _next) => { res.status(error.status ?? 500).json({ error: 'Rejected' }); }) as express.ErrorRequestHandler);
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>((resolve) => server.once('listening', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/guilds/${guildId}/moderation/members/${targetId}/cases`;
  const body = { requestId: 'ae9d3848-1bb4-4070-998d-61ec1bdef019', action: 'kick', reason: 'Incidente documentado por moderacion.', evidence: [] };
  const post = (value: unknown) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
  try {
    permissions = 0n;
    assert.equal((await post(body)).status, 403); assert.equal(stored.length, 0);
    permissions = P.ModerateMembers;
    const activityUrl = url.replace(`/members/${targetId}/cases`, '/activity');
    assert.equal((await fetch(activityUrl)).status, 403);
    permissions |= P.ViewAuditLog;
    assert.equal((await fetch(activityUrl)).status, 403);
    permissions = P.ModerateMembers;
    assert.equal((await post(body)).status, 403); assert.equal(kicks, 0);
    permissions = P.KickMembers | P.ModerateMembers;
    assert.equal((await post(body)).status, 201); assert.equal(kicks, 1);
    assert.equal((await post(body)).status, 200); assert.equal(kicks, 1);
    assert.equal((await post({ ...body, reason: 'Otro motivo diferente para este caso.' })).status, 409);
    const response = await post({ ...body, requestId: 'ae9d3848-1bb4-4070-998d-61ec1bdef020', action: 'timeout', durationMinutes: 10 });
    assert.equal(response.status, 201);
    assert.equal((await response.json() as { item: { status: string } }).item.status, 'uncertain');
    assert.equal(timeouts, 1);
    assert.equal(stored.length, 2);
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
});
