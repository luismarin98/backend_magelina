import test from 'node:test';
import assert from 'node:assert/strict';
import { MessageFlags, type Interaction } from 'discord.js';
import { handleAdventure } from '../src/bot/adventure.js';
import { adventureServices as services } from '../src/bot/commands/adventure/services.js';
import { adventureCommands } from '../src/bot/commands/adventure/index.js';
import { workflowError } from '../src/modules/workflow/rules.js';

const userId = '100000000000000001', guildId = '100000000000000002';
function interaction(name: string, options: Record<string, unknown> = {}, kind = 'slash', actor = userId, guild = guildId) {
  const edits: any[] = [], defers: any[] = [];
  const value: any = { user: { id: actor, username: 'Player', displayName: 'Player' }, guildId: guild, client: {}, commandName: name, deferred: false, replied: false,
    isChatInputCommand: () => kind === 'slash', isButton: () => kind === 'button', isStringSelectMenu: () => kind === 'select',
    customId: options.customId, values: options.values,
    options: { getSubcommand: () => options.subcommand, getString: (key: string) => options[key] ?? null, getInteger: (key: string) => options[key] ?? null, getUser: (key: string) => options[key] ?? null },
    deferReply: async (args: unknown) => { defers.push(args); value.deferred = true; }, editReply: async (args: unknown) => { edits.push(args); }, reply: async (args: unknown) => { edits.push(args); },
  };
  return { value: value as Interaction, edits, defers };
}
function setup(t: any) {
  t.mock.method(services, 'available', async () => ({}));
  t.mock.method(services, 'world', () => ({ verify: async () => 'Pais', list: async () => [] }));
  t.mock.method(services, 'character', async () => ({ alias: 'Heroe', level: 2, rank: 'F', experience: 100, profession: 'hunter', coins: 999, version: 7, currentGuildId: guildId, currentGuildName: 'Pais' }));
}
function component(reply: any, row = 0, column = 0) { return reply.components[row].toJSON().components[column]; }
async function select(reply: any, index = '0', actor = userId) {
  const click = interaction('', { customId: component(reply).custom_id, values: [index] }, 'select', actor);
  await handleAdventure(click.value); return click;
}
async function confirm(reply: any) {
  const click = interaction('', { customId: component(reply).custom_id }, 'button');
  await handleAdventure(click.value); return click;
}

