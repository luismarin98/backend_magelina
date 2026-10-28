import { t } from '../../../i18n/index.js';
import { SlashCommandSubcommandBuilder } from 'discord.js';
import type { MusicContext } from './context.js';

export const definition = new SlashCommandSubcommandBuilder().setName('continuar').setDescription('Continúa la reproducción');

export async function execute({ i, service, state, authorize }: MusicContext) {
  const value = undefined;
  await service.control(i.guild!.id, 'resume', state.version, authorize, value);
  return t("Reproductor actualizado. Consulta /musica cola o el dashboard.");
}
