import test from 'node:test';
import assert from 'node:assert/strict';
import type { Guild } from 'discord.js';
import { AudiusProvider, normalizeTrack, trackId, type MusicProvider } from '../src/modules/music/audius.js';
import { publicAddress, audioUrl } from '../src/modules/music/network.js';
import { MusicService } from '../src/modules/music/service.js';
import type { MusicTransport } from '../src/modules/music/transport.js';
import { emptyGrants, resolveAccess } from '../src/modules/permissions/rules.js';
import type { MusicTrack } from '../src/types/contracts.js';

const raw = { id: 'abc12', title: 'Tema de prueba', duration: 90, is_streamable: true, is_available: true, is_gated: false, stream_conditions: null, is_unlisted: false, user: { name: 'Artista' }, permalink: '/artista/tema' };
const track = normalizeTrack(raw)!;
const guild = { id: '100000000000000001' } as Guild;
const channelId = '100000000000000002';
const authorize = async () => {};
class FakeTransport implements MusicTransport {
  finished?: (error?: string) => void;
  connected = false; played: string[] = []; paused = false; level = 0; playback = 0;
  async connect() { this.connected = true; }
  async play(track: MusicTrack, finished: (error?: string) => void) { this.played.push(track.id); this.finished = finished; }
  pause() { this.paused = true; } resume() { this.paused = false; }
  volume(value: number) { this.level = value; }
  position() { return this.playback; }
  stopTrack() { this.finished = undefined; this.playback = 0; }
  disconnect() { this.connected = false; this.finished = undefined; }
}
function setup(t: test.TestContext) {
  const transports: FakeTransport[] = [];
  let enabled = true;
  const provider: MusicProvider = { search: async () => [track], track: async (id) => ({ ...track, id }), streamUrl: (id) => `https://api.audius.co/v1/tracks/${id}/stream` };
  const service = new MusicService(provider, () => { const transport = new FakeTransport(); transports.push(transport); return transport; }, async () => { if (!enabled) throw new Error('disabled'); });
  t.after(() => service.dispose());
  return { service, transports, provider, disable: () => { enabled = false; } };
}
test('Audius excludes paid, private, unavailable and oversized tracks and validates canonical URLs', () => {
  assert.equal(track.permalink, 'https://audius.co/artista/tema');
  for (const patch of [{ is_gated: true }, { is_unlisted: true }, { is_streamable: false }, { is_available: false }, { stream_conditions: { purchase: {} } }, { duration: 1801 }, { duration: 0 }, { id: '../secret' }, { permalink: 'https://evil.example/track' }, { user: { name: 'Artista', is_deactivated: true } }, { access: { stream: false } }]) assert.equal(normalizeTrack({ ...raw, ...patch }), null);
  assert.throws(() => trackId('https://evil.example'));
});
test('audio connections reject local addresses, IP literals and unsupported protocols', () => {
  for (const address of ['127.0.0.1', '10.2.3.4', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '::1', '::ffff:127.0.0.1', 'fc00::1', 'fe80::1', '2001:db8::1']) assert.equal(publicAddress(address), false, address);
  assert.equal(publicAddress('8.8.8.8'), true);
  assert.equal(publicAddress('2606:4700:4700::1111'), true);
  for (const url of ['http://host.example/audio', 'file:///tmp/audio', 'https://127.0.0.1/a', 'https://user:password@host.example/a', 'https://host.example:8080/a']) assert.throws(() => audioUrl(url));
});
test('Audius search is filtered, cached and never exposes API credentials', async (t) => {
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async () => { requests++; return new Response(JSON.stringify({ data: [raw, { ...raw, id: 'paid', is_gated: true }] })); });
  const provider = new AudiusProvider('test-key-not-a-secret');
  const result = await provider.search('prueba');
  assert.equal(result.length, 1); result[0]!.title = 'Modified';
  assert.equal((await provider.search('prueba'))[0]!.title, 'Tema de prueba');
  assert.equal(requests, 1);
  assert.equal(JSON.stringify(result).includes('test-key-not-a-secret'), false);
});
test('music request/manage permissions imply only music access', () => {
  const grants = emptyGrants(); grants['music.request'] = ['100000000000000001'];
  assert.deepEqual(resolveAccess(false, ['100000000000000001'], grants).capabilities, ['music.read', 'music.request']);
  grants['music.manage'] = ['100000000000000002'];
  assert.deepEqual(resolveAccess(false, ['100000000000000002'], grants), { canConfigure: false, capabilities: ['music.read', 'music.request', 'music.manage'] });
});
test('queues are isolated and stale tab versions do not duplicate a requested track', async (t) => {
  const { service, transports } = setup(t);
  let state = await service.connect(guild, channelId, 0, authorize);
  state = await service.enqueue(guild.id, 'abc12', 'actor', state.version, authorize);
  assert.equal(state.status, 'playing'); assert.equal(state.current?.track.id, 'abc12');
  const version = state.version;
  const results = await Promise.allSettled([service.enqueue(guild.id, 'second', 'actor', version, authorize), service.enqueue(guild.id, 'second', 'actor', version, authorize)]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(service.snapshot(guild.id).queue.length, 1);
  assert.deepEqual(service.snapshot('100000000000000009').queue, []);
  assert.deepEqual(transports[0]!.played, ['abc12']);
});
test('native authorization runs before requests and settings are checked on every mutation', async (t) => {
  const { service, transports, disable } = setup(t);
  await assert.rejects(service.connect(guild, channelId, 0, async () => { throw new Error('denied'); }));
  assert.equal(transports.length, 0);
  const state = await service.connect(guild, channelId, 0, authorize);
  disable();
  await assert.rejects(service.enqueue(guild.id, 'abc12', 'actor', state.version, authorize));
  assert.equal(service.snapshot(guild.id).current, null);
  assert.equal((await service.control(guild.id, 'disconnect', state.version, authorize)).status, 'disconnected');
});
test('pause, resume, volume, skip, removal and shutdown preserve queue consistency', async (t) => {
  const { service, transports } = setup(t);
  let state = await service.connect(guild, channelId, 0, authorize);
  state = await service.enqueue(guild.id, 'first', 'actor', state.version, authorize);
  state = await service.enqueue(guild.id, 'second', 'actor', state.version, authorize);
  state = await service.control(guild.id, 'pause', state.version, authorize);
  assert.equal(state.status, 'paused'); assert.equal(transports[0]!.paused, true);
  state = await service.control(guild.id, 'resume', state.version, authorize);
  state = await service.control(guild.id, 'volume', state.version, authorize, 45);
  assert.equal(transports[0]!.level, 45);
  state = await service.control(guild.id, 'skip', state.version, authorize);
  assert.equal(state.current?.track.id, 'second');
  state = await service.enqueue(guild.id, 'third', 'actor', state.version, authorize);
  state = await service.control(guild.id, 'remove', state.version, authorize, state.queue[0]!.id);
  assert.equal(state.queue.length, 0);
  service.dispose(); assert.equal(transports[0]!.connected, false);
});
test('end-of-track advances the queue and unavailable tracks are skipped', async (t) => {
  const { service, transports, provider } = setup(t);
  let state = await service.connect(guild, channelId, 0, authorize);
  state = await service.enqueue(guild.id, 'first', 'actor', state.version, authorize);
  state = await service.enqueue(guild.id, 'bad', 'actor', state.version, authorize);
  await service.enqueue(guild.id, 'third', 'actor', state.version, authorize);
  provider.track = async (id) => { if (id === 'bad') throw new Error('no longer available'); return { ...track, id }; };
  transports[0]!.finished?.();
  await new Promise<void>((resolve) => setTimeout(resolve, 650));
  assert.equal(service.snapshot(guild.id).current?.track.id, 'third');
});

test('monitor samples actual audio position without mutating queue versions and clamps stale positions', async (t) => {
  const { service, transports } = setup(t);
  let state = await service.connect(guild, channelId, 0, authorize);
  state = await service.enqueue(guild.id, 'abc12', 'actor', state.version, authorize);
  transports[0]!.playback = 15000;
  const sample = service.snapshot(guild.id);
  assert.equal(sample.positionMs, 15000);
  assert.equal(sample.version, state.version);
  assert.ok(Number.isFinite(Date.parse(sample.observedAt!)));
  transports[0]!.playback = 1000000;
  assert.equal(service.snapshot(guild.id).positionMs, track.durationSeconds * 1000);
  state = await service.control(guild.id, 'stop', state.version, authorize);
  assert.equal(state.positionMs, 0);
});
