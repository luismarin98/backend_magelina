import { routeParam } from '../common/input.js';
import { Router } from 'express';
import type { RequestHandler } from 'express';
import { getPolicy, savePolicy, serializePolicy } from './service.js';
import { validatePolicy } from './rules.js';
import { workflowError } from '../workflow/rules.js';

export function permissionRoutes(requireNative: RequestHandler) {
  const router = Router({ mergeParams: true });
  router.use(requireNative);
  router.get('/', async (req, res) => { res.json({ policy: serializePolicy(await getPolicy(routeParam(req, 'guildId'))) }); });
  router.patch('/', async (req, res) => {
    const input = validatePolicy(req.body);
    const roles = await req.managedGuild!.roles.fetch();
    if (Object.values(input.grants).flat().some((id) => id === routeParam(req, 'guildId') || !roles.has(id))) {
      throw workflowError(400, 'Selecciona roles existentes de este servidor. No se permite @everyone.');
    }
    const policy = await savePolicy({ guildId: routeParam(req, 'guildId'), actorId: req.session.user!.id, body: input });
    res.json({ policy: serializePolicy(policy) });
  });
  return router;
}
