import { SlashCommandSubcommandBuilder } from 'discord.js';
import type { SlashContext } from './context.js';
import { workflowError } from '../../../modules/workflow/rules.js';

export const definition = new SlashCommandSubcommandBuilder().setName('ayuda').setDescription('Consulta las habilidades y comandos de Magelina').setDescriptionLocalizations({ "en-US": "Explore Magelina features and commands", "en-GB": "Explore Magelina features and commands" });

export async function execute({ i }: Pick<SlashContext, 'i'>) {
  const { helpPanel } = await import('../../interactive.js');
  if (!i.guildId) throw workflowError(400, 'Esta función solo está disponible en servidores.');
  await i.editReply(helpPanel(i.user.id, i.guildId));
}
