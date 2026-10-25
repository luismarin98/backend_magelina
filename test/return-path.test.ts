import test from 'node:test';
import assert from 'node:assert/strict';
import { safeReturnPath } from '../src/auth/return-path.js';

test('OAuth2 conserva solo destinos locales y conocidos', () => {
  assert.equal(safeReturnPath('/admin/operations'), '/admin/operations');
  assert.equal(safeReturnPath('/dashboard/servers/100000000000000001/projects'), '/dashboard/servers/100000000000000001/projects');
  assert.equal(safeReturnPath('/dashboard/servers/100000000000000001/settings/'), '/dashboard/servers/100000000000000001/settings');
  for (const path of ['https://example.com', '//example.com', '/admin/unknown', '/dashboard/../admin', '/dashboard?next=https://example.com', '/dashboard/servers/invalid/tasks', ['/', '/admin'], undefined]) {
    assert.equal(safeReturnPath(path), '/dashboard');
  }
});
