import { createHash, randomBytes } from 'node:crypto';
import mongoose from 'mongoose';
import { Router } from 'express';
import { AdventureCharacter, AdventureConfig, AdventureMembership } from '../../database/models/Adventure.js';
import { AdventureOffer, AdventureRun } from '../../database/models/AdventureExpedition.js';
import { AdventureInventory, AdventureReceipt } from '../../database/models/AdventureEconomy.js';
import { id, object, text, version } from '../common/input.js';
import { workflowError } from '../workflow/rules.js';
import { hasCode } from '../../types/errors.js';
import { assertAvailable } from '../operations/service.js';
import { changeStack } from './economy-rules.js';
import { resolveExpeditionStep, type ExpeditionDefinition } from './expedition-rules.js';
import type { WorldAccess } from './world.js';

export const expeditionModels = { AdventureCharacter, AdventureConfig, AdventureMembership, AdventureOffer, AdventureRun, AdventureInventory, AdventureReceipt };
export async function expeditionOperation(userId: string, action: string, input: Record<string, unknown>, world?: WorldAccess, models = expeditionModels) {
  const { AdventureCharacter, AdventureConfig, AdventureMembership, AdventureOffer, AdventureRun, AdventureInventory, AdventureReceipt } = models;
  const key = text(input.key, 64);
  if (!/^[a-zA-Z0-9-]{16,64}$/.test(key)) throw workflowError(400, 'Identificador de operación no válido.');
  const fingerprint = createHash('sha256').update(JSON.stringify({ action: `expedition:${action}`, ...Object.fromEntries(Object.entries(input).filter(([field]) => field !== 'key').sort(([a], [b]) => a.localeCompare(b))) })).digest('hex');
  const replay = (receipt: any) => {
    if (receipt.fingerprint !== fingerprint) throw workflowError(409, 'El identificador pertenece a otra operación.');
    return receipt.result;
  };
  const previous = await AdventureReceipt.findOne({ userId, key }).lean();
  if (previous) return replay(previous);
  if (action === 'start') {
    const offer = await AdventureOffer.findById(id(input.offerId)).lean();
    if (!offer || offer.expiresAt <= new Date()) throw workflowError(409, 'La aventura ya no está disponible.');
    if (!world) throw workflowError(503, 'No se pudo comprobar el acceso al país.');
    await world.verify(userId, offer.guildId);
  }
  const session = await mongoose.startSession();
  try {
    let result: Record<string, unknown> = {};
    await session.withTransaction(async () => {
      const receipt = await AdventureReceipt.findOne({ userId, key }).session(session).lean();
      if (receipt) { result = replay(receipt); return; }
      const character = await AdventureCharacter.findOne({ userId }).session(session);
      if (!character) throw workflowError(409, 'Primero inicia tu personaje.');
      const now = new Date();
      if (action === 'start') {
        if (character.activeAdventureId) throw workflowError(409, 'Ya tienes una aventura activa.');
        if (character.nextAdventureAt && character.nextAdventureAt > now) throw workflowError(409, 'Necesitas descansar antes de iniciar otra aventura.');
        const offer = await AdventureOffer.findById(id(input.offerId)).session(session).lean();
        if (!offer || offer.expiresAt <= now) throw workflowError(409, 'La aventura ha caducado.');
        if (character.currentGuildId !== offer.guildId) throw workflowError(409, 'Viaja a ese país antes de iniciar la aventura.');
        const definition = offer.definition as ExpeditionDefinition;
        if (character.level < definition.minLevel) throw workflowError(403, 'Tu nivel no cumple los requisitos.');
        const config = await AdventureConfig.findOne({ guildId: offer.guildId, enabled: true }).session(session).lean();
        if (!config || !await AdventureMembership.findOne({ userId, guildId: offer.guildId }).session(session).lean()) throw workflowError(403, 'El gremio debe estar habilitado y debes estar inscrito.');
        await AdventureConfig.updateOne({ _id: config._id }, { $inc: { commerceRevision: 1 } }, { session });
        const [run] = await AdventureRun.create([{ userId, guildId: offer.guildId, offerId: String(offer._id), definition, seed: randomBytes(32).toString('hex'), dueAt: new Date(now.getTime() + definition.steps[0]!.seconds * 1000) }], { session });
        character.activeAdventureId = String(run!._id);
        character.nextAdventureAt = new Date(now.getTime() + definition.steps.reduce((sum, step) => sum + step.seconds, 0) * 1000);
        character.version++;
        await character.save({ session });
        result = { started: true, runId: String(run!._id) };
      } else {
        const run = await AdventureRun.findOne({ _id: id(input.runId), userId, active: true }).select('+seed').session(session);
        if (!run || character.activeAdventureId !== String(run._id)) throw workflowError(409, 'La aventura ya terminó o no te pertenece.');
        if (run.version !== version(input.version)) throw workflowError(409, 'La aventura cambió. Revisa su estado.');
        const definition = run.definition as ExpeditionDefinition;
        if (action === 'decide') {
          if (run.status !== 'active' || run.dueAt > now) throw workflowError(409, 'La siguiente etapa aún no está lista.');
          const step = definition.steps[run.stage]!;
          const outcome = resolveExpeditionStep(run.seed, run.stage, input.choice);
          run.rewards![step.material] += outcome.quantity;
          run.rewards!.experience += outcome.experience;
          run.events.push({ stage: run.stage, choice: outcome.choice, text: outcome.event, at: now });
          run.stage++;
          if (run.stage === definition.steps.length) run.status = 'ready';
          else run.dueAt = new Date(now.getTime() + definition.steps[run.stage]!.seconds * 1000);
          result = { decided: true, event: outcome.event };
        } else if (action === 'claim') {
          if (run.status !== 'ready') throw workflowError(409, 'Completa las etapas antes de recoger las recompensas.');
          let inventory = await AdventureInventory.findOne({ userId }).session(session);
          if (!inventory) [inventory] = await AdventureInventory.create([{ userId }], { session });
          const stacks = new Map<string, number>(inventory!.stacks);
          for (const material of ['wood', 'herb'] as const) if (run.rewards![material]) changeStack(stacks, material, run.rewards![material]);
          inventory!.set('stacks', stacks); await inventory!.save({ session });
          const experience = character.experience + run.rewards!.experience;
          if (!Number.isSafeInteger(experience) || experience > 1000000000) throw workflowError(409, 'Se alcanzó el límite de experiencia.');
          character.experience = experience;
          character.level = Math.max(character.level, Math.min(100, 1 + Math.floor(experience / 100)));
          run.status = 'completed'; run.active = false; character.activeAdventureId = null;
          result = { claimed: true, rewards: { wood: run.rewards!.wood, herb: run.rewards!.herb, experience: run.rewards!.experience } };
        } else if (action === 'abandon') {
          run.status = 'abandoned'; run.active = false; character.activeAdventureId = null;
          result = { abandoned: true };
        } else throw workflowError(400, 'Acción desconocida.');
        run.version++; character.version++;
        await run.save({ session }); await character.save({ session });
      }
      await AdventureReceipt.create([{ userId, key, fingerprint, result }], { session });
    }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } });
    return result;
  } catch (error) {
    if (hasCode(error, 11000)) {
      const receipt = await AdventureReceipt.findOne({ userId, key }).lean();
      if (receipt) return replay(receipt);
      throw workflowError(409, 'Otra operación modificó tu aventura. Revisa su estado.');
    }
    if (hasCode(error, 20) || hasCode(error, 303)) throw workflowError(503, 'Las aventuras requieren MongoDB con transacciones habilitadas.');
    throw error;
  } finally { await session.endSession(); }
}
export function runDto(run: any) {
  if (!run) return null;
  const definition = run.definition as ExpeditionDefinition;
  return { id: String(run._id), guildId: run.guildId, title: definition.title, status: run.status, stage: run.stage, totalStages: definition.steps.length,
    step: definition.steps[run.stage] ? { title: definition.steps[run.stage]!.title, description: definition.steps[run.stage]!.description } : null,
    dueAt: run.dueAt, version: run.version, rewards: { wood: run.rewards?.wood ?? 0, herb: run.rewards?.herb ?? 0, experience: run.rewards?.experience ?? 0 },
    events: run.events.map((event: any) => ({ text: event.text, at: event.at })), createdAt: run.createdAt };
}
export function expeditionRoutes(world?: WorldAccess) {
  const router = Router();
  router.get('/', async (req, res) => {
    const userId = req.session.user!.id, character = await AdventureCharacter.findOne({ userId }).lean();
    if (!character) throw workflowError(409, 'Primero inicia tu personaje.');
    const guildId = req.query.guildId === undefined ? character.currentGuildId : id(req.query.guildId, true);
    const active = await AdventureRun.findOne({ userId, active: true }).lean();
    const history = await AdventureRun.find({ userId, active: false }).sort({ _id: -1 }).limit(5).lean();
    let offers: any[] = [], boardMessage = '', joined = false;
    if (guildId && world) {
      try {
        await world.verify(userId, guildId);
        if (!(await AdventureConfig.findOne({ guildId }).lean())?.enabled) throw workflowError(409, 'El juego está desactivado en este país.');
        joined = Boolean(await AdventureMembership.exists({ guildId, userId }));
        offers = await AdventureOffer.find({ guildId, expiresAt: { $gt: new Date() } }).sort({ 'definition.minLevel': 1, _id: 1 }).limit(3).lean();
        if (!offers.length) boardMessage = 'El tablón se está preparando. Las nuevas aventuras aparecerán automáticamente.';
      } catch { boardMessage = 'No se pudo consultar el tablón de ese país. Puedes continuar o abandonar tu aventura actual.'; }
    } else boardMessage = 'Viaja a un país con el juego habilitado para descubrir sus aventuras.';
    res.json({ serverTime: new Date(), guildId: guildId ?? null, characterLevel: character.level, nextAdventureAt: character.nextAdventureAt ?? null,
      canStart: Boolean(guildId && joined && character.currentGuildId === guildId && !active), boardMessage, active: runDto(active), history: history.map(runDto),
      offers: offers.map(offer => { const definition = offer.definition as ExpeditionDefinition; return { id: String(offer._id), title: definition.title, description: definition.description, minLevel: definition.minLevel, seconds: definition.steps.reduce((sum, step) => sum + step.seconds, 0), expiresAt: offer.expiresAt }; }) });
  });
  for (const action of ['start', 'decide', 'claim', 'abandon']) router.post(`/${action}`, async (req, res) => {
    await assertAvailable('');
    const input = object(req.body, ['key', ...(action === 'start' ? ['offerId'] : ['runId', 'version']), ...(action === 'decide' ? ['choice'] : [])]);
    res.json(await expeditionOperation(req.session.user!.id, action, input, world));
  });
  return router;
}
