import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import session from 'express-session';
import { ChannelType, PermissionsBitField, PermissionFlagsBits as P, type Guild } from 'discord.js';
import type { AddressInfo } from 'node:net';
import type { Capability } from '../src/types/contracts.js';
import type { RequireCapability } from '../src/modules/permissions/access.js';
import { musicRoutes } from '../src/modules/music/routes.js';
import { MusicService } from '../src/modules/music/service.js';
import { GuildSettings } from '../src/database/models/GuildSettings.js';
import { BotControl } from '../src/database/models/BotControl.js';
import { defaultSettings } from '../src/modules/settings/rules.js';
import { defaultControls } from '../src/modules/operations/service.js';

test('music HTTP enforces capabilities, membership in voice, bot permissions and private channel visibility', async (t) => {
  const guildId = '100000000000000001', actorId = '100000000000000002', channelId = '100000000000000003';
  let capabilities: Capability[] = ['music.read'], canView = true, canSpeak = true;
  const actor = { id: actorId, voice: { channelId: null as string | null } }, me = { id: '100000000000000004', voice: { channelId: null } };
  const channel = { id: channelId, name: 'Sala', type: ChannelType.GuildVoice, full: false, members: new Map([['human', { user: { bot: false } }], ['bot', { user: { bot: true } }]]),
    permissionsFor: (member: { id: string }) => new PermissionsBitField(member.id === me.id ? P.ViewChannel | P.Connect | (canSpeak ? P.Speak : 0n) : canView ? P.ViewChannel | P.Connect : 0n) };
  let channelFetchFailed = false;
  const channels = new Map([[channelId, { ...channel, rawPosition: 0 }]]);
  const guild = { id: guildId, roles: { fetch: async () => null }, channels: { cache: new Map(), fetch: async (id?: string) => { if (channelFetchFailed) throw new Error('Discord unavailable'); return id ? channels.get(id) : channels; } }, members: { fetchMe: async () => me, fetch: async () => actor } } as unknown as Guild;
  const transport = { connect: async () => {}, play: async () => {}, pause: () => {}, resume: () => {}, stopTrack: () => {}, volume: () => {}, disconnect: () => {} };
  const service = new MusicService({ search: async () => [], track: async (id) => ({ id, title: 'Tema', artist: 'Artista', durationSeconds: 90, permalink: 'https://audius.co/artist/track', artworkUrl: null }), streamUrl: () => '' }, () => transport);
  t.after(() => service.dispose());
  t.mock.method(GuildSettings, 'findOne', () => ({ lean: async () => ({ guildId, version: 0, ...defaultSettings(), modules: { ...defaultSettings().modules, music: true }, history: [] }) }));
  t.mock.method(BotControl, 'findOne', () => ({ lean: async () => ({ key: 'global', version: 0, ...defaultControls(), history: [] }) }));
  const requireCapability: RequireCapability = (capability) => (req, res, next) => {
    req.managedGuild = guild; req.guildAccess = { canConfigure: false, capabilities }; req.session.user = { id: actorId, name: 'Test', username: 'test' };
    if (!capabilities.includes(capability)) { res.status(403).json({ error: 'Denied' }); return; } next();
  };
  const app = express(); app.use(express.json()); app.use(session({ secret: 'local-tests-only', resave: false, saveUninitialized: false }));
  app.use('/guilds/:guildId/music', musicRoutes(requireCapability, service));
  app.use(((error, _req, res, _next) => res.status(error.status ?? 500).json({ error: error.publicMessage ?? 'Rejected' })) as express.ErrorRequestHandler);
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/guilds/${guildId}/music`;
  const post = (path: string, body: unknown) => fetch(`${base}/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    const loaded = await (await fetch(base)).json() as { channels: { id: string; canConnect: boolean }[] };
    assert.deepEqual(loaded.channels, [{ id: channelId, name: 'Sala', canConnect: true }]);
    assert.equal(guild.channels.cache.size, 0); // El listado no depende de una caché poblada.
    canView = false;
    assert.deepEqual((await (await fetch(base)).json() as { channels: unknown[] }).channels, []);
    canView = true; canSpeak = false;
    assert.equal((await (await fetch(base)).json() as { channels: { canConnect: boolean }[] }).channels[0]!.canConnect, false);
    canSpeak = true; channelFetchFailed = true;
    const failed = await fetch(base);
    assert.equal(failed.status, 502);
    assert.match((await failed.json() as { error: string }).error, /cargar los canales/);
    channelFetchFailed = false;
    assert.equal((await post('connect', { channelId, version: 0 })).status, 403);
    capabilities = ['music.read', 'music.request', 'music.manage'];
    assert.equal((await post('connect', { channelId, version: 0 })).status, 403);
    assert.equal((await post('youtube/enable', {})).status, 403);
    actor.voice.channelId = channelId; canSpeak = false;
    assert.equal((await post('connect', { channelId, version: 0 })).status, 403);
    canSpeak = true;
    assert.equal((await post('connect', { channelId, version: 0 })).status, 200);
    const monitor = await (await fetch(base)).json() as { listeners: number; player: { positionMs: number; observedAt: string } };
    assert.equal(monitor.listeners, 1);
    assert.equal(monitor.player.positionMs, 0);
    assert.ok(Number.isFinite(Date.parse(monitor.player.observedAt)));
    assert.equal((await post('queue', { trackId: 'https://localhost/audio', version: 1 })).status, 400);
    assert.equal((await post('control', { action: 'volume', value: 101, version: 1 })).status, 400);
    capabilities = ['music.read', 'music.request'];
    assert.equal((await post('control', { action: 'pause', version: 1 })).status, 403);
    assert.equal((await post('queue', { trackId: 'abc12', version: 1 })).status, 200);
    canView = false;
    assert.equal((await fetch(base)).status, 403);
    assert.equal((await post('queue', { trackId: 'abc12', version: 2 })).status, 403);
    canView = true; actor.voice.channelId = null;
    assert.equal((await post('queue', { trackId: 'abc12', version: 2 })).status, 403);
    assert.equal(service.snapshot(guildId).queue.length, 0);
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
});
