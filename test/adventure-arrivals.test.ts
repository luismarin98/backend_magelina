import test from 'node:test';
import assert from 'node:assert/strict';
import { ChannelType } from 'discord.js';
import { AdventureConfig } from '../src/database/models/Adventure.js';
import { AdventureReceipt } from '../src/database/models/AdventureEconomy.js';
import { BotControl } from '../src/database/models/BotControl.js';
import { deliverTravelAnnouncements } from '../src/modules/adventure/worker.js';

test('arrival notices are delivered without mentions, retry failures and respect disabling announcements', async t => {
  let claimed = false, enabled = true, fail = false, sent = 0, attempts = 1, result: any;
  t.mock.method(BotControl, 'findOne', (() => ({ lean: async () => null })) as never);
  t.mock.method(AdventureConfig, 'findOne', (() => ({ lean: async () => ({ enabled: true, integration: { enabled, announceArrivals: true, categoryId: 'category', channelId: 'channel' } }) })) as never);
  t.mock.method(AdventureReceipt, 'updateMany', (async () => ({})) as never);
  t.mock.method(AdventureReceipt, 'findOneAndUpdate', (async () => { if (claimed) return null; claimed = true; return { _id: 'abcdefabcdefabcdefabcdef', notice: { guildId: 'country', channelId: 'channel', categoryId: 'category', alias: '@everyone Alice', attempts } }; }) as never);
  t.mock.method(AdventureReceipt, 'updateOne', (async (_filter: any, update: any) => { result = update.$set; }) as never);
  const bot = { isReady: () => true, guilds: { fetch: async () => ({ name: 'Pais A', channels: { fetch: async () => ({ type: ChannelType.GuildText, parentId: 'category', send: async (message: any) => { if (fail) throw new Error('Discord unavailable'); assert.deepEqual(message.allowedMentions.parse, []); assert.equal(message.enforceNonce, true); sent++; } }) } }) } };
  await deliverTravelAnnouncements(bot as any);
  assert.equal(sent, 1); assert.equal(result['notice.state'], 'sent');
  enabled = false; claimed = false;
  await deliverTravelAnnouncements(bot as any);
  assert.equal(sent, 1); assert.equal(result['notice.state'], 'skipped');
  enabled = true; fail = true; claimed = false;
  await deliverTravelAnnouncements(bot as any);
  assert.equal(result['notice.state'], 'pending');
  attempts = 5; claimed = false;
  await deliverTravelAnnouncements(bot as any);
  assert.equal(result['notice.state'], 'failed');
});
