import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import session from 'express-session';
import type { Client } from 'discord.js';
import type { AddressInfo } from 'node:net';
import { managementRoutes } from '../src/api/management.js';
import { readConfig } from '../src/config/env.js';
import { commandCatalog } from '../src/bot/catalog.js';
import { getMusicService } from '../src/modules/music/service.js';

test('anonymous users can read definitions while server data and command publication remain private', async () => {
  const config = readConfig({ MONGODB_URI: 'mongodb://localhost/test', DISCORD_TOKEN: 'synthetic', DISCORD_CLIENT_ID: '100000000000000001', DISCORD_CLIENT_SECRET: 'synthetic', DISCORD_REDIRECT_URI: 'http://localhost/callback', SESSION_SECRET: 'Test-only-AAaa11!!-session-secret-12345678', BOT_OWNER_IDS: '100000000000000001' });
  const bot = {} as Client;
  const app = express(); app.use(express.json()); app.use(session({ secret: 'catalog-local-only', resave: false, saveUninitialized: false }));
  app.use('/api', managementRoutes({ bot, config }));
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  try {
    const response = await fetch(`${base}/commands/catalog`); assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), JSON.parse(JSON.stringify(commandCatalog())));
    assert.equal(response.headers.has('set-cookie'), false);
    for (const path of ['/admin/commands', '/guilds', '/adventure']) assert.equal((await fetch(base + path)).status, 401);
    assert.equal((await fetch(`${base}/admin/commands/sync`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 401);
  } finally { getMusicService(bot).dispose(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
