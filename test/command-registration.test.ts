import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import session from 'express-session';
import type { AddressInfo } from 'node:net';
import { CommandRegistration, commandDefinitions, commandTarget, subcommandPaths, type CommandRest } from '../src/bot/registration.js';
import { commandRoutes } from '../src/modules/operations/commands.js';
import { readConfig } from '../src/config/env.js';
import { SystemEvent } from '../src/database/models/BotControl.js';

const application = '100000000000000001', guild = '100000000000000002';
test('pending subcommands compare live options in the exact destination without writing', async () => {
  const reads: string[] = [];
  const registration = new CommandRegistration({ production: true, discordClientId: application }, {
    get: async route => {
      reads.push(route);
      return [{ id: '100000000000000003', name: 'musica', type: 1, options: route.includes('/guilds/') ? [{ name: 'buscar', type: 1 }] : [{ name: 'youtube', type: 1 }, { name: 'buscar', type: 3 }] }];
    },
    post: async () => { throw new Error('Status must not write'); },
  });
  const global = (await registration.status({ scope: 'global' })).commands.find(entry => entry.name === 'musica')!;
  assert.equal(global.registered, true);
  assert.equal(global.subcommands.find(entry => entry.name === 'youtube')?.registered, true);
  assert.equal(global.subcommands.find(entry => entry.name === 'buscar')?.registered, false);
  const scoped = (await registration.status({ scope: 'guild', guildId: guild })).commands.find(entry => entry.name === 'musica')!;
  assert.equal(scoped.subcommands.find(entry => entry.name === 'youtube')?.registered, false);
  assert.equal(scoped.subcommands.find(entry => entry.name === 'buscar')?.registered, true);
  assert.deepEqual(reads, [`/applications/${application}/commands`, `/applications/${application}/guilds/${guild}/commands`]);
  assert.deepEqual(subcommandPaths([{ name: 'group', type: 2, options: [{ name: 'action', type: 1 }] }, null]), ['group action']);
});
test('published inventory includes nested live subcommands without requiring local definitions', async () => {
  const registration = new CommandRegistration({ production: true, discordClientId: application }, {
    get: async () => [{ id: '100000000000000003', name: 'legacy', type: 1, options: [
      { name: 'group', type: 2, options: [{ name: 'action', type: 1, description: 'Live description', options: [{ type: 3, name: 'argument' }] }] },
      { name: 'direct', type: 1, description: 'Direct action' },
    ] }],
    post: async () => { throw new Error('Read only'); },
  });
  const status = await registration.status();
  assert.equal(status.published[0]?.managed, false);
  assert.deepEqual(status.published[0]?.subcommands, [{ name: 'group action', description: 'Live description' }, { name: 'direct', description: 'Direct action' }]);
});
test('production always targets global commands and development never falls back to global', () => {
  assert.equal(commandTarget({ production: true, discordClientId: application, discordTestGuildId: guild }).route, `/applications/${application}/commands`);
  assert.equal(commandTarget({ production: false, discordClientId: application, discordTestGuildId: guild }).route, `/applications/${application}/guilds/${guild}/commands`);
  assert.throws(() => commandTarget({ production: false, discordClientId: application }), /DISCORD_TEST_GUILD_ID/);
  assert.throws(() => commandTarget({ production: false, discordClientId: application, discordTestGuildId: 'invalid' }), /DISCORD_TEST_GUILD_ID/);
});
test('refresh is read-only and sync upserts only known commands with sanitized partial results', async () => {
  const writes: { route: string; name: string }[] = [];
  const rest: CommandRest = { get: async () => [{ id: '100000000000000003', name: 'magelina', type: 1 }, { id: '100000000000000004', name: 'unrelated', type: 1 }], post: async (route, { body }) => {
    const name = (body as { name: string }).name; writes.push({ route, name });
    if (name === 'musica') throw new Error('synthetic-private-token');
    return {};
  } };
  const registration = new CommandRegistration({ production: true, discordClientId: application }, rest);
  const status = await registration.status();
  assert.equal(writes.length, 0);
  assert.equal(status.commands.find(command => command.name === 'magelina')?.registered, true);
  assert.equal(status.commands.find(command => command.name === 'musica')?.registered, false);
  const result = await registration.sync();
  assert.deepEqual(writes.map(write => write.name), commandDefinitions.map(command => command.name));
  assert.ok(writes.every(write => write.route === `/applications/${application}/commands`));
  assert.equal(result.results.filter(entry => entry.updated).length, commandDefinitions.length - 1);
  assert.ok(!JSON.stringify(result).includes('synthetic-private-token'));
  await assert.rejects(registration.sync(), /Espera un minuto/);
});
test('concurrent publications cannot interleave and test guild is the sole write target', async () => {
  let release!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  const writes: string[] = [];
  const rest: CommandRest = { get: async () => [], post: async route => { writes.push(route); await barrier; return {}; } };
  const registration = new CommandRegistration({ production: false, discordClientId: application, discordTestGuildId: guild }, rest);
  const first = registration.sync();
  await assert.rejects(registration.sync(), /en curso/);
  release(); await first;
  assert.equal(writes.length, commandDefinitions.length);
  assert.ok(writes.every(route => route.includes(`/guilds/${guild}/`)));
});
test('HTTP publication requires owner and validates manual destination', async t => {
  const config = readConfig({ MONGODB_URI: 'mongodb://localhost/test', DISCORD_TOKEN: 'synthetic', DISCORD_CLIENT_ID: application, DISCORD_CLIENT_SECRET: 'synthetic', DISCORD_REDIRECT_URI: 'http://localhost/callback', SESSION_SECRET: 'Test-only-AAaa11!!-session-secret-12345678', BOT_OWNER_IDS: application, DISCORD_TEST_GUILD_ID: guild });
  let publications = 0;
  const registration = new CommandRegistration(config, { get: async () => [], post: async () => { publications++; return {}; } });
  t.mock.method(SystemEvent, 'create', (async () => ({})) as never);
  const app = express(); app.use(express.json());
  app.use(session({ secret: 'test-only-session-secret', resave: false, saveUninitialized: false }));
  app.use((req, _res, next) => { req.session.user = { id: req.get('x-test-user') ?? application, username: 'test', name: 'Test' }; next(); });
  app.use('/commands', commandRoutes(config, registration));
  app.use(((error, _req, res, _next) => res.status(error.status ?? 500).json({ error: error.publicMessage ?? 'Error' })) as express.ErrorRequestHandler);
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/commands`;
  try {
    const post = (body: unknown, user = application) => fetch(`${url}/sync`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-test-user': user }, body: JSON.stringify(body) });
    assert.equal((await post({}, guild)).status, 403);
    assert.equal((await post({ scope: 'invalid' })).status, 400);
    assert.equal((await post({ scope: 'guild', guildId: guild })).status, 404);
    assert.equal(publications, 0);
    assert.equal((await post({})).status, 200);
    assert.equal(publications, commandDefinitions.length);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
test('manual global publication overrides development default and only upserts selection', async () => {
  const writes: { route: string; body: unknown }[] = [];
  const registration = new CommandRegistration({ production: false, discordClientId: application }, { get: async () => [], post: async (route, { body }) => { writes.push({ route, body }); return {}; } });
  const result = await registration.sync({ scope: 'global' }, ['musica']);
  assert.equal(result.scope, 'global');
  assert.deepEqual(writes, [{ route: `/applications/${application}/commands`, body: commandDefinitions.find(command => command.name === 'musica') }]);
});
test('live inventory includes commands absent from backend and unpublish verifies exact destination', async () => {
  const commandId = '100000000000000099';
  const deleted: string[] = [];
  const registration = new CommandRegistration({ production: true, discordClientId: application }, {
    get: async route => route.includes('/guilds/') ? [] : [{ id: commandId, name: 'legacy', type: 1, description: 'Legacy', version: '123' }],
    post: async () => ({}), delete: async route => { deleted.push(route); },
  });
  const status = await registration.status({ scope: 'global' });
  assert.equal(status.published[0]?.managed, false);
  assert.equal(status.published[0]?.name, 'legacy');
  await assert.rejects(registration.unpublish({ scope: 'guild', guildId: guild }, commandId), /ya no está publicado/);
  assert.equal(deleted.length, 0);
  await registration.unpublish({ scope: 'global' }, commandId);
  assert.deepEqual(deleted, [`/applications/${application}/commands/${commandId}`]);
});
test('unknown definitions and duplicate selections are rejected before writes', async () => {
  let writes = 0;
  const registration = new CommandRegistration({ production: true, discordClientId: application }, { get: async () => [], post: async () => { writes++; } });
  await assert.rejects(registration.sync({ scope: 'global' }, ['unknown']), /Selecciona comandos/);
  await assert.rejects(registration.sync({ scope: 'global' }, ['musica', 'musica']), /Selecciona comandos/);
  assert.equal(writes, 0);
});
