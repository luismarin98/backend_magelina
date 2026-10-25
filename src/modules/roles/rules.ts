import { capabilities } from '../permissions/rules.js';
﻿import { PermissionFlagsBits } from 'discord.js';
import type { RoleTemplate, RoleGrants } from '../../types/contracts.js';
import { workflowError } from '../workflow/rules.js';
export const permissionOptions = ['ViewChannel', 'ReadMessageHistory', 'SendMessages', 'AddReactions', 'EmbedLinks', 'AttachFiles', 'Connect', 'Speak', 'ManageMessages', 'ModerateMembers', 'ManageThreads', 'ManageNicknames'];
export const templates: RoleTemplate[] = [
  { id: 'administrator', name: 'Administrador', permissions: ['ViewChannel', 'ReadMessageHistory', 'ManageMessages', 'ModerateMembers'], capabilities: [...capabilities] },
  { id: 'moderator', name: 'Moderador', permissions: ['ViewChannel', 'ReadMessageHistory', 'ManageMessages', 'ModerateMembers'], capabilities: ['workflow.read', 'workflow.manage', 'collaboration.read', 'collaboration.manage', 'audit.read'] },
  { id: 'coordinator', name: 'Coordinador', permissions: ['ViewChannel', 'ReadMessageHistory', 'SendMessages', 'ManageThreads'], capabilities: ['workflow.read', 'workflow.manage', 'knowledge.read', 'knowledge.manage', 'projects.read', 'projects.manage', 'collaboration.read', 'collaboration.manage'] },
  { id: 'collaborator', name: 'Colaborador', permissions: ['ViewChannel', 'ReadMessageHistory', 'SendMessages', 'AddReactions'], capabilities: ['workflow.read', 'knowledge.read', 'projects.read', 'collaboration.read'] },
  { id: 'reader', name: 'Lector', permissions: ['ViewChannel', 'ReadMessageHistory'], capabilities: ['knowledge.read', 'projects.read'] },
  { id: 'custom', name: 'Personalizado', permissions: [], capabilities: [] },
];
export function templateFor(value: unknown) {
  const template = templates.find((item) => item.id === value);
  if (!template) throw workflowError(400, 'Tipo de rol no valido.');
  return template;
}
export function permissionBits(value: unknown): bigint {
  if (!Array.isArray(value) || value.length > permissionOptions.length || value.some((key) => typeof key !== 'string' || !permissionOptions.includes(key))) throw workflowError(400, 'Permisos de Discord no validos.');
  return value.reduce((bits: bigint, key: string) => bits | PermissionFlagsBits[key as keyof typeof PermissionFlagsBits], 0n);
}
export function templateGrants(grants: RoleGrants, roleId: string, template: RoleTemplate): RoleGrants {
  return Object.fromEntries(Object.entries(grants).map(([capability, roles]) => [capability, [...roles.filter((id) => id !== roleId), ...(template.capabilities.includes(capability as keyof RoleGrants) ? [roleId] : [])]])) as RoleGrants;
}
