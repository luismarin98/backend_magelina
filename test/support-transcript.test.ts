import test from 'node:test';
import assert from 'node:assert/strict';
import { ChannelType, Collection, PermissionFlagsBits as P, PermissionsBitField, type Guild, type Message, type TextChannel } from 'discord.js';
import { captureTranscript, assertMessageReadable, archiveAndDeleteChannel, preserveAttachment, transcriptChannels, type TranscriptStore } from '../src/modules/support/transcript.js';
import { Writable } from 'node:stream';
import { GridFSBucket, ObjectId } from 'mongodb';
import type { Attachment } from 'discord.js';
import { SupportTicket } from '../src/database/models/SupportTicket.js';
import type { supportContext } from '../src/modules/support/service.js';

const guildId = '100000000000000001', userId = '100000000000000002', moderatorId = '100000000000000003', channelId = '100000000000000004';
function message(index: number) {
  return { id: String(200000000000000000n - BigInt(index)), system: false, content: `Mensaje ${index}`, author: { id: userId, username: 'ana', globalName: 'Ana' }, createdAt: new Date(), editedAt: null, type: 0, reference: null, attachments: new Collection(), stickers: new Collection(), embeds: [], components: [] } as unknown as Message<true>;
}

test('archives all message pages and durable attachment references, rather than only the last 50', async () => {
  const messages = Array.from({ length: 205 }, (_, index) => message(index)), calls: any[] = [], records: any[] = [], files: string[] = [];
  messages[0].attachments.set('attachment', { id: 'attachment', name: 'evidencia.png', size: 42 } as never);
  const channel = { id: channelId, name: 'soporte', messages: { fetch: async (options: any) => {
    calls.push(options); const start = options.before ? messages.findIndex(message => message.id === options.before) + 1 : 0;
    return new Collection(messages.slice(start, start + options.limit).map(message => [message.id, message]));
  } } } as unknown as TextChannel;
  const store: TranscriptStore = { message: async record => { records.push(record); }, attachment: async (_guild, _ticket, attachment) => { files.push(attachment.name); return 'abcdefabcdefabcdefabcdef'; } };
  const result = await captureTranscript(channel, guildId, 'abcdefabcdefabcdefabcdef', 'run', store);
  assert.equal(result.count, 205); assert.equal(records.length, 205); assert.equal(calls.length, 3);
  assert.equal(calls[1].before, messages[99].id); assert.equal(calls[2].before, messages[199].id);
  assert.equal(records[0].attachments[0].storageId, 'abcdefabcdefabcdefabcdef'); assert.deepEqual(files, ['evidencia.png']);
  assert.equal(records[204].content, 'Mensaje 204'); assert.equal(records[0].channelId, channelId);
});

test('refuses inaccessible message content instead of silently losing it', () => {
  const unreadable = message(0); unreadable.content = '';
  assert.throws(() => assertMessageReadable(unreadable), /Message Content Intent/);
  assert.doesNotThrow(() => assertMessageReadable({ ...unreadable, system: true }));
});

test('stores attachment bytes durably, reuses saved files, and rejects incomplete downloads', async () => {
  const id = new ObjectId(); let stored: any = null, downloads = 0, deleted = 0;
  const chunks: Buffer[] = [];
  const upload = Object.assign(new Writable({ write(chunk, _encoding, done) { chunks.push(Buffer.from(chunk)); done(); }, final(done) { stored = { _id: id, length: Buffer.concat(chunks).length }; done(); } }), { id, abort: async () => {} });
  const bucket = { find: () => ({ limit: () => ({ next: async () => stored }), next: async () => stored }), openUploadStream: () => upload, delete: async () => { deleted++; } } as unknown as GridFSBucket;
  const download: typeof fetch = async () => { downloads++; return new Response(new Uint8Array([1, 2, 3])); };
  const attachment = { id: '100000000000000099', name: 'evidencia.png', size: 3, url: 'https://cdn.discordapp.com/attachments/file.png' } as Attachment;
  assert.equal(await preserveAttachment(guildId, 'case', attachment, bucket, download), String(id));
  assert.deepEqual(Buffer.concat(chunks), Buffer.from([1, 2, 3]));
  assert.equal(await preserveAttachment(guildId, 'case', attachment, bucket, download), String(id)); assert.equal(downloads, 1);
  stored = null;
  await assert.rejects(preserveAttachment(guildId, 'case', { ...attachment, url: 'https://example.com/file' } as Attachment, bucket, download), /dirección de Discord/);
  const invalidUpload = Object.assign(new Writable({ write(_chunk, _encoding, done) { done(); }, final(done) { stored = { _id: id, length: 2 }; done(); } }), { id, abort: async () => {} });
  const invalidBucket = { ...bucket, find: () => ({ limit: () => ({ next: async () => null }), next: async () => stored }), openUploadStream: () => invalidUpload, delete: async () => { deleted++; } } as unknown as GridFSBucket;
  await assert.rejects(preserveAttachment(guildId, 'case', attachment, invalidBucket, download), /no se guardó completo/); assert.equal(deleted, 1);
});

