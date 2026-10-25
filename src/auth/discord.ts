import type { Config } from '../config/env.js';
import { observedFetch } from '../observability/logging.js';
import type { GlobalRole } from '../types/contracts.js';
const API = 'https://discord.com/api/v10';

export interface DiscordGuild { id: string; name: string; permissions: string; owner?: boolean; icon?: string | null; banner?: string | null }
export interface DiscordUser { id: string; username: string; global_name?: string | null; discriminator?: string; avatar?: string | null; avatar_decoration_data?: { asset: string } | null }
interface DiscordToken { access_token: string; expires_in: number }
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function discordRequest(path: '/users/@me', token: string): Promise<DiscordUser>;
export function discordRequest(path: `/users/@me/guilds${string}`, token: string): Promise<DiscordGuild[]>;

export async function discordRequest(path: '/users/@me' | `/users/@me/guilds${string}`, token: string): Promise<DiscordUser | DiscordGuild[]> {
  const response = await observedFetch('discord-oauth', `${API}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) {
    const error = Object.assign(new Error('Discord no esta disponible.'), { status: response.status === 401 ? 401 : 502 });
    throw error;
  }
  const data: unknown = await response.json();
  if (path.startsWith('/users/@me/guilds')) {
    if (!Array.isArray(data) || !data.every((guild: unknown) => isRecord(guild) && typeof guild.id === 'string' && typeof guild.name === 'string' && typeof guild.permissions === 'string' && /^\d+$/.test(guild.permissions) && (guild.owner === undefined || typeof guild.owner === 'boolean'))) {
      throw Object.assign(new Error('Respuesta de Discord no valida.'), { status: 502 });
    }
    return data as DiscordGuild[];
  }
  if (!isRecord(data) || typeof data.id !== 'string' || typeof data.username !== 'string' || (data.global_name != null && typeof data.global_name !== 'string')) {
    throw Object.assign(new Error('Perfil de Discord no valido.'), { status: 502 });
  }
  return {
    id: data.id, username: data.username, global_name: typeof data.global_name === 'string' ? data.global_name : null,
    discriminator: typeof data.discriminator === 'string' ? data.discriminator : undefined,
    avatar: typeof data.avatar === 'string' ? data.avatar : null,
    avatar_decoration_data: isRecord(data.avatar_decoration_data) && typeof data.avatar_decoration_data.asset === 'string' ? { asset: data.avatar_decoration_data.asset } : null,
  };
}

export async function exchangeCode(code: string, config: Config): Promise<DiscordToken> {
  const response = await observedFetch('discord-oauth', `${API}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.discordClientId,
      client_secret: config.discordClientSecret,
      grant_type: 'authorization_code',
      code,
      redirect_uri: config.discordRedirectUri,
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw Object.assign(new Error('No se pudo iniciar sesion.'), { status: 502 });
  const data: unknown = await response.json();
  if (!isRecord(data) || typeof data.access_token !== 'string' || typeof data.expires_in !== 'number' || !Number.isFinite(data.expires_in) || data.expires_in <= 0) {
    throw Object.assign(new Error('Token de Discord no valido.'), { status: 502 });
  }
  return { access_token: data.access_token, expires_in: data.expires_in };
}

export function canManageGuild(guild: { permissions?: string; owner?: boolean }): boolean {
  const permissions = BigInt(guild.permissions ?? '0');
  return guild.owner === true || (permissions & 8n) !== 0n || (permissions & 32n) !== 0n;
}

export function getGlobalRole(id: string, config: Pick<Config, 'ownerIds' | 'operatorIds'>): GlobalRole {
  if (config.ownerIds.includes(id)) return 'owner';
  if (config.operatorIds.includes(id)) return 'operator';
  return 'member';
}

export async function listDiscordGuilds(token: string): Promise<DiscordGuild[]> {
  const all: DiscordGuild[] = []; let after = '';
  while (true) {
    const page = await discordRequest(`/users/@me/guilds?limit=200${after ? `&after=${after}` : ''}`, token);
    all.push(...page); if (page.length < 200) return all;
    const next = page.at(-1)!.id;
    if (!/^\d{17,20}$/.test(next) || next === after) throw Object.assign(new Error('Cursor de Discord no valido.'), { status: 502 });
    after = next;
  }
}
