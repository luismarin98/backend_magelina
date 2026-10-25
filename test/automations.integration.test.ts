import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { AutomationRule, AutomationJob } from '../src/database/models/Automation.js';
import { Project } from '../src/database/models/Project.js';
import { WorkItem } from '../src/database/models/WorkItem.js';
import { KnowledgeArticle } from '../src/database/models/KnowledgeArticle.js';
import { GuildSettings } from '../src/database/models/GuildSettings.js';
import { BotControl, SystemEvent } from '../src/database/models/BotControl.js';
import { defaultSettings } from '../src/modules/settings/rules.js';
import { createAutomationWorker } from '../src/modules/automations/worker.js';

test('cola: deduplicacion, leases, recuperacion, pausas y cancelacion', { skip: !process.env.TEST_MONGODB_URI }, async () => {
  await mongoose.connect(process.env.TEST_MONGODB_URI!, { dbName: 'discord_dashboard_automations_test' });
  const guildId = new mongoose.Types.ObjectId().toHexString(); const actor = '100000000000000001';
  const sent: string[] = [];
  const transport = { isReady: () => true, send: async (_guild: string, _channel: string, content: string) => { sent.push(content); } };
  const first = createAutomationWorker(transport); const second = createAutomationWorker(transport);
  try {
    await Promise.all([AutomationRule.init(), AutomationJob.init(), Project.init(), WorkItem.init(), KnowledgeArticle.init(), GuildSettings.init(), BotControl.init(), SystemEvent.init()]);
    await GuildSettings.create({ guildId, ...defaultSettings(), modules: { ...defaultSettings().modules, automations: true } });
    const rule = await AutomationRule.create({ guildId, title: 'Aviso', trigger: 'project.deadline', channelId: actor, enabled: true, delayMinutes: 0, createdBy: actor });
    const project = await Project.create({ guildId, title: 'Contenido privado que no debe copiarse', description: '', dueAt: new Date(Date.now() - 60000), history: [] });
    await Promise.all([first.tick(), second.tick()]);
    assert.equal(await AutomationJob.countDocuments({ guildId }), 1); assert.equal(sent.length, 1); assert.equal(sent[0].includes(project.title), false);
    await first.tick(); assert.equal(sent.length, 1);
    const job = await AutomationJob.findOne({ guildId }).lean(); assert.ok(job); assert.equal(job.status, 'delivered');
    // Simula caida tras reclamar un trabajo: otro trabajador recupera el lease vencido.
    await AutomationJob.updateOne({ _id: job._id }, { $set: { status: 'processing', attempts: 1, lockUntil: new Date(0), lockToken: 'old' } });
    await second.tick(); assert.equal(sent.length, 2);
    // Una regla modificada invalida trabajos anteriores.
    await AutomationRule.updateOne({ _id: rule._id }, { $inc: { version: 1 } });
    await AutomationJob.updateOne({ _id: job._id }, { $set: { status: 'pending', attempts: 0, dueAt: new Date(0) } });
    await first.tick(); assert.equal((await AutomationJob.findById(job._id).lean())!.status, 'cancelled');
    // Modulo pausado: no se entrega ni se consume un intento.
    await GuildSettings.updateOne({ guildId }, { $set: { 'modules.automations': false } });
    const pending = await AutomationJob.findOne({ guildId, ruleVersion: 1 }).lean(); assert.ok(pending);
    await AutomationJob.updateOne({ _id: pending._id }, { $set: { status: 'pending', attempts: 0, dueAt: new Date(0) } });
    const before = sent.length; await second.tick(); assert.equal(sent.length, before);
    assert.equal((await AutomationJob.findById(pending._id).lean())!.attempts, 0);
    await GuildSettings.updateOne({ guildId }, { $set: { 'modules.automations': true } });
    await AutomationJob.updateOne({ _id: pending._id }, { $set: { status: 'processing', attempts: 4, lockUntil: new Date(0) } });
    const failing = createAutomationWorker({ isReady: () => true, send: async () => { throw new Error('private-token-that-must-not-be-logged'); } });
    await failing.tick(); await failing.stop();
    const failed = await AutomationJob.findById(pending._id).lean(); assert.ok(failed);
    assert.equal(failed.status, 'failed'); assert.equal(failed.attempts, 5);
    assert.equal(failed.error!.includes('private-token'), false);
    assert.equal(await SystemEvent.countDocuments({ guildId, message: /private-token/ }), 0);
    // Un evento de aceptacion sigue siendo valido aunque la tarea ya se completo.
    const acceptedAt = new Date(Date.now() - 30000);
    await AutomationRule.create({ guildId, title: 'Aceptacion', trigger: 'task.accepted', channelId: actor, enabled: true, delayMinutes: 0, createdBy: actor, createdAt: new Date(0) });
    const task = await WorkItem.create({ guildId, title: 'Tarea', sourceChannelId: actor, sourceMessageId: actor, createdBy: actor, status: 'completed', history: [
      { actorId: actor, status: 'accepted', at: acceptedAt }, { actorId: actor, status: 'completed', at: new Date() },
    ] });
    await first.tick();
    assert.equal(await AutomationJob.countDocuments({ guildId, resourceId: task._id, trigger: 'task.accepted', status: 'delivered' }), 1);
  } finally {
    await Promise.all([first.stop(), second.stop()]);
    await Promise.all([AutomationRule.deleteMany({ guildId }), AutomationJob.deleteMany({ guildId }), Project.deleteMany({ guildId }), WorkItem.deleteMany({ guildId }), GuildSettings.deleteMany({ guildId }), SystemEvent.deleteMany({ guildId })]);
    await mongoose.disconnect();
  }
});
