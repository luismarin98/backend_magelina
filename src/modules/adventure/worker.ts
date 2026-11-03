import { generateCountryExpeditions } from './expedition-generator.js';
import { AdventureReceipt } from '../../database/models/AdventureEconomy.js';
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
export async function deliverTravelAnnouncements(bot: Client, isStopped = () => false) {
  if (!bot.isReady()) return;
  const controls = await getControls();
  if (controls.maintenance) return;
  await AdventureReceipt.updateMany({ 'notice.state': 'processing', 'notice.dueAt': { $lte: new Date() }, 'notice.attempts': { $gte: 5 } }, { $set: { 'notice.state': 'failed' } });
  for (let index = 0; index < 10 && !isStopped(); index++) {
    const token = randomUUID();
    const job = await AdventureReceipt.findOneAndUpdate({ 'notice.guildId': { $nin: controls.blockedGuildIds }, 'notice.state': { $in: ['pending', 'processing'] }, 'notice.dueAt': { $lte: new Date() }, 'notice.attempts': { $lt: 5 } }, { $set: { 'notice.state': 'processing', 'notice.token': token, 'notice.dueAt': new Date(Date.now() + 120000) }, $inc: { 'notice.attempts': 1 } }, { new: true });
    if (!job?.notice) break;
    const notice = job.notice, claim = { _id: job._id, 'notice.token': token };
    try {
      const config = await AdventureConfig.findOne({ guildId: notice.guildId }).lean(), settings = integrationDefaults(config);
      if (!config?.enabled || !settings.enabled || !settings.announceArrivals || settings.channelId !== notice.channelId || settings.categoryId !== notice.categoryId) {
        await AdventureReceipt.updateOne(claim, { $set: { 'notice.state': 'skipped' } }); continue;
      }
      const guild = await bot.guilds.fetch(notice.guildId!), channel = await guild.channels.fetch(notice.channelId!);
      if (channel?.type !== ChannelType.GuildText || channel.parentId !== notice.categoryId) throw new Error('Canal no disponible.');
      await channel.send({ content: `${escapeMarkdown(notice.alias ?? 'Un aventurero')} lleg\u00f3 a ${escapeMarkdown(guild.name)}.`, allowedMentions: { parse: [], users: [], roles: [], repliedUser: false }, nonce: String(job._id), enforceNonce: true });
      await AdventureReceipt.updateOne(claim, { $set: { 'notice.state': 'sent' } });
    } catch {
      await AdventureReceipt.updateOne(claim, { $set: { 'notice.state': notice.attempts >= 5 ? 'failed' : 'pending', 'notice.dueAt': new Date(Date.now() + 30000 * 2 ** notice.attempts) } });
    }
  }
}
export function startAdventureWorker(bot: Client) {
  let stopped = false, running: Promise<void> | undefined;
  const timer = setInterval(() => {
    if (!running && !stopped) running = (async () => {
      const tasks = [async () => { if (bot.isReady()) await generateCountryExpeditions(); }, () => deliverAdventureAnnouncements(bot, () => stopped), () => deliverTravelAnnouncements(bot, () => stopped)];
      for (const task of tasks) {
        if (stopped) break;
        try { await task(); }
        catch { console.warn('No se pudo completar una tarea del gremio. Se reintentará en el siguiente ciclo.'); }
      }
    })().finally(() => { running = undefined; });
  }, 15000);
  timer.unref();
  return async () => { stopped = true; clearInterval(timer); await running; };
}
