import test from 'node:test';
import assert from 'node:assert/strict';
import { projectFields } from '../src/modules/projects/routes.js';
import { profileFields } from '../src/modules/collaboration/routes.js';
import { ruleFields } from '../src/modules/automations/service.js';
import { retryDelay } from '../src/modules/automations/worker.js';
import { defaultControls, validateControls } from '../src/modules/operations/service.js';
import { resolveAccess, emptyGrants } from '../src/modules/permissions/rules.js';
import { date, cursor } from '../src/modules/common/input.js';

test('proyectos: campos, limites y fechas con zona horaria', () => {
  const input = { title: ' Proyecto ', description: '', objectives: ['Objetivo'], dueAt: '2026-11-01T12:00:00Z' };
  assert.equal(projectFields(input).title, 'Proyecto');
  assert.equal(projectFields(input).dueAt!.toISOString(), input.dueAt.replace('00Z', '00.000Z'));
  assert.throws(() => projectFields({ ...input, guildId: 'otro' }), { status: 400 });
  assert.throws(() => projectFields({ ...input, objectives: Array(31).fill('x') }), { status: 400 });
  assert.throws(() => date('2026-11-01T12:00'), { status: 400 });
  assert.throws(() => cursor({ $ne: null }), { status: 400 });
});
test('colaboracion: edicion propia no acepta otro usuario ni estado de mentoria', () => {
  const input = { bio: 'Perfil', offers: ['Node'], seeks: ['React'], available: true, version: 0 };
  assert.deepEqual(profileFields(input).offers, ['node']);
  assert.throws(() => profileFields({ ...input, userId: 'otro' }), { status: 400 });
  assert.throws(() => profileFields({ ...input, status: 'active' }), { status: 400 });
  assert.throws(() => profileFields({ ...input, available: 'true' }), { status: 400 });
});
test('automatizaciones: lista cerrada de disparadores y reintentos acotados', () => {
  const input = { title: 'Aviso', trigger: 'task.completed', channelId: '100000000000000001', delayMinutes: 0, enabled: true };
  assert.equal(ruleFields(input).trigger, 'task.completed');
  assert.throws(() => ruleFields({ ...input, trigger: 'eval' }), { status: 400 });
  assert.throws(() => ruleFields({ ...input, script: 'process.exit()' }), { status: 400 });
  assert.throws(() => ruleFields({ ...input, delayMinutes: -1 }), { status: 400 });
  assert.equal(retryDelay(1), 30000); assert.equal(retryDelay(2), 60000); assert.equal(retryDelay(100), 3600000);
});
test('controles globales validan operadores, limites y modulos conocidos', () => {
  const input = { ...defaultControls(), version: 0 };
  assert.deepEqual(validateControls(input), input);
  for (const patch of [{ requestsPerMinute: 0 }, { jobsPerTick: 51 }, { disabledModules: ['unknown'] }, { operatorIds: ['admin'] }, { ownerIds: [] }, { blockedGuildIds: [{ $ne: null }] }]) assert.throws(() => validateControls({ ...input, ...patch }), { status: 400 });
});
test('las nuevas capacidades no conceden configuracion ni acceso cruzado', () => {
  const role = '100000000000000001'; const grants = emptyGrants(); grants['projects.manage'] = [role]; grants['audit.read'] = [role];
  const access = resolveAccess(false, [role], grants);
  assert.deepEqual(access.capabilities, ['projects.read', 'projects.manage', 'audit.read']); assert.equal(access.canConfigure, false);
});
