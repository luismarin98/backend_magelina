import { routeParam } from '../common/input.js';
import { Router } from 'express';
import type { RequestHandler } from 'express';
import { ChannelType, PermissionFlagsBits } from 'discord.js';
import type { Guild } from 'discord.js';
import { getSettings, saveSettings, serializeSettings } from './service.js';
import { validateSettings } from './rules.js';
import { workflowError } from '../workflow/rules.js';

export async function availableChannels(guild: Guild, actorId: string, globalOwner = false) {
  const [channels, bot, actor] = await Promise.all([guild.channels.fetch(), guild.members.fetchMe(), globalOwner ? Promise.resolve(null) : guild.members.fetch({ user: actorId, force: true })]);
  return [...channels.values()].filter((channel) => channel !== null &&
    (channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildAnnouncement) &&
    (globalOwner || (actor && channel.permissionsFor(actor)?.has(PermissionFlagsBits.ViewChannel)))).map((channel) => {
      // El filtro anterior limita a canales de texto persistentes, no hilos.
      if (!channel || !(channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildAnnouncement)) throw new Error('Unexpected channel');
      return { id: channel.id, name: channel.name,
        canSend: channel.permissionsFor(bot)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]) ?? false };
    });
}

export function settingsRoutes({ requireGuildManager }: { requireGuildManager: RequestHandler }) {
  const router = Router({ mergeParams: true });
  router.use(requireGuildManager);
  router.get('/', async (req, res) => { res.json({ settings: serializeSettings(await getSettings(routeParam(req, 'guildId'))) }); });
  router.get('/channels', async (req, res) => {
    res.json({ channels: await availableChannels(req.managedGuild!, req.session.user!.id, req.guildAccess?.source === 'bot-owner') });
  });
  router.patch('/', async (req, res) => {
    const input = validateSettings(req.body);
    if (input.notifications.channelId !== null) {
      const channels = await availableChannels(req.managedGuild!, req.session.user!.id, req.guildAccess?.source === 'bot-owner');
      if (!channels.some((channel) => channel.id === input.notifications.channelId && channel.canSend)) {
        throw workflowError(400, 'El canal debe pertenecer al servidor y permitirte verlo; el bot necesita verlo y enviar mensajes.');
      }
    }
    const settings = await saveSettings({ guildId: routeParam(req, 'guildId'), actorId: req.session.user!.id, body: input });
    res.json({ settings: serializeSettings(settings) });
  });
  return router;
}
