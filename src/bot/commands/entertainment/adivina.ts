import { SlashCommandSubcommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import type { GamePanels } from '../../games.js';
import type { TriviaTopic } from '../../game-rules.js';

export const definition = new SlashCommandSubcommandBuilder().setName('adivina').setDescription('Adivina un número del 1 al 10 con tres intentos y pistas');
export async function execute(i: ChatInputCommandInteraction, panels: GamePanels) {
  return panels.start(i.user.id, i.guildId!, i.channelId, 'adivina');
}
