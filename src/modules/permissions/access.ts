import { routeParam } from '../common/input.js';
import { assertAvailable, getControls } from '../operations/service.js';
import type { Client } from 'discord.js';
import type { RequestHandler } from 'express';
import type { Capability, GuildAccess, ManagedGuild } from '../../types/contracts.js';
import { canManageGuild, listDiscordGuilds } from '../../auth/discord.js';
import { getPolicy } from './service.js';
import { resolveAccess, emptyGrants } from './rules.js';
import { workflowError } from '../workflow/rules.js';
import { hasCode } from '../../types/errors.js';
import type { Config } from '../../config/env.js';
import { serializeGuild } from '../../discord/images.js';

export type RequireCapability = (capability: Capability) => RequestHandler;

export function guildAuthorization(bot: Client, config: Pick<Config, 'ownerIds'>) {
  const check = (capability?: Capability, nativeOnly = false, memberOnly = false): RequestHandler => async (req, res, next) => {
    const guildId = routeParam(req, 'guildId');
    if (!/^\d{17,20}$/.test(guildId)) throw workflowError(400, 'ID de servidor no valido.');
    const owner = config.ownerIds.includes(req.session.user!.id);
    const guild = bot.guilds.cache.get(guildId);
    if (owner) {
      if (!guild) throw workflowError(404, 'El bot no esta en este servidor.');
      // El propietario puede inspeccionar una comunidad bloqueada, pero no saltarse las pausas de escritura.
      if (!['GET', 'HEAD'].includes(req.method)) await assertAvailable(guildId);
      req.managedGuild = guild;
      req.guildAccess = { ...resolveAccess(false, [], emptyGrants(), 'owner'), canManageRoles: true, canModerate: true, source: 'bot-owner' };
      next(); return;
    }
    await assertAvailable(guildId, undefined, !['GET', 'HEAD'].includes(req.method));
    const guilds = await listDiscordGuilds(req.session.accessToken!);
    const membership = guilds.find((guild) => guild.id === guildId);
    if (!membership) throw workflowError(403, 'No perteneces a este servidor.');
    if (!guild) throw workflowError(404, 'El bot no esta en este servidor.');
    const member = await guild.members.fetch({ user: req.session.user!.id, force: true }).catch((error: unknown) => {
      if (hasCode(error, 10007)) throw workflowError(403, 'Ya no perteneces a este servidor.');
      throw workflowError(502, 'No se pudieron verificar tus roles en Discord.');
    });
    const policy = await getPolicy(guildId);
    const access = resolveAccess(guild.ownerId === member.id, [...member.roles.cache.keys()].filter(id => id !== guildId), policy.grants);
    access.canManageRoles = guild.ownerId === member.id || member.permissions.has(8n) || member.permissions.has(268435456n);
    access.canModerate = guild.ownerId === member.id || member.permissions.has(8n) || member.permissions.has(32n) || member.permissions.has(1099511627776n) || member.permissions.has(2n) || member.permissions.has(4n);
    if ((nativeOnly && !access.canConfigure) || (capability && !access.capabilities.includes(capability)) || (!memberOnly && !nativeOnly && !capability && !access.capabilities.length && !access.canManageRoles && !access.canModerate)) {
      throw workflowError(403, 'No tienes permiso para realizar esta operacion en el gestor.');
    }
    req.managedGuild = guild; req.guildAccess = { ...access, source: access.canConfigure ? 'guild-owner' : 'delegated' }; next();
  };
  async function listGuilds(token: string, userId: string): Promise<ManagedGuild[]> {
    if (config.ownerIds.includes(userId)) return [...bot.guilds.cache.values()].map((guild) => ({ ...serializeGuild(guild), botInstalled: true }));
    const guilds = await listDiscordGuilds(token);
    const visible: ManagedGuild[] = [];
    const controls = await getControls();
    // Mostrar un gremio compartido no autoriza sus herramientas; check verifica el acceso.
    for (const guild of guilds) {
      if (controls.blockedGuildIds.includes(guild.id)) continue;
      const installed = bot.guilds.cache.has(guild.id);
      if (installed || canManageGuild(guild)) {
        visible.push({ ...serializeGuild(bot.guilds.cache.get(guild.id) ?? guild), botInstalled: installed });
      }
    }
    return visible;
  }
  return { requireMember: check(undefined, false, true), requireNative: check(undefined, true), requireAny: check(), requireCapability: (capability: Capability) => check(capability), listGuilds };
}
