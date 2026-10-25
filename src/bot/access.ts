import { type ChatInputCommandInteraction } from 'discord.js';
import type { Config } from '../config/env.js';
import { getPolicy } from '../modules/permissions/service.js';
import { resolveAccess } from '../modules/permissions/rules.js';
import { workflowError } from '../modules/workflow/rules.js';

export async function commandAccess(i: Pick<ChatInputCommandInteraction, 'guild' | 'guildId' | 'user'>, config: Pick<Config, 'ownerIds'>) {
  if (!i.guild) throw workflowError(400, 'Esta función solo está disponible en servidores.');
  const member = await i.guild.members.fetch({ user: i.user.id, force: true });
  const owner = config.ownerIds.includes(i.user.id);
  const policy = await getPolicy(i.guild.id);
  const access = resolveAccess(member.id === i.guild.ownerId, [...member.roles.cache.keys()].filter(id => id !== i.guildId), policy.grants, owner ? 'owner' : 'member');
  return { member, access };
}
