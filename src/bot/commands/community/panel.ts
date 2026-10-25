import { panelSections } from './sections.js';
import { SlashCommandSubcommandBuilder } from 'discord.js';
import type { SlashContext } from './context.js';

export const definition = new SlashCommandSubcommandBuilder().setName('panel').setDescription('Abre una sección del dashboard').addStringOption(o => o.setName('seccion').setDescription('Sección del servidor').addChoices(...panelSections.map(value => ({ name: value, value }))));

export async function execute({ i, config }: SlashContext) {
  const { workflowError } = await import('../../../modules/workflow/rules.js');
  if (!i.guild) throw new Error('Guild required.');
  let content = '';
  const section = i.options.getString('seccion') ?? 'tasks';
  if (!panelSections.includes(section as typeof panelSections[number])) throw workflowError(400, 'Sección desconocida.');
  content = `Abre tu servidor en Magelina: ${config.dashboardOrigin}/dashboard/servers/${i.guild.id}/${section}\nEl dashboard comprobará tus permisos al iniciar sesión.`;

  return content;
}
