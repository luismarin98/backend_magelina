import test from 'node:test';
import assert from 'node:assert/strict';
import type { Interaction } from 'discord.js';
import { commandRegistry, commandDefinitions, commandsByKey, commandKey, indexCommands } from '../src/bot/commands/registry.js';
import { dispatchInteraction, type InteractionHandlers } from '../src/bot/handler.js';

function interaction(kind: string, fields: Record<string, unknown> = {}) {
  return {
    isCommand: () => kind === 'command',
    isModalSubmit: () => kind === 'modal',
    isStringSelectMenu: () => kind === 'select',
    isButton: () => kind === 'button',
    ...fields,
  } as unknown as Interaction;
}

function handlersFor(calls: string[]): InteractionHandlers {
  return {
    workflow: async () => { calls.push('workflow'); },
    slash: async () => { calls.push('slash'); },
    interactive: async () => { calls.push('interactive'); },
    games: async () => { calls.push('games'); },
  };
}

test('every publishable definition routes exactly once to its registered handler', async () => {
  assert.equal(commandsByKey.size, commandDefinitions.length);
  for (const entry of commandRegistry) {
    const calls: string[] = [];
    const handlers = handlersFor(calls);
    assert.equal(await dispatchInteraction(interaction('command', {
      commandName: entry.definition.name, commandType: entry.definition.type ?? 1,
    }), handlers), true);
    assert.deepEqual(calls, [entry.handler]);
  }
});

test('component routes respect both interaction type and namespace; unknown commands stay untouched', async () => {
  const calls: string[] = [];
  const handlers = handlersFor(calls);
  for (const [kind, customId] of [['modal', 'request:123'], ['select', 'mgl:123'], ['button', 'game:123']]) {
    assert.equal(await dispatchInteraction(interaction(kind!, { customId }), handlers), true);
  }
  assert.deepEqual(calls, ['workflow', 'interactive', 'games']);
  for (const value of [interaction('button', { customId: 'mgl:123' }), interaction('select', { customId: 'other:123' }), interaction('command', { commandName: 'jugar', commandType: 3 })]) {
    assert.equal(await dispatchInteraction(value, handlers), false);
  }
  assert.equal(calls.length, 3);
});

test('command identity includes its Discord type and rejects duplicate registrations', () => {
  const slash = { definition: { name: 'example', type: 1 } };
  const message = { definition: { name: 'example', type: 3 } };
  assert.equal(indexCommands([slash, message]).size, 2);
  assert.notEqual(commandKey(1, 'example'), commandKey(3, 'example'));
  assert.throws(() => indexCommands([slash, slash]), /Duplicate command/);
});
