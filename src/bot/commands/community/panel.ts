import { t } from '../../../i18n/index.js';
import { panelSections } from './sections.js';
import { SlashCommandSubcommandBuilder } from 'discord.js';
import type { SlashContext } from './context.js';

export const definition = new SlashCommandSubcommandBuilder().setName('panel').setDescription('Abre una sección del dashboard').setDescriptionLocalizations({ "en-US": "Open a dashboard section", "en-GB": "Open a dashboard section" }).addStringOption(o => o.setName('seccion').setDescription('Sección del servidor').addChoices(...panelSections.map(value => ({ name: value, value }))));

export async function execute({ i, config }: SlashContext) {
  const { workflowError } = await import('../../../modules/workflow/rules.js');
  if (!i.guild) throw new Error('Guild required.');
  let content = '';
  const section = i.options.getString('seccion') ?? 'tasks';
  if (!panelSections.includes(section as typeof panelSections[number])) throw workflowError(400, t("Secci\u00f3n desconocida."));
  content = t('panel.link', { url: `${config.dashboardOrigin}/dashboard/servers/${i.guild.id}/${section}` });

  return content;
}
