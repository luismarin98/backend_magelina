import type { Client, Guild } from 'discord.js';
import type { Config } from '../config/env.js';
import type { SessionUser, GuildAccess } from './contracts.js';

export interface AppDependencies { config: Config; bot: Client; isStopping: () => boolean }
export type ManagementDependencies = Pick<AppDependencies, 'config' | 'bot'>;

declare module 'express-session' {
  interface SessionData {
    user?: SessionUser;
    accessToken?: string;
    tokenExpiresAt?: number;
    profileUpdatedAt?: number;
    oauthState?: string;
    oauthStartedAt?: number;
    oauthReturnTo?: string;
  }
}
declare global {
  namespace Express {
    interface Request { managedGuild?: Guild; guildAccess?: GuildAccess }
  }
}
