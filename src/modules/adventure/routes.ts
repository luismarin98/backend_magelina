import { adventureIntegrationRoutes, joinAnnouncement } from './integration.js';
import { adventureItemRoutes } from './items.js';
import { Router } from 'express';
import { PermissionFlagsBits as P } from 'discord.js';
import { AdventureCharacter, AdventureConfig, AdventureMembership } from '../../database/models/Adventure.js';
import type { guildAuthorization } from '../permissions/access.js';
import { object, text, version } from '../common/input.js';
import { workflowError } from '../workflow/rules.js';
import { hasCode } from '../../types/errors.js';

export function characterAlias(value: unknown) {
  const alias = text(value, 32).normalize('NFC');
  if (alias.length < 2 || /[\p{Cc}\p{Cf}]/u.test(alias)) throw workflowError(400, 'El alias debe tener de 2 a 32 caracteres, sin saltos de línea ni caracteres invisibles.');
  return alias;
}

export function adventureRoutes(access: ReturnType<typeof guildAuthorization>) {
  const router = Router({ mergeParams: true });
  router.use(access.requireMember);
  // Global bot administration never creates or impersonates a player's membership.
  router.use(async (req, res, next) => {
    const member = await req.managedGuild!.members.fetch({ user: req.session.user!.id, force: true }).catch((error: unknown) => {
      if (hasCode(error, 10007)) throw workflowError(403, 'Debes pertenecer al servidor para participar en su gremio de aventureros.');
      throw workflowError(502, 'No se pudo comprobar tu pertenencia al servidor.');
    });
    res.locals.adventureMember = member;
    res.locals.canConfigureAdventure = member.id === req.managedGuild!.ownerId || member.permissions.has(P.Administrator);
    next();
  });
  router.use('/integration', adventureIntegrationRoutes());
  router.get('/', async (req, res) => {
    const guildId = req.managedGuild!.id, userId = req.session.user!.id;
    const [config, character, membership] = await Promise.all([
      AdventureConfig.findOne({ guildId }).lean(), AdventureCharacter.findOne({ userId }).lean(), AdventureMembership.findOne({ guildId, userId }).lean(),
    ]);
    res.json({ enabled: config?.enabled ?? false, configVersion: config?.version ?? 0, canConfigure: res.locals.canConfigureAdventure, canConfigureIntegration: Boolean(res.locals.canConfigureAdventure || config?.integration?.delegateRoleIds.some(role => res.locals.adventureMember.roles?.cache.has(role))), canReviewItems: req.guildAccess?.source === 'bot-owner',
      character: character ? { alias: character.alias, profession: character.profession ?? null, level: character.level, rank: character.rank, coins: character.coins, experience: character.experience, version: character.version } : null,
      membership: membership ? { guildId, localAlias: membership.localAlias, version: membership.version, joinedAt: membership.createdAt } : null });
  });
  router.put('/settings', async (req, res) => {
    if (!res.locals.canConfigureAdventure) throw workflowError(403, 'Solo un administrador del servidor puede habilitar el juego.');
    const input = object(req.body, ['enabled', 'version']), expected = version(input.version);
    if (typeof input.enabled !== 'boolean') throw workflowError(400, 'Indica si deseas habilitar el juego.');
    try {
      const config = await AdventureConfig.findOneAndUpdate({ guildId: req.managedGuild!.id, version: expected }, { $set: { enabled: input.enabled }, $inc: { version: 1 } }, { new: true, upsert: expected === 0, runValidators: true });
      if (!config) throw workflowError(409, 'La configuración cambió. Actualiza antes de guardar.');
      res.json({ enabled: config.enabled, configVersion: config.version });
    } catch (error) { if (hasCode(error, 11000)) throw workflowError(409, 'La configuración cambió. Actualiza antes de guardar.'); throw error; }
  });
  router.use(async (req, _res, next) => {
    const config = await AdventureConfig.findOne({ guildId: req.managedGuild!.id }).lean();
    if (!config?.enabled) throw workflowError(409, 'El juego está desactivado en este servidor.');
    next();
  });
  router.use('/items', adventureItemRoutes());
  router.post('/join', async (req, res) => {
    object(req.body, []);
    const guildId = req.managedGuild!.id, userId = req.session.user!.id;
    const character = await AdventureCharacter.findOne({ userId });
    if (!character) throw workflowError(409, 'Inicia tu partida desde Mi aventura antes de unirte a un gremio.');
    // No welcome currency or rewards: retries never reset or duplicate progress.
    let membership;
    try { membership = await AdventureMembership.findOneAndUpdate({ guildId, userId }, { $setOnInsert: { guildId, userId, ...joinAnnouncement(await AdventureConfig.findOne({ guildId }).lean(), character.alias) } }, { new: true, upsert: true, runValidators: true }); }
    catch (error) { if (!hasCode(error, 11000)) throw error; membership = await AdventureMembership.findOne({ guildId, userId }); }
    if (!membership) throw workflowError(503, 'No se pudo confirmar la inscripción. Reintenta para comprobar su estado.');
    res.json({ joined: true });
  });
  router.patch('/character', async (req, res) => {
    const input = object(req.body, ['alias', 'version']);
    const character = await AdventureCharacter.findOneAndUpdate({ userId: req.session.user!.id, version: version(input.version) }, { $set: { alias: characterAlias(input.alias) }, $inc: { version: 1 } }, { new: true, runValidators: true });
    if (!character) throw workflowError(409, 'El personaje cambió o todavía no existe. Actualiza antes de guardar.');
    res.json({ saved: true });
  });
  router.patch('/membership', async (req, res) => {
    const input = object(req.body, ['localAlias', 'version']);
    const localAlias = input.localAlias === null ? null : characterAlias(input.localAlias);
    const membership = await AdventureMembership.findOneAndUpdate({ guildId: req.managedGuild!.id, userId: req.session.user!.id, version: version(input.version) }, { $set: { localAlias }, $inc: { version: 1 } }, { new: true, runValidators: true });
    if (!membership) throw workflowError(409, 'Tu inscripción cambió o todavía no existe. Actualiza antes de guardar.');
    res.json({ saved: true });
  });
  return router;
}