test('adventure definitions expose self-service commands without moderator permission requirements', () => {
  const definitions = adventureCommands.map(command => command.toJSON());
  assert.deepEqual(definitions.map(command => command.name), ['aventura', 'perfil', 'inventario', 'aventuras', 'viajar', 'mercado', 'fabricar', 'vender', 'ayuda']);
  for (const command of definitions) { assert.equal(command.dm_permission, false); assert.equal(command.default_member_permissions, undefined); }
  assert.deepEqual(definitions[0]!.options!.map(option => option.name), ['iniciar', 'unirse', 'continuar', 'recoger', 'abandonar']);
});
test('inventory is private, paginated and bound to its user and server', async t => {
  setup(t);
  t.mock.method(services, 'inventory', (async (actor: string) => { assert.equal(actor, userId); return { coins: 12, inventory: Array.from({ length: 12 }, (_, i) => ({ itemId: `item-${i}`, name: `Objeto ${i}`, quantity: 1, sellPrice: 2 })) }; }) as never);
  const slash = interaction('inventario'); await handleAdventure(slash.value);
  assert.equal(slash.defers[0].flags, MessageFlags.Ephemeral);
  assert.ok(slash.edits[0].embeds[0].data.description.includes('Objeto 9'));
  assert.ok(!slash.edits[0].embeds[0].data.description.includes('Objeto 10'));
  const nextId = component(slash.edits[0], 0, 1).custom_id;
  const foreign = interaction('', { customId: nextId }, 'button', '100000000000000003'); await handleAdventure(foreign.value);
  assert.match(foreign.edits[0].content, /otra persona/);
  const next = interaction('', { customId: nextId }, 'button'); await handleAdventure(next.value);
  assert.match(next.edits[0].embeds[0].data.description, /Objeto 10/);
});
test('public profiles never expose coins, inventory or current location', async t => {
  setup(t);
  const slash = interaction('perfil', { usuario: { id: '100000000000000003', displayName: 'Otro' } }); await handleAdventure(slash.value);
  const output = JSON.stringify(slash.edits[0]);
  assert.ok(output.includes('Heroe')); assert.ok(!output.includes('999')); assert.ok(!output.includes('Pais'));
});
test('enemy decisions use the shared service only after confirmation and preserve keys on uncertain retries', async t => {
  setup(t);
  t.mock.method(services, 'board', (async () => ({ active: { id: 'abcdefabcdefabcdefabcdef', title: 'Bosque', status: 'active', stage: 0, totalStages: 2, version: 3, dueAt: new Date(0), rewards: { wood: 0, herb: 0, experience: 0 }, loot: [], events: [], step: { encounter: { name: 'Lobo', level: 2, fightChance: 60, avoidChance: 80 } } } })) as never);
  const calls: any[] = [];
  t.mock.method(services, 'expedition', (async (...args: unknown[]) => { calls.push(args); if (calls.length === 1) throw new Error('connection interrupted'); return {}; }) as never);
  const slash = interaction('aventura', { subcommand: 'continuar' }); await handleAdventure(slash.value);
  assert.match(component(slash.edits[0]).options[0].label, /60 %/);
  const selected = await select(slash.edits[0]); assert.equal(calls.length, 0);
  const failed = await confirm(selected.edits[0]); assert.match(failed.edits[0].content, /reintenta/);
  await confirm(selected.edits[0]); assert.equal(calls.length, 2);
  assert.equal(calls[0][0], userId); assert.equal(calls[0][1], 'decide');
  assert.deepEqual(calls[0][2], calls[1][2]); assert.equal(calls[0][2].choice, 'fight'); assert.equal(calls[0][2].version, 3);
  assert.equal('rewards' in calls[0][2], false);
  await confirm(selected.edits[0]); assert.equal(calls.length, 2);
});
test('market selections reject foreign users and forged indices and preserve the quoted listing', async t => {
  setup(t);
  t.mock.method(services, 'market', (async () => ({ more: false, items: [{ _id: 'abcdefabcdefabcdefabcdef', itemName: 'Espada', quantity: 2, unitPrice: 8, sellerId: 'other' }] })) as never);
  const calls: any[] = [];
  t.mock.method(services, 'economy', (async (...args: unknown[]) => { calls.push(args); return {}; }) as never);
  const slash = interaction('mercado'); await handleAdventure(slash.value);
  const forged = await select(slash.edits[0], '9'); assert.match(forged.edits[0].content, /Seleccion/);
  const selected = await select(slash.edits[0]); assert.match(selected.edits[0].embeds[0].data.description, /16 monedas/); assert.equal(calls.length, 0);
  await confirm(selected.edits[0]); await confirm(selected.edits[0]); assert.equal(calls.length, 1);
  assert.equal(calls[0][1], 'buy'); assert.equal(calls[0][2].guildId, guildId); assert.equal(calls[0][2].listingId, 'abcdefabcdefabcdefabcdef');
  assert.equal('total' in calls[0][2], false);
});
test('maintenance is rechecked at confirmation and does not execute a pending sale', async t => {
  setup(t);
  t.mock.method(services, 'inventory', (async () => ({ coins: 0, inventory: [{ itemId: 'wood', name: 'Madera', quantity: 5, sellPrice: 2 }] })) as never);
  let writes = 0; t.mock.method(services, 'economy', (async () => { writes++; return {}; }) as never);
  const slash = interaction('vender', { cantidad: 2 }); await handleAdventure(slash.value);
  const selected = await select(slash.edits[0]);
  t.mock.method(services, 'available', (async (_guild: string, _module: unknown, writing = true) => { if (writing) throw workflowError(503, 'Mantenimiento'); return {}; }) as never);
  const blocked = await confirm(selected.edits[0]); assert.match(blocked.edits[0].content, /Mantenimiento/); assert.equal(writes, 0);
});

