import { BotControl, SystemEvent } from '../../database/models/BotControl.js';
import type { BotControlValues, ModuleKey } from '../../types/contracts.js';
import type { BotControlRecord } from '../../database/models/BotControl.js';
import { object, boolean, strings, version, id } from '../common/input.js';
import { workflowError } from '../workflow/rules.js';
import { hasCode } from '../../types/errors.js';

export const moduleKeys: ModuleKey[] = ['workflow', 'knowledge', 'projects', 'collaboration', 'automations', 'audit', 'music'];
export function defaultControls(): BotControlValues { return { operatorIds: [], maintenance: false, disabledModules: [], blockedGuildIds: [], requestsPerMinute: 120, jobsPerTick: 10 }; }
export async function getControls(): Promise<BotControlRecord> { return await BotControl.findOne({ key: 'global' }).lean() ?? { key: 'global', version: 0, ...defaultControls(), history: [] }; }
export async function assertAvailable(guildId: string, module?: ModuleKey, writing = true) {
  const controls = await getControls();
  if (controls.blockedGuildIds.includes(guildId)) throw workflowError(403, 'El uso del bot esta suspendido para este servidor.');
  if (writing && controls.maintenance) throw workflowError(503, 'El bot esta en mantenimiento. Puedes consultar los datos.');
  if (writing && module && controls.disabledModules.includes(module)) throw workflowError(503, 'Este modulo esta en mantenimiento global.');
  return controls;
}
export function validateControls(value: unknown) {
  const input = object(value, ['version', 'operatorIds', 'maintenance', 'disabledModules', 'blockedGuildIds', 'requestsPerMinute', 'jobsPerTick']);
  const disabled = strings(input.disabledModules, moduleKeys.length, 30);
  if (!disabled.every((key) => moduleKeys.includes(key as ModuleKey))) throw workflowError(400, 'Modulo desconocido.');
  const blockedGuildIds = strings(input.blockedGuildIds, 500, 20).map((item) => id(item, true));
  if (typeof input.requestsPerMinute !== 'number' || !Number.isInteger(input.requestsPerMinute) || input.requestsPerMinute < 30 || input.requestsPerMinute > 1000 ||
      typeof input.jobsPerTick !== 'number' || !Number.isInteger(input.jobsPerTick) || input.jobsPerTick < 1 || input.jobsPerTick > 50) throw workflowError(400, 'Limites fuera de rango.');
  return { operatorIds: strings(input.operatorIds, 50, 20).map((item) => id(item, true)), version: version(input.version), maintenance: boolean(input.maintenance), disabledModules: disabled as ModuleKey[], blockedGuildIds, requestsPerMinute: input.requestsPerMinute, jobsPerTick: input.jobsPerTick };
}
export async function saveControls(actorId: string, body: unknown, initialOperatorIds: string[] = []) {
  const { version: expected, ...after } = validateControls(body); const before = await getControls();
  if (before.version !== expected) throw workflowError(409, 'Los controles cambiaron. Actualiza el panel.');
  const snapshot: BotControlValues = { operatorIds: before.version === 0 ? initialOperatorIds : before.operatorIds, maintenance: before.maintenance, disabledModules: before.disabledModules, blockedGuildIds: before.blockedGuildIds, requestsPerMinute: before.requestsPerMinute, jobsPerTick: before.jobsPerTick };
  try {
    const saved = await BotControl.findOneAndUpdate({ key: 'global', version: expected }, { $set: after, $inc: { version: 1 },
      $push: { history: { $each: [{ actorId, at: new Date(), before: snapshot, after }], $slice: -100 } } }, { new: true, upsert: expected === 0, runValidators: true });
    if (!saved) throw workflowError(409, 'Los controles cambiaron. Actualiza el panel.'); return saved;
  } catch (error) { if (hasCode(error, 11000)) throw workflowError(409, 'Los controles cambiaron. Actualiza el panel.'); throw error; }
}
export async function logEvent(kind: string, message: string, guildId: string | null = null) {
  logRecord('bot.operation', { action: kind, guildId });
  try { await SystemEvent.create({ kind, message: message.slice(0, 500), guildId }); } catch { console.error('No se pudo guardar un evento operativo.'); }
}
import { logRecord } from '../../observability/logging.js';
