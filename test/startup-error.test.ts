import test from 'node:test';
import assert from 'node:assert/strict';
import { ConfigError, readConfig } from '../src/config/env.js';
import { startupErrorMessage } from '../src/config/startup-error.js';

test('el arranque identifica variables faltantes sin mostrar valores de entorno', () => {
  assert.throws(() => readConfig({}), (error: unknown) => {
    assert.ok(error instanceof ConfigError);
    assert.match(startupErrorMessage('configuration', error), /Faltan variables de entorno:.*SESSION_SECRET/);
    return true;
  });
});

test('los errores externos no filtran secretos, URIs ni stacks', () => {
  const cause = Object.assign(new Error('mongodb://user:secret@example.invalid'), { code: 18 });
  for (const stage of ['configuration', 'mongodb', 'indexes', 'discord', 'http'] as const) {
    const message = startupErrorMessage(stage, cause);
    assert.ok(!message.includes('secret'));
    assert.ok(!message.includes('example.invalid'));
  }
  assert.match(startupErrorMessage('http', { code: 'EADDRINUSE' }), /puerto.*ocupado/);
  assert.match(startupErrorMessage('http', { code: 'EAFNOSUPPORT', message: 'detalle-privado' }), /codigo del sistema: EAFNOSUPPORT/);
  assert.ok(!startupErrorMessage('http', { code: 'EAFNOSUPPORT', message: 'detalle-privado' }).includes('detalle-privado'));
  assert.match(startupErrorMessage('indexes', { code: 11000 }), /duplicados/);
});

test('una URL invalida identifica el campo sin imprimir la entrada', () => {
  const env = { MONGODB_URI: 'mongodb://localhost/test', DISCORD_TOKEN: 'test', DISCORD_CLIENT_ID: '100000000000000001', DISCORD_CLIENT_SECRET: 'test', DISCORD_REDIRECT_URI: 'http://localhost:3000/callback', SESSION_SECRET: 'x'.repeat(32), BOT_OWNER_IDS: '100000000000000001', DASHBOARD_ORIGIN: 'valor-secreto-invalido' };
  assert.throws(() => readConfig(env), (error: unknown) => {
    assert.ok(error instanceof ConfigError);
    assert.equal(error.message, 'DASHBOARD_ORIGIN debe ser una URL valida.');
    return true;
  });
});

test('distingue rechazo DNS SRV de rechazo del servidor MongoDB sin mostrar hosts', () => {
  const dns = Object.assign(new Error('querySrv ECONNREFUSED _mongodb._tcp.host-privado'), { code: 'ECONNREFUSED', syscall: 'querySrv' });
  const message = startupErrorMessage('mongodb', dns);
  assert.match(message, /DNS SRV/);
  assert.ok(!message.includes('host-privado'));
  assert.match(startupErrorMessage('mongodb', { code: 'ECONNREFUSED', syscall: 'connect' }), /conexion.*rechazada/);
  assert.match(startupErrorMessage('mongodb', { code: 'ENOTFOUND' }), /configuracion DNS/);
});

test('el rechazo de Discord identifica la prioridad del entorno sin registrar el token', () => {
  for (const cause of [{ code: 'TokenInvalid', message: 'token-privado' }, { status: 401, message: 'token-privado' }, { code: 4004, message: 'token-privado' }]) {
    const message = startupErrorMessage('discord', cause);
    assert.match(message, /Discord rechazo el token/);
    assert.match(message, /entorno/);
    assert.match(message, /\.env/);
    assert.ok(!message.includes('token-privado'));
  }
});
