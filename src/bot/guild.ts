import type { BaseInteraction } from 'discord.js';
import { workflowError } from '../modules/workflow/rules.js';

/** A guild interaction can arrive before the guild is available in the cache. */
export async function interactionGuild(i: Pick<BaseInteraction, 'guild' | 'guildId' | 'client'>) {
  if (!i.guildId) throw workflowError(400, 'Esta función solo está disponible en servidores.');
  if (i.guild) return i.guild;
  try {
    // GuildManager.fetch also populates the cache used by interaction.guild.
    return await i.client.guilds.fetch(i.guildId);
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
    if (code === 50001 || code === 10004) {
      throw workflowError(403, 'Magelina no tiene acceso a este servidor. Un administrador debe añadir el bot al servidor; añadir la aplicación a tu cuenta no es suficiente.');
    }
    throw workflowError(503, 'No se pudo consultar el servidor en Discord. Inténtalo de nuevo en unos momentos.');
  }
}
