import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultSettings, validateSettings, assertModuleEnabled, changedSettings } from '../src/modules/settings/rules.js';

test('los valores iniciales preservan el funcionamiento de los modulos existentes', () => {
  const settings = defaultSettings();
  assert.equal(settings.modules.workflow, true);
  assert.equal(settings.modules.knowledge, true);
  assert.equal(settings.notifications.channelId, null);
  assert.equal(settings.knowledge.reviewDays, 90);
  settings.modules.workflow = false;
  assert.equal(defaultSettings().modules.workflow, true);
});

test('valida entradas completas sin aceptar campos ni conversiones arbitrarias', () => {
  const input = { ...defaultSettings(), version: 0 };
  assert.deepEqual(validateSettings(input), input);
  for (const patch of [{ version: '0' }, { version: -1 }, { guildId: 'otro' }, { modules: { workflow: 'false', knowledge: true } },
    { modules: { workflow: true, knowledge: true, other: true } }, { notifications: { enabled: true, channelId: { $ne: null } } },
    { knowledge: { reviewDays: 0 } }, { knowledge: { reviewDays: 366 } }, { knowledge: { reviewDays: 1.5 } }]) {
    assert.throws(() => validateSettings({ ...input, ...patch }), { status: 400 });
  }
  assert.throws(() => validateSettings(null), { status: 400 });
});

test('desactivar un modulo no desactiva el otro; el historial identifica cambios', () => {
  const before = defaultSettings();
  const after = defaultSettings(); after.modules.workflow = false; after.knowledge.reviewDays = 30;
  assert.throws(() => assertModuleEnabled(after, 'workflow'), { status: 403 });
  assert.doesNotThrow(() => assertModuleEnabled(after, 'knowledge'));
  assert.deepEqual(changedSettings(before, after), ['modules.workflow', 'knowledge.reviewDays']);
  assert.deepEqual(changedSettings(before, defaultSettings()), []);
});
