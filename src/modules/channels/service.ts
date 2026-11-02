import { ChannelType, OverwriteType, PermissionFlagsBits as P, type Guild } from 'discord.js';
import { object, text, strings, id, boolean } from '../common/input.js';
import { workflowError } from '../workflow/rules.js';
import { hasCode } from '../../types/errors.js';

export function channelInput(body: unknown) {
  const input = object(body, ['name', 'type', 'private', 'memberIds']);
  const name = text(input.name, 100);
  if (input.type !== 'text' && input.type !== 'voice') throw workflowError(400, 'Selecciona texto o voz.');
  const restricted = boolean(input.private);
  const memberIds = strings(input.memberIds ?? [], 50, 20).map(value => id(value, true));
  if (!restricted && memberIds.length) throw workflowError(400, 'Selecciona acceso privado para restringir participantes.');
  return { name, type: input.type, private: restricted, memberIds };
}

export async function channelContext(guild: Guild, actorId: string, owner: boolean) {
  const [me, actor] = await Promise.all([guild.members.fetchMe({ force: true }), owner || guild.ownerId === actorId ? Promise.resolve(null) : guild.members.fetch({ user: actorId, force: true })]);
  return { me, actor, canCreate: me.permissions.has([P.ManageChannels, P.ManageRoles]) && (!actor || actor.permissions.has([P.ManageChannels, P.ManageRoles])) };
}

export function privateOverwrites(guildId: string, botId: string, memberIds: string[], roleIds: string[] = []) {
  return [
    { id: guildId, type: OverwriteType.Role, deny: [P.ViewChannel] },
    { id: botId, type: OverwriteType.Member, allow: [P.ViewChannel, P.ManageChannels, P.ManageRoles, P.SendMessages, P.ReadMessageHistory, P.Connect, P.Speak] },
    ...[...new Set(memberIds)].filter(id => id !== botId).map(id => ({ id, type: OverwriteType.Member, allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.Connect, P.Speak] })),
    ...[...new Set(roleIds)].filter(id => id !== guildId).map(id => ({ id, type: OverwriteType.Role, allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.Connect, P.Speak] })),
  ];
}

export async function createGuildChannel(guild: Guild, actorId: string, owner: boolean, body: unknown) {
  const input = channelInput(body), ctx = await channelContext(guild, actorId, owner);
  if (!ctx.canCreate) throw workflowError(403, 'El usuario y Magelina necesitan Gestionar canales y Gestionar roles.');
  for (const memberId of input.memberIds) await guild.members.fetch({ user: memberId, force: true }).catch((error: unknown) => {
    if (hasCode(error, 10007) || hasCode(error, 10013)) throw workflowError(400, 'Una persona seleccionada ya no pertenece al servidor. Actualiza los usuarios.');
    throw error;
  });
  const channel = await guild.channels.create({ name: input.name, type: input.type === 'voice' ? ChannelType.GuildVoice : ChannelType.GuildText,
    permissionOverwrites: input.private ? privateOverwrites(guild.id, ctx.me.id, [actorId, ...input.memberIds]) : [],
    reason: `Magelina: canal creado por ${actorId}` });
  return { id: channel.id, name: channel.name, type: input.type, private: input.private };
}
