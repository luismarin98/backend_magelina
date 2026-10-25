import { SlashCommandSubcommandBuilder } from 'discord.js';
import { safeText } from '../context.js';
import type { MusicContext } from './context.js';

export const definition = new SlashCommandSubcommandBuilder().setName('cola').setDescription('Consulta la reproducción y las próximas canciones');

export async function execute({ state }: MusicContext) {
  return `Estado: ${state.status}. Volumen: ${state.volume}%\nAhora: ${state.current ? safeText(state.current.track.title) : 'Sin canción'}\n` + state.queue.slice(0, 10).map(t => `${safeText(t.track.title)} · entrada \`${t.id}\``).join('\n');

}
