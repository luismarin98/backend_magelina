import test from 'node:test';
import assert from 'node:assert/strict';
import type { Guild } from 'discord.js';
import { AudiusProvider, normalizeTrack, trackId, type MusicProvider } from '../src/modules/music/audius.js';
import { publicAddress, audioUrl } from '../src/modules/music/network.js';
import { MusicService } from '../src/modules/music/service.js';
import type { MusicTransport } from '../src/modules/music/transport.js';
import { emptyGrants, resolveAccess } from '../src/modules/permissions/rules.js';
import type { MusicTrack } from '../src/types/contracts.js';
import type { MusicNotice, MusicNotifier } from '../src/modules/music/notifications.js';

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
function setup(t: test.TestContext, notifier?: MusicNotifier) {
  const transports: FakeTransport[] = [];
  let enabled = true;
  const provider: MusicProvider = { search: async () => [track], track: async (id) => ({ ...track, id }), streamUrl: (id) => `https://api.audius.co/v1/tracks/${id}/stream` };
  const service = new MusicService(provider, () => { const transport = new FakeTransport(); transports.push(transport); return transport; }, async () => { if (!enabled) throw new Error('disabled'); }, notifier);
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


test('voice loss preserves the current track and queue for an authorized reconnect', async t => {
  const transports: FakeTransport[] = [];
  const lost: (() => void)[] = [];
  const provider: MusicProvider = { search: async () => [], track: async id => ({ ...track, id }), streamUrl: () => 'https://example.com/audio' };
  const service = new MusicService(provider, disconnected => {
    lost.push(disconnected);
    const transport = new FakeTransport(); transports.push(transport); return transport;
  }, async () => {});
  t.after(() => service.dispose());
  let state = await service.connect(guild, channelId, 0, authorize);
  state = await service.enqueue(guild.id, 'first', 'actor', state.version, authorize);
  state = await service.enqueue(guild.id, 'second', 'actor', state.version, authorize);
  lost[0]!();
  await new Promise<void>(resolve => setImmediate(resolve));
  state = service.snapshot(guild.id);
  assert.equal(state.status, 'disconnected');
  assert.deepEqual(state.queue.map(entry => entry.track.id), ['first', 'second']);
  await assert.rejects(service.connect(guild, channelId, state.version, async () => { throw new Error('denied'); }));
  assert.equal(transports.length, 1);
  state = await service.connect(guild, channelId, state.version, authorize);
  assert.equal(state.current?.track.id, 'first');
  assert.deepEqual(state.queue.map(entry => entry.track.id), ['second']);
  lost[0]!(); // A stale transport cannot close the replacement.
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(service.snapshot(guild.id).status, 'playing');
  state = await service.control(guild.id, 'disconnect', state.version, authorize);
  assert.deepEqual(state.queue, []);
});

test('maintenance tolerates temporary settings failures but preserves the queue after repeated failures', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  let failing = false;
  const provider: MusicProvider = { search: async () => [], track: async id => ({ ...track, id }), streamUrl: () => 'https://example.com/audio' };
  const service = new MusicService(provider, () => new FakeTransport(), async () => { if (failing) throw new Error('database unavailable'); });
  t.after(() => service.dispose());
  let state = await service.connect(guild, channelId, 0, authorize);
  state = await service.enqueue(guild.id, 'first', 'actor', state.version, authorize);
  service.startMaintenance({} as never);
  failing = true;
  for (let attempt = 1; attempt <= 3; attempt++) {
    t.mock.timers.tick(15000);
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(service.snapshot(guild.id).status, attempt < 3 ? 'playing' : 'disconnected');
  }
  assert.deepEqual(service.snapshot(guild.id).queue.map(entry => entry.track.id), ['first']);
});


test('explicit maintenance still stops playback immediately and clears the queue', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  let denied = false;
  const provider: MusicProvider = { search: async () => [], track: async id => ({ ...track, id }), streamUrl: () => 'https://example.com/audio' };
  const service = new MusicService(provider, () => new FakeTransport(), async () => {
    if (denied) throw Object.assign(new Error('maintenance'), { status: 503, publicMessage: 'maintenance' });
  });
  t.after(() => service.dispose());
  let state = await service.connect(guild, channelId, 0, authorize);
  state = await service.enqueue(guild.id, 'first', 'actor', state.version, authorize);
  service.startMaintenance({} as never);
  denied = true;
  t.mock.timers.tick(15000);
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(service.snapshot(guild.id).status, 'disconnected');
  assert.deepEqual(service.snapshot(guild.id).queue, []);
});


test('playlist imports respect remaining capacity and preserve attribution and order', async t => {
  const { service, provider } = setup(t);
  let requestedLimit = 0;
  provider.playlist = async (_id, limit) => {
    requestedLimit = limit;
    return Array.from({ length: 30 }, (_, index) => ({ ...track, id: `playlist${index}` }));
  };
  let state = await service.connect(guild, channelId, 0, authorize);
  state = await service.enqueue(guild.id, 'first', 'actor', state.version, authorize);
  state = await service.enqueue(guild.id, 'second', 'actor', state.version, authorize);
  state = await service.enqueue(guild.id, 'youtube:playlist:PLabcdefghijk123', 'importer', state.version, authorize);
  assert.equal(requestedLimit, 24);
  assert.equal(state.current?.track.id, 'first');
  assert.equal(state.queue.length, 25);
  assert.equal(state.queue[0]?.track.id, 'second');
  assert.equal(state.queue[1]?.track.id, 'playlist0');
  assert.equal(state.queue[24]?.track.id, 'playlist23');
  assert.ok(state.queue.slice(1).every(entry => entry.requestedBy === 'importer'));
  await assert.rejects(service.enqueue(guild.id, 'youtube:playlist:PLabcdefghijk123', 'actor', state.version, authorize));
});

