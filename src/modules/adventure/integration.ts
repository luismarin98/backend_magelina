import { Router } from 'express';
import { ChannelType, PermissionFlagsBits as P } from 'discord.js';
import { AdventureConfig } from '../../database/models/Adventure.js';
import { object, boolean, id, strings, version } from '../common/input.js';
import { workflowError } from '../workflow/rules.js';
import { hasCode } from '../../types/errors.js';

export function integrationDefaults(config: any) {
  return { enabled: config?.integration?.enabled ?? false, categoryId: config?.integration?.categoryId ?? null, channelId: config?.integration?.channelId ?? null, announceArrivals: config?.integration?.announceArrivals ?? true, announceJoins: config?.integration?.announceJoins ?? true, delegateRoleIds: config?.integration?.delegateRoleIds ?? [] };
}
export function joinAnnouncement(config: any, alias: string) {
  const settings = integrationDefaults(config);
  return config?.enabled && settings.enabled && settings.announceJoins && settings.channelId ? { announcement: 'pending', announcementChannelId: settings.channelId, announcementAlias: alias, announcementAttempts: 0, announcementDueAt: new Date() } : { announcement: 'skipped' };
}
export function adventureIntegrationRoutes() {
  const router = Router({ mergeParams: true });
  router.use(async (req, res, next) => {
    const config = await AdventureConfig.findOne({ guildId: req.managedGuild!.id }).lean();
    const settings = integrationDefaults(config);
    const admin = Boolean(res.locals.canConfigureAdventure);
    const member = res.locals.adventureMember;
    if (!admin && !settings.delegateRoleIds.some((role: string) => member.roles.cache.has(role))) throw workflowError(403, 'Un administrador debe delegarte la configuración de avisos del juego.');
    res.locals.adventureConfig = config; res.locals.adventureIntegration = settings; res.locals.adventureAdmin = admin;
    next();
  });
  router.get('/', async (req, res) => {
    const guild = req.managedGuild!, channels = await guild.channels.fetch(), roles = await guild.roles.fetch();
    res.json({ ...res.locals.adventureIntegration, version: res.locals.adventureConfig?.version ?? 0, canDelegate: res.locals.adventureAdmin,
      categories: [...channels.values()].filter(channel => channel?.type === ChannelType.GuildCategory).map(channel => ({ id: channel!.id, name: channel!.name })),
      channels: [...channels.values()].filter(channel => channel?.type === ChannelType.GuildText).map(channel => ({ id: channel!.id, name: channel!.name, categoryId: channel!.parentId })),
      roles: [...roles.values()].filter(role => role.id !== guild.id && !role.managed).map(role => ({ id: role.id, name: role.name })) });
  });
  router.put('/', async (req, res) => {
    const input = object(req.body, ['enabled', 'categoryId', 'channelId', 'announceJoins', 'announceArrivals', 'delegateRoleIds', 'version']);
    const previous = res.locals.adventureIntegration;
    const settings = { enabled: boolean(input.enabled), categoryId: input.categoryId === null ? null : id(input.categoryId, true), channelId: input.channelId === null ? null : id(input.channelId, true), announceJoins: boolean(input.announceJoins), announceArrivals: input.announceArrivals === undefined ? previous.announceArrivals : boolean(input.announceArrivals), delegateRoleIds: previous.delegateRoleIds as string[] };
    if (input.delegateRoleIds !== undefined) {
      if (!res.locals.adventureAdmin) throw workflowError(403, 'Solo un administrador puede delegar la configuración.');
      settings.delegateRoleIds = strings(input.delegateRoleIds, 20, 20).map(role => id(role, true));
      const roles = await req.managedGuild!.roles.fetch();
      if (settings.delegateRoleIds.some(role => role === req.managedGuild!.id || !roles.has(role) || roles.get(role)!.managed)) throw workflowError(400, 'Selecciona roles válidos del servidor.');
    }
    if (settings.enabled || settings.channelId || settings.categoryId) {
      if (!settings.categoryId || !settings.channelId) throw workflowError(400, 'Selecciona una categoría y su canal de avisos.');
      const guild = req.managedGuild!, category = await guild.channels.fetch(settings.categoryId), channel = await guild.channels.fetch(settings.channelId), me = await guild.members.fetchMe();
      if (category?.type !== ChannelType.GuildCategory || channel?.type !== ChannelType.GuildText || channel.parentId !== category.id) throw workflowError(400, 'El canal debe estar dentro de la categoría seleccionada.');
      if (!channel.permissionsFor(me)?.has([P.ViewChannel, P.SendMessages, P.ReadMessageHistory])) throw workflowError(400, 'Magelina necesita ver el canal, enviar mensajes y leer su historial.');
    }
    try {
      const saved = await AdventureConfig.findOneAndUpdate({ guildId: req.managedGuild!.id, version: version(input.version) }, { $set: { integration: settings }, $inc: { version: 1 } }, { new: true, upsert: input.version === 0, runValidators: true });
      if (!saved) throw workflowError(409, 'La configuración cambió; vuelve a abrirla.');
      res.json({ saved: true });
    } catch (error) { if (hasCode(error, 11000)) throw workflowError(409, 'La configuración cambió; vuelve a abrirla.'); throw error; }
  });
  // Creates resources only on this explicit action; never moves or edits existing channels.
  router.post('/provision', async (req, res) => {
    const input = object(req.body, ['categoryId']);
    const guild = req.managedGuild!, me = await guild.members.fetchMe();
    if (!me.permissions.has(P.ManageChannels)) throw workflowError(400, 'Magelina necesita Gestionar canales.');
    const existing = input.categoryId === null ? null : await guild.channels.fetch(id(input.categoryId, true));
    if (existing && existing.type !== ChannelType.GuildCategory) throw workflowError(400, 'Selecciona una categoría válida.');
    if (input.categoryId !== null && !existing) throw workflowError(400, 'Categoría no disponible.');
    if (existing && !existing.permissionsFor(me)?.has([P.ViewChannel, P.ManageChannels])) throw workflowError(400, 'Magelina no puede crear canales en esa categoría.');
    const category = existing ?? await guild.channels.create({ name: 'Gremio de aventureros', type: ChannelType.GuildCategory, reason: 'Integración del juego solicitada desde el dashboard' });
    const channel = await guild.channels.create({ name: 'avisos-del-gremio', type: ChannelType.GuildText, parent: category.id, reason: 'Canal de avisos del juego solicitado desde el dashboard' });
    res.status(201).json({ categoryId: category.id, channelId: channel.id });
  });
  return router;
}
