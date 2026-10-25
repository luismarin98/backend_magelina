import { managerCommand } from './community/index.js';
import { musicCommand } from './music/index.js';
import { gamesCommand } from './entertainment/index.js';
import { requestCommand } from './requests/index.js';

// This manifest contains definitions only: publishing never loads runtime handlers.
export const commandRegistry = [
  { category: 'requests', handler: 'workflow', definition: requestCommand.toJSON() },
  { category: 'community', handler: 'slash', definition: managerCommand.toJSON() },
  { category: 'music', handler: 'slash', definition: musicCommand.toJSON() },
  { category: 'entertainment', handler: 'games', definition: gamesCommand.toJSON() },
] as const;

export function commandKey(type: number, name: string) { return `${type}:${name}`; }

export function indexCommands<T extends { definition: { type?: number; name: string } }>(entries: readonly T[]) {
  const index = new Map<string, T>();
  for (const entry of entries) {
    const key = commandKey(entry.definition.type ?? 1, entry.definition.name);
    if (index.has(key)) throw new Error(`Duplicate command: ${key}`);
    index.set(key, entry);
  }
  return index;
}

export const commandsByKey = indexCommands(commandRegistry);
export const commandDefinitions = commandRegistry.map(command => command.definition);
