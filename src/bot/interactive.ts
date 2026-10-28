import { t } from '../i18n/index.js';
import { ActionRowBuilder, StringSelectMenuBuilder, EmbedBuilder, MessageFlags, ChannelType, PermissionFlagsBits as P, escapeMarkdown, type Interaction, type Client } from 'discord.js';
import type { Config } from '../config/env.js';
import type { MusicTrack } from '../types/contracts.js';
import { commandCatalog } from './catalog.js';
import { commandAccess } from './access.js';
import { PanelSessions } from './panel-sessions.js';
import { getMusicService, type MusicService } from '../modules/music/service.js';
import { assertAvailable } from '../modules/operations/service.js';
import { requireModule } from '../modules/settings/service.js';
import { workflowError } from '../modules/workflow/rules.js';
import { logRecord } from '../observability/logging.js';

type Panel = { kind: 'help' } | { kind: 'music'; tracks: MusicTrack[] };
const panels = new PanelSessions<Panel>();
const categories = [
  { label: "Primeros pasos", value: 'start' },
  { label: "Comunidad y tareas", value: 'community' },
  { label: "M\u00fasica", value: 'music' },
  { label: "Entretenimiento", value: 'games' },
  { label: "Acciones de mensajes", value: 'messages' },
];
const safe = (value: string, length = 100) => escapeMarkdown(value.replace(/[\r\n]/g, ' ').slice(0, length));

function helpView(token: string, category = 'start') {
  const commands = commandCatalog().commands.filter(command => category === 'music' ? command.group === 'musica' : category === 'games' ? command.group === 'jugar' : category === 'messages' ? command.kind === 'message' : category === 'community' ? command.group === 'magelina' : ['/magelina ayuda', '/magelina panel'].includes(command.name));
  const embed = new EmbedBuilder().setColor(0xd94695).setTitle(`Magelina · ${t(categories.find(item => item.value === category)!.label)}`)
    .setDescription(commands.map(command => `**${command.name}**\n${t(command.description)}${command.kind === 'message' ? `\n${command.usage}` : ''}`).join('\n\n'))
    .setFooter({ text: t("Cada funci\u00f3n comprueba tus permisos y los m\u00f3dulos habilitados. Men\u00fa v\u00e1lido por 5 minutos.") });
  const menu = new StringSelectMenuBuilder().setCustomId(`mgl:${token}`).setPlaceholder(t("Explora las funciones de Magelina")).addOptions(categories.map(item => ({ ...item, label: t(item.label), default: item.value === category })));
  return { content: '', embeds: [embed], components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)], allowedMentions: { parse: [] as never[] } };
}

export function helpPanel(userId: string, guildId: string) {
  return helpView(panels.create(userId, guildId, { kind: 'help' }));
}

export function musicSearchPanel(userId: string, guildId: string, tracks: MusicTrack[], canRequest: boolean) {
  const results = tracks.slice(0, 8);
  if (!results.length) return { content: t("No hay resultados disponibles."), embeds: [], components: [], allowedMentions: { parse: [] as never[] } };
  const content = results.map((track, index) => `**${index + 1}. ${safe(track.title)}** · ${safe(track.artist, 70)}\nID: \`${track.id}\``).join('\n\n').slice(0, 1700);
  if (!canRequest) return { content: `${content}\n\nNecesitas el permiso music.request para añadir canciones.`, embeds: [], components: [], allowedMentions: { parse: [] as never[] } };
  const token = panels.create(userId, guildId, { kind: 'music', tracks: results });
  const menu = new StringSelectMenuBuilder().setCustomId(`mgl:${token}`).setPlaceholder(t("Elige una canci\u00f3n para a\u00f1adirla a la cola")).addOptions(results.map((track, index) => ({ label: `${index + 1}. ${track.title}`.slice(0, 100), value: track.id, description: `${track.artist} · ${Math.floor(track.durationSeconds / 60)}:${String(track.durationSeconds % 60).padStart(2, '0')}`.slice(0, 100) })));
  return { content: `${content}\n\nSelecciona una canción. Este menú permite añadir una pista y vence en 5 minutos.`, embeds: [], components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)], allowedMentions: { parse: [] as never[] } };
}

