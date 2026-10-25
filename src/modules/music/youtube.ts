import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { PassThrough, Readable } from 'node:stream';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import type { MusicTrack } from '../../types/contracts.js';
import { workflowError } from '../workflow/rules.js';
import { logRecord } from '../../observability/logging.js';

export function youtubeId(value: unknown): string {
  if (typeof value !== 'string') throw workflowError(400, 'Introduce un enlace de video de YouTube.');
  const direct = value.startsWith('youtube:') ? value.slice(8) : value;
  if (/^[a-zA-Z0-9_-]{11}$/.test(direct)) return direct;
  let url: URL;
  try { url = new URL(value); } catch { throw workflowError(400, 'Enlace de YouTube no válido.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be'].includes(url.hostname)) throw workflowError(400, 'Usa un enlace HTTPS de youtube.com o youtu.be.');
  const id = url.hostname === 'youtu.be' ? url.pathname.slice(1) : url.pathname === '/watch' ? url.searchParams.get('v') : /^\/(?:shorts|embed)\/([a-zA-Z0-9_-]{11})$/.exec(url.pathname)?.[1];
  if (!id || !/^[a-zA-Z0-9_-]{11}$/.test(id)) throw workflowError(400, 'Selecciona un video individual de YouTube.');
  return id;
}
export function normalizeYouTube(value: unknown, expectedId: string): MusicTrack {
  const item = value as Record<string, unknown> | null;
  if (!item || item.id !== expectedId || typeof item.title !== 'string' || !item.title.trim() || typeof item.duration !== 'number' || !Number.isFinite(item.duration) || item.duration < 1 || item.duration > 1800 || item.is_live === true || ['is_live', 'is_upcoming', 'post_live'].includes(String(item.live_status)) || !['public', 'unlisted'].includes(String(item.availability)) || (typeof item.age_limit === 'number' && item.age_limit >= 18) || item.has_drm === true) throw workflowError(400, 'Selecciona un video público disponible, sin restricciones de edad ni emisión en vivo, de hasta 30 minutos.');
  return { id: `youtube:${expectedId}`, title: item.title.slice(0, 200), artist: String(item.channel ?? item.uploader ?? 'YouTube').slice(0, 120), durationSeconds: Math.ceil(item.duration), permalink: `https://www.youtube.com/watch?v=${expectedId}`, artworkUrl: `https://i.ytimg.com/vi/${expectedId}/mqdefault.jpg` };
}
export type ExtractorSpawner = (executable: string, args: string[]) => ChildProcessWithoutNullStreams;
/** Only fixed categories leave the process; never emit URLs, headers or raw stderr. */
export function youtubeFailure(detail: string): { reason: string; status?: number } {
  const statuses = [...detail.matchAll(/(?:HTTP Error|HTTPError|HTTP error|status code)[ :]+(\d{3})\b/gi)];
  const status = Number(statuses.at(-1)?.[1]);
  if (status >= 400 && status <= 599) return { reason: status === 403 ? 'http-forbidden' : status === 429 ? 'http-rate-limited' : status >= 500 ? 'http-server-error' : 'http-error', status };
  if (/timed? out|timeout|ETIMEDOUT/i.test(detail)) return { reason: 'network-timeout' };
  if (/ECONNRESET|connection (?:reset|aborted)|remote end closed|remote disconnected/i.test(detail)) return { reason: 'network-reset' };
  if (/getaddrinfo|name resolution|ENOTFOUND|EAI_AGAIN/i.test(detail)) return { reason: 'dns-failure' };
  if (/certificate verify|CERTIFICATE_VERIFY_FAILED/i.test(detail)) return { reason: 'tls-certificate' };
  if (/content too short|bytes read.*expected|incomplete read|not enough data/i.test(detail)) return { reason: 'incomplete-download' };
  if (/sign in|login required|not a bot|private video|video unavailable|not available in your country|age.restricted/i.test(detail)) return { reason: 'video-restricted' };
  if (/requested format.*not available|no video formats/i.test(detail)) return { reason: 'format-unavailable' };
  if (/broken pipe|EPIPE|unable to write data/i.test(detail)) return { reason: 'output-pipe-closed' };
  return { reason: 'extractor-error' };
}
function failureMessage(reason: string): string {
  switch (reason) {
    case 'network-timeout': return 'YouTube agotó el tiempo de espera del audio tras los reintentos.';
    case 'network-reset': case 'incomplete-download': return 'La conexión de audio de YouTube se interrumpió antes de completar la canción.';
    case 'http-forbidden': return 'YouTube rechazó la descarga de audio (HTTP 403). Prueba otro video o fuente.';
    case 'http-rate-limited': return 'YouTube limitó las solicitudes (HTTP 429). Espera antes de volver a intentar.';
    case 'http-server-error': return 'El servidor de audio de YouTube falló tras los reintentos.';
    case 'video-restricted': return 'YouTube restringió el acceso a este video.';
    default: return 'YouTube interrumpió la extracción del audio. Revisa reason en youtube.audio.exit.';
  }
}
export class YouTubeExtractor {
  private active = 0;
  private searches = new Map<string, { at: number; tracks: MusicTrack[] }>();
  private diagnostics = new WeakMap<ChildProcessWithoutNullStreams, { tail: string }>();
  constructor(readonly executable: string, private readonly launch: ExtractorSpawner = (file, args) => spawn(file, args, { windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] })) {}
  private run(args: string[]) {
    if (this.active >= 4) throw workflowError(429, 'El extractor está ocupado. Espera antes de volver a intentar.');
    this.active++;
    try {
      const process = this.launch(this.executable, ['--ignore-config', '--no-playlist', '--no-cache-dir', '--no-progress', '--no-warnings', '--socket-timeout', '15', '--retries', '1', '--extractor-retries', '1', '--js-runtimes', `node:${globalThis.process.execPath}`, ...args]);
      process.stdin.end();
      const diagnostic = { tail: '' }; this.diagnostics.set(process, diagnostic);
      process.stderr.on('data', (chunk: Buffer) => { diagnostic.tail = (diagnostic.tail + chunk.toString('utf8')).slice(-16_384); });
      let finished = false;
      const release = () => { if (!finished) { finished = true; this.active--; } };
      process.once('close', release); process.once('error', release);
      return process;
    } catch { this.active--; throw workflowError(503, 'No se pudo iniciar yt-dlp. Comprueba su instalación.'); }
  }
  private async metadata(args: string[], action: string): Promise<unknown> {
    const start = performance.now();
    logRecord('youtube.extract.start', { service: 'yt-dlp', action });
    try {
      const body = await new Promise<string>((resolve, reject) => {
        const child = this.run(args);
        const chunks: Buffer[] = []; let size = 0, settled = false;
        const finish = (error?: Error) => {
          if (settled) return; settled = true; clearTimeout(timer);
          if (error) { child.kill(); reject(error); } else resolve(Buffer.concat(chunks).toString('utf8'));
        };
        const timer = setTimeout(() => finish(workflowError(502, 'YouTube no respondió a tiempo. Inténtalo con otro video.')), 30_000); timer.unref();
        child.stdout.on('data', (chunk: Buffer) => { size += chunk.length; if (size > 4_000_000) finish(workflowError(502, 'La respuesta de YouTube excedió el límite permitido.')); else chunks.push(chunk); });
        child.stdout.on('error', () => finish(workflowError(502, 'No se pudo leer la información del video.')));
        child.once('error', () => finish(workflowError(503, 'yt-dlp no está disponible en el backend.')));
        child.once('close', code => finish(code === 0 ? undefined : workflowError(502, 'YouTube no permitió obtener el video. Comprueba el enlace o prueba otra fuente.')));
      });
      const result: unknown = JSON.parse(body);
      logRecord('youtube.extract.end', { service: 'yt-dlp', action, durationMs: Math.round(performance.now() - start), outcome: 'completed' });
      return result;
    } catch (error) {
      logRecord('youtube.extract.end', { service: 'yt-dlp', action, outcome: 'failed' });
      if (error && typeof error === 'object' && 'publicMessage' in error) throw error;
      throw workflowError(502, 'No se pudo interpretar el video de YouTube.');
    }
  }
  async track(value: string): Promise<MusicTrack> {
    const id = youtubeId(value);
    return normalizeYouTube(await this.metadata(['--dump-single-json', '--skip-download', '--', `https://www.youtube.com/watch?v=${id}`], 'metadata'), id);
  }
  async search(query: string): Promise<MusicTrack[]> {
    const term = query.trim();
    if (term.length < 2 || term.length > 100 || /[\x00-\x1f]/.test(term)) throw workflowError(400, 'Busca una canción o artista usando entre 2 y 100 caracteres.');
    const cached = this.searches.get(term);
    if (cached && Date.now() - cached.at < 30_000) return structuredClone(cached.tracks);
    const result = await this.metadata(['--flat-playlist', '--dump-single-json', '--skip-download', '--', `ytsearch8:${term}`], 'search');
    if (!result || typeof result !== 'object' || !('entries' in result) || !Array.isArray(result.entries)) throw workflowError(502, 'YouTube devolvió una búsqueda no válida.');
    const tracks: MusicTrack[] = [];
    for (const entry of result.entries.slice(0, 8)) {
      try {
        if (!entry || typeof entry !== 'object' || typeof entry.id !== 'string' || !/^[a-zA-Z0-9_-]{11}$/.test(entry.id)) continue;
        // Search previews are revalidated with full metadata when queued and played.
        const track = normalizeYouTube({ ...entry, availability: entry.availability ?? 'public' }, entry.id);
        if (!tracks.some(existing => existing.id === track.id)) tracks.push(track);
      } catch { /* Exclude live, oversized or incomplete results. */ }
    }
    if (this.searches.size >= 100) this.searches.delete(this.searches.keys().next().value!);
    this.searches.set(term, { at: Date.now(), tracks });
    return structuredClone(tracks);
  }
  async open(value: string, signal: AbortSignal): Promise<Readable> {
    if (signal.aborted) throw workflowError(409, 'La reproducción fue cancelada.');
    const id = youtubeId(value);
    const child = this.run(['--retries', '3', '--retry-sleep', 'http:1', '--http-chunk-size', '1M', '-f', 'bestaudio[protocol=https]/best[protocol=https]', '--match-filters', '!is_live & duration <= 1800 & age_limit < 18', '-o', '-', '--', `https://www.youtube.com/watch?v=${id}`]);
    // stdout may reach EOF before exit(1). Wait for the exit status before ending
    // the public stream, otherwise FFmpeg receives an apparently successful EOF.
    const stream = new PassThrough();
    child.stdout.pipe(stream, { end: false });
    child.stdout.on('error', () => stream.destroy(workflowError(502, 'No se pudo leer el flujo de audio de YouTube.')));
    let exited = false;
    const stop = () => { if (!exited) child.kill(); stream.destroy(); };
    signal.addEventListener('abort', stop, { once: true });
    stream.once('close', () => {
      // A normal stdout EOF can precede child exit: don't kill a successful extractor.
      if (!stream.readableEnded && !exited) child.kill();
      signal.removeEventListener('abort', stop);
    });
    // Attach before waiting for the first chunk; no external stderr is exposed.
    child.on('error', () => stream.destroy(workflowError(503, 'No se pudo iniciar el extractor de audio.')));
    child.on('close', code => {
      exited = true;
      const diagnostic: { reason?: string; status?: number } = code !== 0 && !signal.aborted ? youtubeFailure(this.diagnostics.get(child)?.tail ?? '') : {};
      this.diagnostics.delete(child);
      logRecord('youtube.audio.exit', { service: 'yt-dlp', exitCode: code, ...diagnostic, outcome: signal.aborted ? 'cancelled' : code === 0 ? 'completed' : 'failed' });
      if (signal.aborted) stream.destroy();
      else if (code !== 0) stream.destroy(workflowError(502, failureMessage(diagnostic.reason ?? 'extractor-error')));
      else stream.end();
    });
    await new Promise<void>((resolve, reject) => {
      let done = false;
      const finish = (error?: Error) => {
        if (done) return; done = true; clearTimeout(timer);
        stream.off('readable', readable); stream.off('error', failed); stream.off('end', ended); stream.off('close', ended);
        if (error) { stop(); reject(error); } else resolve();
      };
      const readable = () => { if (stream.readableLength > 0) finish(); };
      const failed = () => finish(workflowError(502, 'No se pudo obtener audio de YouTube. Prueba otra fuente.'));
      const ended = () => finish(workflowError(502, 'El extractor terminó sin entregar audio.'));
      const timer = setTimeout(() => finish(workflowError(502, 'Se agotó el tiempo de espera del audio de YouTube.')), 30_000); timer.unref();
      stream.once('error', failed); stream.once('end', ended); stream.once('close', ended); stream.on('readable', readable); readable();
    });
    // Keep a guard until the transport attaches pipeline error handling.
    stream.on('error', () => {});
    logRecord('youtube.audio.ready', { service: 'yt-dlp' });
    return stream;
  }
}
export function configuredYouTube(): YouTubeExtractor | null {
  if (process.env.YOUTUBE_EXPERIMENTAL !== 'true') return null;
  const executable = process.env.YTDLP_PATH || resolve(process.cwd(), '.tools', process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
  if (!existsSync(executable)) throw workflowError(503, 'Instala yt-dlp y configura YTDLP_PATH antes de habilitar YouTube.');
  return new YouTubeExtractor(executable);
}
