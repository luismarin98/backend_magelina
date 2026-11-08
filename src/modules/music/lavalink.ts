import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { Connectors, LoadType, Shoukaku, type LavalinkResponse, type Track } from 'shoukaku';
import type { Client } from 'discord.js';
import type { MusicTrack } from '../../types/contracts.js';
import type { YouTubeSource } from './sources.js';
import { normalizeYouTube, youtubeId, youtubeRequestId } from './youtube.js';
import { workflowError } from '../workflow/rules.js';
import { logRecord } from '../../observability/logging.js';

export function musicEngine(env: NodeJS.ProcessEnv = process.env): 'direct' | 'lavalink' {
  const engine = env.MUSIC_ENGINE ?? 'direct';
  if (engine !== 'direct' && engine !== 'lavalink') throw new Error('MUSIC_ENGINE debe ser direct o lavalink.');
  return engine;
}

/** Only fixed categories leave the node; raw plugin errors can contain signed URLs. */
export function lavalinkFailure(detail: string): string {
  if (/requires? login|sign.?in|confirm.*not a bot|LOGIN_REQUIRED/i.test(detail)) return 'source-auth-required';
  if (/\b429\b|rate.?limit/i.test(detail)) return 'source-rate-limited';
  if (/\b403\b|forbidden/i.test(detail)) return 'source-forbidden';
  if (/AllClientsFailed|all clients failed/i.test(detail)) return 'source-clients-failed';
  if (/no supported audio|no formats|format.*unavailable/i.test(detail)) return 'source-format-unavailable';
  if (/timeout|timed out/i.test(detail)) return 'source-timeout';
  return 'source-error';
}
export function lavalinkOptions(env: NodeJS.ProcessEnv = process.env) {
  let url: URL;
  try { url = new URL(env.LAVALINK_URL ?? 'http://127.0.0.1:2333'); }
  catch { throw new Error('LAVALINK_URL no es valida.'); }
  // This first integration is deliberately local. Remote nodes can be added separately.
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('La prueba local requiere LAVALINK_URL=http://127.0.0.1:2333.');
  let password = env.LAVALINK_PASSWORD;
  if (!password) {
    try { password = parseEnv(readFileSync('.env.lavalink', 'utf8')).LAVALINK_PASSWORD; }
    catch { throw new Error('Ejecuta npm run lavalink:prepare para crear la configuracion local.'); }
  }
  if (!password?.trim()) throw new Error('Falta LAVALINK_PASSWORD.');
  return { name: 'local', url: url.host, auth: password, secure: false };
}

export class LavalinkRuntime {
  readonly manager: Shoukaku;
  private releases = new Map<string, Promise<void>>();
  private shuttingDown = false;
  constructor(bot: Client) {
    this.manager = new Shoukaku(new Connectors.DiscordJS(bot), [lavalinkOptions()], {
      resume: true, resumeTimeout: 60, resumeByLibrary: false,
      reconnectTries: 5, reconnectInterval: 3, restTimeout: 20, voiceConnectionTimeout: 20,
    });
    this.manager.on('error', () => { if (!this.shuttingDown) logRecord('lavalink.node.error', { service: 'lavalink', outcome: 'failed' }); });
    this.manager.on('ready', () => logRecord('lavalink.node.ready', { service: 'lavalink' }));
    this.manager.on('close', (_name, code) => logRecord('lavalink.node.closed', { service: 'lavalink', exitCode: code }));
    this.manager.on('reconnecting', () => logRecord('lavalink.node.reconnecting', { service: 'lavalink' }));
  }
  async node() {
    const ready = this.manager.getIdealNode();
    if (ready) return ready;
    await new Promise<void>((resolve, reject) => {
      const done = () => { clearTimeout(timer); this.manager.off('ready', done); resolve(); };
      const timer = setTimeout(() => { this.manager.off('ready', done); reject(workflowError(503, 'Lavalink local no esta listo. Ejecuta npm run lavalink:start.')); }, 10_000);
      this.manager.once('ready', done);
    });
    const node = this.manager.getIdealNode();
    if (!node) throw workflowError(503, 'Lavalink local no esta disponible.');
    return node;
  }
  async load(identifier: string): Promise<LavalinkResponse> {
    const began = performance.now();
    try {
      const result = await (await this.node()).rest.resolve(identifier);
      logRecord('lavalink.load', { service: 'lavalink', durationMs: Math.round(performance.now() - began), outcome: result?.loadType === LoadType.ERROR ? 'failed' : 'completed' });
      if (!result || result.loadType === LoadType.ERROR) throw workflowError(502, 'Lavalink no pudo obtener esta musica. Revisa el registro local del nodo.');
      return result;
    } catch (error) {
      if (error instanceof Error && 'publicMessage' in error) throw error;
      throw workflowError(502, 'No se pudo consultar Lavalink local.');
    }
  }
  async waitForRelease(guildId: string) { await this.releases.get(guildId); }
  release(guildId: string, after: Promise<unknown>) {
    const released = after.catch(() => {}).then(() => this.manager.leaveVoiceChannel(guildId)).then(() => {}).catch(() => {
      logRecord('lavalink.disconnect.failed', { service: 'lavalink', guildId, outcome: 'failed' });
    });
    this.releases.set(guildId, released);
    void released.then(() => { if (this.releases.get(guildId) === released) this.releases.delete(guildId); });
  }
  async dispose() {
    this.shuttingDown = true;
    // Shoukaku 4 reconnects even after removeNode(). Intentional shutdown must
    // stop retrying and detach the socket close handler before closing sockets.
    this.manager.options.reconnectTries = 0;
    this.manager.options.resume = false;
    await Promise.allSettled([...this.releases.values()]);
    this.manager.id = null;
    const sockets = [...this.manager.nodes.values()].map(node => node.ws).filter(socket => socket !== null);
    this.manager.nodes.clear();
    await Promise.all(sockets.map(socket => new Promise<void>(resolve => {
      socket.removeAllListeners();
      socket.on('error', () => {});
      const timer = setTimeout(() => { socket.terminate(); resolve(); }, 1000);
      socket.once('close', () => { clearTimeout(timer); resolve(); });
      socket.close(1000, 'Magelina shutdown');
    })));
  }
}

