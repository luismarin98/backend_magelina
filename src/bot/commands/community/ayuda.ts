import { SlashCommandSubcommandBuilder } from 'discord.js';
import type { SlashContext } from './context.js';

export const definition = new SlashCommandSubcommandBuilder().setName('ayuda').setDescription('Consulta las habilidades y comandos de Magelina');

export async function execute({ i }: SlashContext) {
  const { helpPanel } = await import('../../interactive.js');
  if (!i.guild) throw new Error('Guild required.');
  let content = '';
  await i.editReply(helpPanel(i.user.id, i.guild.id));
  return;
}
