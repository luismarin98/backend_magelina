import { routeParam } from '../common/input.js';
import { enqueueTaskEvent } from '../automations/service.js';
import { logEvent } from '../operations/service.js';
import type { Client } from 'discord.js';
import type { RequireCapability } from '../permissions/access.js';
import { Router } from 'express';
import { WorkItem } from '../../database/models/WorkItem.js';
import { changeRequest, notifyChange } from './service.js';
import { workflowError } from './rules.js';
import { serializeWorkItem } from '../../api/serialize.js';
import { getSettings } from '../settings/service.js';
import type { NotificationStatus } from '../../types/contracts.js';

export function workflowRoutes({ bot, requireCapability }: { bot: Client; requireCapability: RequireCapability }) {
  const router = Router({ mergeParams: true });
  router.get('/', requireCapability('workflow.read'), async (req, res) => {
    const before = req.query.before;
    if (before !== undefined && (typeof before !== 'string' || !/^[a-f0-9]{24}$/i.test(before))) {
      throw workflowError(400, 'Cursor no valido.');
    }
    const items = await WorkItem.find({ guildId: routeParam(req, 'guildId'), ...(before ? { _id: { $lt: before } } : {}) })
      .sort({ _id: -1 }).limit(31).lean();
    const hasMore = items.length > 30;
    if (hasMore) items.pop();
    res.json({ items: items.map(serializeWorkItem), nextCursor: hasMore ? String(items.at(-1)!._id) : null });
  });
  router.patch('/:itemId', requireCapability('workflow.manage'), async (req, res) => {
    if (!/^[a-f0-9]{24}$/i.test(routeParam(req, 'itemId'))) throw workflowError(400, 'ID de solicitud no valido.');
    const item = await changeRequest({ guildId: routeParam(req, 'guildId'), itemId: routeParam(req, 'itemId'),
      actorId: req.session.user!.id, body: req.body, guild: req.managedGuild!,
    });
    try { await enqueueTaskEvent(item); } catch { await logEvent('automation.enqueue.error', `No se pudo encolar el evento de la tarea ${item.id}; el trabajador lo reconciliara.`, item.guildId); }
    // El guardado ya se completo: un fallo al leer ajustes o notificar no lo revierte.
    let notificationStatus: NotificationStatus = 'failed';
    try {
      const settings = await getSettings(routeParam(req, 'guildId'));
      notificationStatus = !settings.notifications.enabled ? 'disabled' :
        await notifyChange(bot, { id: String(item._id), guildId: item.guildId, status: item.status, sourceChannelId: item.sourceChannelId }, settings.notifications.channelId) ? 'delivered' : 'failed';
    } catch { /* La respuesta distingue cambio persistido de aviso fallido. */ }
    res.json({ item: serializeWorkItem(item), notificationDelivered: notificationStatus === 'delivered', notificationStatus });
  });
  return router;
}
