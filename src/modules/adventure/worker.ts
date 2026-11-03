import { randomUUID } from 'node:crypto';
import { ChannelType, escapeMarkdown, type Client } from 'discord.js';
import { AdventureConfig, AdventureMembership } from '../../database/models/Adventure.js';
import { getControls } from '../operations/service.js';
import { integrationDefaults } from './integration.js';

export async function deliverAdventureAnnouncements(bot: Client, isStopped = () => false) {
    if (!bot.isReady()) return;
    const controls = await getControls();
    if (controls.maintenance) return;
    await AdventureMembership.updateMany({ announcement: 'processing', announcementDueAt: { $lte: new Date() }, announcementAttempts: { $gte: 5 } }, { $set: { announcement: 'failed', announcementError: 'Se agotaron los intentos de envío.' } });
    for (let index = 0; index < 10 && !isStopped(); index++) {
      const token = randomUUID();
      const job = await AdventureMembership.findOneAndUpdate({ guildId: { $nin: controls.blockedGuildIds }, announcement: { $in: ['pending', 'processing'] }, announcementDueAt: { $lte: new Date() }, announcementAttempts: { $lt: 5 } }, { $set: { announcement: 'processing', announcementToken: token, announcementDueAt: new Date(Date.now() + 120000) }, $inc: { announcementAttempts: 1 } }, { new: true, sort: { announcementDueAt: 1 } });
      if (!job) break;
      const claim = { _id: job._id, announcementToken: token };
      try {
        const config = await AdventureConfig.findOne({ guildId: job.guildId }).lean(), settings = integrationDefaults(config);
        if (!config?.enabled || !settings.enabled || !settings.announceJoins || settings.channelId !== job.announcementChannelId) {
          await AdventureMembership.updateOne(claim, { $set: { announcement: 'skipped' } }); continue;
        }
        const guild = await bot.guilds.fetch(job.guildId), channel = await guild.channels.fetch(settings.channelId!);
        if (channel?.type !== ChannelType.GuildText || channel.parentId !== settings.categoryId) throw new Error('Canal de avisos no disponible dentro de la categoría configurada.');
        await channel.send({ content: `📜 ${escapeMarkdown(job.announcementAlias ?? 'Un aventurero')} se ha inscrito en el gremio.`, allowedMentions: { parse: [], users: [], roles: [], repliedUser: false }, nonce: String(job._id), enforceNonce: true });
        await AdventureMembership.updateOne(claim, { $set: { announcement: 'sent', announcementError: null } });
      } catch {
        await AdventureMembership.updateOne(claim, { $set: { announcement: job.announcementAttempts >= 5 ? 'failed' : 'pending', announcementDueAt: new Date(Date.now() + 30000 * 2 ** job.announcementAttempts), announcementError: 'No se pudo enviar el aviso. Comprueba el canal y los permisos del bot.' } });
      }
    }
}
export function startAdventureWorker(bot: Client) {
  let stopped = false, running: Promise<void> | undefined;
  const timer = setInterval(() => {
    if (!running && !stopped) running = deliverAdventureAnnouncements(bot, () => stopped).catch(() => { console.warn('No se pudo procesar la cola de avisos del gremio.'); }).finally(() => { running = undefined; });
  }, 15000);
  timer.unref();
  return async () => { stopped = true; clearInterval(timer); await running; };
}