test('includes active and archived public/private threads in the transcript', async () => {
  const active = { id: 'thread-a', archiveTimestamp: 1000 }, archived = { id: 'thread-b', archiveTimestamp: 900 };
  const channel = { id: channelId, threads: { fetchActive: async () => ({ threads: new Collection([[active.id, active]]) }), fetchArchived: async (options: { type: string; fetchAll: boolean }) => {
    assert.equal(options.fetchAll, true); return { threads: new Collection(options.type === 'private' ? [[archived.id, archived]] : [[active.id, active]]), hasMore: false };
  } } } as unknown as TextChannel;
  assert.deepEqual((await transcriptChannels(channel)).map(source => source.id), [channelId, active.id, archived.id]);
});

test('deletes a resolved case channel only after persistence is confirmed, with safe retries', async t => {
  let record: any, order: string[] = [], failCapture = false, failConfirm = false, failDelete = false, channelMissing = false, changed = false;
  const latest = message(0);
  const channel = { id: channelId, type: ChannelType.GuildText, permissionsFor: () => new PermissionsBitField(P.Administrator),
    permissionOverwrites: { cache: new Collection([[guildId, { id: guildId, type: 0, allow: new PermissionsBitField(), deny: new PermissionsBitField() }]]), set: async () => {} },
    threads: { fetchActive: async () => ({ threads: new Collection() }), fetchArchived: async () => ({ threads: new Collection(), hasMore: false }) },
    messages: { fetch: async () => new Collection([[latest.id, { ...latest, id: changed ? message(1).id : latest.id }]]) },
    delete: async () => { order.push('deleted'); if (failDelete) throw new Error('Discord unavailable'); },
  };
  const guild = { id: guildId, channels: { fetch: async () => channelMissing ? null : channel } } as unknown as Guild;
  const ctx = { canAdmin: true, canModerate: true, actor: null, me: { id: moderatorId } } as Awaited<ReturnType<typeof supportContext>>;
  const capture: typeof captureTranscript = async () => { order.push('captured'); if (failCapture) throw new Error('Storage unavailable'); return { count: 205, newestId: latest.id }; };
  t.mock.method(SupportTicket, 'findOneAndUpdate', (async (filter: any, update: any) => {
    if (filter.version !== record.version || (filter.archiveStatus && filter.archiveStatus !== record.archiveStatus)) return null;
    if (filter.$or && record.archiveStatus === 'archiving' && record.archiveHeartbeatAt > new Date(Date.now() - 300000)) return null;
    if (update.$set.transcriptArchivedAt) { if (failConfirm) return null; order.push('archive-confirmed'); }
    Object.assign(record, update.$set); record.version += update.$inc?.version ?? 0; return { ...record };
  }) as never);
  t.mock.method(SupportTicket, 'updateOne', (async (filter: any, update: any) => { if (filter.version === record.version) Object.assign(record, update.$set); }) as never);
  function reset() { record = { _id: 'abcdefabcdefabcdefabcdef', guildId, state: 'closed', channelId, assigneeId: moderatorId, version: 2, archiveStatus: 'idle' }; order = []; failCapture = failConfirm = failDelete = channelMissing = changed = false; }
  reset();
  await assert.rejects(archiveAndDeleteChannel(guild, userId, { ...ctx, canAdmin: false, canModerate: false }, record, 2, capture), /Solo el moderador/);
  await assert.rejects(archiveAndDeleteChannel(guild, moderatorId, ctx, { ...record, state: 'in_progress' }, 2, capture), /Resuelve el caso/);
  const done = await archiveAndDeleteChannel(guild, moderatorId, ctx, record, 2, capture);
  assert.deepEqual(order, ['captured', 'archive-confirmed', 'deleted']); assert.equal(done!.archiveStatus, 'ready'); assert.ok(done!.channelDeletedAt); assert.equal(done!.transcriptMessageCount, 205);
  reset(); failCapture = true;
  await assert.rejects(archiveAndDeleteChannel(guild, moderatorId, ctx, record, 2, capture), /historial completo/);
  assert.equal(order.includes('deleted'), false); assert.equal(record.archiveStatus, 'failed');
  reset(); failConfirm = true;
  await assert.rejects(archiveAndDeleteChannel(guild, moderatorId, ctx, record, 2, capture), /confirmar el historial/);
  assert.equal(order.includes('deleted'), false);
  reset(); changed = true;
  await assert.rejects(archiveAndDeleteChannel(guild, moderatorId, ctx, record, 2, capture), /mensajes nuevos/);
  assert.equal(order.includes('deleted'), false);
  reset(); failDelete = true;
  await assert.rejects(archiveAndDeleteChannel(guild, moderatorId, ctx, record, 2, capture), /historial está guardado/);
  assert.ok(record.transcriptArchivedAt); assert.equal(record.archiveStatus, 'ready');
  failDelete = false; channelMissing = true;
  const recovered = await archiveAndDeleteChannel(guild, moderatorId, ctx, record, record.version, capture);
  assert.ok(recovered!.channelDeletedAt); assert.equal(recovered!.archiveStatus, 'ready');
  reset(); record.archiveStatus = 'archiving'; record.archiveHeartbeatAt = new Date();
  await assert.rejects(archiveAndDeleteChannel(guild, moderatorId, ctx, record, 2, capture), /ya se está archivando/);
});
