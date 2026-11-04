import test from 'node:test';
import assert from 'node:assert/strict';
import { commandCatalog } from '../src/bot/catalog.js';
import { commandDefinitions } from '../src/bot/registration.js';

test('el catálogo cubre cada definición publicable y explica las acciones de mensajes', () => {
  const { commands } = commandCatalog();
  const expected = commandDefinitions.flatMap(definition => {
    const subcommands = 'options' in definition ? definition.options?.filter(option => option.type === 1 || option.type === 2) ?? [] : [];
    return subcommands.length ? subcommands.map(option => `/${definition.name} ${option.name}`) : [definition.type === 3 ? definition.name : `/${definition.name}`];
  });
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

test('adventure commands share one catalog group and describe self-service access', () => {
  const commands = commandCatalog().commands.filter(command => command.group === 'aventura');
  assert.equal(commands.length, 13);
  assert.ok(commands.every(command => command.requirements.some(value => value.includes('sin rol de moderacion'))));
  assert.match(commands.find(command => command.name === '/fabricar')!.usage, /\[cantidad\]/);
});
