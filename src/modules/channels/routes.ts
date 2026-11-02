import { Router } from 'express';
import { ChannelType, PermissionFlagsBits as P } from 'discord.js';
import type { guildAuthorization } from '../permissions/access.js';
import { channelContext, createGuildChannel } from './service.js';

export function channelRoutes(access: ReturnType<typeof guildAuthorization>) {
  const router = Router({ mergeParams: true });
  router.use(access.requireMember);
  router.get('/', async (req, res) => {
    const guild = req.managedGuild!, actorId = req.session.user!.id;
    const ctx = await channelContext(guild, actorId, req.guildAccess!.source === 'bot-owner');
    const channels = await guild.channels.fetch();
    res.json({ canCreate: ctx.canCreate, channels: [...channels.values()].filter(channel => channel && [ChannelType.GuildText, ChannelType.GuildVoice].includes(channel.type) && (!ctx.actor || channel.permissionsFor(ctx.actor)?.has(P.ViewChannel))).map(channel => ({ id: channel!.id, name: channel!.name, type: channel!.type === ChannelType.GuildVoice ? 'voice' : 'text' })) });
  });
  router.post('/', async (req, res) => {
    res.status(201).json({ channel: await createGuildChannel(req.managedGuild!, req.session.user!.id, req.guildAccess!.source === 'bot-owner', req.body) });
  });
  return router;
}
