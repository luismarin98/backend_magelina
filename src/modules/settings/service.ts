import { assertAvailable } from '../operations/service.js';
import { GuildSettings } from '../../database/models/GuildSettings.js';
import type { GuildSettingsRecord } from '../../database/models/GuildSettings.js';
import type { GuildSettingsDto, GuildSettingsValues, ModuleKey } from '../../types/contracts.js';
import { defaultSettings, validateSettings, assertModuleEnabled, changedSettings } from './rules.js';
import { workflowError } from '../workflow/rules.js';
import { hasCode } from '../../types/errors.js';

export async function getSettings(guildId: string): Promise<GuildSettingsRecord> {
  const existing = await GuildSettings.findOne({ guildId }).lean();
  return existing ? { ...existing, modules: { ...defaultSettings().modules, ...existing.modules } } : { guildId, ...defaultSettings(), version: 0, history: [] };
}

export async function requireModule(guildId: string, module: ModuleKey) {
  await assertAvailable(guildId, module);
  const settings = await getSettings(guildId);
  assertModuleEnabled(settings, module);
  return settings;
}

function values(settings: GuildSettingsValues): GuildSettingsValues {
  return { modules: { ...defaultSettings().modules, ...settings.modules },
    notifications: { enabled: settings.notifications.enabled, channelId: settings.notifications.channelId },
    knowledge: { reviewDays: settings.knowledge.reviewDays } };
}

export function serializeSettings(settings: GuildSettingsRecord): GuildSettingsDto {
  return { guildId: settings.guildId, version: settings.version, ...values(settings),
    history: settings.history.map((entry) => ({ actorId: entry.actorId, at: entry.at.toISOString(), changes: [...entry.changes], before: values(entry.before), after: values(entry.after) })) };
}

export async function saveSettings({ guildId, actorId, body }: { guildId: string; actorId: string; body: unknown }) {
  const input = validateSettings(body);
  const current = await getSettings(guildId);
  if (current.version !== input.version) throw workflowError(409, 'La configuracion cambio. Recarga los valores antes de guardar.');
  const before = values(current);
  const after = values(input);
  const changes = changedSettings(before, after);
  if (!changes.length) return current;
  try {
    const updated = await GuildSettings.findOneAndUpdate({ guildId, version: input.version }, {
      $set: after, $inc: { version: 1 },
      $push: { history: { $each: [{ actorId, at: new Date(), changes, before, after }], $slice: -100 } },
    }, { new: true, runValidators: true, upsert: input.version === 0 });
    if (!updated) throw workflowError(409, 'Otra persona modifico la configuracion. Recarga los valores.');
    return updated;
  } catch (error) {
    if (hasCode(error, 11000)) throw workflowError(409, 'Otra persona guardo la configuracion. Recarga los valores.');
    throw error;
  }
}
