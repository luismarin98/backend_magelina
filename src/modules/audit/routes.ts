import { routeParam } from '../common/input.js';
import { Router } from 'express';
import { AuditLogEvent, PermissionFlagsBits } from 'discord.js';
import type { RequireCapability } from '../permissions/access.js';
import { id } from '../common/input.js';
import { requireModule } from '../settings/service.js';
import { workflowError } from '../workflow/rules.js';

export function auditRoutes(requireCapability: RequireCapability) {
  const router = Router({ mergeParams: true });
  router.get('/', requireCapability('audit.read'), async (req, res) => {
    await requireModule(routeParam(req, 'guildId'), 'audit');
    const guild = req.managedGuild!; const member = await guild.members.fetchMe();
    if (!member.permissions.has(PermissionFlagsBits.ViewAuditLog)) throw workflowError(403, 'El bot necesita el permiso Ver registro de auditoria en Discord.');
    const before = req.query.before === undefined ? undefined : id(req.query.before, true);
    const user = req.query.actor === undefined || req.query.actor === '' ? undefined : id(req.query.actor, true);
    let type: AuditLogEvent | undefined;
    if (req.query.action !== undefined && req.query.action !== '') {
      if (typeof req.query.action !== 'string' || !/^\d+$/.test(req.query.action) || !Object.values(AuditLogEvent).includes(Number(req.query.action))) throw workflowError(400, 'Accion de auditoria no valida.');
      type = Number(req.query.action) as AuditLogEvent;
    }
    const logs = await guild.fetchAuditLogs({ limit: 51, ...(before ? { before } : {}), ...(user ? { user } : {}), ...(type !== undefined ? { type } : {}) });
    const entries = [...logs.entries.values()]; const more = entries.length > 50; if (more) entries.pop();
    res.json({ entries: entries.map((entry) => ({ id: entry.id, actorId: entry.executorId, action: entry.action, targetId: entry.targetId, reason: entry.reason, at: entry.createdAt.toISOString() })), nextCursor: more ? entries.at(-1)!.id : null });
  });
  return router;
}
