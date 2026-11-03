import mongoose from 'mongoose';
import { GridFSBucket } from 'mongodb';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { randomUUID } from 'node:crypto';
import { ChannelType, PermissionsBitField, PermissionFlagsBits as P, type Attachment, type Guild, type Message, type TextChannel, type ThreadChannel } from 'discord.js';
import { SupportTicket } from '../../database/models/SupportTicket.js';
import { SupportMessage } from '../../database/models/SupportMessage.js';
import { workflowError } from '../workflow/rules.js';
import { hasCode } from '../../types/errors.js';
import type { supportContext } from './service.js';

export function transcriptFiles() {
  if (!mongoose.connection.db) throw workflowError(503, 'La base de datos no está disponible para guardar los adjuntos.');
  return new GridFSBucket(mongoose.connection.db, { bucketName: 'supportAttachments' });
}

export async function preserveAttachment(guildId: string, ticketId: string, attachment: Attachment, bucket = transcriptFiles(), download: typeof fetch = fetch) {
  const metadata = { guildId, ticketId, attachmentId: attachment.id };
  const existing = await bucket.find({ 'metadata.guildId': guildId, 'metadata.ticketId': ticketId, 'metadata.attachmentId': attachment.id }).limit(1).next();
  if (existing) return String(existing._id);
  const url = new URL(attachment.url);
  if (url.protocol !== 'https:' || !['cdn.discordapp.com', 'media.discordapp.net'].includes(url.hostname)) throw workflowError(409, 'Un adjunto no tiene una dirección de Discord válida. El canal se conserva.');
  const response = await download(url, { redirect: 'error', signal: AbortSignal.timeout(120000) });
  if (!response.ok || !response.body) throw workflowError(502, 'No se pudo guardar un adjunto. El canal se conserva.');
  const upload = bucket.openUploadStream(attachment.name, { metadata });
  try {
    await pipeline(Readable.fromWeb(response.body as import('node:stream/web').ReadableStream<Uint8Array>), upload);
    const stored = await bucket.find({ _id: upload.id }).next();
    if (!stored || stored.length !== attachment.size) { await bucket.delete(upload.id); throw workflowError(502, 'El adjunto no se guardó completo. El canal se conserva.'); }
    return String(upload.id);
  } catch (cause) { await upload.abort().catch(() => {}); throw cause; }
}

export interface TranscriptStore {
  attachment: typeof preserveAttachment;
  message: (record: Record<string, unknown>) => Promise<void>;
}
const store: TranscriptStore = { attachment: preserveAttachment, message: async record => {
  await SupportMessage.updateOne({ guildId: record.guildId, ticketId: record.ticketId, runId: record.runId, messageId: record.messageId }, { $set: record }, { upsert: true, runValidators: true });
} };

export async function captureTranscript(channel: Pick<TextChannel, 'messages'> & Partial<Pick<TextChannel, 'id' | 'name'>>, guildId: string, ticketId: string, runId: string, persistence = store) {
  let before: string | undefined, count = 0, newestId: string | null = null;
  for (;;) {
    const batch = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}), cache: false });
    const messages = [...batch.values()].sort((a, b) => BigInt(a.id) < BigInt(b.id) ? 1 : -1);
    if (!messages.length) break;
    newestId ??= messages[0].id;
    for (const message of messages) {
      assertMessageReadable(message);
      const attachments = [];
      for (const attachment of message.attachments.values()) attachments.push({ id: attachment.id, name: attachment.name, size: attachment.size, storageId: await persistence.attachment(guildId, ticketId, attachment) });
      await persistence.message({ guildId, ticketId, runId, messageId: message.id, messageOrder: message.id, channelId: channel.id, channelName: channel.name, authorId: message.author.id, author: message.author.globalName ?? message.author.username,
        content: message.content, createdAt: message.createdAt, editedAt: message.editedAt, type: message.type, replyTo: message.reference?.messageId ?? null,
        embeds: message.embeds.map(embed => embed.toJSON()), components: message.components.map(component => component.toJSON()), stickers: [...message.stickers.values()].map(sticker => ({ id: sticker.id, name: sticker.name, url: sticker.url })), attachments });
      count++;
    }
    const next = messages.at(-1)!.id;
    if (next === before) throw workflowError(502, 'Discord repitió una página del historial. El canal se conserva.');
    before = next;
    if (batch.size < 100) break;
  }
  return { count, newestId };
}