test('travel confirmation binds the destination and character version, including neutral refuge', async t => {
  setup(t);
  t.mock.method(services, 'countries', (async () => ({ more: false, items: [{ id: '100000000000000003', name: 'Otro pais' }] })) as never);
  const calls: any[] = []; t.mock.method(services, 'economy', (async (...args: unknown[]) => { calls.push(args); return {}; }) as never);
  const slash = interaction('viajar'); await handleAdventure(slash.value);
  const selected = await select(slash.edits[0]); await confirm(selected.edits[0]);
  assert.equal(calls[0][1], 'travel'); assert.equal(calls[0][2].guildId, null); assert.equal(calls[0][2].version, 7);
});
test('crafting and selling confirm quantities without accepting client-supplied balances or prices', async t => {
  setup(t);
  t.mock.method(services, 'inventory', (async () => ({ coins: 0, inventory: [{ itemId: 'wood', name: 'Madera', quantity: 5, sellPrice: 2 }] })) as never);
  t.mock.method(services, 'recipes', (async () => ({ more: false, items: [{ id: 'wooden-charm', name: 'Amuleto', ingredients: { wood: 2, herb: 2 } }] })) as never);
  const calls: any[] = []; t.mock.method(services, 'economy', (async (...args: unknown[]) => { calls.push(args); return {}; }) as never);
  for (const [name, action] of [['fabricar', 'craft'], ['vender', 'sell']]) {
    const slash = interaction(name!, { cantidad: 2 }); await handleAdventure(slash.value);
    const selected = await select(slash.edits[0]); assert.equal(calls.length, action === 'craft' ? 0 : 1);
    await confirm(selected.edits[0]);
    const call = calls.at(-1); assert.equal(call[1], action); assert.equal(call[2].quantity, 2);
    assert.equal('coins' in call[2], false); assert.equal('sellPrice' in call[2], false);
  }
});
test('signup is explicit, membership requires confirmation and help creates nothing', async t => {
  setup(t);
  const starts: any[] = [], joins: any[] = [];
  t.mock.method(services, 'start', (async (...args: unknown[]) => { starts.push(args); return { alias: 'Heroe', level: 1, rank: 'F' }; }) as never);
  t.mock.method(services, 'join', (async (...args: unknown[]) => { joins.push(args); return { joined: true }; }) as never);
  const help = interaction('ayuda', { subcommand: 'juego' }); await handleAdventure(help.value);
  assert.equal(starts.length, 0); assert.equal(joins.length, 0);
  const start = interaction('aventura', { subcommand: 'iniciar', alias: 'Heroe', profesion: 'hunter' }); await handleAdventure(start.value);
  assert.deepEqual(starts[0], [userId, 'Heroe', 'hunter']);
  const join = interaction('aventura', { subcommand: 'unirse' }); await handleAdventure(join.value);
  assert.equal(joins.length, 0); await confirm(join.edits[0]); assert.deepEqual(joins[0], [userId, guildId]);
});
test('abandonment and reward collection stay explicit and use the owned run version', async t => {
  setup(t);
  let status = 'active';
  t.mock.method(services, 'board', (async () => ({ active: { id: 'abcdefabcdefabcdefabcdef', title: 'Bosque', status, stage: 1, totalStages: 2, version: 9, dueAt: new Date(Date.now() + 60000), rewards: { wood: 1, herb: 2, experience: 4 }, loot: [], events: [], step: null } })) as never);
  const calls: any[] = []; t.mock.method(services, 'expedition', (async (...args: unknown[]) => { calls.push(args); return {}; }) as never);
  const waiting = interaction('aventura', { subcommand: 'continuar' }); await handleAdventure(waiting.value);
  assert.equal(waiting.edits[0].components.length, 0);
  const early = interaction('aventura', { subcommand: 'recoger' }); await handleAdventure(early.value); assert.match(early.edits[0].content, /Completa/);
  const abandon = interaction('aventura', { subcommand: 'abandonar' }); await handleAdventure(abandon.value); assert.equal(calls.length, 0);
  await confirm(abandon.edits[0]); assert.equal(calls[0][1], 'abandon'); assert.equal(calls[0][2].version, 9);
  status = 'ready';
  const collect = interaction('aventura', { subcommand: 'recoger' }); await handleAdventure(collect.value);
  const selected = await select(collect.edits[0]); await confirm(selected.edits[0]); assert.equal(calls[1][1], 'claim');
});

test('offers start only through the selected saved offer and disappear during rest', async t => {
  setup(t);
  let rest = false;
  t.mock.method(services, 'board', (async () => ({ active: null, canStart: true, characterLevel: 2, nextAdventureAt: rest ? new Date(Date.now() + 60000) : null, boardMessage: '', offers: [{ id: 'abcdefabcdefabcdefabcdef', title: 'Reconocer bosque', description: 'Recorre el bosque.', minLevel: 1, seconds: 360 }] })) as never);
  const calls: any[] = []; t.mock.method(services, 'expedition', (async (...args: unknown[]) => { calls.push(args); return {}; }) as never);
  const slash = interaction('aventuras'); await handleAdventure(slash.value);
  const selected = await select(slash.edits[0]); assert.equal(calls.length, 0);
  await confirm(selected.edits[0]); assert.equal(calls[0][1], 'start'); assert.equal(calls[0][2].offerId, 'abcdefabcdefabcdefabcdef');
  assert.equal('seconds' in calls[0][2], false);
  rest = true;
  const resting = interaction('aventuras'); await handleAdventure(resting.value);
  assert.equal(resting.edits[0].components.length, 0); assert.match(resting.edits[0].embeds[0].data.description, /Descanso/);
});
