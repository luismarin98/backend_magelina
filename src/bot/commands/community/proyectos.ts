import { SlashCommandSubcommandBuilder } from 'discord.js';
import { safeText } from '../context.js';
import type { SlashContext } from './context.js';

export const definition = new SlashCommandSubcommandBuilder().setName('proyectos').setDescription('Consulta los últimos diez proyectos activos');

export async function execute({ i, requireCapability }: SlashContext) {
  const { requireModule } = await import('../../../modules/settings/service.js');
  const { Project } = await import('../../../database/models/Project.js');
  if (!i.guild) throw new Error('Guild required.');
  let content = '';
  requireCapability('projects.read');
  await requireModule(i.guild.id, 'projects');
  const filter = { guildId: i.guild.id };
  content = (await Project.find({ ...filter, archived: false }).sort({ _id: -1 }).limit(10).lean()).map(t => `${safeText(t.title)} · ${t.completedObjectives.length}/${t.objectives.length} objetivos`).join('\n');
  content ||= 'Todavía no hay resultados en este servidor.';

  return content;
}
