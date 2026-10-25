import { musicRoutes } from '../modules/music/routes.js';
import { getMusicService } from '../modules/music/service.js';
import { moderationRoutes } from '../modules/moderation/routes.js';
import { roleRoutes } from '../modules/roles/routes.js';
import { routeParam } from '../modules/common/input.js';
import { projectRoutes } from '../modules/projects/routes.js';
import { collaborationRoutes } from '../modules/collaboration/routes.js';
import { automationRoutes } from '../modules/automations/routes.js';
import { auditRoutes } from '../modules/audit/routes.js';
import { operationRoutes } from '../modules/operations/routes.js';
import { commandRoutes } from '../modules/operations/commands.js';
import { effectiveRole } from '../modules/operations/roles.js';
import { guildAuthorization } from '../modules/permissions/access.js';
import { permissionRoutes } from '../modules/permissions/routes.js';
import { getSettings } from '../modules/settings/service.js';
import type { ManagementDependencies } from '../types/http.js';
import { Router } from 'express';
import { requireUser } from '../auth/routes.js';
import { isDatabaseReady } from '../database/connection.js';
import { workflowRoutes } from '../modules/workflow/routes.js';
import { knowledgeRoutes } from '../modules/knowledge/routes.js';
import { settingsRoutes } from '../modules/settings/routes.js';

import { serializeBot, serializeGuild } from '../discord/images.js';
import { userIdentities } from '../discord/user-identities.js';
import { commandCatalog } from '../bot/catalog.js';

export function managementRoutes({ bot, config }: ManagementDependencies) {
  const router = Router();
  router.use(requireUser);
  router.get('/commands/catalog', (_req, res) => res.json(commandCatalog()));

  const access = guildAuthorization(bot, config);
  const requireGuildManager = access.requireNative;
  const identities = userIdentities(bot);
  router.get('/guilds/:guildId/users', access.requireAny, identities);

  router.use('/guilds/:guildId/work-items', workflowRoutes({ bot, requireCapability: access.requireCapability }));
  router.use('/guilds/:guildId/knowledge', knowledgeRoutes({ requireCapability: access.requireCapability }));
  router.use('/guilds/:guildId/settings', settingsRoutes({ requireGuildManager }));

  router.use('/guilds/:guildId/projects', projectRoutes(access.requireCapability));
  router.use('/guilds/:guildId/collaboration', collaborationRoutes(access.requireCapability));
  router.use('/guilds/:guildId/automations', automationRoutes(access.requireCapability));
  router.use('/guilds/:guildId/audit-logs', auditRoutes(access.requireCapability));

  router.use('/guilds/:guildId/music', musicRoutes(access.requireCapability, getMusicService(bot, config.audiusApiKey)));
  router.use('/guilds/:guildId/moderation', moderationRoutes(access));
  router.use('/guilds/:guildId/permissions', permissionRoutes(requireGuildManager));
  router.get('/guilds/:guildId/access', access.requireMember, async (req, res) => {
    const settings = await getSettings(routeParam(req, 'guildId'));
    res.json({ ...req.guildAccess!, modules: settings.modules, reviewDays: settings.knowledge.reviewDays });
  });
  router.get('/guilds', async (req, res) => {
    res.json({ guilds: await access.listGuilds(req.session.accessToken!, req.session.user!.id) });
  });

  router.use('/guilds/:guildId/roles', roleRoutes(access));

  router.use('/admin', async (req, res, next) => {
    if (!['owner', 'operator'].includes(await effectiveRole(req.session.user!.id, config))) {
      return res.status(403).json({ error: 'Acceso reservado a la administracion del bot.' });
    }
    next();
  });
  router.use('/admin/operations', operationRoutes(config));
  router.get('/admin/users', identities);
  router.use('/admin/commands', commandRoutes(config, undefined, bot));
  router.get('/admin/overview', (_req, res) => {
    res.json({
      bot: { ...serializeBot(bot.user), ready: bot.isReady(), name: bot.user?.username ?? null, uptimeMs: bot.uptime ?? 0 },
      database: { ready: isDatabaseReady() },
      guildCount: bot.guilds.cache.size,
      guilds: [...bot.guilds.cache.values()].map(serializeGuild),
    });
  });
  return router;
}
