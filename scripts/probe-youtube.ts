import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { pipeline } from 'node:stream/promises';
import { YouTubeExtractor } from '../src/modules/music/youtube.js';

const searchMode = process.argv[2] === '--search';
const input = process.argv[searchMode ? 3 : 2];
const secondsIndex = process.argv.indexOf('--seconds');
const sampleSeconds = secondsIndex >= 0 ? Number(process.argv[secondsIndex + 1]) : 0.5;
if (!Number.isFinite(sampleSeconds) || sampleSeconds < 0.5 || sampleSeconds > 180) throw new Error('--seconds debe estar entre 0.5 y 180.');
const realtime = process.argv.includes('--realtime');
if (!input) throw new Error('Indica el enlace de un video propio o autorizado: npm run probe:youtube -- URL');
const extractor = new YouTubeExtractor(process.env.YTDLP_PATH || resolve('.tools', process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp'));
const controller = new AbortController();
const deadline = setTimeout(() => controller.abort(), 65_000 + (realtime ? sampleSeconds * 1000 : 0));
let stage = 'metadata';
try {
  if (searchMode) {
    stage = 'search';
    const tracks = await extractor.search(input);
    console.info(JSON.stringify({ stage, result: 'ok', count: tracks.length, thumbnailCount: tracks.filter(track => track.artworkUrl).length, sample: tracks[0] ? { id: tracks[0].id, title: tracks[0].title, durationSeconds: tracks[0].durationSeconds } : null, discordConnected: false }));
  } else {
  const track = await extractor.track(input);
  console.info(JSON.stringify({ stage, result: 'ok', durationSeconds: track.durationSeconds }));
  stage = 'audio';
  const audio = await extractor.open(track.id, controller.signal);
  const executable: unknown = createRequire(import.meta.url)('ffmpeg-static');
  if (typeof executable !== 'string') throw new Error('FFmpeg no disponible.');
  const child = spawn(executable, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-protocol_whitelist', 'pipe', ...(realtime ? ['-re'] : []), '-i', 'pipe:0', '-vn', '-t', String(sampleSeconds), '-f', 's16le', '-ar', '48000', '-ac', '2', 'pipe:1'], { windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
  const abort = () => { child.kill(); audio.destroy(); };
  controller.signal.addEventListener('abort', abort, { once: true });
  child.stderr.resume();
  let bytes = 0; child.stdout.on('data', (chunk: Buffer) => { bytes += chunk.length; });
  const closed = new Promise<number | null>((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
  const piped = pipeline(audio, child.stdin).catch(() => {});
  try {
    const code = await closed;
    if (code !== 0 || bytes < sampleSeconds * 192_000 * 0.98) throw new Error('No se confirmó la decodificación de audio.');
    console.info(JSON.stringify({ stage, result: 'ok', pcmBytes: bytes, sampleSeconds, realtime, discordConnected: false, filesSaved: false }));
  } finally { controller.abort(); await piped; controller.signal.removeEventListener('abort', abort); }
  }
} catch (error) {
  console.error(JSON.stringify({ stage, result: 'failed', message: error instanceof Error && 'publicMessage' in error ? error.publicMessage : 'La prueba no pudo completarse. Revisa el extractor y la conectividad.' }));
  process.exitCode = 1;
} finally { controller.abort(); clearTimeout(deadline); }
