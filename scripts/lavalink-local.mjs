import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { parseEnv } from 'node:util';
import { createRequire } from 'node:module';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const directory = resolve(root, '.tools/lavalink');
const envFile = resolve(root, '.env.lavalink');
const headers = { 'User-Agent': 'Magelina-local-Lavalink-setup' };
const versions = { lavalink: '4.2.2', youtube: '1.18.2' };
const action = process.argv[2];
const exists = path => access(path).then(() => true, () => false);

async function json(url) {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`No se pudo consultar el proveedor oficial (HTTP ${response.status}).`);
  return response.json();
}
async function download(url, target, checksum) {
  if (!/^[a-f\d]{64}$/i.test(checksum ?? '')) throw new Error('La descarga oficial no incluye SHA-256; no se instalara.');
  if (await exists(target)) {
    const hash = createHash('sha256').update(await readFile(target)).digest('hex');
    if (hash === checksum.toLowerCase()) return;
  }
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(240_000) });
  if (!response.ok) throw new Error(`No se pudo descargar el binario (HTTP ${response.status}).`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (createHash('sha256').update(bytes).digest('hex') !== checksum.toLowerCase()) throw new Error('La descarga no coincide con su SHA-256 oficial.');
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, bytes);
}
async function releaseAsset(repo, version, pattern, target) {
  const release = await json(`https://api.github.com/repos/${repo}/releases/tags/${version}`);
  const asset = release.assets.find(asset => pattern.test(asset.name));
  if (!asset) throw new Error(`Falta el binario oficial de ${repo} ${version}.`);
  await download(asset.browser_download_url, target, asset.digest?.replace(/^sha256:/, ''));
}
async function environment() {
  return parseEnv(await readFile(envFile, 'utf8'));
}
async function request(path, timeout = 30_000) {
  const env = await environment();
  return fetch(`http://127.0.0.1:2333${path}`, { headers: { Authorization: env.LAVALINK_PASSWORD }, signal: AbortSignal.timeout(timeout) });
}
async function prepare() {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Este instalador local portable requiere Windows x64.');
  await mkdir(directory, { recursive: true });
  const packages = await json('https://api.adoptium.net/v3/assets/latest/21/hotspot?architecture=x64&image_type=jre&os=windows&vendor=eclipse');
  const runtime = packages[0];
  if (!runtime?.binary?.package) throw new Error('No se encontro Java 21 portable oficial.');
  const archive = resolve(directory, 'java21.zip');
  await Promise.all([
    download(runtime.binary.package.link, archive, runtime.binary.package.checksum),
    releaseAsset('lavalink-devs/Lavalink', versions.lavalink, /^Lavalink\.jar$/, resolve(directory, 'Lavalink.jar')),
    releaseAsset('lavalink-devs/youtube-source', versions.youtube, /^youtube-plugin-1\.18\.2\.jar$/, resolve(directory, `plugins/youtube-plugin-${versions.youtube}.jar`)),
  ]);
  const runtimeRoot = resolve(directory, 'runtime');
  const java = resolve(runtimeRoot, `${runtime.release_name}-jre`, 'bin/java.exe');
  // Expand only into the fixed project-local runtime directory; leave system Java untouched.
  const quote = value => `'${value.replaceAll("'", "''")}'`;
  if (!await exists(java)) execFileSync('powershell.exe', ['-NoProfile', '-Command', `$ErrorActionPreference='Stop'\nExpand-Archive -LiteralPath ${quote(archive)} -DestinationPath ${quote(runtimeRoot)} -Force`], { windowsHide: true });
  await access(java);
  if (!await exists(envFile)) await writeFile(envFile, `LAVALINK_PASSWORD=${randomBytes(32).toString('hex')}\n`, { flag: 'wx', mode: 0o600 });
  const env = await environment();
  if (!/^[a-f\d]{64}$/.test(env.LAVALINK_PASSWORD ?? '')) throw new Error('La clave local de Lavalink no es valida.');
  const config = `server:
  address: 127.0.0.1
  port: 2333
lavalink:
  server:
    password: "${env.LAVALINK_PASSWORD}"
    sources:
      youtube: false
      http: true
      local: false
    frameBufferDurationMs: 5000
    youtubePlaylistLoadLimit: 1
    playerUpdateInterval: 1
plugins:
  youtube:
    enabled: true
    allowSearch: true
    clients: [MUSIC, ANDROID_VR, TVHTML5_SIMPLY, MWEB, WEB, WEBEMBEDDED]
${env.CIPHER_TOKEN ? `    remoteCipher:\n      url: "http://127.0.0.1:8001"\n      password: "${env.CIPHER_TOKEN}"\n` : ''}
logging:
  request:
    enabled: false
  level:
    root: INFO
    lavalink: INFO
    dev.lavalink.youtube.http.YoutubeAccessTokenTracker: WARN
    dev.lavalink.youtube.clients.skeleton.StreamingNonMusicClient: ERROR
`;
  await writeFile(resolve(directory, 'application.yml'), config, { mode: 0o600 });
  await writeFile(resolve(directory, 'runtime.json'), JSON.stringify({ java, versions, javaRelease: runtime.release_name }));
  console.log(`Lavalink ${versions.lavalink}, YouTube ${versions.youtube} y Java 21 portable instalados y verificados. Solo escucha en 127.0.0.1:2333.`);
}
async function prepareCipher() {
  const release = await json('https://api.github.com/repos/denoland/deno/releases/latest');
  const archive = resolve(directory, 'deno.zip');
  await releaseAsset('denoland/deno', release.tag_name, /^deno-x86_64-pc-windows-msvc\.zip$/, archive);
  const quote = value => `'${value.replaceAll("'", "''")}'`;
  if (!await exists(resolve(directory, 'deno/deno.exe'))) execFileSync('powershell.exe', ['-NoProfile', '-Command', `$ErrorActionPreference='Stop'\nExpand-Archive -LiteralPath ${quote(archive)} -DestinationPath ${quote(resolve(directory, 'deno'))} -Force`], { windowsHide: true });
  const source = resolve(directory, 'yt-cipher');
  if (!await exists(resolve(source, '.git'))) execFileSync('git', ['clone', '--depth', '1', 'https://github.com/kikkia/yt-cipher.git', source], { windowsHide: true, stdio: 'ignore' });
  const ejs = resolve(source, 'ejs');
  if (!await exists(resolve(ejs, '.git'))) execFileSync('git', ['clone', 'https://github.com/yt-dlp/ejs.git', ejs], { windowsHide: true, stdio: 'ignore' });
  execFileSync('git', ['checkout', 'cd4e87f52e87ab6d8b318fd3a817adda6fafa8dc'], { cwd: ejs, windowsHide: true, stdio: 'ignore' });
  const deno = resolve(directory, 'deno/deno.exe');
  execFileSync(deno, ['run', '--no-config', `--lock=${resolve(source, 'deno.lock')}`, '--node-modules-dir=none', '--allow-read', '--allow-write', './scripts/patch-ejs.ts'], {
    cwd: source, windowsHide: true, stdio: 'ignore', env: { ...process.env, DENO_DIR: resolve(directory, 'deno-cache') },
  });
  const env = await environment();
  if (!env.CIPHER_TOKEN) await writeFile(envFile, `${await readFile(envFile, 'utf8')}CIPHER_TOKEN=${randomBytes(32).toString('hex')}\n`, { mode: 0o600 });
  console.log('Servicio de firmas preparado localmente; Deno portable y fuentes oficiales.');
  await prepare();
}
async function startCipher() {
  const env = await environment();
  if (!env.CIPHER_TOKEN) throw new Error('Ejecuta primero prepare-cipher.');
  const child = spawn(resolve(directory, 'deno/deno.exe'), ['run', '--no-config', `--lock=${resolve(directory, 'yt-cipher/deno.lock')}`, '--node-modules-dir=none', '--allow-net', '--allow-read', '--allow-write', '--allow-env', 'server.ts'], {
    cwd: resolve(directory, 'yt-cipher'), windowsHide: true, stdio: 'inherit',
    env: { ...process.env, DENO_DIR: resolve(directory, 'deno-cache'), XDG_CACHE_HOME: resolve(directory, 'cipher-cache'), HOST: '127.0.0.1', PORT: '8001', API_TOKEN: env.CIPHER_TOKEN, MAX_THREADS: '2', OVERRIDE_PLAYER_VARIANT: 'IAS' },
  });
  process.once('SIGINT', () => { if (child.exitCode === null) child.kill(); });
  process.once('SIGTERM', () => { if (child.exitCode === null) child.kill(); });
  child.once('error', () => { console.error('No se pudo iniciar el servicio local de firmas.'); process.exitCode = 1; });
  child.once('exit', code => { process.exitCode = code ?? 1; });
}
async function start() {
  const runtime = JSON.parse(await readFile(resolve(directory, 'runtime.json'), 'utf8'));
  console.log('Iniciando Lavalink local; Ctrl+C detiene este proceso.');
  const child = spawn(runtime.java, ['-Xms128m', '-Xmx512m', '-jar', 'Lavalink.jar', '--logging.level.root=INFO'], { cwd: directory, windowsHide: true, stdio: 'inherit' });
  process.once('SIGINT', () => { if (child.exitCode === null) child.kill(); });
  process.once('SIGTERM', () => { if (child.exitCode === null) child.kill(); });
  child.once('error', () => { console.error('No se pudo iniciar Java portable.'); process.exitCode = 1; });
  child.once('exit', code => { process.exitCode = code ?? 1; });
}
try {
  if (action === 'prepare') await prepare();
  else if (action === 'prepare-cipher') await prepareCipher();
  else if (action === 'start-cipher') await startCipher();
  else if (action === 'start') await start();
  else if (action === 'check') {
    const response = await request('/v4/info');
    if (!response.ok) throw new Error(`Lavalink no esta listo (HTTP ${response.status}).`);
    const info = await response.json();
    console.log(JSON.stringify({ version: info.version.semver, sources: info.sourceManagers, plugins: info.plugins }));
  } else if (action === 'probe') {
    const input = process.argv[3];
    // Accept individual YouTube IDs only; never arbitrary HTTP input.
    if (!/^[\w-]{11}$/.test(input ?? '')) throw new Error('Indica el ID de un video para la prueba.');
    const began = performance.now();
    const response = await request(`/v4/loadtracks?identifier=${encodeURIComponent(`https://www.youtube.com/watch?v=${input}`)}`);
    if (!response.ok) throw new Error(`Lavalink rechazo la prueba (HTTP ${response.status}).`);
    const result = await response.json();
    console.log(JSON.stringify({ loadType: result.loadType, durationMs: Math.round(performance.now() - began), title: result.loadType === 'track' ? result.data.info.title : undefined, reason: result.loadType === 'error' ? 'youtube-load-failed' : undefined }));
    if (result.loadType !== 'track') process.exitCode = 1;
  } else if (action === 'probe-player') {
    const input = process.argv[3];
    if (!/^[\w-]{11}$/.test(input ?? '')) throw new Error('Indica el ID de un video para la prueba.');
    const env = await environment();
    const WebSocket = createRequire(import.meta.url)('ws');
    const socket = new WebSocket('ws://127.0.0.1:2333/v4/websocket', { headers: { Authorization: env.LAVALINK_PASSWORD, 'User-Id': '111111111111111111', 'Client-Name': 'Magelina-AudioProbe/1.0' } });
    let session;
    const events = [];
    const timer = setTimeout(() => socket.close(), 20_000);
    const closed = new Promise((resolve, reject) => { socket.once('close', resolve); socket.once('error', reject); });
    socket.on('message', async bytes => {
      try {
        const data = JSON.parse(bytes.toString());
        if (data.op === 'ready') {
          session = data.sessionId;
          const response = await fetch(`http://127.0.0.1:2333/v4/sessions/${session}/players/111111111111111112`, {
            method: 'PATCH', headers: { Authorization: env.LAVALINK_PASSWORD, 'Content-Type': 'application/json' },
            body: JSON.stringify({ track: { identifier: `https://www.youtube.com/watch?v=${input}` } }), signal: AbortSignal.timeout(15000),
          });
          if (!response.ok) { events.push({ type: 'patch-failed', status: response.status }); socket.close(); }
        } else if (data.op === 'event') {
          events.push({ type: data.type, reason: data.reason, message: data.exception?.message?.replace(/https?:\/\/\S+/g, '[url]').slice(0, 350) });
          if (data.type === 'TrackExceptionEvent' || data.type === 'TrackEndEvent') socket.close();
        }
      } catch { events.push({ type: 'probe-error' }); socket.close(); }
    });
    try { await closed; console.log(JSON.stringify({ events, discordConnected: false })); }
    finally { clearTimeout(timer); socket.terminate(); }
  } else if (action === 'probe-audio') {
    const input = process.argv[3], seconds = Number(process.argv[4] ?? 10);
    if (!/^[\w-]{11}$/.test(input ?? '') || !Number.isInteger(seconds) || seconds < 1 || seconds > 240) throw new Error('Usa probe-audio VIDEO_ID SEGUNDOS (1 a 240).');
    const began = performance.now();
    const response = await request(`/youtube/stream/${input}`, (seconds + 60) * 1000);
    if (!response.ok || !response.body) throw new Error(`El nodo no pudo extraer audio de YouTube (HTTP ${response.status}).`);
    const firstByteMs = Math.round(performance.now() - began);
    const ffmpeg = createRequire(import.meta.url)('ffmpeg-static');
    const child = spawn(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-re', '-i', 'pipe:0', '-t', String(seconds), '-vn', '-f', 's16le', '-ar', '48000', '-ac', '2', 'pipe:1'], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
    let bytes = 0;
    child.stdout.on('data', chunk => { bytes += chunk.length; });
    const audio = Readable.fromWeb(response.body);
    const done = new Promise((resolve, reject) => { child.once('close', resolve); child.once('error', reject); });
    const piped = pipeline(audio, child.stdin).catch(() => {});
    const timer = setTimeout(() => { audio.destroy(); child.kill(); }, (seconds + 30) * 1000);
    try {
      const code = await done;
      if (code !== 0 || bytes < seconds * 192_000 * 0.98) throw new Error('No se confirmo la decodificacion continua del audio.');
      console.log(JSON.stringify({ result: 'ok', seconds, firstByteMs, decodedBytes: bytes, realtime: true, discordConnected: false }));
    } finally { clearTimeout(timer); audio.destroy(); child.kill(); await piped; }
  } else throw new Error('Usa prepare, start, check, probe VIDEO_ID o probe-audio VIDEO_ID SEGUNDOS.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
