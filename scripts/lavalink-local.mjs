import { mkdir, readFile, writeFile, access, rename } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { parseEnv } from 'node:util';
import { createRequire } from 'node:module';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const directory = resolve(root, '.tools/lavalink');
const envFile = resolve(root, '.env.lavalink');
const headers = { 'User-Agent': 'Magelina-local-Lavalink-setup' };
// Official upstream snapshot, pinned with its published SHA-256 for reproducibility.
const versions = { lavalink: '4.2.2', youtube: '02f536d9ac05b4bb0f91dedc19f964f30fc18559' };
const youtubeSha256 = '693087b71b4acc78fdc2110b9f4ba39ce0ef61aeaeb34c2cd71820239a8d36e8';
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
    download(`https://maven.lavalink.dev/snapshots/dev/lavalink/youtube/youtube-plugin/${versions.youtube}/youtube-plugin-${versions.youtube}.jar`, resolve(directory, 'plugins/youtube-plugin.jar'), youtubeSha256),
  ]);
  const previousPlugin = resolve(directory, 'plugins/youtube-plugin-1.18.2.jar');
  if (await exists(previousPlugin)) {
    await mkdir(resolve(directory, 'plugin-backups'), { recursive: true });
    await rename(previousPlugin, resolve(directory, 'plugin-backups/youtube-plugin-1.18.2.jar'));
  }
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
    clients: [WEB, MWEB, ANDROID_VR, TVHTML5_SIMPLY, WEBEMBEDDED]
