import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder, OverwriteType, PermissionFlagsBits as P, type Guild } from 'discord.js';
import { SupportConfig } from '../../database/models/SupportConfig.js';
import { workflowError } from '../workflow/rules.js';
import type { supportContext } from './service.js';
import { hasCode } from '../../types/errors.js';

export function supportPanel() {
  return { embeds: [new EmbedBuilder().setTitle('Soporte del gremio').setDescription('Consulta las respuestas del equipo. Si necesitas atención, envía una solicitud: un administrador la revisará y asignará un moderador.').setColor(0xd94695)],
    components: [new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId('support:help').setLabel('Consultar ayuda').setStyle(ButtonStyle.Secondary), new ButtonBuilder().setCustomId('support:request').setLabel('Solicitar atención').setStyle(ButtonStyle.Primary))], allowedMentions: { parse: [] as never[] } };
}

export async function publishSupportPanel(guild: Guild, actorId: string, ctx: Awaited<ReturnType<typeof supportContext>>, channelId?: string) {
  if (!ctx.canModerate) throw workflowError(403, 'Solo los moderadores o administradores pueden publicar el panel de soporte.');
  await SupportConfig.updateOne({ guildId: guild.id }, { $setOnInsert: { guildId: guild.id } }, { upsert: true });
  const config = await SupportConfig.findOneAndUpdate({ guildId: guild.id, publishing: false }, { $set: { publishing: true }, $inc: { version: 1 } }, { new: true });
  if (!config) throw workflowError(409, 'Otro miembro del equipo está publicando el panel.');
  try {
    const targetId = channelId ?? config.panelChannelId;
    let channel;
    if (targetId) {
      channel = await guild.channels.fetch(targetId);
      if (!channel || channel.type !== ChannelType.GuildText || (ctx.actor && !channel.permissionsFor(ctx.actor)?.has(config.panelChannelId === targetId ? [P.ViewChannel] : [P.ViewChannel, P.SendMessages]))) throw workflowError(403, 'Selecciona un canal de texto donde puedas enviar mensajes.');
    } else {
      if (!ctx.me.permissions.has([P.ManageChannels, P.ManageRoles])) throw workflowError(403, 'Magelina necesita gestionar canales y roles para crear el punto de soporte.');
      channel = await guild.channels.create({ name: 'soporte-del-gremio', type: ChannelType.GuildText, reason: `Magelina: panel de soporte publicado por ${actorId}`,
        permissionOverwrites: [{ id: guild.id, type: OverwriteType.Role, allow: [P.ViewChannel, P.ReadMessageHistory], deny: [P.SendMessages] }, { id: ctx.me.id, type: OverwriteType.Member, allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.ManageChannels, P.ManageRoles] }] });
    }
    if (!channel.permissionsFor(ctx.me)?.has([P.ViewChannel, P.SendMessages, P.ReadMessageHistory])) throw workflowError(403, 'Magelina necesita ver el canal, enviar mensajes y leer el historial.');
    const reuse = config.panelChannelId === channel.id && config.panelMessageId;
    config.panelChannelId = channel.id;
    if (!reuse) config.panelMessageId = null;
    await config.save();
    if (reuse) {
      const message = await channel.messages.fetch(reuse).catch((error: unknown) => { if (hasCode(error, 10008)) return null; throw error; });
      if (message) {
        if (message.author.id !== ctx.me.id) throw workflowError(403, 'El mensaje registrado no pertenece a Magelina.');
        await message.edit(supportPanel());
      } else { config.panelMessageId = (await channel.send(supportPanel())).id; }
    } else {
      const message = await channel.send(supportPanel()); config.panelMessageId = message.id;
    }
    await config.save();
    return config;
  } finally {
    await SupportConfig.updateOne({ guildId: guild.id }, { $set: { publishing: false, panelChannelId: config.panelChannelId, panelMessageId: config.panelMessageId } });
  }
}
