import { Router } from 'express';
import type { Client } from 'discord.js';
import { listBotGuilds } from '../discord/bot-guilds.js';
import { serializeGuild } from '../discord/images.js';
import { workflowError } from '../modules/workflow/rules.js';
import { hasCode } from '../types/errors.js';
import { routeParam } from '../modules/common/input.js';

/** Mounted after the global owner/operator authorization in managementRoutes. */
export function adminGuildRoutes(bot: Client) {
  const router = Router();
  router.get('/', async (_req, res) => {
    const guilds = await listBotGuilds(bot);
    res.set('Cache-Control', 'no-store').json({ guilds: guilds.map(guild => ({ ...guild, botInstalled: true })) });
  });
  router.get('/:guildId', async (req, res) => {
    const id = routeParam(req, 'guildId');
    if (!/^\d{17,20}$/.test(id)) throw workflowError(400, 'ID de servidor no válido.');
    const guild = await bot.guilds.fetch({ guild: id, force: true, withCounts: true }).catch((error: unknown) => {
      if (hasCode(error, 10004) || hasCode(error, 50001)) throw workflowError(404, 'Magelina ya no tiene acceso a este servidor. Actualiza la lista.');
      throw workflowError(502, 'No se pudo consultar la información del servidor en Discord.');
    });
    res.set('Cache-Control', 'no-store').json({ guild: {
      ...serializeGuild(guild),
      description: guild.description,
      ownerId: guild.ownerId,
      preferredLocale: guild.preferredLocale,
      createdAt: guild.createdAt.toISOString(),
      memberCount: guild.approximateMemberCount ?? null,
      onlineCount: guild.approximatePresenceCount ?? null,
    } });
  });
  return router;
}
