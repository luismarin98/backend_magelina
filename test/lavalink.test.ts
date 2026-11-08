import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { Client, Guild } from 'discord.js';
import { LoadType, type LavalinkResponse, type PlayOptions, type Track, type Node as LavalinkNode } from 'shoukaku';
import { LavalinkYouTube, lavalinkYouTubeTrack, lavalinkOptions, musicEngine, LavalinkRuntime, lavalinkFailure } from '../src/modules/music/lavalink.js';
import { LavalinkMusicTransport } from '../src/modules/music/lavalink-transport.js';

const video = 'oOi3oJmfz4o';
const raw: Track = { encoded: 'encoded-track', pluginInfo: {}, info: { identifier: video, isSeekable: true, author: 'Artist', length: 221000, isStream: false, position: 0, title: 'Song', uri: `https://www.youtube.com/watch?v=${video}`, sourceName: 'youtube' } };

test('local Lavalink selection defaults to direct and does not accept remote URLs or embedded credentials', () => {
  assert.equal(musicEngine({}), 'direct');
  assert.equal(musicEngine({ MUSIC_ENGINE: 'lavalink' }), 'lavalink');
  assert.throws(() => musicEngine({ MUSIC_ENGINE: 'invalid' }));
  assert.equal(lavalinkOptions({ LAVALINK_PASSWORD: 'test' }).url, '127.0.0.1:2333');
  for (const url of ['http://remote.example:2333', 'http://user:secret@127.0.0.1:2333', 'file:///tmp/node', 'http://127.0.0.1:2333/v4']) assert.throws(() => lavalinkOptions({ LAVALINK_PASSWORD: 'test', LAVALINK_URL: url }));
});

test('Lavalink YouTube metadata preserves canonical IDs and rejects live, oversized and foreign tracks', () => {
  assert.equal(lavalinkYouTubeTrack(raw).id, `youtube:${video}`);
  for (const info of [{ isStream: true }, { length: 1801000 }, { length: 0 }, { sourceName: 'http' }, { identifier: 'invalid' }]) assert.throws(() => lavalinkYouTubeTrack({ ...raw, info: { ...raw.info, ...info } }));
});

test('encoded track cache avoids duplicate loading and refreshes stale metadata', async t => {
  let now = 1000, calls = 0;
  t.mock.method(Date, 'now', () => now);
  const provider = new LavalinkYouTube({ load: async identifier => { calls++; assert.equal(identifier, raw.info.uri); return { loadType: LoadType.TRACK, data: raw }; } });
  const first = await provider.track(`youtube:${video}`);
  first.title = 'mutated';
  assert.equal(await provider.encoded(video), raw.encoded);
  assert.equal((await provider.track(video)).title, 'Song');
  assert.equal(calls, 1);
  now += 30000;
  await provider.track(video);
  assert.equal(calls, 2);
});

test('playlist loading stays ordered and bounded and previews are revalidated before playback', async () => {
  const calls: string[] = [];
  const provider = new LavalinkYouTube({ load: async identifier => {
    calls.push(identifier);
    if (identifier.includes('playlist')) return { loadType: LoadType.PLAYLIST, data: {
      encoded: '', info: { name: 'List', selectedTrack: -1 }, pluginInfo: {}, tracks: [raw, raw, { ...raw, info: { ...raw.info, identifier: 'abcdefghijk' } }, { ...raw, info: { ...raw.info, identifier: '12345678901', isStream: true } }],
    } };
    return { loadType: LoadType.TRACK, data: raw };
  } });
  assert.deepEqual((await provider.playlist('youtube:playlist:PLabcdefghijk123', 2)).map(track => track.id), [`youtube:${video}`, 'youtube:abcdefghijk']);
  await provider.track(video);
  assert.equal(calls.length, 2);
  assert.equal(calls[0], 'https://www.youtube.com/playlist?list=PLabcdefghijk123');
  assert.equal(calls[1], raw.info.uri);
});

