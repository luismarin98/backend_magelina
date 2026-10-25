import test from 'node:test';
import assert from 'node:assert/strict';
import { PermissionsBitField, PermissionFlagsBits as P, type GuildMember } from 'discord.js';
import { allowedActions, canReview, validateCase } from '../src/modules/moderation/rules.js';
function member(id: string, rank: number, permissions = 0n, bot = false): GuildMember {
  return { id, user: { bot }, permissions: new PermissionsBitField(permissions), roles: { highest: { rank, comparePositionTo: (other: { rank: number }) => rank - other.rank } } } as unknown as GuildMember;
}
const actorId = '100000000000000001', targetId = '100000000000000002', guildId = '100000000000000003';
const ownerId = '100000000000000004';
const modBits = P.ModerateMembers | P.KickMembers | P.BanMembers;
const ctx = { actor: member(actorId, 5, modBits), target: member(targetId, 1), me: member('100000000000000005', 9, modBits), ownerId, actorId };

test('native permissions and both hierarchies constrain moderation', () => {
  assert.deepEqual(allowedActions(ctx), ['warning', 'timeout', 'untimeout', 'kick', 'ban']);
  assert.deepEqual(allowedActions({ ...ctx, actor: member(actorId, 1, P.Administrator) }), []);
  assert.deepEqual(allowedActions({ ...ctx, me: member('bot', 1, modBits) }), ['warning']);
  assert.deepEqual(allowedActions({ ...ctx, actor: member(actorId, 5, P.KickMembers) }), ['warning', 'kick']);
  assert.equal(canReview(member(actorId, 5)), false);
  assert.equal(canReview(member(actorId, 5, P.ManageRoles)), false);
  assert.equal(canReview(member(actorId, 5, P.ManageGuild)), true);
});
test('protects self, guild owner and bots; administrators cannot be timed out', () => {
  for (const target of [member(actorId, 1), member(ownerId, 1), member('bot', 1, 0n, true), ctx.me]) assert.deepEqual(allowedActions({ ...ctx, target }), []);
  assert.deepEqual(allowedActions({ ...ctx, target: member(targetId, 1, P.Administrator) }), ['warning', 'kick', 'ban']);
  assert.deepEqual(allowedActions({ ...ctx, actor: null, me: member('bot', 0, modBits) }), ['warning']);
});
test('incident input rejects missing reasons, foreign evidence, invalid durations and injected fields', () => {
  const input = { requestId: 'ae9d3848-1bb4-4070-998d-61ec1bdef019', action: 'timeout', reason: 'Insultos reiterados documentados.', durationMinutes: 60, evidence: [`https://discord.com/channels/${guildId}/${targetId}/${actorId}`] };
  assert.equal(validateCase(input, guildId).durationMinutes, 60);
  for (const patch of [{ reason: 'malo' }, { durationMinutes: 40321 }, { durationMinutes: 0 }, { action: 'delete' }, { actorId }, { requestId: 'invalid' }, { evidence: ['javascript:alert(1)'] }, { evidence: [`https://discord.com/channels/${ownerId}/${targetId}/${actorId}`] }]) assert.throws(() => validateCase({ ...input, ...patch }, guildId));
  assert.throws(() => validateCase({ ...input, action: 'kick' }, guildId));
});
