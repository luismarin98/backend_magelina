import test from 'node:test';
import assert from 'node:assert/strict';
import { commandCatalog } from '../src/bot/catalog.js';
import { commandDefinitions } from '../src/bot/registration.js';

test('el catálogo cubre cada definición publicable y explica las acciones de mensajes', () => {
  const { commands } = commandCatalog();
  const expected = commandDefinitions.flatMap(definition => 'options' in definition && definition.options?.length ? definition.options.map(option => `/${definition.name} ${option.name}`) : [definition.name]);
  assert.deepEqual(commands.map(command => command.name).sort(), expected.sort());
  assert.equal(new Set(commands.map(command => command.id)).size, commands.length);
  const context = commands.find(command => command.kind === 'message')!;
  assert.equal(context.name, 'Crear solicitud');
  assert.match(context.usage, /clic derecho.*Aplicaciones/);
  assert.ok(context.description);
});

test('el catálogo distingue parámetros opcionales, límites, elecciones y capacidades', () => {
  const { commands } = commandCatalog();
  const change = commands.find(command => command.name === '/magelina solicitud')!;
  assert.match(change.usage, /<id> <version> <estado> \[responsable\]/);
  assert.equal(change.parameters.find(parameter => parameter.name === 'responsable')?.type, 'Usuario');
  assert.equal(change.parameters.find(parameter => parameter.name === 'estado')?.choices.length, 4);
  const volume = commands.find(command => command.name === '/musica volumen')!;
  assert.equal(volume.parameters[0]?.min, 0); assert.equal(volume.parameters[0]?.max, 100);
  assert.ok(volume.requirements.some(value => value.includes('music.manage')));
  const youtube = commands.find(command => command.name === '/musica youtube')!;
  assert.ok(youtube.requirements.some(value => value.includes('music.request')));
  assert.ok(youtube.requirements.some(value => value.includes('experimental')));
  assert.ok(commands.find(command => command.name === '/musica desconectar')?.requirements.some(value => value.includes('deshabilitado')));
});
