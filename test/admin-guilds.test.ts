import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { Client, Collection, GatewayIntentBits } from 'discord.js';
import type { AddressInfo } from 'node:net';
import { adminGuildRoutes } from '../src/api/admin-guilds.js';

test('admin guild listing is independent from MongoDB and details are fetched only when requested', async t => {
  const bot = new Client({ intents: [GatewayIntentBits.Guilds] });
  const guild = { id: '100000000000000001', name: 'Example guild', icon: null, banner: null,
    description: 'Community description', ownerId: '100000000000000002', preferredLocale: 'es-ES',
    createdAt: new Date('2020-01-01T00:00:00Z'), approximateMemberCount: 1234, approximatePresenceCount: 56 };
  let listCalls = 0, detailCalls = 0;
  t.mock.method(bot.guilds, 'fetch', (async (options: { guild?: string; force?: boolean; withCounts?: boolean; limit?: number }) => {
    if (options.guild) {
      detailCalls++;
      if (options.guild !== guild.id) throw Object.assign(new Error('Unknown guild'), { code: 10004 });
      assert.equal(options.force, true); assert.equal(options.withCounts, true);
      return guild;
    }
    listCalls++;
    assert.equal(options.limit, 200);
    return new Collection([[guild.id, guild]]);
  }) as never);
  const app = express();
  app.use('/admin', (req, res, next) => {
    if (!['owner', 'operator'].includes(req.get('x-test-role') ?? '')) { res.sendStatus(403); return; }
    next();
  });
  app.use('/admin/guilds', adminGuildRoutes(bot));
  app.use(((error, _req, res, _next) => res.status(error.status ?? 500).json({ error: error.publicMessage })) as express.ErrorRequestHandler);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/admin/guilds`;
  const headers = { 'x-test-role': 'owner' };
  try {
    assert.equal((await fetch(base)).status, 403);
    assert.equal(listCalls, 0);
    const list = await fetch(base, { headers });
    assert.equal(list.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await list.json(), { guilds: [{ id: guild.id, name: guild.name, icon: null, banner: null, botInstalled: true }] });
    assert.equal(detailCalls, 0);
    const details = await fetch(`${base}/${guild.id}`, { headers });
    assert.equal(details.status, 200);
    assert.deepEqual(await details.json(), { guild: { id: guild.id, name: guild.name, icon: null, banner: null,
      description: guild.description, ownerId: guild.ownerId, preferredLocale: 'es-ES', createdAt: '2020-01-01T00:00:00.000Z', memberCount: 1234, onlineCount: 56 } });
    assert.equal((await fetch(`${base}/invalid`, { headers })).status, 400);
    assert.equal((await fetch(`${base}/100000000000000099`, { headers })).status, 404);
    assert.equal((await fetch(base, { headers: { 'x-test-role': 'operator' } })).status, 200);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    await bot.destroy();
  }
});
