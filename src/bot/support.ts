import { ActionRowBuilder, EmbedBuilder, MessageFlags, ModalBuilder, PermissionFlagsBits as P, TextInputBuilder, TextInputStyle, escapeMarkdown, type Interaction } from 'discord.js';
import { randomUUID } from 'node:crypto';
import { PanelSessions } from './panel-sessions.js';
import { interactionGuild } from './guild.js';
import { supportConfig, submitSupport } from '../modules/support/service.js';
import { assertAvailable } from '../modules/operations/service.js';
import { workflowError } from '../modules/workflow/rules.js';

const requests = new PanelSessions<{ requestId: string; channelId: string; panelMessageId: string }>();

export async function handleSupportInteraction(i: Interaction) {
  if (!(i.isButton() || i.isModalSubmit()) || !i.customId.startsWith('support:')) return;
  try {
    const guild = await interactionGuild(i);
    if (i.isButton() && i.customId === 'support:help') {
      await i.deferReply({ flags: MessageFlags.Ephemeral });
      await assertAvailable(guild.id, undefined, false);
      const member = await guild.members.fetch({ user: i.user.id, force: true }), config = await supportConfig(guild.id);
      const channel = await guild.channels.fetch(i.channelId!);
      if (config.panelMessageId !== i.message.id || config.panelChannelId !== i.channelId || !channel?.permissionsFor(member)?.has(P.ViewChannel)) throw workflowError(403, 'Abre el panel de soporte vigente de este servidor.');
      const embed = new EmbedBuilder().setTitle('Respuestas del equipo').setColor(0xd94695);
      if (config.faqs.length) embed.addFields(config.faqs.map(faq => ({ name: escapeMarkdown(faq.question).slice(0, 200), value: escapeMarkdown(faq.answer).slice(0, 850) })));
      else embed.setDescription('El equipo aún no ha publicado respuestas. Puedes solicitar atención desde el panel.');
      await i.editReply({ embeds: [embed], allowedMentions: { parse: [] } }); return;
    }
    if (i.isButton() && i.customId === 'support:request') {
      await assertAvailable(guild.id);
      const member = await guild.members.fetch({ user: i.user.id, force: true }), config = await supportConfig(guild.id);
      const channel = await guild.channels.fetch(i.channelId!);
      if (config.panelMessageId !== i.message.id || config.panelChannelId !== i.channelId || !channel?.permissionsFor(member)?.has(P.ViewChannel)) throw workflowError(403, 'Abre el panel de soporte vigente de este servidor.');
      const token = requests.create(i.user.id, guild.id, { requestId: randomUUID(), channelId: i.channelId!, panelMessageId: i.message.id });
      await i.showModal(new ModalBuilder().setCustomId(`support:submit:${token}`).setTitle('Solicitar atención').addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('subject').setLabel('Asunto').setStyle(TextInputStyle.Short).setMaxLength(100).setRequired(true)),
        new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('description').setLabel('¿Qué necesitas resolver?').setStyle(TextInputStyle.Paragraph).setMaxLength(1500).setRequired(true)),
      )); return;
    }
    if (i.isModalSubmit() && i.customId.startsWith('support:submit:')) {
      await i.deferReply({ flags: MessageFlags.Ephemeral });
      await assertAvailable(guild.id);
      const session = requests.get(i.customId.slice('support:submit:'.length), i.user.id, guild.id);
      const member = await guild.members.fetch({ user: i.user.id, force: true }), config = await supportConfig(guild.id);
      const channel = await guild.channels.fetch(session.channelId);
      if (config.panelMessageId !== session.panelMessageId || !channel?.permissionsFor(member)?.has(P.ViewChannel)) throw workflowError(403, 'El panel cambió o ya no tienes acceso.');
      const item = await submitSupport(guild.id, i.user.id, { requestId: session.requestId, subject: i.fields.getTextInputValue('subject'), description: i.fields.getTextInputValue('description') });
      await i.editReply({ content: `Solicitud recibida: ${item.id}. Un administrador la revisará y asignará un moderador. Todavía no se ha creado un canal privado.`, allowedMentions: { parse: [] } });
    }
  } catch (cause) {
    const content = cause instanceof Error && 'publicMessage' in cause ? String(cause.publicMessage) : 'No se pudo procesar la solicitud. Intenta actualizar el panel.';
    try {
      if (i.deferred || i.replied) await i.editReply({ content, allowedMentions: { parse: [] } });
      else await i.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
    } catch { /* The interaction may have expired; no channel is created by this handler. */ }
  }
}
