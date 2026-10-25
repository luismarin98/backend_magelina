import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { YouTubeExtractor, normalizeYouTube, youtubeId, youtubeFailure, type ExtractorSpawner } from '../src/modules/music/youtube.js';
import { MusicSources, musicTrackId } from '../src/modules/music/sources.js';
const video = 'YE7VzlLtp-4';
const metadata = { id: video, title: 'Big Buck Bunny', channel: 'Blender', duration: 596, availability: 'public', age_limit: 0, is_live: false };
class FakeChild extends EventEmitter {
  stdin = new PassThrough(); stdout = new PassThrough(); stderr = new PassThrough(); killed = false;
  kill() { if (!this.killed) { this.killed = true; this.stdout.destroy(); queueMicrotask(() => this.emit('close', null)); } return true; }
}
function fake(run: (child: FakeChild, args: string[]) => void) {
  const children: FakeChild[] = [], calls: string[][] = [];
  const launch: ExtractorSpawner = (_file, args) => {
    const child = new FakeChild(); children.push(child); calls.push(args);
    queueMicrotask(() => run(child, args));
    return child as unknown as ChildProcessWithoutNullStreams;
  };
  return { extractor: new YouTubeExtractor('fake-extractor', launch), children, calls };
}
test('YouTube accepts only individual canonical video IDs and never passes arbitrary URLs', () => {
  for (const value of [video, `youtube:${video}`, `https://youtu.be/${video}`, `https://www.youtube.com/watch?v=${video}&list=ignored`, `https://youtube.com/shorts/${video}`]) assert.equal(youtubeId(value), video);
  for (const value of ['--exec=whoami', 'file:///tmp/audio', 'http://youtu.be/'+video, 'https://youtube.com.evil/watch?v='+video, 'https://user:pass@youtube.com/watch?v='+video, 'https://youtube.com/playlist?list=x', 'https://youtube.com:8080/watch?v='+video, 'https://youtu.be/'+video+'/extra']) assert.throws(() => youtubeId(value));
  assert.equal(musicTrackId(`youtube:${video}`), `youtube:${video}`);
  assert.throws(() => musicTrackId('https://localhost/audio'));
});
test('metadata rejects live, DRM, private, wrong IDs and oversized videos', () => {
  assert.equal(normalizeYouTube(metadata, video).id, `youtube:${video}`);
  for (const patch of [{ duration: 1801 }, { duration: Infinity }, { availability: 'private' }, { is_live: true }, { live_status: 'is_upcoming' }, { age_limit: 18 }, { has_drm: true }, { id: 'different' }]) assert.throws(() => normalizeYouTube({ ...metadata, ...patch }, video));
});
test('extractor ignores user configuration and uses argument arrays with a canonical YouTube URL', async () => {
  const setup = fake(child => { child.stdout.end(JSON.stringify(metadata)); child.emit('close', 0); });
  const track = await setup.extractor.track(`https://youtube.com/watch?v=${video}&ignored=private`);
  assert.equal(track.permalink, `https://www.youtube.com/watch?v=${video}`);
  assert.ok(setup.calls[0]!.includes('--ignore-config'));
  assert.ok(setup.calls[0]!.includes('--no-playlist'));
  assert.deepEqual(setup.calls[0]!.slice(-2), ['--', `https://www.youtube.com/watch?v=${video}`]);
});
test('extractor failures sanitize stderr and malformed JSON', async () => {
  const failed = fake(child => { child.stderr.write('private-cookie-and-token'); child.emit('close', 1); });
  await assert.rejects(failed.extractor.track(video), error => error instanceof Error && !error.message.includes('private-cookie'));
  const malformed = fake(child => { child.stdout.end('invalid-json'); child.emit('close', 0); });
  await assert.rejects(malformed.extractor.track(video), /interpretar/);
});
test('YouTube searches are bounded, normalized, cached and exclude invalid previews', async () => {
  const setup = fake(child => { child.stdout.end(JSON.stringify({ entries: [metadata, { ...metadata, id: 'abcdefghijk', duration: 1900 }, { ...metadata, id: 'invalid' }, metadata] })); child.emit('close', 0); });
  const tracks = await setup.extractor.search('Big Buck Bunny');
  assert.equal(tracks.length, 1);
  assert.equal(tracks[0]?.artworkUrl, `https://i.ytimg.com/vi/${video}/mqdefault.jpg`);
  assert.equal(tracks[0]?.id, `youtube:${video}`);
  assert.ok(setup.calls[0]!.includes('--flat-playlist'));
  assert.deepEqual(setup.calls[0]!.slice(-2), ['--', 'ytsearch8:Big Buck Bunny']);
  tracks[0]!.title = 'changed';
  assert.equal((await setup.extractor.search('Big Buck Bunny'))[0]?.title, metadata.title);
  assert.equal(setup.calls.length, 1);
  await assert.rejects(setup.extractor.search('a'));
});
test('audio streams are cancelled and their subprocess is killed when playback stops', async () => {
  const setup = fake(child => child.stdout.write(Buffer.alloc(1024)));
  const controller = new AbortController();
  const stream = await setup.extractor.open(video, controller.signal);
  assert.equal(stream.readableLength, 1024);
  controller.abort();
  assert.equal(setup.children[0]!.killed, true);
  assert.equal(stream.destroyed, true);
  assert.ok(setup.calls[0]!.includes('bestaudio[protocol=https]/best[protocol=https]'));
  assert.ok(setup.calls[0]!.includes('--http-chunk-size'));
  assert.deepEqual(setup.calls[0]!.slice(setup.calls[0]!.lastIndexOf('--retries'), setup.calls[0]!.lastIndexOf('--retries') + 2), ['--retries', '3']);
});
test('aborting while waiting for the first audio bytes ends extraction', async () => {
  const setup = fake(() => {}), controller = new AbortController();
  const audio = setup.extractor.open(video, controller.signal);
  controller.abort();
  await assert.rejects(audio);
  assert.equal(setup.children[0]!.killed, true);
});
test('normal audio EOF does not kill the extractor before its successful exit', async () => {
  const setup = fake(child => child.stdout.write(Buffer.alloc(1024)));
  const stream = await setup.extractor.open(video, new AbortController().signal);
  const drained = new Promise<void>(resolve => stream.once('close', resolve));
  stream.resume(); setup.children[0]!.stdout.end();
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(setup.children[0]!.killed, false);
  assert.equal(stream.readableEnded, false);
  setup.children[0]!.emit('close', 0);
  await drained;
});

