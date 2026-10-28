import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { execFileSync, spawn } from 'node:child_process';
import os from 'node:os';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = resolve(root, '.env.pc');
const tailscale = resolve(process.env.ProgramFiles || 'C:/Program Files', 'Tailscale/tailscale.exe');
const command = process.argv[2];
const stopFile = resolve(root, '.cache/host-pc.stop');
const lock = resolve(root, '.cache/host-pc.lock');

async function clearStaleLock() {
  let owner;
  try { owner = await readFile(lock, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return true; throw error; }
  const pid = Number(owner);
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('El bloqueo del host no contiene un PID valido. Revisa el proceso antes de retirar .cache/host-pc.lock.');
  try { process.kill(pid, 0); return false; }
  catch (error) { if (error.code !== 'ESRCH') throw error; }
  // No retirar un bloqueo que haya sido sustituido mientras se comprobaba el PID.
  if (await readFile(lock, 'utf8').catch(error => { if (error.code === 'ENOENT') return null; throw error; }) !== owner) return false;
  await unlink(lock).catch(error => { if (error.code !== 'ENOENT') throw error; });
  console.log('Se retiro el bloqueo de un host que ya no esta en ejecucion.');
  return true;
}

async function prepare() {
  if (existsSync(envPath)) { console.log('.env.pc ya existe; se conserva su configuracion.'); return; }
  const original = await readFile(resolve(root, '.env'), 'utf8');
  const settings = [
    '# Perfil de alojamiento en PC. No subir este archivo al repositorio.',
    'NODE_ENV=production', 'PORT=3000', 'BIND_HOST=127.0.0.1', 'TRUST_PROXY=true',
    'DASHBOARD_ORIGIN=https://magelina-five.vercel.app',
    'DISCORD_REDIRECT_URI=https://magelina-five.vercel.app/api/auth/discord/callback',
    'YOUTUBE_EXPERIMENTAL=true', 'YTDLP_PATH=.tools/yt-dlp.exe',
  ];
  await writeFile(envPath, `${original}\n\n${settings.join('\n')}\n`, { flag: 'wx', mode: 0o600 });
  console.log('Perfil .env.pc creado a partir de .env, sin modificar el perfil de desarrollo.');
}

async function check(requireTunnel = true) {
  const env = parseEnv(await readFile(envPath, 'utf8'));
  const { readConfig } = await import('../dist/config/env.js');
  const config = readConfig(env);
  if (!config.production || !config.trustProxy || config.bindHost !== '127.0.0.1' || config.port !== 3000 ||
      config.dashboardOrigin !== 'https://magelina-five.vercel.app' ||
      config.discordRedirectUri !== 'https://magelina-five.vercel.app/api/auth/discord/callback') {
    throw new Error('El perfil de PC debe usar produccion, proxy, 127.0.0.1:3000 y las URLs de Vercel indicadas en HOSTING-PC.md.');
  }
  const extractor = resolve(root, env.YTDLP_PATH || '.tools/yt-dlp.exe');
  if (env.YOUTUBE_EXPERIMENTAL === 'true') {
    execFileSync(extractor, ['--version'], { cwd: root, windowsHide: true, stdio: 'ignore', timeout: 15000 });
  }
  const { default: ffmpeg } = await import('ffmpeg-static');
  if (!ffmpeg) throw new Error('FFmpeg no esta instalado. Ejecuta npm install.');
  execFileSync(ffmpeg, ['-version'], { windowsHide: true, stdio: 'ignore', timeout: 15000 });
  console.log('Configuracion, Node, FFmpeg y extractor: correctos. No se inicio sesion en Discord.');
  console.log(`RAM libre ahora: ${(os.freemem() / 2 ** 30).toFixed(1)} GiB. Heap maximo al arrancar: 512 MiB (no limita el consumo total).`);
  if (requireTunnel) {
    if (!existsSync(tailscale)) throw new Error('Falta Tailscale. Instala la version oficial e inicia sesion; consulta HOSTING-PC.md.');
    let status;
    try { status = JSON.parse(execFileSync(tailscale, ['status', '--json'], { windowsHide: true, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 15000 })); }
    catch { throw new Error('No se pudo consultar Tailscale. Abre la aplicacion e inicia sesion.'); }
    if (status.BackendState !== 'Running' || !status.Self?.DNSName) throw new Error('Tailscale aun no esta conectado. Inicia sesion desde la aplicacion.');
    console.log(`Direccion del equipo: https://${status.Self.DNSName.replace(/\.$/, '')}`);
    console.log('La direccion solo sera publica despues de habilitar Funnel y verificarla.');
  }
  return env;
}

async function start() {
  if (!process.argv.includes('--render-stopped')) throw new Error('Primero suspende el servicio de Render. Luego ejecuta npm run host:pc -- -RenderStopped.');
  const env = await check();
  await mkdir(dirname(lock), { recursive: true });
  await clearStaleLock();
  try { await writeFile(lock, String(process.pid), { flag: 'wx' }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; throw new Error('El host sigue en ejecucion. Ejecuta npm run host:stop y espera a que confirme el cierre.'); }
  let child;
  let stopTimer;
  // Windows entrega Ctrl+C tambien al hijo que hereda esta consola.
  const interrupt = () => { if (process.platform !== 'win32' && child?.exitCode === null) child.kill('SIGINT'); };
  const terminate = () => { if (child?.exitCode === null) child.kill('SIGTERM'); };
  try {
    await unlink(stopFile).catch(() => {});
    await new Promise((accept, reject) => {
      const probe = createServer();
      probe.once('error', () => reject(new Error('El puerto 3000 esta ocupado o no permite abrirse. Deten el backend local anterior antes de arrancar otra instancia.')));
      probe.listen(3000, '127.0.0.1', () => probe.close(accept));
    });
    console.log('Iniciando Magelina en 127.0.0.1:3000. Para detener: Ctrl+C.');
    child = spawn(process.execPath, ['--max-old-space-size=512', 'dist/index.js'], {
      cwd: root, env: { ...process.env, ...env, HOST_PC_CONTROL: 'true' }, stdio: ['pipe', 'inherit', 'inherit'], windowsHide: true,
    });
    child.stdin.on('error', () => {});
    stopTimer = setInterval(() => {
      if (existsSync(stopFile) && !child.stdin.destroyed) { child.stdin.end('shutdown\n'); clearInterval(stopTimer); }
    }, 500);
    process.once('SIGINT', interrupt); process.once('SIGTERM', terminate);
    process.exitCode = await new Promise((accept, reject) => { child.once('error', reject); child.once('exit', code => accept(code ?? 1)); });
  } finally {
    clearInterval(stopTimer);
    process.off('SIGINT', interrupt); process.off('SIGTERM', terminate);
    await unlink(lock).catch(() => {});
    await unlink(stopFile).catch(() => {});
  }
}

async function stopHost() {
  if (await clearStaleLock()) { console.log('No hay un host iniciado con este lanzador.'); return; }
  await writeFile(stopFile, 'shutdown\n');
  console.log('Cierre solicitado. El host desconectara el bot y cerrara la base de datos.');
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    await delay(250);
    if (await clearStaleLock()) {
      console.log('Host detenido. Ya puedes volver a iniciarlo.');
      return;
    }
  }
  throw new Error('El host no confirmo el cierre en 15 segundos. Revisa su terminal y los registros; no se forzo su finalizacion.');
}

try {
  if (command === 'prepare') await prepare();
  else if (command === 'check') await check(!process.argv.includes('--without-tunnel'));
  else if (command === 'start') await start();
  else if (command === 'stop') await stopHost();
  else throw new Error('Usa prepare, check, start o stop.');
} catch (error) {
  // Nunca imprimir errores de procesos externos o valores de las credenciales.
  console.error(error?.code ? `No se pudo completar ${command}: ${error.code}. Revisa HOSTING-PC.md.` : error.message);
  process.exitCode = 1;
}
