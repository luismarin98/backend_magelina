import { GuildPolicy } from '../../database/models/GuildPolicy.js';
import type { GuildPolicyRecord } from '../../database/models/GuildPolicy.js';
import type { PermissionPolicy } from '../../types/contracts.js';
import { emptyGrants, validatePolicy } from './rules.js';
import { workflowError } from '../workflow/rules.js';
import { hasCode } from '../../types/errors.js';

export async function getPolicy(guildId: string): Promise<GuildPolicyRecord> {
  const stored = await GuildPolicy.findOne({ guildId }).lean();
  return stored ? { ...stored, grants: { ...emptyGrants(), ...stored.grants }, history: stored.history.map((event) => ({ ...event, before: { ...emptyGrants(), ...event.before }, after: { ...emptyGrants(), ...event.after } })) } : { guildId, version: 0, grants: emptyGrants(), history: [] };
}
export function serializePolicy(policy: GuildPolicyRecord): PermissionPolicy {
  return { guildId: policy.guildId, version: policy.version, grants: policy.grants,
    history: policy.history.map((entry) => ({ actorId: entry.actorId, before: entry.before, after: entry.after, at: entry.at.toISOString() })) };
}
export async function savePolicy({ guildId, actorId, body }: { guildId: string; actorId: string; body: unknown }) {
  const input = validatePolicy(body);
  const current = await getPolicy(guildId);
  if (current.version !== input.version) throw workflowError(409, 'Los permisos cambiaron. Recarga antes de guardar.');
  // Ordenar elimina diferencias de orden sin alterar el significado de las reglas.
  for (const list of Object.values(input.grants)) list.sort();
  const before = structuredClone(current.grants);
  for (const list of Object.values(before)) list.sort();
  if (JSON.stringify(before) === JSON.stringify(input.grants)) return current;
  try {
    const policy = await GuildPolicy.findOneAndUpdate({ guildId, version: input.version }, {
      $set: { grants: input.grants }, $inc: { version: 1 },
      $push: { history: { $each: [{ actorId, at: new Date(), before: current.grants, after: input.grants }], $slice: -100 } },
    }, { new: true, runValidators: true, upsert: input.version === 0 });
    if (!policy) throw workflowError(409, 'Otra persona modifico los permisos. Recarga antes de guardar.');
    return policy;
  } catch (error) {
    if (hasCode(error, 11000)) throw workflowError(409, 'Otra persona guardo los permisos. Recarga antes de guardar.');
    throw error;
  }
}
