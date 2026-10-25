import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { PassThrough } from 'node:stream';
import { createAudioResource, createAudioPlayer, StreamType, NoSubscriberBehavior, AudioPlayerStatus, entersState } from '@discordjs/voice';
import { createStreamingPlayer } from '../src/modules/music/transport.js';

test('a brief audio delivery gap does not end the streaming player and playback resumes', { timeout: 5000 }, async t => {
  const stream = new PassThrough({ objectMode: true }), baselineStream = new PassThrough({ objectMode: true });
  const player = createStreamingPlayer(NoSubscriberBehavior.Play);
  const baseline = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Play } });
  t.after(() => { player.stop(true); baseline.stop(true); stream.destroy(); baselineStream.destroy(); });
  const resource = createAudioResource(stream, { inputType: StreamType.Opus, silencePaddingFrames: 0 });
  player.play(resource);
  baseline.play(createAudioResource(baselineStream, { inputType: StreamType.Opus, silencePaddingFrames: 0 }));
  stream.write(Buffer.from([0xf8, 0xff, 0xfe])); baselineStream.write(Buffer.from([0xf8, 0xff, 0xfe]));
  await entersState(player, AudioPlayerStatus.Playing, 1000);
  await new Promise<void>(resolve => setTimeout(resolve, 450));
  assert.equal(baseline.state.status, AudioPlayerStatus.Idle, 'Library defaults end a starved resource');
  assert.equal(player.state.status, AudioPlayerStatus.Playing);
  const before = resource.playbackDuration;
  stream.write(Buffer.from([0xf8, 0xff, 0xfe]));
  await new Promise<void>(resolve => setTimeout(resolve, 80));
  assert.ok(resource.playbackDuration > before, 'New audio must still be consumed after the gap');
  stream.end();
  await entersState(player, AudioPlayerStatus.Idle, 1000);
});

test('installed FFmpeg and Opus encode a short synthetic sample without a Discord connection', { timeout: 15000 }, async (t) => {
  const executable: unknown = createRequire(import.meta.url)('ffmpeg-static');
  assert.equal(typeof executable, 'string');
  const process = spawn(executable as string, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.15', '-f', 's16le', '-ar', '48000', '-ac', '2', 'pipe:1'], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
  t.after(() => { process.kill(); });
  const resource = createAudioResource(process.stdout, { inputType: StreamType.Raw, inlineVolume: true });
  resource.volume!.setVolume(0.3);
  let packets = 0;
  for await (const packet of resource.playStream) { assert.ok(Buffer.isBuffer(packet)); assert.ok(packet.length > 0); packets++; }
  assert.ok(packets >= 5, 'Expected encoded Opus packets');
});
