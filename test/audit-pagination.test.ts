import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { Collection, PermissionsBitField, PermissionFlagsBits as P, type Guild } from 'discord.js';
import { auditRoutes } from '../src/modules/audit/routes.js';
import { GuildSettings } from '../src/database/models/GuildSettings.js';
import { BotControl } from '../src/database/models/BotControl.js';
import { defaultSettings } from '../src/modules/settings/rules.js';
import { defaultControls } from '../src/modules/operations/service.js';

test('audit pages contain ten entries, retain Discord filters and stop at the final page', async t => {
  const guildId = '100000000000000001', actorId = '100000000000000002';
  const calls: any[] = [];
  t.mock.method(GuildSettings, 'findOne', (() => ({ lean: async () => ({ guildId, ...defaultSettings() }) })) as never);
  t.mock.method(BotControl, 'findOne', (() => ({ lean: async () => ({ ...defaultControls() }) })) as never);
  const guild = { id: guildId, members: { fetchMe: async () => ({ permissions: new PermissionsBitField(P.ViewAuditLog) }) }, fetchAuditLogs: async (options: any) => {
    calls.push(options);
    return { entries: new Collection(Array.from({ length: options.before ? 2 : 11 }, (_, index) => {
      const id = String(100000000000000100n - BigInt(index));
      return [id, { id, executorId: actorId, targetId: guildId, action: 10, reason: null, createdAt: new Date() }];
    })) };
  } } as unknown as Guild;
  const app = express();
  app.use('/guilds/:guildId/audit', auditRoutes(capability => (req, _res, next) => { assert.equal(capability, 'audit.read'); req.managedGuild = guild; next(); }));
  app.use(((error, _req, res, _next) => res.status(error.status ?? 500).json({ error: error.publicMessage })) as express.ErrorRequestHandler);
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/guilds/${guildId}/audit`;
  try {
    const first = await (await fetch(`${url}?actor=${actorId}&action=10`)).json();
    assert.equal(first.entries.length, 10);
    assert.equal(first.nextCursor, first.entries.at(-1).id);
    assert.deepEqual(calls[0], { limit: 11, user: actorId, type: 10 });
    const last = await (await fetch(`${url}?actor=${actorId}&action=10&before=${first.nextCursor}`)).json();
    assert.equal(last.entries.length, 2); assert.equal(last.nextCursor, null);
    assert.deepEqual(calls[1], { limit: 11, before: first.nextCursor, user: actorId, type: 10 });
    assert.equal((await fetch(`${url}?before=invalid`)).status, 400);
    assert.equal(calls.length, 2);
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});
