import { type ChatInputCommandInteraction } from 'discord.js';
import type { Config } from '../config/env.js';
import { getPolicy } from '../modules/permissions/service.js';
import { resolveAccess } from '../modules/permissions/rules.js';
import { interactionGuild } from './guild.js';

export async function commandAccess(i: Pick<ChatInputCommandInteraction, 'guild' | 'guildId' | 'user' | 'client'>, config: Pick<Config, 'ownerIds'>) {
  const guild = await interactionGuild(i);
  const member = await guild.members.fetch({ user: i.user.id, force: true });
  const owner = config.ownerIds.includes(i.user.id);
  const policy = await getPolicy(guild.id);
  const access = resolveAccess(member.id === guild.ownerId, [...member.roles.cache.keys()].filter(id => id !== i.guildId), policy.grants, owner ? 'owner' : 'member');
  return { member, access };
}