test('failed playlist lookup and revoked authorization leave the queue unchanged', async t => {
  const { service, provider } = setup(t);
  const state = await service.connect(guild, channelId, 0, authorize);
  provider.playlist = async () => { throw new Error('unavailable'); };
  await assert.rejects(service.enqueue(guild.id, 'youtube:playlist:PLabcdefghijk123', 'actor', state.version, authorize));
  assert.deepEqual(service.snapshot(guild.id).queue, []);
  provider.playlist = async () => [track];
  let checks = 0;
  await assert.rejects(service.enqueue(guild.id, 'youtube:playlist:PLabcdefghijk123', 'actor', state.version, async () => { if (++checks > 1) throw new Error('revoked'); }));
  assert.deepEqual(service.snapshot(guild.id).queue, []);
  assert.equal(service.snapshot(guild.id).version, state.version);
});


test('music announcements cover additions, finish, next track and exhausted queue', async t => {
  const notices: MusicNotice[] = [];
  const { service, transports } = setup(t, async notice => { notices.push(notice); });
  let state = await service.connect(guild, channelId, 0, authorize);
  state = await service.enqueue(guild.id, 'first', 'actor1', state.version, authorize);
  state = await service.enqueue(guild.id, 'second', 'actor2', state.version, authorize);
  assert.deepEqual(notices.map(notice => notice.kind), ['added', 'started', 'added']);
  assert.equal(notices[0]?.entries[0]?.requestedBy, 'actor1');
  assert.equal(notices[2]?.next?.track.id, 'second');
  const firstFinished = transports[0]!.finished!;
  firstFinished();
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.deepEqual(notices.slice(3).map(notice => notice.kind), ['finished', 'started']);
  assert.equal(notices[3]?.next?.track.id, 'second');
  assert.equal(notices[4]?.entries[0]?.requestedBy, 'actor2');
  firstFinished(); // A stale completion cannot announce the same track twice.
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(notices.length, 5);
  transports[0]!.finished!();
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(notices.at(-1)?.kind, 'finished');
  assert.equal(notices.at(-1)?.next, null);
  assert.equal(notices.at(-1)?.pending, 0);
});

test('playlist addition is summarized once and skip is distinct from completion', async t => {
  const notices: MusicNotice[] = [];
  const { service, provider } = setup(t, async notice => { notices.push(notice); });
  provider.playlist = async () => ['first', 'second', 'third'].map(id => ({ ...track, id }));
  let state = await service.connect(guild, channelId, 0, authorize);
  state = await service.enqueue(guild.id, 'youtube:playlist:PLabcdefghijk123', 'actor', state.version, authorize);
  assert.equal(notices.filter(notice => notice.kind === 'added').length, 1);
  assert.equal(notices[0]?.entries.length, 3);
  assert.equal(notices[1]?.next?.track.id, 'second');
  await service.control(guild.id, 'skip', state.version, authorize);
  assert.deepEqual(notices.slice(2).map(notice => notice.kind), ['skipped', 'started']);
  assert.equal(notices.at(-1)?.next?.track.id, 'third');
});

test('failed tracks announce failure and notifier failures never stop playback', async t => {
  const notices: MusicNotice[] = [];
  const { service, transports } = setup(t, async notice => { notices.push(notice); throw new Error('Discord unavailable'); });
  let state = await service.connect(guild, channelId, 0, authorize);
  state = await service.enqueue(guild.id, 'first', 'actor', state.version, authorize);
  state = await service.enqueue(guild.id, 'second', 'actor', state.version, authorize);
  transports[0]!.finished!('download interrupted');
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.deepEqual(notices.slice(3).map(notice => notice.kind), ['failed', 'started']);
  assert.equal(service.snapshot(guild.id).current?.track.id, 'second');
  assert.equal(service.snapshot(guild.id).status, 'playing');
});

test('failed asynchronous pause does not mark the player paused', async t => {
  const { service, transports } = setup(t);
  let state = await service.connect(guild, channelId, 0, authorize);
  state = await service.enqueue(guild.id, 'first', 'actor', state.version, authorize);
  t.mock.method(transports[0]!, 'pause', async () => { throw new Error('node unavailable'); });
  await assert.rejects(service.control(guild.id, 'pause', state.version, authorize));
  assert.equal(service.snapshot(guild.id).status, 'playing');
  assert.equal(service.snapshot(guild.id).version, state.version);
});

test('failed asynchronous stop preserves current track and queue for reconnect', async t => {
  const { service, transports } = setup(t);
  let state = await service.connect(guild, channelId, 0, authorize);
  state = await service.enqueue(guild.id, 'first', 'actor', state.version, authorize);
  state = await service.enqueue(guild.id, 'second', 'actor', state.version, authorize);
  t.mock.method(transports[0]!, 'stopTrack', async () => { throw new Error('node unavailable'); });
  state = await service.control(guild.id, 'skip', state.version, authorize);
  assert.equal(state.status, 'disconnected');
  assert.deepEqual(state.queue.map(entry => entry.track.id), ['first', 'second']);
});
