import { SlashCommandSubcommandBuilder } from 'discord.js';
import { safeText } from '../context.js';
import type { SlashContext } from './context.js';

export const definition = new SlashCommandSubcommandBuilder().setName('colaboracion').setDescription('Consulta perfiles disponibles para colaborar');

export async function execute({ i, requireCapability }: SlashContext) {
  const { requireModule } = await import('../../../modules/settings/service.js');
  const { CollaborationProfile } = await import('../../../database/models/Collaboration.js');
  if (!i.guild) throw new Error('Guild required.');
  let content = '';
  requireCapability('collaboration.read');
  await requireModule(i.guild.id, 'collaboration');
  const filter = { guildId: i.guild.id };
  content = (await CollaborationProfile.find({ ...filter, available: true }).sort({ _id: -1 }).limit(10).lean()).map(t => `${t.userId} · ofrece: ${safeText(t.offers.join(', '))}`).join('\n');
  content ||= 'Todavía no hay resultados en este servidor.';

  return content;
}
