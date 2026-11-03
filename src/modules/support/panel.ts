import { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ChannelType, EmbedBuilder, OverwriteType, PermissionFlagsBits as P, type Guild } from 'discord.js';
import { reportTypes } from './report-types.js';
import { SupportConfig } from '../../database/models/SupportConfig.js';
import { workflowError } from '../workflow/rules.js';
import type { supportContext } from './service.js';
import { hasCode } from '../../types/errors.js';

export function supportPanel() {
  return { embeds: [new EmbedBuilder().setTitle('Soporte del gremio').setDescription('Consulta las respuestas del equipo. Si necesitas atención, envía una solicitud: un administrador la revisará y asignará un moderador.').setColor(0xd94695)],
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(new StringSelectMenuBuilder().setCustomId('support:type').setPlaceholder('Selecciona el tipo de reporte').addOptions(reportTypes)), new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId('support:help').setLabel('Consultar ayuda').setStyle(ButtonStyle.Secondary))], allowedMentions: { parse: [] as never[] } };
}

export async function publishSupportPanel(guild: Guild, actorId: string, ctx: Awaited<ReturnType<typeof supportContext>>, channelId?: string) {
  if (!ctx.canModerate) throw workflowError(403, 'Solo los moderadores o administradores pueden publicar el panel de soporte.');
  await SupportConfig.updateOne({ guildId: guild.id }, { $setOnInsert: { guildId: guild.id } }, { upsert: true });
  const config = await SupportConfig.findOneAndUpdate({ guildId: guild.id, publishing: false }, { $set: { publishing: true }, $inc: { version: 1 } }, { new: true });
  if (!config) throw workflowError(409, 'Otro miembro del equipo está publicando el panel.');
  try {
    if (!ctx.me.permissions.has([P.ManageChannels, P.ManageRoles])) throw workflowError(403, 'Magelina necesita gestionar canales y roles para organizar el soporte.');
    let category = config.categoryId ? await guild.channels.fetch(config.categoryId).catch((error: unknown) => { if (hasCode(error, 10003)) return null; throw error; }) : null;
    if (category && category.type !== ChannelType.GuildCategory) throw workflowError(409, 'La categoria de soporte configurada no es valida.');
    if (!category) {
      category = await guild.channels.create({ name: 'Soporte del gremio', type: ChannelType.GuildCategory, reason: `Magelina: soporte publicado por ${actorId}` });
      config.categoryId = category.id;
      await config.save();
    }
    const targetId = channelId ?? config.panelChannelId;
    let channel;
    if (targetId) {
      channel = await guild.channels.fetch(targetId);
      if (!channel || channel.type !== ChannelType.GuildText || (ctx.actor && !channel.permissionsFor(ctx.actor)?.has(config.panelChannelId === targetId ? [P.ViewChannel] : [P.ViewChannel, P.SendMessages]))) throw workflowError(403, 'Selecciona un canal de texto donde puedas enviar mensajes.');
    } else {
      if (!ctx.me.permissions.has([P.ManageChannels, P.ManageRoles])) throw workflowError(403, 'Magelina necesita gestionar canales y roles para crear el punto de soporte.');
      channel = await guild.channels.create({ name: 'soporte-del-gremio', type: ChannelType.GuildText, parent: category.id, reason: `Magelina: panel de soporte publicado por ${actorId}`,
        permissionOverwrites: [{ id: guild.id, type: OverwriteType.Role, allow: [P.ViewChannel, P.ReadMessageHistory], deny: [P.SendMessages] }, { id: ctx.me.id, type: OverwriteType.Member, allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.ManageChannels, P.ManageRoles] }] });
    }
    if (!channel.permissionsFor(ctx.me)?.has([P.ViewChannel, P.SendMessages, P.ReadMessageHistory])) throw workflowError(403, 'Magelina necesita ver el canal, enviar mensajes y leer el historial.');
    if (channel.parentId !== category.id) await channel.setParent(category.id, { lockPermissions: false });
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
