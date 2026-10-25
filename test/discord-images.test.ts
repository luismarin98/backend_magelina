import test from 'node:test';
import assert from 'node:assert/strict';
import { avatarDecoration, discordImage, serializeBot, serializeGuild, serializeSessionUser } from '../src/discord/images.js';
import { discordRequest } from '../src/auth/discord.js';

const hash = '1234567890abcdef1234567890abcdef';

test('iconos y banners animados tienen WebP animado y una variante estatica', () => {
  const guild = serializeGuild({ id: '100000000000000001', name: 'Comunidad', icon: `a_${hash}`, banner: `a_${hash}` });
  assert.equal(guild.icon?.url, `https://cdn.discordapp.com/icons/100000000000000001/a_${hash}.webp?size=128&animated=true`);
  assert.equal(guild.icon?.staticUrl, `https://cdn.discordapp.com/icons/100000000000000001/a_${hash}.webp?size=128`);
  assert.ok(guild.banner?.url.endsWith('size=512&animated=true'));
  assert.equal(serializeGuild({ id: '1', name: 'Sin imagen' }).icon, null);
  assert.equal(discordImage('icons/1', 'https://untrusted.invalid/image'), null);
  assert.equal(serializeGuild({ id: '../other', name: 'Invalid', icon: hash }).icon, null);
});

test('usuario y bot conservan avatar y decoracion sin exponer otros campos', () => {
  const user = serializeSessionUser({ id: '100000000000000001', username: 'ana', global_name: 'Ana', avatar: `a_${hash}`, avatar_decoration_data: { asset: `a_${hash}` } });
  assert.ok(user.avatar?.url.includes('&animated=true'));
  assert.equal(user.avatarDecorationUrl, `https://cdn.discordapp.com/avatar-decoration-presets/a_${hash}.png?size=128`);
  const bot = serializeBot({ id: user.id, username: 'Magelina', globalName: null, avatar: hash, discriminator: '0000', avatarDecorationData: { asset: `a_${hash}`, skuId: '100000000000000002' } });
  assert.equal(bot?.name, 'Magelina'); assert.ok(bot?.avatar?.url.includes(`/avatars/${user.id}/`));
  assert.deepEqual(Object.keys(bot!).sort(), ['avatar', 'avatarDecorationUrl', 'id', 'name']);
  assert.equal(serializeBot(null), null); assert.equal(avatarDecoration('../unsafe'), null);
});

test('los avatares predeterminados respetan usuarios migrados y discriminadores antiguos', () => {
  assert.equal(serializeSessionUser({ id: '4194304', username: 'Modern', discriminator: '0', avatar: null }).avatar?.url, 'https://cdn.discordapp.com/embed/avatars/1.png');
  assert.equal(serializeSessionUser({ id: '4194304', username: 'Legacy', discriminator: '1234', avatar: null }).avatar?.url, 'https://cdn.discordapp.com/embed/avatars/4.png');
});

test('OAuth conserva campos de imagen y descarta datos privados no necesarios', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ id: '100000000000000001', username: 'ana', avatar: hash, discriminator: '0', avatar_decoration_data: { asset: `a_${hash}`, sku_id: '123' }, email: 'private@example.invalid' }), { status: 200 }));
  const result = await discordRequest('/users/@me', 'synthetic-token');
  assert.equal(result.avatar, hash); assert.equal(result.avatar_decoration_data?.asset, `a_${hash}`);
  assert.equal('email' in result, false);
});
