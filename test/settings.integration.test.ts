import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { GuildSettings } from '../src/database/models/GuildSettings.js';
import { WorkItem } from '../src/database/models/WorkItem.js';
import { KnowledgeArticle } from '../src/database/models/KnowledgeArticle.js';
import { defaultSettings } from '../src/modules/settings/rules.js';
import { getSettings, saveSettings, requireModule } from '../src/modules/settings/service.js';
import { createRequest, changeRequest } from '../src/modules/workflow/service.js';
import { createArticle } from '../src/modules/knowledge/service.js';

test('configuracion: primer guardado concurrente, aislamiento y aplicacion real', { skip: !process.env.TEST_MONGODB_URI }, async () => {
  await mongoose.connect(process.env.TEST_MONGODB_URI!, { dbName: 'discord_dashboard_workflow_test' });
  const guildId = new mongoose.Types.ObjectId().toHexString();
  const otherGuild = new mongoose.Types.ObjectId().toHexString();
  const actorId = '100000000000000001';
  try {
    await Promise.all([GuildSettings.init(), WorkItem.init(), KnowledgeArticle.init()]);
    assert.equal((await getSettings(guildId)).version, 0);
    assert.equal(await GuildSettings.countDocuments({ guildId }), 0);
    const input = { ...defaultSettings(), version: 0, modules: { ...defaultSettings().modules, workflow: false, knowledge: true }, knowledge: { reviewDays: 7 } };
    const save = () => saveSettings({ guildId, actorId, body: input });
    const results = await Promise.allSettled([save(), save()]);
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    const rejected = results.find((result) => result.status === 'rejected');
    assert.ok(rejected && rejected.status === 'rejected'); assert.equal(rejected.reason.status, 409);
    const stored = await getSettings(guildId);
    assert.equal(stored.version, 1); assert.equal(stored.history.length, 1);
    assert.equal(stored.history[0].before.modules.workflow, true);
    assert.equal(stored.history[0].after.modules.workflow, false);
    assert.equal((await getSettings(otherGuild)).modules.workflow, true);
    await assert.rejects(() => requireModule(guildId, 'workflow'), { status: 403 });
    await assert.rejects(() => createRequest({ guildId, createdBy: actorId, sourceChannelId: actorId, sourceMessageId: actorId, title: 'Bloqueada' }), { status: 403 });
    const source = await WorkItem.create({ guildId, createdBy: actorId, sourceChannelId: actorId, sourceMessageId: actorId, title: 'Anterior', status: 'completed', history: [] });
    await assert.rejects(() => changeRequest({ guildId, itemId: source.id, actorId, body: { status: 'completed', version: 0 },
      guild: { members: { fetch: async () => ({ user: { bot: false } }) } } }), { status: 403 });
    const article = await createArticle({ guildId, actorId, body: { sourceItemId: source.id, title: 'Solucion', content: 'Pasos', tags: [] } });
    assert.equal(article.reviewDueAt.getTime() - article.reviewedAt.getTime(), 7 * 86400000);
    await saveSettings({ guildId, actorId, body: { ...input, version: 1, modules: { ...defaultSettings().modules, workflow: false, knowledge: false } } });
    await assert.rejects(() => requireModule(guildId, 'knowledge'), { status: 403 });
    assert.equal(await WorkItem.countDocuments({ guildId }), 1);
    assert.equal(await KnowledgeArticle.countDocuments({ guildId }), 1);
  } finally {
    await Promise.all([GuildSettings.deleteMany({ guildId }), WorkItem.deleteMany({ guildId }), KnowledgeArticle.deleteMany({ guildId })]);
    await mongoose.disconnect();
  }
});
