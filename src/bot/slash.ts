import { MessageFlags, type Interaction } from 'discord.js';
import type { Config } from '../config/env.js';
import type { Capability } from '../types/contracts.js';
import { commandAccess } from './access.js';
export { commandAccess } from './access.js';
export { safeText } from './commands/context.js';
import { assertAvailable } from '../modules/operations/service.js';
import { workflowError } from '../modules/workflow/rules.js';
import { logRecord } from '../observability/logging.js';
import { executeCommunity } from './commands/community/index.js';
import { executeMusic } from './commands/music/index.js';

export async function handleSlash(interaction: Interaction, config: Pick<Config, 'ownerIds' | 'dashboardOrigin'>) {
  if (!interaction.isChatInputCommand() || !['magelina', 'musica'].includes(interaction.commandName)) return;
  const i = interaction;
  try {
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    if (!i.guild) throw workflowError(400, 'Esta función solo está disponible en servidores.');
    const { member, access } = await commandAccess(i, config);
    const command = i.options.getSubcommand();
    await assertAvailable(i.guild.id, undefined, command === 'solicitud' || (interaction.commandName === 'musica' && !['buscar', 'cola'].includes(command)));
    const requireCapability = (capability: Capability) => {
      if (!access.capabilities.includes(capability)) throw workflowError(403, 'No tienes permiso para utilizar esta función.');
    };
    const execute = i.commandName === 'musica' ? executeMusic : executeCommunity;
    const content = await execute({ i, config, member, access, command, requireCapability });
    if (content === undefined) return;
    await i.editReply({ content: content.slice(0, 2000), allowedMentions: { parse: [] } });
  } catch (error) {
    logRecord('bot.command.failed', { command: i.commandName, guildId: i.guildId, outcome: 'failed' });
    const content = error instanceof Error && 'publicMessage' in error && typeof error.publicMessage === 'string' ? error.publicMessage : 'No se pudo completar el comando. Comprueba los permisos y vuelve a intentarlo.';
    try {
      if (i.deferred || i.replied) await i.editReply({ content, allowedMentions: { parse: [] } });
      else await i.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
    } catch { console.error('No se pudo responder al comando de Magelina.'); }
  }
}