import test from 'node:test';
import assert from 'node:assert/strict';
import { BotControl } from '../src/database/models/BotControl.js';
import { createWorldAccess } from '../src/modules/adventure/world.js';

test('country access checks actual Discord membership and bot presence without a bot-owner bypass', async t => {
  t.mock.method(BotControl, 'findOne', (() => ({ lean: async () => null })) as never);
  let missingBot = false, missingMember = false, checkedUser = '';
  const bot = { guilds: { fetch: async () => {
    if (missingBot) throw { code: 10004 };
    return { name: 'Pais A', members: { fetch: async ({ user, force }: { user: string; force: boolean }) => { checkedUser = user; assert.equal(force, true); if (missingMember) throw { code: 10007 }; } } };
  } } };
  const access = createWorldAccess(bot as any, { listGuilds: async () => [{ id: 'A', name: 'Pais A', botInstalled: true }, { id: 'B', name: 'Otro', botInstalled: false }] } as any);
  assert.equal(await access.verify('owner-or-player', 'A'), 'Pais A');
  assert.equal(checkedUser, 'owner-or-player');
  assert.equal((await access.list('player', 'token')).length, 1);
  missingMember = true;
  await assert.rejects(access.verify('owner-or-player', 'A'), /pertenecer/);
  missingBot = true;
  await assert.rejects(access.verify('owner-or-player', 'A'), /instalada/);
});
