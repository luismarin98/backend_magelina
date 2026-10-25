import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import session from 'express-session';
import mongoose from 'mongoose';
import type { AddressInfo } from 'node:net';
import type { RequireCapability } from '../src/modules/permissions/access.js';
import { projectRoutes } from '../src/modules/projects/routes.js';
import { collaborationRoutes } from '../src/modules/collaboration/routes.js';
import { resolveAccess, emptyGrants } from '../src/modules/permissions/rules.js';
import { Project } from '../src/database/models/Project.js';
import { WorkItem } from '../src/database/models/WorkItem.js';
import { CollaborationProfile, Mentorship } from '../src/database/models/Collaboration.js';
import { GuildSettings } from '../src/database/models/GuildSettings.js';
import { BotControl } from '../src/database/models/BotControl.js';

test('HTTP de modulos: vinculos aislados, consentimiento y versiones', { skip: !process.env.TEST_MONGODB_URI }, async () => {
  await mongoose.connect(process.env.TEST_MONGODB_URI!, { dbName: 'discord_dashboard_features_test' });
  const guildId = new mongoose.Types.ObjectId().toHexString(); const otherGuild = new mongoose.Types.ObjectId().toHexString();
  const actor = '100000000000000001'; const learner = '100000000000000002';
  const app = express(); app.use(express.json());
  // Sesiones y permisos simulados SOLO en este servidor de prueba; no en la aplicacion.
  app.use(session({ secret: 'test-only-secret-never-used-in-production', resave: false, saveUninitialized: false }));
  app.use((req, _res, next) => { const user = req.get('x-test-user') ?? actor; req.session.user = { id: user, name: user, username: user }; next(); });
  const requireCapability: RequireCapability = (capability) => (req, res, next) => {
    const grants = emptyGrants(); grants['collaboration.read'] = ['participant'];
    const access = resolveAccess(req.get('x-test-manager') === 'true', ['participant'], grants);
    if (!access.capabilities.includes(capability)) return res.status(403).json({ error: 'denied' });
    req.guildAccess = access; next();
  };
  app.use('/guilds/:guildId/projects', projectRoutes(requireCapability));
  app.use('/guilds/:guildId/collaboration', collaborationRoutes(requireCapability));
  app.use(((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const status = typeof error === 'object' && error !== null && 'status' in error && typeof error.status === 'number' ? error.status : 500;
    res.status(status).json({ error: 'test error' });
  }) satisfies express.ErrorRequestHandler);
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const send = (path: string, body: unknown, user = actor, manager = true) => fetch(`${base}${path}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'x-test-user': user, 'x-test-manager': String(manager) }, body: JSON.stringify(body) });
  try {
    await Promise.all([Project.init(), WorkItem.init(), CollaborationProfile.init(), Mentorship.init(), GuildSettings.init(), BotControl.init()]);
    const project = await Project.create({ guildId, title: 'Proyecto', description: '', objectives: ['Objetivo'], history: [] });
    const item = await WorkItem.create({ guildId, title: 'Tarea', sourceChannelId: actor, sourceMessageId: actor, createdBy: actor, history: [] });
    const cross = await WorkItem.create({ guildId: otherGuild, title: 'Otra tarea', sourceChannelId: actor, sourceMessageId: actor, createdBy: actor, history: [] });
    const link = `/guilds/${guildId}/projects/${project.id}/tasks/${item.id}`;
    assert.equal((await send(link, { version: 0, attached: true }, actor, false)).status, 403);
    assert.equal((await send(`/guilds/${guildId}/projects/${project.id}/tasks/${cross.id}`, { version: 0, attached: true })).status, 404);
    assert.equal((await send(link, { version: 0, attached: true })).status, 200);
    assert.equal(String((await WorkItem.findById(item.id).lean())!.projectId), project.id);
    assert.equal((await send(link, { version: 0, attached: false })).status, 409);
    const mentorship = await Mentorship.create({ guildId, mentorId: actor, learnerId: learner, goal: 'Aprender', history: [] });
    const path = `/guilds/${guildId}/collaboration/mentorships/${mentorship.id}`;
    assert.equal((await send(path, { action: 'accept', version: 0 }, '100000000000000003')).status, 403);
    assert.equal((await send(path, { action: 'accept', version: 0 }, actor, false)).status, 200);
    assert.equal((await Mentorship.findById(mentorship.id).lean())!.status, 'pending');
    assert.equal((await send(path, { action: 'accept', version: 0 }, learner, false)).status, 409);
    assert.equal((await send(path, { action: 'accept', version: 1 }, learner, false)).status, 200);
    const active = await Mentorship.findById(mentorship.id).lean(); assert.equal(active!.status, 'active'); assert.equal(active!.acceptedBy.length, 2);
    assert.equal((await send(path, { action: 'complete', version: 2 }, learner, false)).status, 200);
    assert.equal((await send(path, { action: 'accept', version: 3 }, actor, false)).status, 403);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await Promise.all([Project.deleteMany({ guildId }), WorkItem.deleteMany({ guildId: { $in: [guildId, otherGuild] } }), Mentorship.deleteMany({ guildId })]);
    await mongoose.disconnect();
  }
});
