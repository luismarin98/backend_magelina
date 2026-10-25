import { Router } from 'express';
import type { Config } from '../../config/env.js';
import { createCommandRegistration, type CommandRegistration, type PublicationTarget } from '../../bot/registration.js';
import type { Client } from 'discord.js';
import { object } from '../common/input.js';
import { workflowError } from '../workflow/rules.js';
import { logEvent } from './service.js';

// Montado bajo la autorización global /admin de managementRoutes.
export function commandRoutes(config: Config, registration: CommandRegistration = createCommandRegistration(config), bot?: Client) {
  const router = Router();
  function target(scope: unknown, guildId: unknown): PublicationTarget | undefined {
    if (scope === undefined && guildId === undefined) return undefined;
    if (scope === 'global' && guildId === undefined) return { scope };
    if (scope !== 'guild' || typeof guildId !== 'string' || !/^\d{17,20}$/.test(guildId)) throw workflowError(400, 'Destino de comandos no válido.');
    if (!bot?.guilds.cache.has(guildId)) throw workflowError(404, 'El bot no está conectado a este gremio.');
    return { scope, guildId };
  }
  router.get('/targets', (_req, res) => res.json({ defaultScope: config.production ? 'global' : 'guild', testGuildId: config.discordTestGuildId ?? null, guilds: bot ? [...bot.guilds.cache.values()].map(guild => ({ id: guild.id, name: guild.name })) : [] }));
  router.get('/', async (req, res) => { res.json(await registration.status(target(req.query.scope, req.query.guildId))); });
  router.post('/sync', async (req, res) => {
    if (!config.ownerIds.includes(req.session.user!.id)) throw workflowError(403, 'Solo el propietario del bot puede actualizar los comandos.');
    const input = object(req.body ?? {}, ['scope', 'guildId', 'names']);
    if (input.names !== undefined && (!Array.isArray(input.names) || !input.names.every(name => typeof name === 'string'))) throw workflowError(400, 'Lista de comandos no válida.');
    const result = await registration.sync(target(input.scope, input.guildId), input.names as string[] | undefined);
    await logEvent('admin.commands.sync', `Actualización ${result.scope} por ${req.session.user!.id}: ${result.results.filter(entry => entry.updated).length}/${result.results.length} confirmados.`, result.guildId ?? undefined);
    res.json(result);
  });
  router.post('/unpublish', async (req, res) => {
    if (!config.ownerIds.includes(req.session.user!.id)) throw workflowError(403, 'Solo el propietario del bot puede retirar comandos.');
    const input = object(req.body, ['scope', 'guildId', 'commandId']);
    const selected = target(input.scope, input.guildId);
    if (!selected || typeof input.commandId !== 'string') throw workflowError(400, 'Selecciona el destino y el comando publicado.');
    const result = await registration.unpublish(selected, input.commandId);
    await logEvent('admin.commands.unpublish', `Comando ${result.name} retirado de ${result.scope} por ${req.session.user!.id}.`, result.guildId ?? undefined);
    res.json(result);
  });
  return router;
}
