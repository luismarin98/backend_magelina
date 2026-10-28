import { t } from '../../../i18n/index.js';
import { SlashCommandSubcommandBuilder } from 'discord.js';
import type { MusicContext } from './context.js';

export const definition = new SlashCommandSubcommandBuilder().setName('pausar').setDescription('Pausa la reproducción').setDescriptionLocalizations({ "en-US": "Pause playback", "en-GB": "Pause playback" });

export async function execute({ i, service, state, authorize }: MusicContext) {
  const value = undefined;
  await service.control(i.guild!.id, 'pause', state.version, authorize, value);
  return t("Reproductor actualizado. Consulta /musica cola o el dashboard.");
}
