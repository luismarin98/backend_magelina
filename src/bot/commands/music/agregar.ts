import { t } from '../../../i18n/index.js';
import { SlashCommandSubcommandBuilder } from 'discord.js';
import type { MusicContext } from './context.js';

export const definition = new SlashCommandSubcommandBuilder().setName('agregar').setDescription('Añade una pista usando su ID de Audius').addStringOption(o => o.setName('pista').setDescription('ID mostrado por /musica buscar').setRequired(true).setMaxLength(30));

export async function execute({ i, service, state, authorize }: MusicContext) {
  const { trackId } = await import('../../../modules/music/audius.js');
  await service.enqueue(i.guild!.id, trackId(i.options.getString('pista', true)), i.user.id, state.version, authorize);
  return t("Reproductor actualizado. Consulta /musica cola o el dashboard.");
}