class FakePlayer extends EventEmitter {
  position = 0;
  autoStart = true;
  options?: PlayOptions;
  controls: unknown[] = [];
  async playTrack(options: PlayOptions) {
    this.options = options;
    if (this.autoStart) queueMicrotask(() => {
      this.emit('start', this.event());
      this.emit('update', { state: { connected: true, position: 20 } });
    });
  }
  event(reason = 'finished') { return { reason, exception: { message: 'Audio unavailable', cause: 'unknown' }, track: { ...raw, userData: this.options?.track?.userData } }; }
  async stopTrack() { this.controls.push('stop'); }
  async setPaused(value: boolean) { this.controls.push(['paused', value]); }
  async setGlobalVolume(value: number) { this.controls.push(['volume', value]); }
}
function setup() {
  const player = new FakePlayer();
  let joins = 0, leaves = 0, lost = 0;
  const manager = Object.assign(new EventEmitter(), {
    joinVoiceChannel: async (options: { shardId: number; channelId: string }) => { joins++; assert.equal(options.shardId, 0); return player; },
    leaveVoiceChannel: async () => { leaves++; },
  });
  const runtime = { manager, node: async () => ({}), waitForRelease: async () => {},
    release: (guildId: string, after: Promise<unknown>) => { void after.then(() => manager.leaveVoiceChannel()); },
    load: async (): Promise<LavalinkResponse> => ({ loadType: LoadType.TRACK, data: raw }) } as unknown as LavalinkRuntime;
  const provider = { search: async () => [], track: async () => lavalinkYouTubeTrack(raw), streamUrl: () => 'https://api.audius.co/audio' };
  const youtube = new LavalinkYouTube(runtime);
  const transport = new LavalinkMusicTransport(runtime, youtube, provider, () => { lost++; });
  return { transport, player, manager, counts: () => ({ joins, leaves, lost }) };
}
const guild = { id: '100000000000000001', shardId: 0 } as Guild;
const channelId = '100000000000000002';

test('Lavalink transport requires connected playback progress before announcing playback', async t => {
  const { transport, player, counts } = setup();
  t.after(() => transport.disconnect());
  await transport.connect(guild, channelId);
  player.autoStart = false;
  let started = false;
  const playing = transport.play(lavalinkYouTubeTrack(raw), () => {}).then(() => { started = true; });
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(started, false);
  player.emit('start', player.event());
  player.emit('update', { state: { connected: true, position: 0 } });
  player.emit('update', { state: { connected: false, position: 20 } });
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(started, false);
  player.emit('update', { state: { connected: true, position: 20 } });
  await playing;
  assert.equal(started, true);
  await transport.pause(); await transport.resume(); await transport.volume(45);
  player.position = 15000;
  assert.equal(transport.position(), 15000);
  assert.deepEqual(player.controls, [['paused', true], ['paused', false], ['volume', 45]]);
  assert.equal(counts().joins, 1);
});

test('stale end events cannot finish a repeated song or advance the queue twice', async t => {
  const { transport, player } = setup();
  t.after(() => transport.disconnect());
  await transport.connect(guild, channelId);
  let completions = 0;
  await transport.play(lavalinkYouTubeTrack(raw), () => { completions++; });
  const old = player.event();
  await transport.stopTrack();
  await transport.play(lavalinkYouTubeTrack(raw), () => { completions++; });
  player.emit('end', old);
  assert.equal(completions, 0);
  const current = player.event();
  player.emit('end', current); player.emit('end', current);
  assert.equal(completions, 1);
});

test('startup failures reject playback and track errors invoke completion only once', async t => {
  const { transport, player } = setup();
  t.after(() => transport.disconnect());
  await transport.connect(guild, channelId);
  player.autoStart = false;
  const startup = transport.play(lavalinkYouTubeTrack(raw), () => {});
  const rejected = assert.rejects(startup, /audio reproducible/);
  await new Promise<void>(resolve => setImmediate(resolve));
  player.emit('exception', player.event());
  await rejected;
  player.autoStart = true;
  const errors: (string | undefined)[] = [];
  await transport.play(lavalinkYouTubeTrack(raw), error => { errors.push(error); });
  const event = player.event();
  player.emit('stuck', event); player.emit('end', { ...event, reason: 'loadFailed' });
  assert.equal(errors.length, 1);
  assert.match(errors[0]!, /dejo de entregar/);
});