${env.CIPHER_TOKEN ? `    remoteCipher:\n      url: "http://127.0.0.1:8001"\n      password: "${env.CIPHER_TOKEN}"\n` : ''}
${env.POT_TOKEN ? `    remotePot:\n      url: "http://127.0.0.1:8002"\n      pass: "${env.POT_TOKEN}"\n` : ''}
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
  if (env.POT_TOKEN && await exists(resolve(directory, 'youtube-source-po/.git'))) {
    await prepareProbe();
    execFileSync(process.execPath, [resolve(root, 'scripts/build-youtube-po.mjs')], { cwd: root, windowsHide: true, stdio: 'inherit' });
  }
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
async function startPot() {
  const env = await environment();
  if (!env.POT_TOKEN) throw new Error('Prepara primero el generador PO.');
  const child = spawn(process.execPath, ['server.js'], {
    cwd: resolve(directory, 'webpo-generator'), windowsHide: true, stdio: 'inherit',
    env: { ...process.env, HOST: '127.0.0.1', PORT: '8002', API_TOKEN: env.POT_TOKEN, WORKERS: '1', CACHE_SIZE: '100', QUEUE_SIZE: '8', MAX_PENDING_REQUESTS: '16' },
  });
  process.once('SIGINT', () => child.kill()); process.once('SIGTERM', () => child.kill());
  child.once('error', () => { console.error('No se pudo iniciar el generador PO local.'); process.exitCode = 1; });
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
async function prepareProbe() {
  const compiler = resolve(directory, 'ecj-3.40.0.jar');
  const checksum = '5c26f6a20278196f8038a284d885c3796cd7d422';
  if (!await exists(compiler) || createHash('sha1').update(await readFile(compiler)).digest('hex') !== checksum) {
    const response = await fetch('https://repo.maven.apache.org/maven2/org/eclipse/jdt/ecj/3.40.0/ecj-3.40.0.jar', { signal: AbortSignal.timeout(60_000) });
    if (!response.ok) throw new Error('No se pudo descargar el compilador oficial de Eclipse.');
    const bytes = Buffer.from(await response.arrayBuffer());
    if (createHash('sha1').update(bytes).digest('hex') !== checksum) throw new Error('Checksum del compilador incorrecto.');
    await writeFile(compiler, bytes);
  }
  const libs = resolve(directory, 'probe-libs'), classes = resolve(directory, 'probe-classes');
  await mkdir(libs, { recursive: true }); await mkdir(classes, { recursive: true });
  const quote = value => `'${value.replaceAll("'", "''")}'`;
  execFileSync('powershell.exe', ['-NoProfile', '-Command', `$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$probeArchive=[System.IO.Compression.ZipFile]::OpenRead(${quote(resolve(directory, 'Lavalink.jar'))})
try { foreach ($probeEntry in $probeArchive.Entries) { if ($probeEntry.FullName -match '^BOOT-INF/lib/[^/]+[.]jar$') { [System.IO.Compression.ZipFileExtensions]::ExtractToFile($probeEntry, (Join-Path ${quote(libs)} $probeEntry.Name), $true) } } } finally { $probeArchive.Dispose() }`], { windowsHide: true });
  const runtime = JSON.parse(await readFile(resolve(directory, 'runtime.json'), 'utf8'));
  // Java wildcard classpaths are expanded by the launcher, not by ECJ.
  const { readdir } = await import('node:fs/promises');
  const classpath = [...(await readdir(libs)).filter(name => name.endsWith('.jar')).map(name => resolve(libs, name)), resolve(directory, 'plugins/youtube-plugin.jar')].join(';');
  return { runtime, compiler, classes, classpath };
}
async function preparePot() {
  await prepareCipher();
  for (const [repo, folder, revision] of [
    ['ashton045/webpo-generator', 'webpo-generator', '682ac9fbfb64948a8b518551011138486c560207'],
    ['ashton045/youtube-source', 'youtube-source-po', '1ddb648257d5b547aa1e2dfb8104edf6cb1089be'],
  ]) {
    const target = resolve(directory, folder);
    if (!await exists(resolve(target, '.git'))) execFileSync('git', ['clone', '--no-checkout', `https://github.com/${repo}.git`, target], { windowsHide: true, stdio: 'ignore' });
    execFileSync('git', ['fetch', '--depth', '1', 'origin', revision], { cwd: target, windowsHide: true, stdio: 'ignore' });
    execFileSync('git', ['checkout', '--detach', revision], { cwd: target, windowsHide: true, stdio: 'ignore' });
  }
  execFileSync('powershell.exe', ['-NoProfile', '-Command', 'npm ci --omit=dev --no-audit --no-fund; exit $LASTEXITCODE'], { cwd: resolve(directory, 'webpo-generator'), windowsHide: true, stdio: 'inherit' });
  const env = await environment();
  if (!env.POT_TOKEN) await writeFile(envFile, `${await readFile(envFile, 'utf8')}POT_TOKEN=${randomBytes(32).toString('hex')}\n`, { mode: 0o600 });
  await prepare();
  console.log('Generador PO local y plugin experimental del PR #229 preparados con revisiones fijas.');
}
async function probeFrames() {
  const input = process.argv[3], seconds = Number(process.argv[4] ?? 10);
  if (!/^[\w-]{11}$/.test(input ?? '') || !Number.isInteger(seconds) || seconds < 1 || seconds > 240) throw new Error('Usa probe-frames VIDEO_ID SEGUNDOS (1 a 240).');
  const { runtime, compiler, classes, classpath } = await prepareProbe();
  execFileSync(runtime.java, ['-jar', compiler, '-21', '-cp', classpath, '-d', classes, resolve(root, 'scripts/probes/AudioProbe.java')], { windowsHide: true, stdio: 'pipe' });
  const env = await environment();
  const child = spawn(runtime.java, ['-Xmx256m', '-cp', `${classes};${classpath}`, 'AudioProbe', input, String(seconds)], {
    windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'], env: { ...process.env, CIPHER_TOKEN: env.CIPHER_TOKEN, POT_TOKEN: env.POT_TOKEN },
  });
  let pending = '', ok = false;
  child.stdout.on('data', bytes => {
    pending += bytes.toString();
    const lines = pending.split(/\r?\n/); pending = lines.pop();
    for (const line of lines) if (line.startsWith('MAGELINA_PROBE:')) {
      const result = JSON.parse(line.slice('MAGELINA_PROBE:'.length));
      console.log(JSON.stringify(result)); if (result.status === 'ok') ok = true;
    }
  });
  const timeout = setTimeout(() => child.kill(), 130_000);
  try { await new Promise((resolve, reject) => { child.once('exit', resolve); child.once('error', reject); }); }
  finally { clearTimeout(timeout); }
  if (!ok) process.exitCode = 1;
}
try {
  if (['prepare', 'prepare-cipher', 'prepare-pot'].includes(action)) {
    const owner = Number(await readFile(resolve(root, '.cache/host-pc.lock'), 'utf8').catch(() => '0'));
    if (Number.isSafeInteger(owner) && owner > 0) {
      let running = true;
      try { process.kill(owner, 0); } catch (error) { if (error.code === 'ESRCH') running = false; }
      if (running) throw new Error('Deten primero el host con npm run host:stop antes de reemplazar el plugin.');
    }
  }
  if (action === 'prepare') await prepare();
  else if (action === 'prepare-cipher') await prepareCipher();
  else if (action === 'prepare-pot') await preparePot();
  else if (action === 'start-cipher') await startCipher();
  else if (action === 'start-pot') await startPot();
  else if (action === 'start') await start();
  else if (action === 'probe-frames' || action === 'probe-audio') await probeFrames();
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
  } else throw new Error('Usa prepare, prepare-pot, start, check, probe VIDEO_ID o probe-frames VIDEO_ID SEGUNDOS.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
