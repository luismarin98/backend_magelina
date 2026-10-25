import { test } from 'node:test';
import assert from 'node:assert/strict';
import { permissionBits, templateFor, templateGrants } from '../src/modules/roles/rules.js';
import { emptyGrants, resolveAccess, capabilities } from '../src/modules/permissions/rules.js';

test('administrator template grants operational modules without guild governance', () => {
  const role = '111111111111111111';
  const grants = templateGrants(emptyGrants(), role, templateFor('administrator'));
  const access = resolveAccess(false, [role], grants);
  assert.deepEqual(access.capabilities, capabilities);
  assert.equal(access.canConfigure, false);
  assert.throws(() => templateFor('owner'));
});

test('native role permissions reject administrator and arbitrary permission bits', () => {
  assert.throws(() => permissionBits(['Administrator']));
  assert.throws(() => permissionBits('8'));
  assert.throws(() => permissionBits(['UnknownPermission']));
  assert.equal(permissionBits(['ViewChannel', 'ViewChannel']), 1024n);
});
test('template replaces only selected role grants and preserves other roles', () => {
  const grants = emptyGrants();
  grants['workflow.manage'] = ['111111111111111111', '222222222222222222'];
  const result = templateGrants(grants, '111111111111111111', templateFor('reader'));
  assert.deepEqual(result['workflow.manage'], ['222222222222222222']);
  assert.deepEqual(result['knowledge.read'], ['111111111111111111']);
  assert.deepEqual(grants['knowledge.read'], []);
  assert.throws(() => templateFor('owner'));
});