export function lavalinkYouTubeTrack(value: Track): MusicTrack {
  if (value.info.sourceName !== 'youtube') throw workflowError(400, 'La pista no pertenece a YouTube.');
  const id = youtubeId(value.info.identifier);
  return normalizeYouTube({ id, title: value.info.title, channel: value.info.author,
    duration: value.info.length / 1000, is_live: value.info.isStream, availability: 'public' }, id);
}

export class LavalinkYouTube implements YouTubeSource {
  private cache = new Map<string, { at: number; music: MusicTrack; encoded: string }>();
  constructor(private readonly runtime: Pick<LavalinkRuntime, 'load'>) {}
  private remember(track: Track) {
    const music = lavalinkYouTubeTrack(track);
    if (this.cache.size >= 100) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(music.id, { at: Date.now(), music, encoded: track.encoded });
    return structuredClone(music);
  }
  async track(value: string): Promise<MusicTrack> {
    const id = `youtube:${youtubeId(value)}`;
    const cached = this.cache.get(id);
    if (cached && Date.now() - cached.at < 30_000) return structuredClone(cached.music);
    const result = await this.runtime.load(`https://www.youtube.com/watch?v=${youtubeId(value)}`);
    if (result.loadType !== LoadType.TRACK) throw workflowError(400, 'El video no esta disponible en Lavalink.');
    const track = this.remember(result.data);
    if (track.id !== id) { this.cache.delete(track.id); throw workflowError(502, 'Lavalink devolvio un video diferente.'); }
    return track;
  }
  async encoded(value: string) {
    const track = await this.track(value);
    return this.cache.get(track.id)!.encoded;
  }
  async search(query: string): Promise<MusicTrack[]> {
    const term = query.trim();
    if (term.length < 2 || term.length > 100 || /[\x00-\x1f]/.test(term)) throw workflowError(400, 'Busca usando entre 2 y 100 caracteres.');
    const result = await this.runtime.load(`ytsearch:${term}`);
    return this.filtered(result.loadType === LoadType.SEARCH ? result.data.slice(0, 8) : [], 8);
  }
  async playlist(value: string, limit: number): Promise<MusicTrack[]> {
    const request = youtubeRequestId(value);
    if (!request.startsWith('youtube:playlist:')) throw workflowError(400, 'Introduce una playlist de YouTube.');
    const id = request.slice('youtube:playlist:'.length);
    const result = await this.runtime.load(`https://www.youtube.com/playlist?list=${id}`);
    const tracks = this.filtered(result.loadType === LoadType.PLAYLIST ? result.data.tracks.slice(0, 100) : [], Math.min(25, Math.max(0, limit)));
    if (!tracks.length) throw workflowError(400, 'La playlist no contiene canciones disponibles de hasta 30 minutos.');
    return tracks;
  }
  private filtered(entries: Track[], limit: number) {
    const result: MusicTrack[] = [];
    for (const entry of entries) {
      if (result.length >= limit) break;
      try {
        // Preview results must be reloaded as individual tracks before playback.
        const track = lavalinkYouTubeTrack(entry);
        if (!result.some(existing => existing.id === track.id)) result.push(track);
      } catch { /* Skip non-YouTube, live and oversized entries. */ }
    }
    return result;
  }
}
