import { Router } from 'express';
import { ChannelType, PermissionFlagsBits as P, type Guild, type GuildMember } from 'discord.js';
import type { RequireCapability } from '../permissions/access.js';
import { object, text, version, id, routeParam } from '../common/input.js';
import { workflowError } from '../workflow/rules.js';
import { getSettings, requireModule } from '../settings/service.js';
import type { MusicService } from './service.js';
import { musicTrackId, MusicSources } from './sources.js';

async function members(guild: Guild, actorId: string, globalOwner: boolean) {
  const [me, actor] = await Promise.all([guild.members.fetchMe({ force: true }), globalOwner ? Promise.resolve(null) : guild.members.fetch({ user: actorId, force: true })]);
  return { me, actor };
}
function visible(channel: NonNullable<ReturnType<Guild['channels']['cache']['get']>>, actor: GuildMember | null) {
  return actor === null || Boolean(channel.permissionsFor(actor)?.has(P.ViewChannel));
}
export function musicRoutes(requireCapability: RequireCapability, service: MusicService) {
  const router = Router({ mergeParams: true });
  router.get('/', requireCapability('music.read'), async (req, res) => {
    const guild = req.managedGuild!, settings = await getSettings(guild.id);
    const [channels] = await Promise.all([guild.channels.fetch(), guild.roles.fetch()]).catch(() => {
      throw workflowError(502, 'No se pudieron cargar los canales de Discord. Actualiza el monitor e inténtalo de nuevo.');
    });
    const { me, actor } = await members(guild, req.session.user!.id, req.guildAccess!.source === 'bot-owner');
    const player = service.snapshot(guild.id);
    const channel = player.channelId ? channels.get(player.channelId) : null;
    if (player.channelId && (!channel || !visible(channel, actor))) throw workflowError(403, 'No puedes consultar la cola de un canal privado al que no tienes acceso.');
    const listeners = channel?.type === ChannelType.GuildVoice ? [...channel.members.values()].filter((member) => !member.user.bot).length : 0;
    res.json({ player, listeners, canEnableYouTube: req.guildAccess!.source === 'bot-owner', youtubeEnabled: service.provider instanceof MusicSources && Boolean(service.provider.youtube), enabled: settings.modules.music, canRequest: req.guildAccess!.capabilities.includes('music.request'), canManage: req.guildAccess!.capabilities.includes('music.manage'),
      channels: [...channels.values()].filter((entry) => entry !== null).filter((entry) => entry.type === ChannelType.GuildVoice && visible(entry, actor)).sort((a, b) => a.rawPosition - b.rawPosition).map((entry) => ({ id: entry.id, name: entry.name,
        canConnect: Boolean(entry.permissionsFor(me)?.has([P.ViewChannel, P.Connect, P.Speak])) && (!actor || Boolean(entry.permissionsFor(actor)?.has(P.Connect))) })) });
  });
  router.post('/youtube/enable', requireCapability('music.manage'), async (req, res) => {
    if (req.guildAccess!.source !== 'bot-owner') throw workflowError(403, 'Solo el propietario del bot puede habilitar esta fuente global.');
    object(req.body, ['version']);
    if (!(service.provider instanceof MusicSources)) throw workflowError(503, 'Este backend no admite activar YouTube.');
    service.provider.enableYouTube();
    res.json({ youtubeEnabled: Boolean(service.provider.youtube) });
  });
  router.get('/search', requireCapability('music.read'), async (req, res) => {
    await requireModule(routeParam(req, 'guildId'), 'music');
    const query = text(req.query.q, 100);
    if (query.length < 2) throw workflowError(400, 'Escribe al menos 2 caracteres para buscar.');
    const source = req.query.source ?? 'audius';
    if (source !== 'audius' && source !== 'youtube') throw workflowError(400, 'Fuente de música no válida.');
    res.json({ tracks: await service.provider.search(query, source) });
  });
  const authorize = (req: Parameters<ReturnType<RequireCapability>>[0], selected?: string, disconnect = false) => async (current: string | null) => {
    const guild = req.managedGuild!, channelId = selected ?? current;
    if (!channelId) { if (disconnect) return; throw workflowError(409, 'Conecta el reproductor a un canal de voz primero.'); }
    await guild.roles.fetch();
    const channel = await guild.channels.fetch(channelId);
    if (!channel || channel.type !== ChannelType.GuildVoice) throw workflowError(400, 'Selecciona un canal de voz normal de este servidor.');
    const { me, actor } = await members(guild, req.session.user!.id, req.guildAccess!.source === 'bot-owner');
    if (actor && !channel.permissionsFor(actor)?.has([P.ViewChannel, P.Connect])) throw workflowError(403, 'No tienes acceso a este canal de voz.');
    if (!req.guildAccess!.canConfigure && actor?.voice.channelId !== channelId) throw workflowError(403, 'Debes estar en el mismo canal de voz para solicitar musica o controlar el reproductor.');
    if (!disconnect && !channel.permissionsFor(me)?.has([P.ViewChannel, P.Connect, P.Speak])) throw workflowError(403, 'Magelina necesita Ver canal, Conectar y Hablar en este canal.');
    if (selected && channel.full && me.voice.channelId !== selected && !channel.permissionsFor(me)?.has(P.MoveMembers)) throw workflowError(403, 'El canal de voz esta lleno.');
  };
  router.post('/connect', requireCapability('music.manage'), async (req, res) => {
    const input = object(req.body, ['channelId', 'version']);
    const channelId = id(input.channelId, true), expected = version(input.version);
    res.json({ player: await service.connect(req.managedGuild!, channelId, expected, authorize(req, channelId)) });
  });
  router.post('/queue', requireCapability('music.request'), async (req, res) => {
    const input = object(req.body, ['trackId', 'version']);
    res.json({ player: await service.enqueue(routeParam(req, 'guildId'), musicTrackId(input.trackId), req.session.user!.id, version(input.version), authorize(req)) });
  });
  router.post('/control', requireCapability('music.manage'), async (req, res) => {
    const input = object(req.body, ['action', 'version', 'value']);
    const action = text(input.action, 20);
    if (!['pause', 'resume', 'skip', 'stop', 'disconnect', 'volume', 'remove'].includes(action)) throw workflowError(400, 'Control de musica no valido.');
    if (action === 'volume' && (typeof input.value !== 'number' || !Number.isInteger(input.value) || input.value < 0 || input.value > 100)) throw workflowError(400, 'El volumen debe estar entre 0 y 100.');
    if (action === 'remove' && (typeof input.value !== 'string' || !/^[a-f\d-]{36}$/i.test(input.value))) throw workflowError(400, 'Identificador de cola no valido.');
    if (!['volume', 'remove'].includes(action) && input.value !== undefined) throw workflowError(400, 'Este control no admite un valor.');
    res.json({ player: await service.control(routeParam(req, 'guildId'), action as Parameters<MusicService['control']>[1], version(input.version), authorize(req, undefined, action === 'disconnect'), input.value as number | string | undefined) });
  });
  return router;
}
