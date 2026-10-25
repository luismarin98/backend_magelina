import type { Interaction } from 'discord.js';
import {
  ActionRowBuilder, ApplicationCommandType, ContextMenuCommandBuilder, MessageFlags,
  ModalBuilder, PermissionFlagsBits, TextInputBuilder, TextInputStyle,
} from 'discord.js';
import { createRequest } from '../../../modules/workflow/service.js';
import { requireModule } from '../../../modules/settings/service.js';

export const requestCommand = new ContextMenuCommandBuilder()
  .setName('Crear solicitud').setType(ApplicationCommandType.Message).setDMPermission(false);

export async function handleWorkflow(interaction: Interaction) {
  if (!interaction.isMessageContextMenuCommand() && !interaction.isModalSubmit()) return;
  const context = interaction.isMessageContextMenuCommand() && interaction.commandName === requestCommand.name;
  const modal = interaction.isModalSubmit() && interaction.customId.startsWith('request:');
  if (!context && !modal) return;
  try {
    if (!interaction.inGuild()) return interaction.reply({ content: 'Esta funcion solo esta disponible en servidores.', flags: MessageFlags.Ephemeral });
    if (interaction.isMessageContextMenuCommand()) {
      await requireModule(interaction.guildId, 'workflow');
      const title = new TextInputBuilder().setCustomId('title').setLabel('Titulo de la solicitud')
        .setStyle(TextInputStyle.Short).setMinLength(1).setMaxLength(160).setRequired(true);
      return await interaction.showModal(new ModalBuilder()
        .setCustomId(`request:${interaction.channelId}:${interaction.targetMessage.id}`)
        .setTitle('Crear solicitud').addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(title)));
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const match = /^request:(\d{17,20}):(\d{17,20})$/.exec(interaction.customId);
    if (!match || match[1] !== interaction.channelId) throw new Error('Invalid source');
    const channel = await interaction.client.channels.fetch(match[1]);
    const guild = interaction.client.guilds.cache.get(interaction.guildId);
    const member = await guild!.members.fetch({ user: interaction.user.id, force: true });
    if (!channel?.isTextBased() || !('guildId' in channel) || channel.guildId !== interaction.guildId ||
        !channel.permissionsFor(member)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory])) {
      return await interaction.editReply('No puedes crear una solicitud desde este canal.');
    }
    await channel.messages.fetch(match[2]); // Verifica el origen; no se guarda ni copia su contenido.
    const item = await createRequest({ guildId: interaction.guildId, sourceChannelId: channel.id,
      sourceMessageId: match[2], createdBy: interaction.user.id, title: interaction.fields.getTextInputValue('title'),
    });
    await interaction.editReply({ content: `Solicitud creada: ${item.id}. Un administrador puede revisarla desde la dashboard.`, allowedMentions: { parse: [] } });
  } catch (error) {
    logRecord('bot.workflow.failed', { guildId: interaction.guildId, outcome: 'failed' });
    const content = (error instanceof Error && 'publicMessage' in error && typeof error.publicMessage === 'string' ? error.publicMessage : '') || 'No se pudo guardar la solicitud. Revisa el acceso al mensaje e intentalo de nuevo.';
    try {
      if (interaction.deferred || interaction.replied) await interaction.editReply({ content, allowedMentions: { parse: [] } });
      else await interaction.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
    } catch { console.error('No se pudo responder a la interaccion de solicitudes.'); }
  }
}
import { logRecord } from '../../../observability/logging.js';

export { handleWorkflow as execute };
