import { readFile, mkdir, open } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const directory = resolve(root, '.tools/lavalink');

// Own only the children started here; externally started nodes remain independent.
export async function startLocalLavalink() {
  const env = parseEnv(await readFile(resolve(root, '.env.lavalink'), 'utf8'));
  const runtime = JSON.parse(await readFile(resolve(directory, 'runtime.json'), 'utf8'));
  const owned = [];
  let closing = false;
  async function close() {
    closing = true;
    await Promise.all(owned.map(async child => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      const exited = new Promise(resolve => child.once('exit', resolve));
      child.kill();
      await Promise.race([exited, delay(2000)]);
    }));
  }
  async function ready(url, auth) {
    try {
      const response = await fetch(url, { headers: { Authorization: auth }, signal: AbortSignal.timeout(5000) });
      await response.body?.cancel();
      return response.ok;
    }
    catch { return false; }
  }
  async function service(name, executable, args, cwd, variables, url, auth) {
    if (await ready(url, auth)) return;
    await mkdir(resolve(root, '.cache'), { recursive: true });
    const log = await open(resolve(root, `.cache/${name}.log`), 'a');
    const child = spawn(executable, args, { cwd, windowsHide: true, stdio: ['ignore', log.fd, log.fd], env: { ...process.env, ...variables } });
    owned.push(child);
    let failed = false;
    child.once('error', () => { failed = true; });
    child.once('exit', () => { if (!closing) console.error(`Servicio local ${name} detenido; revisa .cache/${name}.log.`); });
    await log.close();
    // Cold Java startup on this PC can exceed 35 s under memory pressure.
    const deadline = Date.now() + (name === 'lavalink-node' ? 90_000 : 45_000);
    while (Date.now() < deadline) {
      if (failed || child.exitCode !== null || child.signalCode !== null) throw new Error(`No se pudo iniciar ${name}. Revisa su registro local.`);
      if (await ready(url, auth)) return;
      await delay(250);
    }
    throw new Error(`${name} no quedo listo a tiempo.`);
  }
  try {
    if (env.CIPHER_TOKEN) await service('lavalink-cipher', resolve(directory, 'deno/deno.exe'), ['run', '--no-config', `--lock=${resolve(directory, 'yt-cipher/deno.lock')}`, '--node-modules-dir=none', '--allow-net', '--allow-read', '--allow-write', '--allow-env', 'server.ts'], resolve(directory, 'yt-cipher'), {
      DENO_DIR: resolve(directory, 'deno-cache'), XDG_CACHE_HOME: resolve(directory, 'cipher-cache'), HOST: '127.0.0.1', PORT: '8001', API_TOKEN: env.CIPHER_TOKEN, MAX_THREADS: '2', OVERRIDE_PLAYER_VARIANT: 'IAS',
    }, 'http://127.0.0.1:8001/metrics', env.CIPHER_TOKEN);
    if (env.POT_TOKEN) await service('lavalink-pot', process.execPath, ['server.js'], resolve(directory, 'webpo-generator'), {
      HOST: '127.0.0.1', PORT: '8002', API_TOKEN: env.POT_TOKEN, WORKERS: '1', CACHE_SIZE: '100', QUEUE_SIZE: '8', MAX_PENDING_REQUESTS: '16',
    }, 'http://127.0.0.1:8002/health', env.POT_TOKEN);
    await service('lavalink-node', runtime.java, ['-Xms128m', '-Xmx512m', '-jar', 'Lavalink.jar', '--logging.level.root=INFO'], directory, {}, 'http://127.0.0.1:2333/v4/info', env.LAVALINK_PASSWORD);
    console.log('Lavalink y sus servicios locales estan listos.');
    return { close };
  } catch (error) { await close(); throw error; }
}
