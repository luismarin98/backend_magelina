import { Router } from 'express';
import { PermissionFlagsBits, type Guild, type Role } from 'discord.js';
import { GuildRoleBinding } from '../../database/models/GuildRoleBinding.js';
import { guildAuthorization } from '../permissions/access.js';
import { getPolicy, savePolicy, serializePolicy } from '../permissions/service.js';
import { object, text, version, routeParam, id } from '../common/input.js';
import { workflowError } from '../workflow/rules.js';
import { hasCode } from '../../types/errors.js';
import { serializeGuild } from '../../discord/images.js';
import { permissionBits, permissionOptions, templates, templateFor, templateGrants } from './rules.js';

async function context(guild: Guild, userId: string, globalOwner: boolean) {
  await guild.roles.fetch();
  const me = await guild.members.fetchMe({ force: true });
  const actor = globalOwner || guild.ownerId === userId ? null : await guild.members.fetch({ user: userId, force: true });
  const canCreate = me.permissions.has(PermissionFlagsBits.ManageRoles) && (!actor || actor.permissions.has(PermissionFlagsBits.ManageRoles));
  const editable = (role: Role) => canCreate && role.id !== guild.id && !role.managed && me.roles.highest.comparePositionTo(role) > 0 && (!actor || actor.roles.highest.comparePositionTo(role) > 0);
  return { me, actor, canCreate, editable };
}
async function bind(guildId: string, roleId: string, kind: string, expected: number, actorId: string) {
  try {
    const result = await GuildRoleBinding.findOneAndUpdate({ guildId, roleId, version: expected }, { $set: { kind, actorId }, $inc: { version: 1 } }, { upsert: expected === 0, new: true, runValidators: true });
    if (!result) throw workflowError(409, 'La clasificacion cambio. Recarga antes de guardar.');
    return result;
  } catch (error) {
    if (hasCode(error, 11000)) throw workflowError(409, 'La clasificacion cambio. Recarga antes de guardar.');
    throw error;
  }
}
export function roleRoutes(access: ReturnType<typeof guildAuthorization>) {
  const router = Router({ mergeParams: true });
  router.use(access.requireAny);
  router.use((req, _res, next) => {
    if (!req.guildAccess?.canConfigure && !req.guildAccess?.canManageRoles) throw workflowError(403, 'Necesitas Gestionar roles en Discord.');
    next();
  });
  router.get('/', async (req, res) => {
    const guild = req.managedGuild!;
    const ctx = await context(guild, req.session.user!.id, req.guildAccess!.source === 'bot-owner');
    const bindings = await GuildRoleBinding.find({ guildId: guild.id }).lean();
    res.json({ guild: serializeGuild(guild), templates, permissionOptions, canCreate: ctx.canCreate, canAssignInternal: req.guildAccess!.canConfigure, policyVersion: (await getPolicy(guild.id)).version,
      roles: [...guild.roles.cache.values()].sort((a, b) => b.comparePositionTo(a)).map((role) => {
        const binding = bindings.find((entry) => entry.roleId === role.id);
        return { id: role.id, name: role.name, color: role.hexColor, managed: role.managed, editable: ctx.editable(role), kind: binding?.kind, bindingVersion: binding?.version ?? 0 };
      }) });
  });
  router.post('/', async (req, res) => {
    const input = object(req.body, ['name', 'color', 'permissions', 'kind']);
    const name = text(input.name, 100), template = templateFor(input.kind), permissions = permissionBits(input.permissions);
    if (typeof input.color !== 'string' || !/^#[a-f0-9]{6}$/i.test(input.color)) throw workflowError(400, 'Color no valido.');
    const guild = req.managedGuild!;
    const ctx = await context(guild, req.session.user!.id, req.guildAccess!.source === 'bot-owner');
    if (!ctx.canCreate || !ctx.me.permissions.has(permissions) || (ctx.actor && !ctx.actor.permissions.has(permissions))) throw workflowError(403, 'El usuario y el bot necesitan Gestionar roles y los permisos seleccionados.');
    const role = await guild.roles.create({ name, color: Number.parseInt(input.color.slice(1), 16), permissions, reason: `Magelina: usuario ${req.session.user!.id}` });
    let warning: string | undefined;
    try { await bind(guild.id, role.id, template.id, 0, req.session.user!.id); }
    catch { warning = 'El rol se creo en Discord, pero no se guardo su tipo. Seleccionalo en la lista para clasificarlo; no lo crees de nuevo.'; }
    res.status(201).json({ role: { id: role.id, name: role.name }, warning });
  });
  router.patch('/:roleId/type', access.requireNative, async (req, res) => {
    const input = object(req.body, ['kind', 'version']);
    const template = templateFor(input.kind), expected = version(input.version);
    const guild = req.managedGuild!, roleId = id(routeParam(req, 'roleId'), true);
    const ctx = await context(guild, req.session.user!.id, req.guildAccess!.source === 'bot-owner');
    const role = guild.roles.cache.get(roleId);
    if (!role || role.id === guild.id || role.managed) throw workflowError(403, 'Selecciona un rol propio del servidor que no pertenezca a una integracion.');
    res.json({ binding: await bind(guild.id, roleId, template.id, expected, req.session.user!.id) });
  });
  router.post('/:roleId/apply-template', access.requireNative, async (req, res) => {
    const input = object(req.body, ['version', 'bindingVersion']);
    const expected = version(input.version), bindingVersion = version(input.bindingVersion);
    const guild = req.managedGuild!, roleId = id(routeParam(req, 'roleId'), true);
    const roles = await guild.roles.fetch();
    if (roleId === guild.id || !roles.has(roleId) || roles.get(roleId)!.managed) throw workflowError(400, 'Selecciona un rol propio del servidor.');
    const binding = await GuildRoleBinding.findOne({ guildId: guild.id, roleId }).lean();
    if (!binding || binding.version !== bindingVersion) throw workflowError(409, 'La clasificacion cambio. Recarga antes de aplicar.');
    const template = templateFor(binding.kind);
    if (template.id === 'custom') throw workflowError(400, 'Configura este rol en Permisos internos.');
    const current = await getPolicy(guild.id);
    const policy = await savePolicy({ guildId: guild.id, actorId: req.session.user!.id, body: { version: expected, grants: templateGrants(current.grants, roleId, template) } });
    res.json({ policy: serializePolicy(policy) });
  });
  return router;
}
