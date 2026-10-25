import { SlashCommandSubcommandBuilder } from 'discord.js';
import type { MusicContext } from './context.js';

export const definition = new SlashCommandSubcommandBuilder().setName('retirar').setDescription('Retira una canción pendiente').addStringOption(o => o.setName('entrada').setDescription('ID de entrada mostrado en la cola').setRequired(true).setMaxLength(36));

export async function execute({ i, service, state, authorize }: MusicContext) {
  const value = i.options.getString('entrada', true);
  const { workflowError } = await import('../../../modules/workflow/rules.js');
  if (!/^[a-f\d-]{36}$/i.test(String(value))) throw workflowError(400, 'Identificador de entrada no válido.');
  await service.control(i.guild!.id, 'remove', state.version, authorize, value);
  return 'Reproductor actualizado. Consulta /musica cola o el dashboard.';
}
