import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import session from 'express-session';
import type { SessionData } from 'express-session';
import type { AddressInfo } from 'node:net';
import { authRoutes } from '../src/auth/routes.js';
import { readConfig } from '../src/config/env.js';
import { BotControl } from '../src/database/models/BotControl.js';

test('las sesiones existentes reciben imagenes sin renovar la cookie ni exponer tokens', async (t) => {
  const userId = '100000000000000001'; const hash = '1234567890abcdef1234567890abcdef';
  const config = readConfig({ MONGODB_URI: 'mongodb://localhost/test', DISCORD_TOKEN: 'synthetic', DISCORD_CLIENT_ID: '100000000000000099', DISCORD_CLIENT_SECRET: 'synthetic', DISCORD_REDIRECT_URI: 'http://localhost/callback', SESSION_SECRET: 'Test-only-AAaa11!!-session-secret-12345678', BOT_OWNER_IDS: '100000000000000099' });
  t.mock.method(BotControl, 'findOne', () => ({ lean: async () => null }));
  const originalFetch = globalThis.fetch; let requests = 0; let status = 200; let profileId = userId;
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    if (!String(input).startsWith('https://discord.com/')) return originalFetch(input, init);
    requests++;
    return new Response(JSON.stringify({ id: profileId, username: 'ana', global_name: 'Ana', avatar: `a_${hash}`, avatar_decoration_data: { asset: `a_${hash}` }, email: 'private@example.invalid' }), { status });
  });
  const store = new session.MemoryStore(); let serial = 0;
  const app = express();
  app.use(session({ store, genid: () => `profile-${++serial}`, secret: config.sessionSecret, resave: false, saveUninitialized: false, cookie: { maxAge: 60000 } }));
  app.use((req, _res, next) => {
    if (!req.session.user) { req.session.user = { id: userId, username: 'ana', name: 'Stored' }; req.session.accessToken = 'synthetic-private-token'; req.session.tokenExpiresAt = Date.now() + 60000; }
    next();
  });
  app.use('/auth', authRoutes(config));
  app.use(((error, _req, res, _next) => { res.status(error.status ?? 500).json({ error: 'Sesion no valida' }); }) as express.ErrorRequestHandler);
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const first = await fetch(`${base}/auth/me`); const text = await first.text(); const body = JSON.parse(text);
    assert.equal(first.status, 200); assert.ok(body.user.avatar.url.includes('&animated=true'));
    assert.ok(body.user.avatarDecorationUrl.includes('/avatar-decoration-presets/'));
    assert.ok(!text.includes('synthetic-private-token')); assert.ok(!text.includes('private@example.invalid'));
    const cookie = first.headers.get('set-cookie')!.split(';')[0];
    const second = await fetch(`${base}/auth/me`, { headers: { Cookie: cookie } });
    assert.equal(second.status, 200); assert.equal(requests, 1); assert.equal(second.headers.get('set-cookie'), null);
    const persisted = await new Promise<SessionData | null | undefined>((resolve, reject) => store.get('profile-1', (error, value) => error ? reject(error) : resolve(value)));
    assert.equal(persisted?.user?.name, 'Stored');
    status = 502;
    const temporaryFailure = await fetch(`${base}/auth/me`); assert.equal(temporaryFailure.status, 200);
    assert.equal((await temporaryFailure.json()).user.name, 'Stored');
    status = 401; assert.equal((await fetch(`${base}/auth/me`)).status, 401);
    status = 200; profileId = '100000000000000002'; assert.equal((await fetch(`${base}/auth/me`)).status, 401);
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
});
