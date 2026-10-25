import type { GuildSettingsInput, GuildSettingsValues, ModuleKey } from '../../types/contracts.js';
import { moduleKeys } from '../operations/service.js';
import { workflowError } from '../workflow/rules.js';

export function defaultSettings(): GuildSettingsValues {
  return { modules: { workflow: true, knowledge: true, projects: true, collaboration: true, automations: false, audit: true, music: false }, notifications: { enabled: true, channelId: null }, knowledge: { reviewDays: 90 } };
}

function record(value: unknown, keys: string[]): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && Object.keys(value).every((key) => keys.includes(key));
}

export function validateSettings(input: unknown): GuildSettingsInput {
  if (!record(input, ['version', 'modules', 'notifications', 'knowledge']) ||
      typeof input.version !== 'number' || !Number.isSafeInteger(input.version) || input.version < 0 ||
      !record(input.modules, moduleKeys) || !moduleKeys.every((key) => typeof (input.modules as Record<string, unknown>)[key] === 'boolean') ||
      !record(input.notifications, ['enabled', 'channelId']) || typeof input.notifications.enabled !== 'boolean' ||
      !(input.notifications.channelId === null || (typeof input.notifications.channelId === 'string' && /^\d{17,20}$/.test(input.notifications.channelId))) ||
      !record(input.knowledge, ['reviewDays']) || typeof input.knowledge.reviewDays !== 'number' || !Number.isInteger(input.knowledge.reviewDays) || input.knowledge.reviewDays < 1 || input.knowledge.reviewDays > 365) {
    throw workflowError(400, 'Configuracion invalida. Usa modulos booleanos, un canal valido y un plazo de revision entre 1 y 365 dias.');
  }
  return { version: input.version, modules: input.modules as Record<ModuleKey, boolean>,
    notifications: { enabled: input.notifications.enabled, channelId: input.notifications.channelId }, knowledge: { reviewDays: input.knowledge.reviewDays } };
}

export function assertModuleEnabled(settings: GuildSettingsValues, key: ModuleKey): void {
  if (!settings.modules[key]) throw workflowError(403, `El modulo ${key} esta desactivado en este servidor.`);
}

export function changedSettings(before: GuildSettingsValues, after: GuildSettingsValues): string[] {
  const changes: string[] = [];
  for (const key of moduleKeys) if (before.modules[key] !== after.modules[key]) changes.push(`modules.${key}`);
  if (before.notifications.enabled !== after.notifications.enabled) changes.push('notifications.enabled');
  if (before.notifications.channelId !== after.notifications.channelId) changes.push('notifications.channelId');
  if (before.knowledge.reviewDays !== after.knowledge.reviewDays) changes.push('knowledge.reviewDays');
  return changes;
}
