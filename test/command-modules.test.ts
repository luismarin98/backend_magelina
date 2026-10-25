import test from 'node:test';
import assert from 'node:assert/strict';
import { subcommands as music } from '../src/bot/commands/music/index.js';
import { subcommands as community } from '../src/bot/commands/community/index.js';
import { subcommands as games } from '../src/bot/commands/entertainment/index.js';
import { execute as youtube } from '../src/bot/commands/music/youtube.js';
import { execute as retirar } from '../src/bot/commands/music/retirar.js';
import type { MusicContext } from '../src/bot/commands/music/context.js';

test('each subcommand module provides an executable action with a unique definition', () => {
  for (const modules of [music, community, games]) {
    const names = modules.map(module => module.definition.name);
    assert.equal(new Set(names).size, names.length);
    for (const module of modules) {
      assert.equal(typeof module.execute, 'function');
      assert.equal(module.definition.toJSON().type, 1);
    }
  }
});

test('YouTube module canonicalizes the video and preserves concurrency and authorization', async () => {
  const calls: unknown[][] = [];
  const authorize = async () => {};
  const context = {
    i: { guild: { id: 'guild' }, user: { id: 'actor' }, options: { getString: () => 'https://www.youtube.com/watch?v=ARWg160eaX4' } },
    service: { enqueue: async (...args: unknown[]) => { calls.push(args); } },
    state: { version: 7 }, authorize,
  } as unknown as MusicContext;
  await youtube(context);
  assert.deepEqual(calls, [['guild', 'youtube:ARWg160eaX4', 'actor', 7, authorize]]);
});

test('remove module rejects malformed queue identifiers before changing the player', async () => {
  let called = false;
  const context = {
    i: { guild: { id: 'guild' }, options: { getString: () => 'invalid' } },
    service: { control: async () => { called = true; } }, state: { version: 7 }, authorize: async () => {},
  } as unknown as MusicContext;
  await assert.rejects(retirar(context), /Identificador/);
  assert.equal(called, false);
});
