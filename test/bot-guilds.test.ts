import test from 'node:test';
import assert from 'node:assert/strict';
import { Client, Collection, GatewayIntentBits } from 'discord.js';
import { listBotGuilds } from '../src/discord/bot-guilds.js';

test('bot membership listing includes uncached guilds across all Discord pages', async t => {
  const bot = new Client({ intents: [GatewayIntentBits.Guilds] });
  const first = Array.from({ length: 200 }, (_, index) => ({ id: String(100000000000000000n + BigInt(index)), name: `Guild ${index}`, icon: null }));
  const last = { id: '100000000000000200', name: 'Last guild', icon: null };
  const requests: unknown[] = [];
  t.mock.method(bot.guilds, 'fetch', (async (options: unknown) => {
    requests.push(options);
    return new Collection((requests.length === 1 ? first : [last]).map(guild => [guild.id, guild]));
  }) as never);
  try {
    assert.equal(bot.guilds.cache.size, 0);
    const guilds = await listBotGuilds(bot);
    assert.equal(guilds.length, 201);
    assert.ok(guilds.some(guild => guild.id === last.id));
    assert.deepEqual(requests, [{ limit: 200 }, { limit: 200, after: first.at(-1)!.id }]);
  } finally { await bot.destroy(); }
});

test('simultaneous requests share one query and later requests refresh memberships', async t => {
  const bot = new Client({ intents: [GatewayIntentBits.Guilds] });
  let calls = 0;
  t.mock.method(bot.guilds, 'fetch', (async () => {
    calls++;
    const guild = { id: '100000000000000001', name: `Guild ${calls}`, icon: null };
    return new Collection([[guild.id, guild]]);
  }) as never);
  try {
    const [first, second] = await Promise.all([listBotGuilds(bot), listBotGuilds(bot)]);
    assert.equal(calls, 1);
    assert.deepEqual(first, second);
    assert.equal((await listBotGuilds(bot))[0]!.name, 'Guild 2');
    assert.equal(calls, 2);
  } finally { await bot.destroy(); }
});

test('failed listing does not silently return a partial cache and can be retried', async t => {
  const bot = new Client({ intents: [GatewayIntentBits.Guilds] });
  let failed = true;
  t.mock.method(bot.guilds, 'fetch', (async () => {
    if (failed) throw new Error('Discord unavailable');
    return new Collection();
  }) as never);
  try {
    await assert.rejects(listBotGuilds(bot), /lista completa/);
    failed = false;
    assert.deepEqual(await listBotGuilds(bot), []);
  } finally { await bot.destroy(); }
});

test('a repeated pagination cursor rejects incomplete results', async t => {
  const bot = new Client({ intents: [GatewayIntentBits.Guilds] });
  const page = new Collection(Array.from({ length: 200 }, (_, index) => {
    const id = String(100000000000000000n + BigInt(index));
    return [id, { id, name: `Guild ${index}`, icon: null }];
  }));
  t.mock.method(bot.guilds, 'fetch', (async () => page) as never);
  try { await assert.rejects(listBotGuilds(bot), /lista completa/); }
  finally { await bot.destroy(); }
});
