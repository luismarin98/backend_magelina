import { SlashCommandSubcommandBuilder } from 'discord.js';
import type { MusicContext } from './context.js';

export const definition = new SlashCommandSubcommandBuilder().setName('volumen').setDescription('Cambia el volumen').addIntegerOption(o => o.setName('valor').setDescription('Volumen de 0 a 100').setRequired(true).setMinValue(0).setMaxValue(100));

export async function execute({ i, service, state, authorize }: MusicContext) {
  const value = i.options.getInteger('valor', true);
  await service.control(i.guild!.id, 'volume', state.version, authorize, value);
  return 'Reproductor actualizado. Consulta /musica cola o el dashboard.';
}
