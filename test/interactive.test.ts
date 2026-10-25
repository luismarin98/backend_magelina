import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { ChannelType, type Interaction } from 'discord.js';
import { PanelSessions } from '../src/bot/panel-sessions.js';
import { handleInteractive, helpPanel, musicSearchPanel } from '../src/bot/interactive.js';
import { GuildPolicy } from '../src/database/models/GuildPolicy.js';
import { GuildSettings } from '../src/database/models/GuildSettings.js';
import { BotControl } from '../src/database/models/BotControl.js';
import { emptyGrants } from '../src/modules/permissions/rules.js';
import type { MusicState, MusicTrack } from '../src/types/contracts.js';
import type { MusicService } from '../src/modules/music/service.js';

const guildId = '100000000000000001', userId = '100000000000000002', roleId = '100000000000000003', channelId = '100000000000000004';
const config = { ownerIds: [] };
const track: MusicTrack = { id: 'abc12', title: 'Canción **prueba** @everyone', artist: 'Artista', durationSeconds: 180, permalink: 'https://audius.co/artist/song', artworkUrl: null };
const state: MusicState = { version: 4, channelId, status: 'idle', current: null, queue: [], volume: 30, error: null };
function selection(customId: string, value: string, actor = userId) {
  const edits: unknown[] = [], replies: unknown[] = [];
  let currentChannel = channelId;
  const member = { id: userId, permissions: { has: () => false }, roles: { cache: new Map([[roleId, {}]]) }, voice: { get channelId() { return currentChannel; } } };
  const permissions = { has: () => true };
  const i = { customId, values: [value], user: { id: actor }, guildId, client: {}, deferred: false,
    guild: { id: guildId, ownerId: '100000000000000099', members: { fetch: async () => member, fetchMe: async () => ({ permissions }) }, channels: { fetch: async () => ({ id: channelId, type: ChannelType.GuildVoice, permissionsFor: () => permissions }) } },
    isStringSelectMenu: () => true,
    deferUpdate: async () => { i.deferred = true; },
    editReply: async (payload: unknown) => { edits.push(payload); }, reply: async (payload: unknown) => { replies.push(payload); },
  };
  return { i: i as unknown as Interaction, edits, replies, move: () => { currentChannel = '100000000000000005'; } };
}
function policies(t: TestContext) {
  const grants = emptyGrants(); grants['music.request'] = [roleId];
  t.mock.method(GuildPolicy, 'findOne', (() => ({ lean: async () => ({ grants, history: [] }) })) as never);
  t.mock.method(GuildSettings, 'findOne', (() => ({ lean: async () => ({ modules: { music: true } }) })) as never);
  t.mock.method(BotControl, 'findOne', (() => ({ lean: async () => null })) as never);
  return grants;
}

test('panel sessions bind actor and guild, expire, consume once and bound memory', () => {
  let now = 0; const sessions = new PanelSessions<string>(100, 2, () => now);
  const first = sessions.create(userId, guildId, 'one');
  assert.throws(() => sessions.get(first, 'another', guildId), /otra persona/);
  assert.throws(() => sessions.get(first, userId, 'another'), /servidor/);
  assert.equal(sessions.take(first, userId, guildId), 'one');
  assert.throws(() => sessions.take(first, userId, guildId), /venció/);
  const expired = sessions.create(userId, guildId, 'two'); now = 101;
  assert.throws(() => sessions.get(expired, userId, guildId), /venció/);
  const evicted = sessions.create(userId, guildId, 'three');
  sessions.create(userId, guildId, 'four'); sessions.create(userId, guildId, 'five');
  assert.throws(() => sessions.get(evicted, userId, guildId), /venció/);
});

test('help categories update the panel and a different actor cannot edit it', async t => {
  policies(t);
  const panel = helpPanel(userId, guildId);
  const id = panel.components[0]!.toJSON().components[0]!.custom_id!;
  const other = selection(id, 'music', 'another');
  await handleInteractive(other.i, config);
  assert.equal(other.edits.length, 0); assert.equal(other.replies.length, 1);
  const own = selection(id, 'music');
  await handleInteractive(own.i, config);
  const payload = own.edits[0] as ReturnType<typeof helpPanel>;
  assert.match(payload.embeds[0]!.toJSON().description!, /\/musica buscar/);
  assert.deepEqual(payload.allowedMentions, { parse: [] });
});

test('music menus enforce fresh authority, voice membership and single consumption', async t => {
  const grants = policies(t);
  let enqueued = 0;
  const service: Pick<MusicService, 'snapshot' | 'enqueue'> = { snapshot: () => state, enqueue: async (_guild, id, actor, version, authorize) => {
    await authorize(channelId); assert.equal(id, track.id); assert.equal(actor, userId); assert.equal(version, 4); enqueued++; return state;
  } };
  const make = () => musicSearchPanel(userId, guildId, [track], true).components[0]!.toJSON().components[0]!.custom_id!;
  const id = make();
  await Promise.all([handleInteractive(selection(id, track.id).i, config, () => service), handleInteractive(selection(id, track.id).i, config, () => service)]);
  assert.equal(enqueued, 1);
  const moved = selection(make(), track.id); moved.move();
  await handleInteractive(moved.i, config, () => service); assert.equal(enqueued, 1);
  assert.match(JSON.stringify(moved.edits), /mismo canal/);
  const revoked = selection(make(), track.id); grants['music.request'] = [];
  await handleInteractive(revoked.i, config, () => service); assert.equal(enqueued, 1);
  assert.match(JSON.stringify(revoked.edits), /no tienes permiso/);
});

test('music menus reject forged selections and fit Discord limits with long metadata', async t => {
  policies(t);
  const panel = musicSearchPanel(userId, guildId, Array.from({ length: 12 }, (_, index) => ({ ...track, id: `id${index}`, title: '*'.repeat(200), artist: '_'.repeat(120) })), true);
  assert.ok(panel.content.length <= 2000);
  const menu = panel.components[0]!.toJSON().components[0]!;
  assert.ok('options' in menu && menu.options.length === 8);
  const forged = selection(menu.custom_id!, 'youtube:abcdefghijk');
  await handleInteractive(forged.i, config, () => { throw new Error('Must not access player'); });
  assert.equal(forged.edits.length, 0); assert.match(JSON.stringify(forged.replies), /este menú/);
  assert.equal(musicSearchPanel(userId, guildId, [track], false).components.length, 0);
});
