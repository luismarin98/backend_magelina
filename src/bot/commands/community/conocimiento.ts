import { SlashCommandSubcommandBuilder } from 'discord.js';
import { safeText } from '../context.js';
import type { SlashContext } from './context.js';

export const definition = new SlashCommandSubcommandBuilder().setName('conocimiento').setDescription('Busca artículos publicados').addStringOption(o => o.setName('buscar').setDescription('Texto del título').setMinLength(2).setMaxLength(100));

export async function execute({ i, requireCapability }: SlashContext) {
  const { requireModule } = await import('../../../modules/settings/service.js');
  const { KnowledgeArticle } = await import('../../../database/models/KnowledgeArticle.js');
  if (!i.guild) throw new Error('Guild required.');
  let content = '';
  requireCapability('knowledge.read');
  await requireModule(i.guild.id, 'knowledge');
  const filter = { guildId: i.guild.id };
  const search = i.options.getString('buscar');
  const escaped = search?.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  content = (await KnowledgeArticle.find({ ...filter, archived: false, ...(escaped ? { title: { $regex: escaped, $options: 'i' } } : {}) }).sort({ _id: -1 }).limit(10).lean()).map(t => `${safeText(t.title)} · \`${t._id}\``).join('\n');
  content ||= 'Todavía no hay resultados en este servidor.';

  return content;
}
