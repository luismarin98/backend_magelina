import type { Capability, GuildAccess, PermissionInput, RoleGrants, GlobalRole } from '../../types/contracts.js';
import { workflowError } from '../workflow/rules.js';

export const capabilities: Capability[] = ['workflow.read', 'workflow.manage', 'knowledge.read', 'knowledge.manage', 'projects.read', 'projects.manage', 'collaboration.read', 'collaboration.manage', 'automations.read', 'automations.manage', 'audit.read', 'music.read', 'music.request', 'music.manage'];
export function emptyGrants(): RoleGrants {
  return { 'workflow.read': [], 'workflow.manage': [], 'knowledge.read': [], 'knowledge.manage': [], 'projects.read': [], 'projects.manage': [], 'collaboration.read': [], 'collaboration.manage': [], 'automations.read': [], 'automations.manage': [], 'audit.read': [], 'music.read': [], 'music.request': [], 'music.manage': [] };
}
export function resolveAccess(guildOwner: boolean, roleIds: string[], grants: RoleGrants, globalRole: GlobalRole = 'member'): GuildAccess {
  if (guildOwner || globalRole === 'owner') return { canConfigure: true, capabilities: [...capabilities] };
  const allowed = new Set(capabilities.filter((key) => grants[key].some((id) => roleIds.includes(id))));
  if (allowed.has('music.manage')) { allowed.add('music.request'); allowed.add('music.read'); }
  if (allowed.has('music.request')) allowed.add('music.read');
  if (allowed.has('workflow.manage')) allowed.add('workflow.read');
  if (allowed.has('knowledge.manage')) allowed.add('knowledge.read');
  if (allowed.has('projects.manage')) allowed.add('projects.read');
  if (allowed.has('collaboration.manage')) allowed.add('collaboration.read');
  if (allowed.has('automations.manage')) allowed.add('automations.read');
  return { canConfigure: false, capabilities: capabilities.filter((key) => allowed.has(key)) };
}
export function validatePolicy(value: unknown): PermissionInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw workflowError(400, 'Permisos no validos.');
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some((key) => !['version', 'grants'].includes(key)) || typeof input.version !== 'number' || !Number.isSafeInteger(input.version) || input.version < 0 ||
      !input.grants || typeof input.grants !== 'object' || Array.isArray(input.grants)) throw workflowError(400, 'Version o permisos no validos.');
  const grants = input.grants as Record<string, unknown>;
  if (Object.keys(grants).some((key) => !capabilities.includes(key as Capability))) throw workflowError(400, 'Permiso desconocido.');
  const normalized = emptyGrants();
  for (const key of capabilities) {
    const roles = grants[key];
    if (!Array.isArray(roles) || roles.length > 20 || !roles.every((id: unknown) => typeof id === 'string' && /^\d{17,20}$/.test(id))) {
      throw workflowError(400, 'Cada permiso admite hasta 20 IDs de roles validos.');
    }
    normalized[key] = [...new Set(roles as string[])];
  }
  return { version: input.version, grants: normalized };
}
