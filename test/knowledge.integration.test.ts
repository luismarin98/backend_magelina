import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { WorkItem } from '../src/database/models/WorkItem.js';
import { KnowledgeArticle } from '../src/database/models/KnowledgeArticle.js';
import { createArticle, updateArticle } from '../src/modules/knowledge/service.js';

test('soluciones: origen completado, aislamiento, duplicados y version', { skip: !process.env.TEST_MONGODB_URI }, async () => {
  await mongoose.connect(process.env.TEST_MONGODB_URI!, { dbName: 'discord_dashboard_workflow_test' });
  const guildId = new mongoose.Types.ObjectId().toHexString();
  const actorId = '100000000000000001';
  try {
    await Promise.all([WorkItem.init(), KnowledgeArticle.init()]);
    const source = await WorkItem.create({ guildId, sourceChannelId: '100000000000000002', sourceMessageId: '100000000000000003',
      createdBy: actorId, title: 'Tarea', status: 'submitted', history: [{ actorId, status: 'submitted', at: new Date() }],
    });
    const body = { sourceItemId: source.id, title: 'Solucion', content: 'Pasos para resolverlo', tags: ['ayuda'] };
    await assert.rejects(() => createArticle({ guildId, actorId, body }), { status: 409 });
    await WorkItem.updateOne({ _id: source._id }, { $set: { status: 'completed' } });
    await assert.rejects(() => createArticle({ guildId: 'otro', actorId, body }), { status: 404 });
    const article = await createArticle({ guildId, actorId, body });
    await assert.rejects(() => createArticle({ guildId, actorId, body }), { status: 409 });
    const change = (action: string, version: number, scope = guildId) => updateArticle({ guildId: scope, articleId: article.id, actorId, body: { action, version } });
    await assert.rejects(() => change('reviewed', 0, 'otro'), { status: 409 });
    const results = await Promise.allSettled([change('reviewed', 0), change('reviewed', 0)]);
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    const rejected = results.find((result) => result.status === 'rejected');
    assert.ok(rejected && rejected.status === 'rejected');
    assert.equal(rejected.reason.status, 409);
    const archived = await change('archived', 1);
    assert.equal(archived.archived, true);
    await assert.rejects(() => change('reviewed', 2), { status: 409 });
    const restored = await change('restored', 2);
    assert.equal(restored.archived, false);
    assert.equal(restored.history.length, 4);
    assert.equal(restored.history.at(-1)!.actorId, actorId);
  } finally {
    await KnowledgeArticle.deleteMany({ guildId });
    await WorkItem.deleteMany({ guildId });
    await mongoose.disconnect();
  }
});