export function assertMessageReadable(message: Pick<Message, 'system' | 'content' | 'attachments' | 'embeds' | 'stickers' | 'components'>) {
  if (!message.system && !message.content && !message.attachments.size && !message.embeds.length && !message.stickers.size && !message.components.length) throw workflowError(409, 'Discord no entregó el contenido de un mensaje. Revisa Message Content Intent antes de archivar; el canal no se eliminará.');
}

export async function transcriptChannels(channel: TextChannel): Promise<(TextChannel | ThreadChannel)[]> {
  const threads = new Map<string, ThreadChannel>();
  const active = await channel.threads.fetchActive();
  for (const thread of active.threads.values()) threads.set(thread.id, thread);
  for (const type of ['public', 'private'] as const) {
    let before: Date | undefined;
    for (;;) {
      const batch = await channel.threads.fetchArchived({ type, fetchAll: true, limit: 100, ...(before ? { before } : {}) }).catch(() => { throw workflowError(403, 'Magelina necesita acceder a los hilos y Gestionar hilos para comprobar el historial completo. El canal se conserva.'); });
      for (const thread of batch.threads.values()) threads.set(thread.id, thread);
      if (!batch.hasMore) break;
      const oldest = Math.min(...[...batch.threads.values()].map(thread => thread.archiveTimestamp ?? Number.NaN));
      if (!Number.isFinite(oldest) || (before && oldest >= before.getTime())) throw workflowError(502, 'No se pudo completar el historial de hilos. El canal se conserva.');
      before = new Date(oldest);
    }
  }
  return [channel, ...threads.values()];
}

