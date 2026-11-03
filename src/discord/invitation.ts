import { PermissionFlagsBits as P } from 'discord.js';
import { permissionOptions } from '../modules/roles/rules.js';

/** Requirements belong to features, not to a manually maintained decimal mask. */
export const invitationFeatures = [
  { id: 'messages', permissions: ['ViewChannel', 'SendMessages', 'ReadMessageHistory', 'EmbedLinks'] },
  { id: 'moderation', permissions: ['KickMembers', 'BanMembers', 'ModerateMembers', 'ViewAuditLog'] },
  { id: 'channels-support', permissions: ['ManageChannels', 'ManageRoles', 'ManageThreads'] },
  { id: 'music', permissions: ['Connect', 'Speak', 'MoveMembers'] },
  // Discord only lets the bot grant permissions it possesses when creating roles.
  { id: 'role-templates', permissions: [...permissionOptions as (keyof typeof P)[]] },
] satisfies { id: string; permissions: (keyof typeof P)[] }[];

export function botInvitation(clientId: string) {
  const names = [...new Set(invitationFeatures.flatMap(feature => feature.permissions))];
  const permissions = names.reduce((mask, name) => mask | P[name as keyof typeof P], 0n).toString();
  const url = new URL('https://discord.com/oauth2/authorize');
  url.search = new URLSearchParams({ client_id: clientId, permissions, integration_type: '0', scope: 'bot applications.commands' }).toString();
  return { url: url.href, permissions, permissionCount: names.length, features: invitationFeatures };
}
