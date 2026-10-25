import test from 'node:test';
import assert from 'node:assert/strict';
import { validateArticle, validateVersion, escapeSearch } from '../src/modules/knowledge/rules.js';

const input = { sourceItemId: '1234567890abcdef12345678', title: ' Solucion ', content: ' Pasos ', tags: ['Node', 'node', ' API '] };

test('normaliza etiquetas y conserva texto plano', () => {
  assert.deepEqual(validateArticle(input), { title: 'Solucion', content: 'Pasos', tags: ['node', 'api'] });
  assert.equal(validateArticle({ ...input, content: '<script>texto</script>' }).content, '<script>texto</script>');
});

test('rechaza campos ajenos, entradas vacias e inyecciones', () => {
  for (const change of [{ guildId: 'otro' }, { content: ' ' }, { title: 'a'.repeat(161) },
    { content: 'a'.repeat(8001) }, { tags: Array(9).fill('tag') }, { tags: ['a'.repeat(31)] }, { tags: [1] }, { sourceItemId: { $ne: null } }]) {
    assert.throws(() => validateArticle({ ...input, ...change }), { status: 400 });
  }
  assert.throws(() => validateArticle(null), { status: 400 });
  assert.throws(() => validateVersion('0'), { status: 400 });
  assert.throws(() => validateVersion(-1), { status: 400 });
});

test('busqueda literal sin ejecutar expresiones regulares de usuario', () => {
  const regex = new RegExp(escapeSearch(' (a+)+$ [.*] '), 'i');
  assert.equal(regex.test('texto (a+)+$ [.*] texto'), true);
  assert.equal(regex.test('aaaaa'), false);
  assert.throws(() => escapeSearch({ $ne: '' }), { status: 400 });
  assert.throws(() => escapeSearch('a'.repeat(121)), { status: 400 });
});
