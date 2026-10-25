import { SlashCommandSubcommandBuilder } from 'discord.js';
import type { MusicContext } from './context.js';

export const definition = new SlashCommandSubcommandBuilder().setName('desconectar').setDescription('Desconecta al bot del canal de voz');

export async function execute({ i, service, state, authorize }: MusicContext) {
  const value = undefined;
  await service.control(i.guild!.id, 'disconnect', state.version, authorize, value);
  return 'Reproductor actualizado. Consulta /musica cola o el dashboard.';
}