test('source failures are classified without exposing upstream URLs or credentials', () => {
  for (const [message, reason] of [
    ['Sign in to confirm you are not a bot', 'source-auth-required'],
    ['HTTP 403 https://private.example/?token=secret', 'source-forbidden'],
    ['HTTP 429', 'source-rate-limited'], ['AllClientsFailedException', 'source-clients-failed'],
    ['No supported audio formats', 'source-format-unavailable'], ['timed out', 'source-timeout'],
    ['unknown https://private.example/?token=secret', 'source-error'],
  ]) assert.equal(lavalinkFailure(message!), reason);
});

test('start followed by extraction failure never announces playback or advances the queue', async t => {
  const { transport, player } = setup();
  t.after(() => transport.disconnect());
  await transport.connect(guild, channelId);
  player.autoStart = false;
  let completed = 0;
  const playing = transport.play(lavalinkYouTubeTrack(raw), () => { completed++; });
  const rejected = assert.rejects(playing, /fuente rechazo/);
  await new Promise<void>(resolve => setImmediate(resolve));
  player.emit('start', player.event());
  player.emit('exception', { ...player.event(), exception: { message: 'Sign in', cause: 'HTTP 403' } });
  await rejected;
  assert.equal(completed, 0);
});

test('disconnect releases the voice connection and removes node listeners', async () => {
  const { transport, manager, counts } = setup();
  await transport.connect(guild, channelId);
  manager.emit('disconnect', 'local', 1);
  assert.equal(counts().lost, 1);
  transport.disconnect();
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(counts().leaves, 1);
  assert.equal(manager.listenerCount('disconnect'), 0);
});

test('reconnect waits for the previous remote player to be released', async t => {
  const oldPassword = process.env.LAVALINK_PASSWORD, oldUrl = process.env.LAVALINK_URL;
  process.env.LAVALINK_PASSWORD = 'test'; process.env.LAVALINK_URL = 'http://127.0.0.1:2333';
  t.after(() => {
    if (oldPassword === undefined) delete process.env.LAVALINK_PASSWORD; else process.env.LAVALINK_PASSWORD = oldPassword;
    if (oldUrl === undefined) delete process.env.LAVALINK_URL; else process.env.LAVALINK_URL = oldUrl;
  });
  const runtime = new LavalinkRuntime(new EventEmitter() as unknown as Client);
  t.after(() => runtime.dispose());
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  t.mock.method(runtime.manager, 'leaveVoiceChannel', async () => { await gate; });
  runtime.release(guild.id, Promise.resolve());
  let ready = false;
  const waiting = runtime.waitForRelease(guild.id).then(() => { ready = true; });
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(ready, false);
  release(); await waiting;
  assert.equal(ready, true);
});

test('intentional shutdown waits for releases and closes sockets without reconnecting', async t => {
  const oldPassword = process.env.LAVALINK_PASSWORD, oldUrl = process.env.LAVALINK_URL;
  process.env.LAVALINK_PASSWORD = 'test'; process.env.LAVALINK_URL = 'http://127.0.0.1:2333';
  t.after(() => {
    if (oldPassword === undefined) delete process.env.LAVALINK_PASSWORD; else process.env.LAVALINK_PASSWORD = oldPassword;
    if (oldUrl === undefined) delete process.env.LAVALINK_URL; else process.env.LAVALINK_URL = oldUrl;
  });
  const runtime = new LavalinkRuntime(new EventEmitter() as unknown as Client);
  let reconnects = 0, closes = 0;
  const socket = Object.assign(new EventEmitter(), {
    close: () => { closes++; queueMicrotask(() => socket.emit('close')); },
    terminate: () => { throw new Error('Clean close should not be forced'); },
  });
  socket.on('close', () => { reconnects++; });
  runtime.manager.nodes.set('local', { ws: socket } as unknown as LavalinkNode);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  t.mock.method(runtime.manager, 'leaveVoiceChannel', async () => { await gate; });
  runtime.release(guild.id, Promise.resolve());
  const closing = runtime.dispose();
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(closes, 0);
  release(); await closing;
  assert.equal(closes, 1);
  assert.equal(reconnects, 0);
  assert.equal(runtime.manager.options.reconnectTries, 0);
  assert.equal(runtime.manager.nodes.size, 0);
  assert.equal(runtime.manager.id, null);
});
