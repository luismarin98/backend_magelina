import { ChannelType, EmbedBuilder, PermissionFlagsBits as P, escapeMarkdown, type Client } from 'discord.js';
import type { MusicQueueEntry } from '../../types/contracts.js';
import { logRecord } from '../../observability/logging.js';

export interface MusicNotice {
  kind: 'added' | 'started' | 'finished' | 'failed' | 'skipped';
  guildId: string;
  channelId: string;
  entries: MusicQueueEntry[];
  next: MusicQueueEntry | null;
  pending: number;
}
export type MusicNotifier = (notice: MusicNotice) => Promise<void>;
const text = (value: string) => escapeMarkdown(value.replace(/[\r\n]/g, ' ').slice(0, 150));
const requester = (id: string) => /^\d{17,20}$/.test(id) ? `<@${id}>` : 'Usuario';
const line = (entry: MusicQueueEntry) => `**${text(entry.track.title)}** · ${requester(entry.requestedBy)}`;

export function musicNoticeMessage(notice: MusicNotice) {
  const titles = {
    added: notice.entries.length > 1 ? `${notice.entries.length} canciones añadidas a la cola` : 'Canción añadida a la cola',
    started: 'Ahora suena', finished: 'Canción terminada',
    failed: 'No se pudo completar la canción', skipped: 'Canción saltada',
  };
  const entry = notice.entries[0];
  const description = notice.entries.slice(0, 3).map(line).join('\n')
    + (notice.entries.length > 3 ? `\nY ${notice.entries.length - 3} canciones más.` : '');
  const embed = new EmbedBuilder().setColor(notice.kind === 'failed' ? 0xed4245 : 0xef75bd)
    .setTitle(titles[notice.kind]).setDescription(description || 'La cola está vacía.')
    .addFields({ name: notice.kind === 'added' ? 'Próxima en cola' : 'A continuación', value: notice.next ? line(notice.next) : 'No hay más canciones pendientes.' })
    .setFooter({ text: `${notice.pending} pendientes · /musica cola para consultar la lista` });
  if (notice.kind === 'started' && entry) {
    const seconds = entry.track.durationSeconds;
    embed.addFields({ name: 'Duración', value: `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`, inline: true });
  }
  return { embeds: [embed], allowedMentions: { parse: [] as never[], users: [] as string[], roles: [] as string[], repliedUser: false } };
}

/** Per-guild ordering without holding up playback; cap backlog during Discord outages. */
export function createMusicNotifier(bot: Client): MusicNotifier {
  const deliveries = new Map<string, { tail: Promise<void>; pending: number }>();
  return async notice => {
    let delivery = deliveries.get(notice.guildId);
    if (!delivery) { delivery = { tail: Promise.resolve(), pending: 0 }; deliveries.set(notice.guildId, delivery); }
    if (delivery.pending >= 50) {
      logRecord('music.notice.failed', { guildId: notice.guildId, reason: 'backlog-full', outcome: 'failed' });
      return;
    }
    delivery.pending++;
    const current = delivery;
    const sent = current.tail.then(async () => {
      const guild = bot.guilds.cache.get(notice.guildId);
      // Never fall back to a public text channel or send to a channel the bot has left.
      if (!guild || guild.members.me?.voice.channelId !== notice.channelId) return;
      const channel = await guild.channels.fetch(notice.channelId);
      if (!channel || channel.type !== ChannelType.GuildVoice || !channel.permissionsFor(bot.user!)?.has([P.ViewChannel, P.SendMessages, P.EmbedLinks])) {
        logRecord('music.notice.failed', { guildId: notice.guildId, reason: 'channel-permissions', outcome: 'failed' });
        return;
      }
      await channel.send(musicNoticeMessage(notice));
    }).catch(() => {
      logRecord('music.notice.failed', { guildId: notice.guildId, reason: 'discord-send-failed', outcome: 'failed' });
    }).finally(() => {
      current.pending--;
      if (!current.pending && deliveries.get(notice.guildId) === current) deliveries.delete(notice.guildId);
    });
    current.tail = sent;
    await sent;
  };
}
