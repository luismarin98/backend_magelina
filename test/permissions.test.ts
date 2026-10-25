import test from 'node:test';
import assert from 'node:assert/strict';
import { capabilities, emptyGrants, resolveAccess, validatePolicy } from '../src/modules/permissions/rules.js';

const role = '100000000000000001';
test('acceso delegado denegado inicialmente; el propietario del servidor conserva el control', () => {
  assert.deepEqual(resolveAccess(false, [role], emptyGrants()), { canConfigure: false, capabilities: [] });
  assert.deepEqual(resolveAccess(true, [], emptyGrants()), { canConfigure: true, capabilities });
});
test('gestionar incluye consulta y no concede configuracion ni acceso al otro modulo', () => {
  const grants = emptyGrants(); grants['workflow.manage'] = [role];
  assert.deepEqual(resolveAccess(false, [role], grants), { canConfigure: false, capabilities: ['workflow.read', 'workflow.manage'] });
  assert.deepEqual(resolveAccess(false, ['100000000000000002'], grants).capabilities, []);
  grants['knowledge.read'] = ['100000000000000002'];
  assert.deepEqual(resolveAccess(false, [role, '100000000000000002'], grants).capabilities, ['workflow.read', 'workflow.manage', 'knowledge.read']);
  assert.deepEqual(resolveAccess(false, [], grants).capabilities, []);
});
test('roles de consulta no permiten escribir; las reglas no se comparten entre invocaciones', () => {
  const grants = emptyGrants(); grants['knowledge.read'].push(role);
  assert.deepEqual(resolveAccess(false, [role], grants).capabilities, ['knowledge.read']);
  assert.deepEqual(emptyGrants()['knowledge.read'], []);
});
test('validacion rechaza capacidades desconocidas, IDs invalidos e inyecciones', () => {
  const body = { version: 0, grants: emptyGrants() };
  assert.deepEqual(validatePolicy(body), body);
  assert.throws(() => validatePolicy({ ...body, guildId: role }), { status: 400 });
  assert.throws(() => validatePolicy({ ...body, version: '0' }), { status: 400 });
  assert.throws(() => validatePolicy({ ...body, grants: { ...body.grants, 'settings.manage': [role] } }), { status: 400 });
  assert.throws(() => validatePolicy({ ...body, grants: { ...body.grants, 'workflow.read': [{ $ne: null }] } }), { status: 400 });
  assert.throws(() => validatePolicy({ ...body, grants: { ...body.grants, 'workflow.read': Array(21).fill(role) } }), { status: 400 });
  assert.throws(() => validatePolicy({ version: 0, grants: {} }), { status: 400 });
  assert.throws(() => validatePolicy(null), { status: 400 });
  assert.deepEqual(validatePolicy({ ...body, grants: { ...body.grants, 'workflow.read': [role, role] } }).grants['workflow.read'], [role]);
});
