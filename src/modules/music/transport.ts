import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { createRequire } from 'node:module';
const ffmpegModule: unknown = createRequire(import.meta.url)('ffmpeg-static');
const ffmpegPath = typeof ffmpegModule === 'string' ? ffmpegModule : null;
import { AudioPlayerStatus, NoSubscriberBehavior, VoiceConnectionStatus, StreamType, createAudioPlayer, createAudioResource, entersState, joinVoiceChannel } from '@discordjs/voice';
import type { AudioResource, VoiceConnection } from '@discordjs/voice';
import type { Guild } from 'discord.js';
import type { MusicTrack } from '../../types/contracts.js';
import type { MusicProvider } from './audius.js';
import { openAudio } from './network.js';
import { workflowError } from '../workflow/rules.js';
import { logRecord } from '../../observability/logging.js';

export function createStreamingPlayer(noSubscriber = NoSubscriberBehavior.Pause) {
  // The library default is five 20ms frames: a 100ms delivery gap ends the track.
  // Allow a bounded 30s interruption so network jitter can recover without skipping.
  return createAudioPlayer({ behaviors: { noSubscriber, maxMissedFrames: 1500 } });
}

export interface MusicTransport {
  connect(guild: Guild, channelId: string): Promise<void>;
  play(track: MusicTrack, finished: (error?: string) => void): Promise<void>;
  pause(): void; resume(): void; volume(value: number): void; stopTrack(): void; disconnect(): void;
  position?(): number;
}
export class DiscordMusicTransport implements MusicTransport {
  private player = createStreamingPlayer();
  private connection?: VoiceConnection;
  private process?: ChildProcessWithoutNullStreams;
  private controller?: AbortController;
  private resource?: AudioResource;
  private finished?: (error?: string) => void;
  private level = 0.3;
  private expectedDurationMs = 0;
  private source = 'audius';
  constructor(private readonly provider: MusicProvider, private readonly disconnected: () => void) {
    this.player.on(AudioPlayerStatus.Idle, () => {
      if (!this.finished) return;
      const early = (this.resource?.playbackDuration ?? 0) + 3000 < this.expectedDurationMs;
      this.complete(early ? 'El flujo de audio terminó antes de completar la canción. Revisa los eventos music.transport.finished y youtube.audio.exit de la consola.' : undefined, early ? 'early-end-or-stall' : 'ended');
    });
    this.player.on('error', () => this.complete('El reproductor encontró un error de audio y avanzó la cola.', 'player-error'));
  }
  private complete(error?: string, reason = 'ended') {
    const callback = this.finished;
    if (!callback) return;
    logRecord('music.transport.finished', { service: this.source, action: reason, positionMs: Math.round(this.resource?.playbackDuration ?? 0), expectedDurationMs: this.expectedDurationMs, outcome: error ? 'failed' : 'completed' });
    this.stopTrack();
    callback?.(error);
  }
  async connect(guild: Guild, channelId: string) {
    if (!ffmpegPath) throw workflowError(503, 'FFmpeg no esta disponible en este servidor.');
    this.connection = joinVoiceChannel({ guildId: guild.id, channelId, adapterCreator: guild.voiceAdapterCreator, selfDeaf: true });
    const active = this.connection;
    this.connection.on('error', () => { if (this.connection === active) this.disconnected(); });
    this.connection.on(VoiceConnectionStatus.Disconnected, () => {
      const connection = this.connection;
      if (!connection) return;
      void Promise.race([
        entersState(connection, VoiceConnectionStatus.Signalling, 5_000), entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
      ]).then(() => entersState(connection, VoiceConnectionStatus.Ready, 15_000)).catch(() => { if (this.connection === connection) this.disconnected(); });
    });
    try { await entersState(this.connection, VoiceConnectionStatus.Ready, 20_000); this.connection.subscribe(this.player); }
    catch { this.disconnect(); throw workflowError(502, 'No se pudo conectar al canal de voz. Revisa permisos, DAVE y conectividad UDP.'); }
  }
  async play(track: MusicTrack, finished: (error?: string) => void) {
    this.stopTrack();
    const controller = new AbortController(); this.controller = controller;
    this.expectedDurationMs = track.durationSeconds * 1000;
    this.source = track.id.startsWith('youtube:') ? 'youtube' : 'audius';
    const source = this.source;
    const response = await (this.provider.openStream?.(track.id, controller.signal) ?? openAudio(this.provider.streamUrl(track.id), controller.signal));
    if (controller.signal.aborted) { response.destroy(); return; }
    const process = spawn(ffmpegPath!, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-protocol_whitelist', 'pipe', '-i', 'pipe:0', '-vn', '-f', 's16le', '-ar', '48000', '-ac', '2', 'pipe:1'], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    this.process = process; this.finished = finished;
    process.stderr.resume();
    const failed = (reason: string, message = 'Se interrumpió la fuente o la conversión del audio. Revisa music.transport.finished en la consola.') => { if (this.process === process) this.complete(message, reason); };
    process.on('error', () => failed('ffmpeg-start-error'));
    process.on('close', code => {
      logRecord('music.ffmpeg.exit', { service: source, exitCode: code, outcome: controller.signal.aborted ? 'cancelled' : code === 0 ? 'completed' : 'failed' });
      if (code !== 0 && !controller.signal.aborted) failed('ffmpeg-exit-error');
    });
    response.once('error', (error: Error & { publicMessage?: unknown }) => { if (!controller.signal.aborted) failed('source-stream-error', typeof error.publicMessage === 'string' ? error.publicMessage : undefined); });
    void pipeline(response, process.stdin).catch(() => { if (!controller.signal.aborted) failed('source-pipeline-error'); });
    process.stdout.on('error', () => failed('ffmpeg-output-error'));
    this.resource = createAudioResource(process.stdout, { inputType: StreamType.Raw, inlineVolume: true });
    this.resource.volume!.setVolume(this.level);
    this.player.play(this.resource);
  }
  pause() { this.player.pause(); }
  resume() { this.player.unpause(); }
  position() { return this.resource?.playbackDuration ?? 0; }
  volume(value: number) { this.level = value / 100; this.resource?.volume?.setVolume(this.level); }
  stopTrack() {
    this.finished = undefined;
    this.controller?.abort(); this.controller = undefined;
    this.process?.kill(); this.process = undefined;
    this.player.stop(true); this.resource = undefined;
  }
  disconnect() {
    this.stopTrack();
    const connection = this.connection; this.connection = undefined;
    if (connection && connection.state.status !== VoiceConnectionStatus.Destroyed) connection.destroy();
  }
}
