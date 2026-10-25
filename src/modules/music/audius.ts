import type { MusicTrack } from '../../types/contracts.js';
import { workflowError } from '../workflow/rules.js';

const API = 'https://api.audius.co/v1';
const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
export function trackId(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-z\d]{1,30}$/i.test(value)) throw workflowError(400, 'ID de pista de Audius no valido.');
  return value;
}
export function normalizeTrack(value: unknown): MusicTrack | null {
  if (!record(value) || !record(value.user) || typeof value.id !== 'string' || !/^[a-z\d]{1,30}$/i.test(value.id) ||
    typeof value.title !== 'string' || !value.title.trim() || typeof value.duration !== 'number' || !Number.isFinite(value.duration) || value.duration < 1 || value.duration > 1800 ||
    value.is_streamable !== true || value.is_available === false || value.is_gated === true || value.is_unlisted === true || value.is_delete === true ||
    value.stream_conditions != null || (record(value.access) && value.access.stream === false) || value.user.is_deactivated === true) return null;
  let permalink: URL;
  try { permalink = new URL(typeof value.permalink === 'string' ? value.permalink : '', 'https://audius.co'); }
  catch { return null; }
  if (permalink.origin !== 'https://audius.co' || permalink.pathname === '/' || permalink.username || permalink.password) return null;
  let artworkUrl: string | null = null;
  if (record(value.artwork) && typeof value.artwork['150x150'] === 'string') {
    try { const url = new URL(value.artwork['150x150']); if (url.protocol === 'https:' && !url.username && !url.password) artworkUrl = url.href; } catch { /* No artwork is also valid. */ }
  }
  return { id: value.id, title: value.title.trim().slice(0, 200), artist: typeof value.user.name === 'string' ? value.user.name.slice(0, 120) : 'Artista de Audius', durationSeconds: Math.floor(value.duration), permalink: permalink.href, artworkUrl };
}
export interface MusicProvider {
  openStream?(id: string, signal: AbortSignal): Promise<import('node:stream').Readable>;
  search(query: string, source?: 'audius' | 'youtube'): Promise<MusicTrack[]>;
  track(id: string): Promise<MusicTrack>;
  streamUrl(id: string): string;
}
export class AudiusProvider implements MusicProvider {
  private cache = new Map<string, { at: number; tracks: MusicTrack[] }>();
  constructor(private readonly apiKey?: string) {}
  private url(path: string, params: Record<string, string> = {}) {
    const url = new URL(`${API}${path}`);
    url.search = new URLSearchParams({ app_name: 'Magelina', ...params, ...(this.apiKey ? { api_key: this.apiKey } : {}) }).toString();
    return url;
  }
  private async get(path: string, params?: Record<string, string>): Promise<unknown> {
    try {
      const response = await observedFetch('audius', this.url(path, params), { redirect: 'error', signal: AbortSignal.timeout(12_000), headers: { Accept: 'application/json' } });
      if (response.status === 429) throw workflowError(429, 'Audius alcanzo su limite de consultas. Espera antes de reintentar.');
      if (!response.ok) throw workflowError(502, 'Audius no esta disponible o la pista no permite acceso.');
      const reader = response.body?.getReader(); if (!reader) throw new Error('Missing response');
      const chunks: Uint8Array[] = []; let size = 0;
      try {
        while (true) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.byteLength; if (size > 2_000_000) throw new Error('Large response'); chunks.push(chunk.value); }
      } finally { await reader.cancel().catch(() => {}); }
      const body: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!record(body) || !('data' in body)) throw new Error('Invalid response');
      return body.data;
    } catch (error) {
      if (error && typeof error === 'object' && 'publicMessage' in error) throw error;
      throw workflowError(502, 'No se pudo consultar Audius. Intentalo de nuevo.');
    }
  }
  async search(query: string) {
    const cached = this.cache.get(query);
    if (cached && Date.now() - cached.at < 30_000) return structuredClone(cached.tracks);
    const result = await this.get('/tracks/search', { query, limit: '20', include_purchaseable: 'false' });
    if (!Array.isArray(result)) throw workflowError(502, 'Audius devolvio una busqueda no valida.');
    const tracks = result.map(normalizeTrack).filter((track): track is MusicTrack => Boolean(track));
    if (this.cache.size >= 100) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(query, { at: Date.now(), tracks });
    return structuredClone(tracks);
  }
  async track(id: string) {
    const result = await this.get(`/tracks/${trackId(id)}`);
    const track = normalizeTrack(result);
    if (!track) throw workflowError(400, 'Selecciona una pista publica, gratuita y reproducible de Audius de hasta 30 minutos.');
    return track;
  }
  streamUrl(id: string) { return this.url(`/tracks/${trackId(id)}/stream`).href; }
}
import { observedFetch } from '../../observability/logging.js';
