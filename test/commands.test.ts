import test from 'node:test';
import assert from 'node:assert/strict';
import { MessageFlags, PermissionFlagsBits as P, type ChatInputCommandInteraction, type Interaction } from 'discord.js';
import { managerCommand, musicCommand } from '../src/bot/commands.js';
import { commandAccess, handleSlash } from '../src/bot/slash.js';
import { GuildPolicy } from '../src/database/models/GuildPolicy.js';
import { BotControl } from '../src/database/models/BotControl.js';
import { WorkItem } from '../src/database/models/WorkItem.js';
import { GuildSettings } from '../src/database/models/GuildSettings.js';
import { emptyGrants } from '../src/modules/permissions/rules.js';

const config = { ownerIds: ['100000000000000009'], dashboardOrigin: 'https://magelina.example' };
function interaction(command = 'magelina', subcommand = 'ayuda', nativeManager = false) {
  const replies: { content: string; allowedMentions?: unknown }[] = [];
  const deferrals: { flags?: number }[] = [];
  const member = { id: '100000000000000002', permissions: { has: (p: bigint) => nativeManager && p === P.ManageGuild }, roles: { cache: new Map([['100000000000000001', {}], ['100000000000000003', {}]]) } };
  const value = { commandName: command, guildId: '100000000000000001', user: { id: member.id },
    guild: { id: '100000000000000001', ownerId: '100000000000000005', members: { fetch: async () => member } },
    options: { getSubcommand: () => subcommand, getString: () => null },
    isChatInputCommand: () => true, deferred: false, replied: false,
    deferReply: async (options: { flags?: number } = {}) => { deferrals.push(options); value.deferred = true; },
    editReply: async (reply: { content: string }) => { replies.push(reply); },
  };
  return { value: value as unknown as ChatInputCommandInteraction, replies, deferrals };
}
test('commands serialize with guild-only definitions and all music controls', () => {
  assert.equal(managerCommand.toJSON().dm_permission, false);
  const names = musicCommand.toJSON().options!.map(o => o.name);
  for (const name of ['buscar', 'conectar', 'agregar', 'cola', 'volumen', 'retirar', 'pausar', 'continuar', 'saltar', 'detener', 'desconectar']) assert.ok(names.includes(name));
  assert.equal(new Set(names).size, names.length);
});
test('fresh membership resolves delegated roles and Discord managers cannot bypass internal grants', async t => {
  const grants = emptyGrants(); grants['workflow.read'] = ['100000000000000003']; grants['music.manage'] = ['100000000000000001'];
  t.mock.method(GuildPolicy, 'findOne', (() => ({ lean: async () => ({ guildId: '100000000000000001', grants, history: [] }) })) as never);
  const { access } = await commandAccess(interaction().value, config);
  assert.deepEqual(access.capabilities, ['workflow.read']);
  assert.deepEqual((await commandAccess(interaction('magelina', 'ayuda', true).value, config)).access.capabilities, ['workflow.read']);
});
test('unauthorized request cannot query community records and errors stay private', async t => {
  t.mock.method(GuildPolicy, 'findOne', (() => ({ lean: async () => null })) as never);
  t.mock.method(BotControl, 'findOne', (() => ({ lean: async () => null })) as never);
  const query = t.mock.method(WorkItem, 'find', (() => { throw new Error('Must not query'); }) as never);
  const i = interaction('magelina', 'solicitudes');
  await handleSlash(i.value, config);
  assert.match(i.replies[0]!.content, /No tienes permiso/);
  assert.equal(i.deferrals[0]!.flags, MessageFlags.Ephemeral);
  assert.equal(query.mock.callCount(), 0);
  assert.deepEqual(i.replies[0]!.allowedMentions, { parse: [] });
});
test('DM invocation returns a controlled error without fetching data', async () => {
  const i = interaction(); Object.assign(i.value, { guild: null, guildId: null });
  await handleSlash(i.value, config);
  assert.match(i.replies[0]!.content, /servidores/);
});

