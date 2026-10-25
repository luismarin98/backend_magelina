import { SlashCommandSubcommandBuilder } from 'discord.js';
import type { MusicContext } from './context.js';

export const definition = new SlashCommandSubcommandBuilder().setName('buscar').setDescription('Busca canciones y añádelas con un menú interactivo').addStringOption(o => o.setName('texto').setDescription('Título o artista').setRequired(true).setMinLength(2).setMaxLength(100)).addStringOption(o => o.setName('fuente').setDescription('Plataforma de música; Audius por defecto').addChoices({ name: 'Audius', value: 'audius' }, { name: 'YouTube experimental', value: 'youtube' }));

export async function execute({ i, access, service }: MusicContext) {
  const { musicSearchPanel } = await import('../../interactive.js');
  const { workflowError } = await import('../../../modules/workflow/rules.js');
  const source = i.options.getString('fuente') ?? 'audius';
  if (source !== 'audius' && source !== 'youtube') throw workflowError(400, 'Fuente de música no válida.');
  const tracks = await service.provider.search(i.options.getString('texto', true), source);
  await i.editReply(musicSearchPanel(i.user.id, i.guild!.id, tracks, access.capabilities.includes('music.request')));
  return;
}
