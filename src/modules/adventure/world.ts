import { Router } from 'express';
import type { Client } from 'discord.js';
import { AdventureCharacter, AdventureConfig, AdventureMembership } from '../../database/models/Adventure.js';
import type { guildAuthorization } from '../permissions/access.js';
import { workflowError } from '../workflow/rules.js';
import { hasCode } from '../../types/errors.js';
import { assertAvailable } from '../operations/service.js';

export interface WorldAccess {
  list: (userId: string, token: string) => Promise<{ id: string; name: string }[]>;
  verify: (userId: string, guildId: string) => Promise<string>;
}
export function createWorldAccess(bot: Client, access?: ReturnType<typeof guildAuthorization>): WorldAccess {
  return {
    list: async (userId, token) => (access ? await access.listGuilds(token, userId) : []).filter(guild => guild.botInstalled).map(guild => ({ id: guild.id, name: guild.name })),
    verify: async (userId, guildId) => {
      await assertAvailable(guildId, undefined, false);
      const guild = await bot.guilds.fetch(guildId).catch((error: unknown) => {
        if (hasCode(error, 10004) || hasCode(error, 50001)) throw workflowError(403, 'Magelina debe estar instalada en ese país.');
        throw workflowError(502, 'No se pudo comprobar el acceso al país.');
      });
      await guild.members.fetch({ user: userId, force: true }).catch((error: unknown) => {
        if (hasCode(error, 10007)) throw workflowError(403, 'Debes pertenecer al servidor de ese país.');
        throw workflowError(502, 'No se pudo comprobar tu pertenencia al país.');
      });
      return guild.name;
    },
  };
}
export function worldRoutes(access?: WorldAccess) {
  const router = Router();
  router.get('/', async (req, res) => {
    if (!access) throw workflowError(503, 'El acceso a los países no está disponible.');
    const userId = req.session.user!.id;
    const character = await AdventureCharacter.findOne({ userId }).lean();
    if (!character) throw workflowError(409, 'Primero inicia tu aventura.');
    const guilds = await access.list(userId, req.session.accessToken!);
    const ids = guilds.map(guild => guild.id);
    const [configs, memberships] = await Promise.all([AdventureConfig.find({ guildId: { $in: ids } }).lean(), AdventureMembership.find({ guildId: { $in: ids }, userId }).lean()]);
    res.json({ activeAdventureId: character.activeAdventureId ?? null, currentGuildId: character.currentGuildId ?? null, currentGuildName: character.currentGuildName ?? null, version: character.version,
      countries: guilds.map(guild => ({ ...guild, enabled: Boolean(configs.find(config => config.guildId === guild.id)?.enabled), joined: memberships.some(membership => membership.guildId === guild.id) })) });
  });
  return router;
}