export async function handleInteractive(interaction: Interaction, config: Pick<Config, 'ownerIds'>, musicFor: (client: Client) => Pick<MusicService, 'snapshot' | 'enqueue'> = getMusicService) {
  if (!interaction.isStringSelectMenu() || !interaction.customId.startsWith('mgl:')) return;
  const i = interaction;
  try {
    if (!i.guild) throw workflowError(400, t("Este men\u00fa solo funciona en un servidor."));
    const token = i.customId.slice(4);
    const panel = panels.get(token, i.user.id, i.guild.id);
    const selected = i.values.length === 1 ? i.values[0] : undefined;
    if (panel.kind === 'help' && !categories.some(category => category.value === selected)) throw workflowError(400, t("Categor\u00eda no v\u00e1lida."));
    if (panel.kind === 'music' && !panel.tracks.some(track => track.id === selected)) throw workflowError(400, t("Selecciona una canci\u00f3n de este men\u00fa."));
    // Claim before awaiting: a concurrent click receives its own private error,
    // without modifying this panel or submitting a second queue operation.
    if (panel.kind === 'music') panels.take(token, i.user.id, i.guild.id);
    await i.deferUpdate();
    await assertAvailable(i.guild.id, undefined, panel.kind === 'music');
    if (panel.kind === 'help') {
      await commandAccess(i, config);
      await i.editReply(helpView(token, selected));
      return;
    }
    await requireModule(i.guild.id, 'music');
    const { access } = await commandAccess(i, config);
    if (!access.capabilities.includes('music.request')) throw workflowError(403, t("Ya no tienes permiso para solicitar canciones."));
    const service = musicFor(i.client);
    const state = service.snapshot(i.guild.id);
    await service.enqueue(i.guild.id, selected!, i.user.id, state.version, async channelId => {
      const fresh = await commandAccess(i, config);
      if (!fresh.access.capabilities.includes('music.request')) throw workflowError(403, t("Tus permisos del reproductor cambiaron."));
      await assertAvailable(i.guild!.id);
      const channel = channelId ? await i.guild!.channels.fetch(channelId) : null;
      if (!channel || channel.type !== ChannelType.GuildVoice) throw workflowError(400, t("Conecta primero a Magelina con /musica conectar y vuelve a buscar."));
      if (!channel.permissionsFor(fresh.member)?.has([P.ViewChannel, P.Connect]) || (!fresh.access.canConfigure && fresh.member.voice.channelId !== channel.id)) throw workflowError(403, t("Debes tener acceso y estar en el mismo canal de voz."));
      const me = await i.guild!.members.fetchMe({ force: true });
      if (!channel.permissionsFor(me)?.has([P.ViewChannel, P.Connect, P.Speak])) throw workflowError(403, t("Magelina necesita Ver canal, Conectar y Hablar."));
    });
    await i.editReply({ content: t("Canci\u00f3n a\u00f1adida a la cola. Consulta /musica cola para ver la reproducci\u00f3n."), embeds: [], components: [], allowedMentions: { parse: [] } });
  } catch (error) {
    logRecord('bot.component.failed', { command: 'select', guildId: i.guildId, outcome: 'failed' });
    const content = error instanceof Error && 'publicMessage' in error && typeof error.publicMessage === 'string' ? t(error.publicMessage) : t("No se pudo completar la interacci\u00f3n. Ejecuta el comando de nuevo.");
    try {
      if (i.deferred) await i.editReply({ content, components: [], embeds: [], allowedMentions: { parse: [] } });
      else await i.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
    } catch { logRecord('bot.component.reply-failed', { guildId: i.guildId, outcome: 'failed' }); }
  }
}
