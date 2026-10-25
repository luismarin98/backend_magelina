import { SlashCommandSubcommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import type { GamePanels } from '../../games.js';
import type { TriviaTopic } from '../../game-rules.js';

export const definition = new SlashCommandSubcommandBuilder().setName('trivia').setDescription('Responde cinco preguntas con botones').addStringOption(option => option.setName('tema').setDescription('Tema de las preguntas').addChoices({ name: 'Mixta', value: 'mixta' }, { name: 'Música', value: 'musica' }, { name: 'Cultura general', value: 'general' }));
export async function execute(i: ChatInputCommandInteraction, panels: GamePanels) {
  return panels.start(i.user.id, i.guildId!, i.channelId, 'trivia', (i.options.getString('tema') ?? 'mixta') as TriviaTopic);
}
