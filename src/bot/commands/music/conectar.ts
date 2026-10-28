import { t } from '../../../i18n/index.js';
import { SlashCommandSubcommandBuilder } from 'discord.js';
import type { MusicContext } from './context.js';

export const definition = new SlashCommandSubcommandBuilder().setName('conectar').setDescription('Conecta a Magelina a tu canal de voz').setDescriptionLocalizations({ "en-US": "Connect Magelina to your voice channel", "en-GB": "Connect Magelina to your voice channel" });

export async function execute({ i, member, service, state, authorize }: MusicContext) {
  const { workflowError } = await import('../../../modules/workflow/rules.js');
  if (!member.voice.channelId) throw workflowError(400, t("Entra primero en un canal de voz."));
  await service.connect(i.guild!, member.voice.channelId, state.version, authorize);
  return t("Reproductor actualizado. Consulta /musica cola o el dashboard.");
}
