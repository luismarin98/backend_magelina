import { t } from '../../../i18n/index.js';
import { SlashCommandSubcommandBuilder } from 'discord.js';
import type { SlashContext } from './context.js';

export const definition = new SlashCommandSubcommandBuilder().setName('solicitud').setDescription('Cambia el estado de una solicitud')
    .addStringOption(o => o.setName('id').setDescription('ID mostrado en solicitudes').setRequired(true).setMinLength(24).setMaxLength(24))
    .addIntegerOption(o => o.setName('version').setDescription('Versión mostrada en solicitudes').setRequired(true).setMinValue(0))
    .addStringOption(o => o.setName('estado').setDescription('Nuevo estado').setRequired(true).addChoices({ name: 'Aceptar', value: 'accepted' }, { name: 'Rechazar', value: 'rejected' }, { name: 'En curso', value: 'in_progress' }, { name: 'Completar', value: 'completed' }))
    .addUserOption(o => o.setName('responsable').setDescription('Obligatorio al aceptar; solo en ese paso'));

export async function execute({ i, requireCapability }: SlashContext) {
  const { workflowError } = await import('../../../modules/workflow/rules.js');
  const { changeRequest, notifyChange, statusLabels } = await import('../../../modules/workflow/service.js');
  const { enqueueTaskEvent } = await import('../../../modules/automations/service.js');
  const { logEvent } = await import('../../../modules/operations/service.js');
  const { getSettings } = await import('../../../modules/settings/service.js');
  if (!i.guild) throw new Error('Guild required.');
  let content = '';
  requireCapability('workflow.manage');
  const itemId = i.options.getString('id', true);
  if (!/^[a-f\d]{24}$/i.test(itemId)) throw workflowError(400, 'ID de solicitud no válido.');
  const assignee = i.options.getUser('responsable');
  const item = await changeRequest({ guildId: i.guild.id, itemId, actorId: i.user.id, guild: i.guild,
    body: { status: i.options.getString('estado', true), version: i.options.getInteger('version', true), ...(assignee ? { assigneeId: assignee.id } : {}) } });
  try { await enqueueTaskEvent(item); } catch { await logEvent('automation.enqueue.error', `No se pudo encolar el evento de la tarea ${item.id}; el trabajador lo reconciliara.`, item.guildId); }
  let notification = t("No se pudo enviar el aviso; el cambio qued\u00f3 guardado.");
  try {
    const settings = await getSettings(i.guild.id);
    notification = !settings.notifications.enabled ? t("Avisos deshabilitados.") : await notifyChange(i.client, { id: String(item._id), guildId: item.guildId, status: item.status, sourceChannelId: item.sourceChannelId }, settings.notifications.channelId) ? t("Aviso enviado.") : notification;
  } catch { /* El cambio ya está persistido. */ }
  content = `Solicitud actualizada: ${statusLabels[item.status]}. Versión: ${item.version}. ${notification}`;

  return content;
}
