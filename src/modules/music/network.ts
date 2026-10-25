import { get } from 'node:https';
import { logRecord, safeRoute } from '../../observability/logging.js';
import { lookup } from 'node:dns';
import { isIP, type LookupFunction } from 'node:net';
import type { IncomingMessage } from 'node:http';
import { workflowError } from '../workflow/rules.js';

export function publicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b! >= 16 && b! <= 31) ||
      (a === 192 && (b === 168 || b === 0)) || (a === 100 && b! >= 64 && b! <= 127) || (a === 198 && (b === 18 || b === 19 || b === 51)) || (a === 203 && b === 0));
  }
  // Accept global unicast IPv6 only. Excludes local, mapped IPv4 and multicast.
  return isIP(address) === 6 && /^[23][a-f\d]{3}:/i.test(address) && !address.toLowerCase().startsWith('2001:db8:');
}
export function audioUrl(value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw workflowError(502, 'Audius devolvio una direccion de audio no valida.'); }
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || isIP(url.hostname.replace(/^\[|\]$/g, '')) || !url.hostname.includes('.')) {
    throw workflowError(502, 'La fuente de audio no es una direccion HTTPS publica.');
  }
  return url;
}
const publicLookup: LookupFunction = (hostname, options, callback) => {
  lookup(hostname, { all: true }, (error, addresses) => {
    if (error) return callback(error, '', 4);
    if (!addresses.length || addresses.some(({ address }) => !publicAddress(address))) return callback(new Error('Non-public audio host'), '', 4);
    const allowed = options.family ? addresses.filter((item) => item.family === Number(options.family)) : addresses;
    if (!allowed.length) return callback(new Error('No audio address'), '', 4);
    if (options.all) callback(null, allowed);
    else callback(null, allowed[0]!.address, allowed[0]!.family);
  });
};

/** Resolve every redirect through the same pinned public-address lookup. Never give remote URLs to FFmpeg. */
export async function openAudio(value: string, signal: AbortSignal, redirects = 0): Promise<IncomingMessage> {
  if (redirects > 5) throw workflowError(502, 'Demasiadas redirecciones de audio.');
  const url = audioUrl(value);
  const start = performance.now(), fields = { service: 'audius-audio', method: 'GET', route: safeRoute(url.href) };
  logRecord('http.out.start', fields);
  const response = await new Promise<IncomingMessage>((resolve, reject) => {
    const request = get(url, { agent: false, lookup: publicLookup, signal, headers: { 'User-Agent': 'Magelina/0.1', Accept: 'audio/*,application/octet-stream' } }, resolve);
    const deadline = setTimeout(() => request.destroy(new Error('Audio headers timeout')), 15_000);
    deadline.unref();
    request.once('response', response => { clearTimeout(deadline); logRecord('http.out.end', { ...fields, status: response.statusCode, durationMs: Math.round(performance.now() - start), outcome: 'headers-received' }); });
    request.once('error', () => clearTimeout(deadline));
    request.setTimeout(20_000, () => request.destroy(new Error('Audio request timeout')));
    request.on('error', error => { logRecord('http.out.error', { ...fields, durationMs: Math.round(performance.now() - start), outcome: 'failed' }); reject(error); });
  });
  if ([301, 302, 303, 307, 308].includes(response.statusCode ?? 0) && response.headers.location) {
    response.destroy();
    return openAudio(new URL(response.headers.location, url).href, signal, redirects + 1);
  }
  if (response.statusCode !== 200 && response.statusCode !== 206) { response.destroy(); throw workflowError(502, 'Audius no pudo entregar esta pista.'); }
  const type = response.headers['content-type']?.split(';')[0]?.toLowerCase();
  if (type && !type.startsWith('audio/') && !['application/octet-stream', 'binary/octet-stream'].includes(type)) { response.destroy(); throw workflowError(502, 'La fuente no contiene audio compatible.'); }
  response.socket?.setTimeout(0);
  return response;
}