export async function archiveAndDeleteChannel(guild: Guild, actorId: string, ctx: Awaited<ReturnType<typeof supportContext>>, ticket: { _id: unknown; state: string; assigneeId?: string | null; channelId?: string | null; channelDeletedAt?: Date | null }, expected: number, capture = captureTranscript) {
  if (!ctx.canAdmin && !(ctx.canModerate && ticket.assigneeId === actorId)) throw workflowError(403, 'Solo el moderador asignado o un administrador puede eliminar el canal.');
  if (ticket.state !== 'closed') throw workflowError(409, 'Resuelve el caso antes de eliminar su canal.');
  if (ticket.channelDeletedAt) return await SupportTicket.findOne({ _id: ticket._id, guildId: guild.id });
  if (!ticket.channelId) throw workflowError(409, 'Este caso no tiene canal de atención.');
  const locked = await SupportTicket.findOneAndUpdate({ _id: ticket._id, guildId: guild.id, state: 'closed', version: expected, $or: [{ archiveStatus: { $ne: 'archiving' } }, { archiveHeartbeatAt: { $lt: new Date(Date.now() - 300000) } }] }, { $set: { archiveStatus: 'archiving', archiveHeartbeatAt: new Date(), archiveError: null }, $inc: { version: 1 } }, { new: true });
  if (!locked) throw workflowError(409, 'El caso cambió o ya se está archivando. Actualiza antes de continuar.');
  const heartbeat = setInterval(() => { void SupportTicket.updateOne({ _id: ticket._id, guildId: guild.id, version: locked.version, archiveStatus: 'archiving' }, { $set: { archiveHeartbeatAt: new Date() } }).catch(() => {}); }, 20000);
  heartbeat.unref();
  let archived = false;
  try {
    const channel = await guild.channels.fetch(ticket.channelId).catch((error: unknown) => { if (hasCode(error, 10003)) return null; throw error; });
    if (!channel) {
      if (!locked.transcriptArchivedAt) throw workflowError(409, 'El canal ya no existe y no hay un historial completo guardado.');
      archived = true;
    } else {
      if (channel.type !== ChannelType.GuildText || !channel.permissionsFor(ctx.me)?.has([P.ViewChannel, P.ReadMessageHistory, P.ManageChannels, P.ManageRoles]) || (ctx.actor && !channel.permissionsFor(ctx.actor)?.has([P.ViewChannel, P.ReadMessageHistory]))) throw workflowError(403, 'No se puede leer y gestionar el canal para archivarlo.');
      // A resolved support channel becomes read-only while its transcript is captured.
      const writes = P.SendMessages | P.CreatePublicThreads | P.CreatePrivateThreads | P.SendMessagesInThreads;
      await channel.permissionOverwrites.set([...channel.permissionOverwrites.cache.values()].map(overwrite => ({ id: overwrite.id, type: overwrite.type, allow: new PermissionsBitField(overwrite.allow).remove(writes).bitfield, deny: new PermissionsBitField(overwrite.deny).add(writes).bitfield })), `Magelina: archivo del caso por ${actorId}`);
      const runId = randomUUID(), sources = await transcriptChannels(channel);
      const snapshots: { source: TextChannel | ThreadChannel; newestId: string | null }[] = [];
      let count = 0;
      for (const source of sources) { const result = await capture(source, guild.id, String(ticket._id), runId); snapshots.push({ source, newestId: result.newestId }); count += result.count; }
      const verify = async () => {
        for (const snapshot of snapshots) {
          const latest = await snapshot.source.messages.fetch({ limit: 1, cache: false });
          if ((latest.first()?.id ?? null) !== snapshot.newestId) throw workflowError(409, 'Llegaron mensajes nuevos durante el archivo. El canal se conserva; vuelve a intentarlo.');
        }
      };
      await verify();
      const saved = await SupportTicket.findOneAndUpdate({ _id: ticket._id, guildId: guild.id, archiveStatus: 'archiving', version: locked.version }, { $set: { transcriptRunId: runId, transcriptArchivedAt: new Date(), transcriptMessageCount: count } }, { new: true });
      if (!saved) throw workflowError(409, 'No se pudo confirmar el historial guardado. El canal se conserva.');
      archived = true;
      const currentSources = await transcriptChannels(channel);
      if (currentSources.map(source => source.id).sort().join() !== sources.map(source => source.id).sort().join()) throw workflowError(409, 'Los hilos del canal cambiaron durante el archivo. El canal se conserva; vuelve a intentarlo.');
      await verify();
      await channel.delete(`Magelina: caso resuelto y archivado por ${actorId}`).catch((error: unknown) => { if (!hasCode(error, 10003)) throw error; });
    }
    const result = await SupportTicket.findOneAndUpdate({ _id: ticket._id, guildId: guild.id, archiveStatus: 'archiving', version: locked.version }, { $set: { archiveStatus: 'ready', channelDeletedAt: new Date(), archiveError: null, archiveHeartbeatAt: null }, $inc: { version: 1 }, $push: { history: { actorId, action: 'channel_deleted', at: new Date() } } }, { new: true });
    if (!result) throw workflowError(503, 'El historial está guardado, pero no se confirmó la eliminación. Actualiza el caso.');
    return result;
  } catch (cause) {
    const message = cause instanceof Error && 'publicMessage' in cause ? String(cause.publicMessage) : archived ? 'El historial está guardado. No se pudo confirmar la eliminación del canal; puedes reintentar.' : 'No se pudo guardar el historial completo. El canal se conserva.';
    await SupportTicket.updateOne({ _id: ticket._id, guildId: guild.id, version: locked.version }, { $set: { archiveStatus: archived ? 'ready' : 'failed', archiveHeartbeatAt: null, archiveError: message } }).catch(() => {});
    throw workflowError(archived ? 503 : 409, message);
  } finally { clearInterval(heartbeat); }
}
