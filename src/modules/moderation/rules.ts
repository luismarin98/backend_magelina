import { PermissionFlagsBits as P, type GuildMember } from 'discord.js';
import type { ModerationAction } from '../../types/contracts.js';
import { object, text, strings } from '../common/input.js';
import { workflowError } from '../workflow/rules.js';

export const actions: ModerationAction[] = ['warning', 'timeout', 'untimeout', 'kick', 'ban'];
export const moderatorPermissions = P.ModerateMembers | P.KickMembers | P.BanMembers | P.ManageGuild;
export function canReview(member: GuildMember): boolean {
  return member.permissions.any(moderatorPermissions);
}
export function allowedActions({ actor, target, me, ownerId, actorId }: {
  actor: GuildMember | null; target: GuildMember; me: GuildMember; ownerId: string; actorId: string;
}): ModerationAction[] {
  // actor=null is reserved for the verified guild/global owner.
  if (target.id === actorId || target.id === me.id || target.id === ownerId || target.user.bot) return [];
  if (actor && actor.roles.highest.comparePositionTo(target.roles.highest) <= 0) return [];
  const permitted: ModerationAction[] = ['warning'];
  const belowBot = me.roles.highest.comparePositionTo(target.roles.highest) > 0;
  const bothHave = (permission: bigint) => me.permissions.has(permission) && (!actor || actor.permissions.has(permission));
  if (belowBot && !target.permissions.has(P.Administrator) && bothHave(P.ModerateMembers)) permitted.push('timeout', 'untimeout');
  if (belowBot && bothHave(P.KickMembers)) permitted.push('kick');
  if (belowBot && bothHave(P.BanMembers)) permitted.push('ban');
  return permitted;
}
export function validateCase(body: unknown, guildId: string) {
  const input = object(body, ['requestId', 'action', 'reason', 'evidence', 'durationMinutes']);
  if (typeof input.requestId !== 'string' || !/^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(input.requestId)) throw workflowError(400, 'Identificador de operacion no valido.');
  if (!actions.includes(input.action as ModerationAction)) throw workflowError(400, 'Accion de moderacion no valida.');
  const action = input.action as ModerationAction;
  const reason = text(input.reason, 1000);
  if (reason.length < 10) throw workflowError(400, 'Explica el motivo con al menos 10 caracteres.');
  const evidence = strings(input.evidence ?? [], 3, 200);
  for (const link of evidence) {
    if (!new RegExp(`^https://discord\\.com/channels/${guildId}/\\d{17,20}/\\d{17,20}$`).test(link)) throw workflowError(400, 'Usa enlaces a mensajes de este servidor como evidencia.');
  }
  let durationMinutes: number | null = null;
  if (action === 'timeout') {
    if (typeof input.durationMinutes !== 'number' || !Number.isSafeInteger(input.durationMinutes) || input.durationMinutes < 1 || input.durationMinutes > 40320) throw workflowError(400, 'La suspension debe durar entre 1 minuto y 28 dias.');
    durationMinutes = input.durationMinutes;
  } else if (input.durationMinutes !== undefined && input.durationMinutes !== null) throw workflowError(400, 'Esta accion no admite una duracion.');
  return { requestId: input.requestId, action, reason, evidence, durationMinutes };
}
