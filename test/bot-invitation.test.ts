import test from 'node:test';
import assert from 'node:assert/strict';
import { PermissionFlagsBits as P } from 'discord.js';
import { botInvitation } from '../src/discord/invitation.js';
import { permissionOptions } from '../src/modules/roles/rules.js';

test('invitation computes a deduplicated feature permission mask without Administrator', () => {
  const invite = botInvitation('100000000000000001');
  const names = [...new Set(invite.features.flatMap(feature => feature.permissions))];
  assert.equal(invite.permissionCount, names.length);
  assert.equal(BigInt(invite.permissions) & P.Administrator, 0n);
  for (const name of [...permissionOptions, 'ManageChannels', 'ManageRoles', 'ManageThreads', 'ViewAuditLog', 'KickMembers', 'BanMembers', 'ModerateMembers', 'Connect', 'Speak', 'MoveMembers']) {
    const flag = P[name as keyof typeof P];
    assert.equal(BigInt(invite.permissions) & flag, flag, name);
  }
  assert.equal(invite.permissions, names.reduce((mask, name) => mask | P[name], 0n).toString());
  const url = new URL(invite.url);
  assert.equal(url.origin + url.pathname, 'https://discord.com/oauth2/authorize');
  assert.equal(url.searchParams.get('client_id'), '100000000000000001');
  assert.equal(url.searchParams.get('permissions'), invite.permissions);
  assert.equal(url.searchParams.get('scope'), 'bot applications.commands');
  assert.equal(url.searchParams.get('integration_type'), '0');
});
