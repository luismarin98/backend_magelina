import { SlashCommandSubcommandBuilder } from 'discord.js';
import type { MusicContext } from './context.js';

export const definition = new SlashCommandSubcommandBuilder().setName('youtube').setDescription('Prueba experimental: añade un enlace de YouTube').addStringOption(o => o.setName('enlace').setDescription('Video individual público de hasta 30 minutos').setRequired(true).setMaxLength(300));

export async function execute({ i, service, state, authorize }: MusicContext) {
  const { youtubeId } = await import('../../../modules/music/youtube.js');
  await service.enqueue(i.guild!.id, `youtube:${youtubeId(i.options.getString('enlace', true))}`, i.user.id, state.version, authorize);
  return 'Reproductor actualizado. Consulta /musica cola o el dashboard.';
}
