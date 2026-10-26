import test from 'node:test';
import assert from 'node:assert/strict';
import { canManageGuild, getGlobalRole } from '../src/auth/discord.js';
import { readConfig } from '../src/config/env.js';

test('los permisos de servidor no conceden administracion global', () => {
  const config = { ownerIds: ['100000000000000001'], operatorIds: ['100000000000000002'] };
  assert.equal(getGlobalRole('100000000000000001', config), 'owner');
  assert.equal(getGlobalRole('100000000000000002', config), 'operator');
  assert.equal(getGlobalRole('100000000000000003', config), 'member');
});

test('solo propietario, administrador o Manage Guild pueden gestionar el servidor', () => {
  assert.equal(canManageGuild({ owner: true, permissions: '0' }), true);
  assert.equal(canManageGuild({ permissions: '8' }), true);
  assert.equal(canManageGuild({ permissions: '32' }), true);
  assert.equal(canManageGuild({ permissions: '268435456' }), false); // Manage Roles no equivale a Manage Guild.
  assert.equal(canManageGuild({ permissions: '0' }), false);
});

test('configuracion rechaza secretos cortos y propietarios mal configurados', () => {
  const env = {
    MONGODB_URI: 'mongodb://localhost/test', DISCORD_TOKEN: 'test',
    DISCORD_CLIENT_ID: '100000000000000000', DISCORD_CLIENT_SECRET: 'test',
    DISCORD_REDIRECT_URI: 'http://localhost:3000/api/auth/discord/callback',
    SESSION_SECRET: 'Test-only-AAaa11!!-session-secret-12345678', BOT_OWNER_IDS: '100000000000000001',
  };
  assert.equal(readConfig(env).ownerIds[0], env.BOT_OWNER_IDS);
  assert.equal(readConfig(env).bindHost, '0.0.0.0');
  assert.equal(readConfig({ ...env, BIND_HOST: '127.0.0.1' }).bindHost, '127.0.0.1');
  assert.throws(() => readConfig({ ...env, BIND_HOST: 'https://example.com' }), /BIND_HOST/);
  assert.deepEqual(readConfig(env).dnsServers, []);
  assert.deepEqual(readConfig({ ...env, DNS_SERVERS: '1.1.1.1, 8.8.8.8' }).dnsServers, ['1.1.1.1', '8.8.8.8']);
  assert.throws(() => readConfig({ ...env, DNS_SERVERS: 'https://dns.example' }), /DNS_SERVERS/);
  assert.throws(() => readConfig({ ...env, DNS_SERVERS: '1.1.1.1,8.8.8.8,9.9.9.9,1.0.0.1,8.8.4.4' }), /DNS_SERVERS/);
  assert.throws(() => readConfig({ ...env, SESSION_SECRET: 'short' }), /SESSION_SECRET/);
  assert.throws(() => readConfig({ ...env, SESSION_SECRET: 'a1'.repeat(32) }), /cifrar las sesiones/);
  assert.throws(() => readConfig({ ...env, BOT_OWNER_IDS: 'admin' }), /IDs/);
  assert.throws(() => readConfig({ ...env, BOT_OWNER_IDS: ',' }), /BOT_OWNER_IDS/);
  assert.throws(() => readConfig({ ...env, NODE_ENV: 'production' }), /HTTPS/);
});
