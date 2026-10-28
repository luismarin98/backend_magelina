import { t } from '../../../i18n/index.js';
import { commandAccess } from '../../access.js';
import { ChannelType, PermissionFlagsBits as P } from 'discord.js';
import { assertAvailable } from '../../../modules/operations/service.js';
import { requireModule } from '../../../modules/settings/service.js';
import { workflowError } from '../../../modules/workflow/rules.js';
import { getMusicService } from '../../../modules/music/service.js';
import type { SlashContext } from '../context.js';


export async function prepareMusic(context: SlashContext) {
  const { i, config, member, command, requireCapability } = context;
  if (!i.guild) throw workflowError(400, 'Guild required.');
  requireCapability(['agregar', 'youtube'].includes(command) ? 'music.request' : ['buscar', 'cola'].includes(command) ? 'music.read' : 'music.manage');
  if (command !== 'desconectar') await requireModule(i.guild.id, 'music');
  const service = getMusicService(i.client);
  const state = service.snapshot(i.guild.id);
  if (state.channelId) {
    const current = await i.guild.channels.fetch(state.channelId);
    if (!current?.permissionsFor(member)?.has(P.ViewChannel)) throw workflowError(403, t("No tienes acceso al canal del reproductor."));
  }
  const authorize = async (current: string | null) => {
    const fresh = await commandAccess(i, config);
    const capability = ['agregar', 'youtube'].includes(command) ? 'music.request' : 'music.manage';
    if (!fresh.access.capabilities.includes(capability)) throw workflowError(403, t("Tus permisos del reproductor cambiaron."));
    await assertAvailable(i.guild!.id);
    const channelId = command === 'conectar' ? member.voice.channelId : current;
    if (!channelId && command === 'desconectar') return;
    const channel = channelId ? await i.guild!.channels.fetch(channelId) : null;
    if (!channel || channel.type !== ChannelType.GuildVoice) throw workflowError(400, t("Debes seleccionar un canal de voz normal. Usa /musica conectar desde tu canal."));
    const actor = await i.guild!.members.fetch({ user: i.user.id, force: true });
    if (!channel.permissionsFor(actor)?.has([P.ViewChannel, P.Connect]) || (!fresh.access.canConfigure && actor.voice.channelId !== channel.id)) throw workflowError(403, t("Debes tener acceso y estar en el mismo canal de voz."));
    const me = await i.guild!.members.fetchMe({ force: true });
    if (command !== 'desconectar' && !channel.permissionsFor(me)?.has([P.ViewChannel, P.Connect, P.Speak])) throw workflowError(403, t("Magelina necesita Ver canal, Conectar y Hablar."));
    if (command === 'conectar' && channel.full && me.voice.channelId !== channel.id && !channel.permissionsFor(me)?.has(P.MoveMembers)) throw workflowError(403, t("El canal est\u00e1 lleno."));
  };
  return { ...context, service, state, authorize };
}
export type MusicContext = Awaited<ReturnType<typeof prepareMusic>>;
