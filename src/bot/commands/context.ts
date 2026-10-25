import { escapeMarkdown, type ChatInputCommandInteraction } from 'discord.js';
import type { Config } from '../../config/env.js';
import type { Capability } from '../../types/contracts.js';
import type { commandAccess } from '../access.js';

export interface SlashContext extends Awaited<ReturnType<typeof commandAccess>> {
  i: ChatInputCommandInteraction;
  config: Pick<Config, 'ownerIds' | 'dashboardOrigin'>;
  command: string;
  requireCapability(capability: Capability): void;
}

export const safeText = (value: string) => escapeMarkdown(value.replace(/[\r\n]/g, ' ').slice(0, 110));
