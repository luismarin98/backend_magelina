import { SlashCommandSubcommandBuilder } from 'discord.js';
import { safeText } from '../context.js';
import type { SlashContext } from './context.js';

export const definition = new SlashCommandSubcommandBuilder().setName('solicitudes').setDescription('Consulta las últimas diez solicitudes');

export async function execute({ i, requireCapability }: SlashContext) {
  const { requireModule } = await import('../../../modules/settings/service.js');
  const { statusLabels } = await import('../../../modules/workflow/service.js');
  const { WorkItem } = await import('../../../database/models/WorkItem.js');
  if (!i.guild) throw new Error('Guild required.');
  let content = '';
  requireCapability('workflow.read');
  await requireModule(i.guild.id, 'workflow');
  const filter = { guildId: i.guild.id };
  content = (await WorkItem.find(filter).sort({ _id: -1 }).limit(10).lean()).map(t => `${safeText(t.title)} · ${statusLabels[t.status]} · \`${t._id}\` · versión ${t.version}`).join('\n');
  content ||= 'Todavía no hay resultados en este servidor.';

  return content;
}
