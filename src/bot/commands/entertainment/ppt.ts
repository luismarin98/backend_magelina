import { SlashCommandSubcommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import type { GamePanels } from '../../games.js';
import type { TriviaTopic } from '../../game-rules.js';

export const definition = new SlashCommandSubcommandBuilder().setName('ppt').setDescription('Juega tres rondas de piedra, papel o tijera contra Magelina');
export async function execute(i: ChatInputCommandInteraction, panels: GamePanels) {
  return panels.start(i.user.id, i.guildId!, i.channelId, 'ppt');
}
