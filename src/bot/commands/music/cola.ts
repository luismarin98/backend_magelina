import { t } from '../../../i18n/index.js';
import { SlashCommandSubcommandBuilder } from 'discord.js';
import { safeText } from '../context.js';
import type { MusicContext } from './context.js';

export const definition = new SlashCommandSubcommandBuilder().setName('cola').setDescription('Consulta la reproducción y las próximas canciones').setDescriptionLocalizations({ "en-US": "Check playback and upcoming songs", "en-GB": "Check playback and upcoming songs" });

export async function execute({ state }: MusicContext) {
  return `Estado: ${state.status}. Volumen: ${state.volume}%\nAhora: ${state.current ? safeText(state.current.track.title) : t("Sin canci\u00f3n")}\n` + state.queue.slice(0, 10).map(t => `${safeText(t.track.title)} · entrada \`${t.id}\``).join('\n');

}
