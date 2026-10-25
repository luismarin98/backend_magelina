import test from 'node:test';
import assert from 'node:assert/strict';
import { transitions, validateChange } from '../src/modules/workflow/rules.js';

test('una solicitud solo se convierte en tarea al aceptarla', () => {
  assert.deepEqual(transitions.submitted, ['accepted', 'rejected']);
  assert.deepEqual(transitions.accepted, ['in_progress']);
  assert.deepEqual(transitions.in_progress, ['completed']);
  assert.deepEqual(transitions.completed, []);
  assert.deepEqual(transitions.rejected, []);
});

test('aceptar exige responsable y version para evitar sobrescrituras', () => {
  const valid = { status: 'accepted', version: 0, assigneeId: '100000000000000001' };
  assert.equal(validateChange(valid), valid);
  assert.throws(() => validateChange({ status: 'accepted', version: 0 }), { status: 400 });
  assert.throws(() => validateChange({ ...valid, assigneeId: 'admin' }), { status: 400 });
  assert.throws(() => validateChange({ ...valid, assigneeId: 100000000000000001 }), { status: 400 });
  assert.throws(() => validateChange({ ...valid, version: -1 }), { status: 400 });
  assert.throws(() => validateChange({ ...valid, version: '0' }), { status: 400 });
});

test('no permite inyectar campos de otro servidor ni modificar el historial', () => {
  for (const injected of [{ guildId: 'other' }, { history: [] }, { $set: { status: 'completed' } }]) {
    assert.throws(() => validateChange({ status: 'in_progress', version: 1, ...injected }), { status: 400 });
  }
  assert.throws(() => validateChange({ status: '__proto__', version: 1 }), { status: 400 });
  assert.throws(() => validateChange({ status: 'completed', version: 1, assigneeId: '100000000000000001' }), { status: 400 });
  assert.throws(() => validateChange(null), { status: 400 });
});
