import { randomUUID } from 'node:crypto';
import type { Guild } from 'discord.js';
import { LoadType, type Player } from 'shoukaku';
import type { MusicTrack } from '../../types/contracts.js';
import type { MusicProvider } from './audius.js';
import type { MusicTransport } from './transport.js';
import { LavalinkYouTube, type LavalinkRuntime } from './lavalink.js';
import { workflowError } from '../workflow/rules.js';
import { logRecord } from '../../observability/logging.js';

export class LavalinkMusicTransport implements MusicTransport {
  private player?: Player;
  private guildId?: string;
  private level = 30;
  private playbackId?: string;
  private finished?: (error?: string) => void;
  private starting?: { resolve: () => void; reject: (error: Error) => void };
  private commands: Promise<unknown> = Promise.resolve();
  private readonly nodeLost = () => { if (this.player) this.disconnected(); };
  constructor(private readonly runtime: LavalinkRuntime, private readonly youtube: LavalinkYouTube,
    private readonly provider: MusicProvider, private readonly disconnected: () => void) {}

  async connect(guild: Guild, channelId: string) {
    await this.runtime.node();
    await this.runtime.waitForRelease(guild.id);
    this.guildId = guild.id;
    try {
      this.player = await this.runtime.manager.joinVoiceChannel({ guildId: guild.id, channelId, shardId: guild.shardId, deaf: true });
      const matches = (event: unknown) => {
        const data = event as { track?: { userData?: { magelinaPlayback?: string } } };
        return Boolean(this.playbackId && data.track?.userData?.magelinaPlayback === this.playbackId);
      };
      this.player.on('start', event => { if (matches(event)) this.starting?.resolve(); });
      this.player.on('end', event => {
        if (!matches(event) || event.reason === 'stopped' || event.reason === 'replaced') return;
        this.complete(event.reason === 'finished' ? undefined : 'Lavalink no pudo completar la cancion.');
      });
      this.player.on('exception', event => { if (matches(event)) this.complete('Lavalink encontro un error al obtener el audio de esta cancion.'); });
      this.player.on('stuck', event => { if (matches(event)) this.complete('La fuente de audio dejo de entregar datos.'); });
      this.player.on('closed', event => {
        logRecord('lavalink.voice.closed', { service: 'lavalink', guildId: guild.id, exitCode: event.code, outcome: 'failed' });
        if (this.player) this.disconnected();
      });
      this.runtime.manager.on('disconnect', this.nodeLost);
    } catch {
      await this.runtime.manager.leaveVoiceChannel(guild.id);
      this.player = undefined;
      throw workflowError(502, 'No se pudo conectar Lavalink al canal de voz. Revisa el nodo local y DAVE.');
    }
  }
  private command(action: (player: Player) => Promise<void>) {
    const player = this.player;
    if (!player) return Promise.resolve();
    const result = this.commands.then(() => action(player)).catch(() => {
      throw workflowError(502, 'Lavalink no pudo aplicar el control de reproduccion.');
    });
    this.commands = result.catch(() => {});
    return result;
  }
  async play(track: MusicTrack, finished: (error?: string) => void) {
    if (!this.player) throw workflowError(409, 'Conecta primero el reproductor.');
    if (this.playbackId) await this.stopTrack();
    await this.commands;
    const began = performance.now();
    let encoded: string;
    if (track.id.startsWith('youtube:')) encoded = await this.youtube.encoded(track.id);
    else {
      const loaded = await this.runtime.load(this.provider.streamUrl(track.id));
      if (loaded.loadType !== LoadType.TRACK) throw workflowError(502, 'Lavalink no pudo abrir la pista de Audius.');
      encoded = loaded.data.encoded;
    }
    const playbackId = randomUUID();
    this.playbackId = playbackId;
    let timer: ReturnType<typeof setTimeout>;
    const started = new Promise<void>((resolve, reject) => {
      this.starting = { resolve, reject };
      timer = setTimeout(() => reject(workflowError(504, 'Lavalink no inicio el audio a tiempo.')), 25_000);
    });
    // Attach the rejection guard before PATCH can trigger a synchronous start/failure event.
    void started.catch(() => {});
    try {
      await this.command(player => player.playTrack({ track: { encoded, userData: { magelinaPlayback: playbackId } }, volume: this.level, paused: false }));
      await started;
      this.finished = finished;
      logRecord('music.audio.playing', { service: 'lavalink', durationMs: Math.round(performance.now() - began) });
    } catch (error) {
      await this.stopTrack();
      throw error;
    } finally {
      clearTimeout(timer!);
      this.starting = undefined;
    }
  }
  private complete(error?: string) {
    if (this.starting) {
      this.starting.reject(workflowError(502, error ?? 'La pista termino antes de iniciar.'));
      return;
    }
    const callback = this.finished;
    this.finished = undefined;
    this.playbackId = undefined;
    logRecord('music.transport.finished', { service: 'lavalink', guildId: this.guildId, outcome: error ? 'failed' : 'completed' });
    callback?.(error);
  }
  pause() { return this.command(player => player.setPaused(true)); }
  resume() { return this.command(player => player.setPaused(false)); }
  volume(value: number) { this.level = value; return this.command(player => player.setGlobalVolume(value)); }
  position() { return this.player?.position ?? 0; }
  stopTrack() {
    this.finished = undefined;
    this.playbackId = undefined;
    this.starting?.reject(workflowError(409, 'La reproduccion fue cancelada.'));
    return this.command(player => player.stopTrack());
  }
  disconnect() {
    this.finished = undefined;
    this.playbackId = undefined;
    this.starting?.reject(workflowError(409, 'El reproductor se desconecto.'));
    this.runtime.manager.off('disconnect', this.nodeLost);
    const guildId = this.guildId;
    this.player = undefined;
    this.guildId = undefined;
    if (guildId) this.runtime.release(guildId, this.commands);
  }
}
