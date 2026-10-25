import { WorkItem } from '../../database/models/WorkItem.js';
import { transitions, validateChange, workflowError } from './rules.js';
import type { WorkItemRecord } from '../../database/models/WorkItem.js';
import type { WorkStatus } from '../../types/contracts.js';
import type { Client } from 'discord.js';
import { hasCode } from '../../types/errors.js';
import { requireModule } from '../settings/service.js';

interface CreateRequestInput { guildId: string; sourceChannelId: string; sourceMessageId: string; createdBy: string; title: string }
// Puerto minimo para poder probar el servicio sin construir un cliente Discord completo.
export interface GuildMembersPort { members: { fetch(options: { user: string; force: boolean }): Promise<{ user: { bot: boolean } }> } }

export const statusLabels: Record<WorkStatus, string> = {
  submitted: 'Pendiente', accepted: 'Aceptada', in_progress: 'En curso', completed: 'Completada', rejected: 'Rechazada',
};

export async function createRequest({ guildId, sourceChannelId, sourceMessageId, createdBy, title }: CreateRequestInput) {
  await requireModule(guildId, 'workflow');
  if (typeof title !== 'string' || !title.trim() || title.trim().length > 160) {
    throw workflowError(400, 'El titulo debe tener entre 1 y 160 caracteres.');
  }
  try {
    return await WorkItem.create({ guildId, sourceChannelId, sourceMessageId, createdBy,
      title: title.trim(), history: [{ actorId: createdBy, status: 'submitted', at: new Date() }],
    });
  } catch (error) {
    if (hasCode(error, 11000)) throw workflowError(409, 'Este mensaje ya tiene una solicitud.');
    throw error;
  }
}

export async function changeRequest({ guildId, itemId, actorId, body: input, guild }: { guildId: string; itemId: string; actorId: string; body: unknown; guild: GuildMembersPort }) {
  await requireModule(guildId, 'workflow');
  const body = validateChange(input);
  const current = await WorkItem.findOne({ _id: itemId, guildId }).lean();
  if (!current) throw workflowError(404, 'Solicitud no encontrada.');
  if (current.version !== body.version) throw workflowError(409, 'La solicitud cambio. Actualiza el tablero.');
  if (!transitions[current.status].includes(body.status)) throw workflowError(409, 'Ese cambio de estado no esta permitido.');
  if (body.status === 'accepted') {
    let member;
    try { member = await guild.members.fetch({ user: body.assigneeId, force: true }); }
    catch (error) {
      if (hasCode(error, 10007) || hasCode(error, 10013)) throw workflowError(400, 'El responsable no pertenece al servidor.');
      throw workflowError(502, 'No se pudo verificar al responsable en Discord.');
    }
    if (member.user.bot) throw workflowError(400, 'El responsable debe ser una persona.');
  }
  const item = await WorkItem.findOneAndUpdate({ _id: itemId, guildId, version: body.version, status: current.status }, {
    $set: { status: body.status, ...(body.status === 'accepted' ? { assigneeId: body.assigneeId } : {}) },
    $inc: { version: 1 },
    $push: { history: { actorId, status: body.status, at: new Date() } },
  }, { new: true, runValidators: true });
  if (!item) throw workflowError(409, 'Otra persona modifico la solicitud. Actualiza el tablero.');
  return item;
}

export async function notifyChange(bot: { channels: Pick<Client['channels'], 'fetch'> }, item: Pick<WorkItemRecord, 'sourceChannelId' | 'guildId' | 'status'> & { id: string }, channelId: string | null = null) {
  try {
    const channel = await bot.channels.fetch(channelId ?? item.sourceChannelId);
    if (!channel?.isTextBased() || !channel.isSendable() || !('guildId' in channel) || channel.guildId !== item.guildId) return false;
    await channel.send({
      content: `Solicitud ${item.id}: ${statusLabels[item.status]}. Consulta el detalle en la dashboard.`,
      allowedMentions: { parse: [] },
    });
    return true;
  } catch { return false; }
}