test('public help works in a server without bot access or database queries', async t => {
  const policies = t.mock.method(GuildPolicy, 'findOne', (() => { throw new Error('Help must not query policies'); }) as never);
  const controls = t.mock.method(BotControl, 'findOne', (() => { throw new Error('Help must not query controls'); }) as never);
  const i = interaction();
  Object.assign(i.value, { guild: null });
  // No client or member is available for a user-installed application.
  await handleSlash(i.value, config);
  assert.equal('embeds' in i.replies[0]!, true);
  assert.equal(i.deferrals[0]!.flags, undefined);
  assert.equal(policies.mock.callCount(), 0);
  assert.equal(controls.mock.callCount(), 0);
});

test('public help does not let a user-installed app execute server operations', async () => {
  const i = interaction('magelina', 'panel');
  Object.assign(i.value, { guild: null, client: { guilds: { fetch: async () => { throw { code: 50001 }; } } } });
  await handleSlash(i.value, config);
  assert.match(i.replies[0]!.content, /añadir el bot al servidor/);
});

test('guild commands recover a cache miss before checking membership and internal grants', async t => {
  const grants = emptyGrants(); grants['workflow.read'] = ['100000000000000003'];
  t.mock.method(GuildPolicy, 'findOne', (() => ({ lean: async () => ({ grants, history: [] }) })) as never);
  t.mock.method(BotControl, 'findOne', (() => ({ lean: async () => null })) as never);
  const i = interaction('magelina', 'panel');
  const guild = i.value.guild;
  let cached: typeof guild = null;
  let fetched = 0;
  Object.defineProperty(i.value, 'guild', { get: () => cached });
  Object.assign(i.value, { client: { guilds: { fetch: async (id: string) => {
    assert.equal(id, i.value.guildId);
    fetched++;
    cached = guild;
    return guild;
  } } } });
  await handleSlash(i.value, config);
  assert.equal(fetched, 1);
  assert.ok(i.replies.length > 0);
  assert.match(i.replies[0]!.content, /dashboard\/servers/);
  assert.ok(!i.replies.some(reply => reply.content?.includes('solo está disponible')));
});
test('authorized queries isolate guild data and disable mentions in user titles', async t => {
  const grants = emptyGrants(); grants['workflow.read'] = ['100000000000000003'];
  t.mock.method(GuildPolicy, 'findOne', (() => ({ lean: async () => ({ grants, history: [] }) })) as never);
  t.mock.method(BotControl, 'findOne', (() => ({ lean: async () => null })) as never);
  t.mock.method(GuildSettings, 'findOne', (() => ({ lean: async () => ({ modules: { workflow: true } }) })) as never);
  let filter: unknown;
  t.mock.method(WorkItem, 'find', ((value: unknown) => {
    filter = value;
    return { sort: () => ({ limit: () => ({ lean: async () => [{ _id: '123456789012345678901234', title: '@everyone **test**', status: 'submitted', version: 2 }] }) }) };
  }) as never);
  const i = interaction('magelina', 'solicitudes');
  await handleSlash(i.value, config);
  assert.deepEqual(filter, { guildId: i.value.guildId });
  assert.match(i.replies[0]!.content, /versión 2/);
  assert.deepEqual(i.replies[0]!.allowedMentions, { parse: [] });
});
test('blocked guild cannot access the command results', async t => {
  t.mock.method(GuildPolicy, 'findOne', (() => ({ lean: async () => null })) as never);
  t.mock.method(BotControl, 'findOne', (() => ({ lean: async () => ({ blockedGuildIds: ['100000000000000001'] }) })) as never);
  const i = interaction('magelina', 'panel');
  await handleSlash(i.value, config);
  assert.match(i.replies[0]!.content, /suspendido/);
});
test('unrelated interactions are ignored', async () => {
  await handleSlash({ isChatInputCommand: () => false } as unknown as Interaction, config);
});
