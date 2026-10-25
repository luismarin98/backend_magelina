import type { BotIdentity, DiscordImage, GuildSummary, SessionUser } from '../types/contracts.js';
import type { User } from 'discord.js';

const CDN = 'https://cdn.discordapp.com';
const validId = (id: string) => /^\d{1,20}$/.test(id);
const validHash = (hash: unknown): hash is string => typeof hash === 'string' && /^(?:a_)?[a-f0-9]{32}$/.test(hash);

/** WebP animado conserva los formatos originales que no convierten correctamente a GIF. */
export function discordImage(path: string, hash: unknown, size: 128 | 512 = 128): DiscordImage | null {
  if (!validHash(hash)) return null;
  const staticUrl = `${CDN}/${path}/${hash}.webp?size=${size}`;
  return { url: hash.startsWith('a_') ? `${staticUrl}&animated=true` : staticUrl, staticUrl };
}

export function avatarDecoration(asset: unknown): string | null {
  return validHash(asset) ? `${CDN}/avatar-decoration-presets/${asset}.png?size=128` : null;
}

export interface UserImagesInput {
  id: string; username: string; global_name?: string | null; discriminator?: string;
  avatar?: string | null; avatar_decoration_data?: { asset: string } | null;
}
export function serializeSessionUser(user: UserImagesInput): SessionUser {
  let avatar = validId(user.id) ? discordImage(`avatars/${user.id}`, user.avatar) : null;
  if (!avatar && validId(user.id)) {
    const legacy = user.discriminator && user.discriminator !== '0' && user.discriminator !== '0000' && /^\d{4}$/.test(user.discriminator);
    const index = legacy ? Number(user.discriminator) % 5 : Number((BigInt(user.id) >> 22n) % 6n);
    const url = `${CDN}/embed/avatars/${index}.png`;
    avatar = { url, staticUrl: url };
  }
  return { id: user.id, username: user.username, name: user.global_name || user.username, avatar, avatarDecorationUrl: avatarDecoration(user.avatar_decoration_data?.asset) };
}

export function serializeBot(user: Pick<User, 'id' | 'username' | 'globalName' | 'avatar' | 'discriminator' | 'avatarDecorationData'> | null): BotIdentity | null {
  if (!user) return null;
  const profile = serializeSessionUser({ id: user.id, username: user.username, global_name: user.globalName, discriminator: user.discriminator, avatar: user.avatar, avatar_decoration_data: user.avatarDecorationData });
  return { id: profile.id, name: profile.name, avatar: profile.avatar ?? null, avatarDecorationUrl: profile.avatarDecorationUrl ?? null };
}

export function serializeGuild(guild: { id: string; name: string; icon?: string | null; banner?: string | null }): GuildSummary {
  return { id: guild.id, name: guild.name, icon: validId(guild.id) ? discordImage(`icons/${guild.id}`, guild.icon) : null, banner: validId(guild.id) ? discordImage(`banners/${guild.id}`, guild.banner, 512) : null };
}
