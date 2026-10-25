import { SlashCommandSubcommandBuilder } from 'discord.js';
import { safeText } from '../context.js';
import type { SlashContext } from './context.js';

export const definition = new SlashCommandSubcommandBuilder().setName('automatizaciones').setDescription('Consulta reglas y su estado');

export async function execute({ i, requireCapability }: SlashContext) {
  const { requireModule } = await import('../../../modules/settings/service.js');
  const { AutomationRule } = await import('../../../database/models/Automation.js');
  if (!i.guild) throw new Error('Guild required.');
  let content = '';
  requireCapability('automations.read');
  await requireModule(i.guild.id, 'automations');
  const filter = { guildId: i.guild.id };
  content = (await AutomationRule.find(filter).sort({ _id: -1 }).limit(10).lean()).map(t => `${safeText(t.title)} · ${t.enabled ? 'Activa' : 'Desactivada'} · ${t.trigger}`).join('\n');
  content ||= 'Todavía no hay resultados en este servidor.';

  return content;
}
