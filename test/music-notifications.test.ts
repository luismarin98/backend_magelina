import test from 'node:test';
import assert from 'node:assert/strict';
import { ChannelType, type Client } from 'discord.js';
import { createMusicNotifier, musicNoticeMessage, type MusicNotice } from '../src/modules/music/notifications.js';

const guildId = '100000000000000001', channelId = '100000000000000002';
const notice: MusicNotice = {
  kind: 'started', guildId, channelId, pending: 0, next: null,
  entries: [{ id: 'entry', requestedBy: '100000000000000003', track: {
    id: 'youtube:abcdefghijk', title: 'Tema de prueba', artist: 'Artista', durationSeconds: 125,
    permalink: 'https://www.youtube.com/watch?v=abcdefghijk', artworkUrl: null,
  } }],
};

function setup() {
  const sent: ReturnType<typeof musicNoticeMessage>[] = [];
  let permitted = true;
  const channel = {
    type: ChannelType.GuildVoice, permissionsFor: () => ({ has: () => permitted }),
    send: async (message: ReturnType<typeof musicNoticeMessage>) => { sent.push(message); },
  };
  const guild = { members: { me: { voice: { channelId } } }, channels: { fetch: async () => channel } };
  const bot = { user: { id: 'bot' }, guilds: { cache: new Map([[guildId, guild]]) } } as unknown as Client;
  return { notify: createMusicNotifier(bot), channel, guild, sent, deny: () => { permitted = false; } };
}

test('music notices identify the requester, duration and empty queue without pinging', () => {
  const message = musicNoticeMessage(notice), embed = message.embeds[0]!.toJSON();
  assert.equal(embed.title, 'Ahora suena');
  assert.match(embed.description!, /<@100000000000000003>/);
  assert.equal(embed.fields?.find(field => field.name === 'Duración')?.value, '2:05');
  assert.equal(embed.fields?.[0]?.value, 'No hay más canciones pendientes.');
  assert.deepEqual(message.allowedMentions.parse, []);
  assert.deepEqual(message.allowedMentions.users, []);
});

test('playlist summary and next-track fields stay within Discord embed limits', () => {
  const entries = Array.from({ length: 25 }, () => structuredClone(notice.entries[0]!));
  entries.forEach(entry => { entry.track.title = '*'.repeat(200); });
  const message = musicNoticeMessage({ ...notice, kind: 'added', entries, next: entries[1]!, pending: 25 });
  const embed = message.embeds[0]!.toJSON();
  assert.equal(embed.title, '25 canciones añadidas a la cola');
  assert.match(embed.description!, /Y 22 canciones más/);
  assert.ok(embed.description!.length <= 4096);
  assert.ok(embed.fields!.every(field => field.value.length <= 1024));
});

test('notices go to the active voice channel and missing permissions skip delivery', async () => {
  const { notify, sent, guild, deny } = setup();
  await notify(notice);
  assert.equal(sent.length, 1);
  deny();
  await notify(notice);
  assert.equal(sent.length, 1);
  guild.members.me.voice.channelId = 'another-channel';
  await notify(notice);
  assert.equal(sent.length, 1);
});

test('Discord delivery failures are isolated and following notices can still be sent', async () => {
  const { notify, channel, sent } = setup();
  const send = channel.send;
  channel.send = async () => { throw new Error('Discord unavailable'); };
  await assert.doesNotReject(notify(notice));
  channel.send = send;
  await notify(notice);
  assert.equal(sent.length, 1);
});

test('notices preserve order and limit backlog while Discord is slow', async () => {
  const { notify, channel, sent } = setup();
  const send = channel.send;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let calls = 0;
  channel.send = async message => { if (++calls === 1) await gate; await send(message); };
  const pending = Array.from({ length: 55 }, (_, index) => notify({ ...notice, kind: index === 0 ? 'added' : 'started' }));
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(calls, 1);
  release();
  await Promise.all(pending);
  assert.equal(sent.length, 50);
  assert.equal(sent[0]?.embeds[0]?.toJSON().title, 'Canción añadida a la cola');
  assert.equal(sent[1]?.embeds[0]?.toJSON().title, 'Ahora suena');
});