test('stdout EOF followed by exit(1) remains a stream error and logs only a safe diagnosis', async (t) => {
  const records: string[] = [];
  t.mock.method(console, 'error', (value: string) => { records.push(value); });
  const setup = fake(child => child.stdout.write(Buffer.alloc(1024)));
  const stream = await setup.extractor.open(video, new AbortController().signal);
  const failed = new Promise<Error>(resolve => stream.once('error', resolve));
  stream.resume(); setup.children[0]!.stdout.end();
  setup.children[0]!.stderr.write('ERROR: unable to download video data: HTTP Error 403: Forbidden https://secret.invalid/?token=private-token');
  await new Promise<void>(resolve => setImmediate(resolve));
  setup.children[0]!.emit('close', 1);
  assert.match((await failed).message, /403/);
  assert.equal(setup.children[0]!.killed, false);
  const record = JSON.parse(records.find(value => value.includes('youtube.audio.exit'))!);
  assert.equal(record.reason, 'http-forbidden'); assert.equal(record.status, 403);
  assert.ok(!records.join('').includes('private-token'));
  assert.ok(!records.join('').includes('secret.invalid'));
});

test('extractor diagnoses HTTP, timeout and incomplete downloads without returning external text', () => {
  for (const [detail, reason] of [
    ['HTTP Error 429: Too Many Requests', 'http-rate-limited'],
    ['HTTP Error 503: Service Unavailable', 'http-server-error'],
    ['Read timed out. (read timeout=15.0)', 'network-timeout'],
    ['Connection reset by peer', 'network-reset'],
    ['Incomplete read: 1024 bytes read, 8192 more expected', 'incomplete-download'],
    ['getaddrinfo failed', 'dns-failure'],
    ['private-cookie-and-token', 'extractor-error'],
  ]) assert.equal(youtubeFailure(detail!).reason, reason);
});
test('extractor concurrency is bounded and slots are released after exit', async () => {
  const setup = fake(() => {});
  const pending = Array.from({ length: 4 }, () => setup.extractor.track(video));
  const settled = Promise.allSettled(pending);
  await assert.rejects(setup.extractor.track(video), /ocupado/);
  setup.children.forEach(child => child.emit('close', 1));
  await settled;
});
test('mixed sources keep Audius IDs isolated and disabled YouTube cannot be requested', async () => {
  const audius = { search: async () => [], track: async (id: string) => ({ ...normalizeYouTube(metadata, video), id }), streamUrl: (id: string) => `https://api.audius.co/${id}` };
  const sources = new MusicSources(audius, null);
  assert.equal((await sources.track('abc12')).id, 'abc12');
  assert.throws(() => sources.track(`youtube:${video}`), /no está habilitada/);
  assert.throws(() => sources.streamUrl(`youtube:${video}`), /extractor/);
});
