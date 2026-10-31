import type { Client } from 'discord.js';
import type { GuildSummary } from '../types/contracts.js';
import { serializeGuild } from './images.js';
import { workflowError } from '../modules/workflow/rules.js';

const pending = new WeakMap<Client, Promise<GuildSummary[]>>();

/** Read actual bot memberships, including guilds absent from the gateway cache. */
export function listBotGuilds(bot: Client): Promise<GuildSummary[]> {
  const current = pending.get(bot);
  if (current) return current;
  const result = fetchGuilds(bot).finally(() => pending.delete(bot));
  pending.set(bot, result);
  return result;
}

async function fetchGuilds(bot: Client): Promise<GuildSummary[]> {
  const guilds = new Map<string, GuildSummary>();
  let after: string | undefined;
  try {
    while (true) {
      const page = await bot.guilds.fetch({ limit: 200, ...(after ? { after } : {}) });
      for (const guild of page.values()) {
        const cached = bot.guilds.cache.get(guild.id);
        guilds.set(guild.id, serializeGuild({ id: guild.id, name: guild.name, icon: guild.icon, banner: cached?.banner }));
      }
      if (page.size < 200) break;
      const next = page.lastKey();
      if (!next || (after && BigInt(next) <= BigInt(after))) throw new Error('Invalid guild cursor');
      after = next;
    }
  } catch {
    // Do not report a partial gateway cache as a complete membership list.
    throw workflowError(502, 'No se pudo consultar la lista completa de servidores del bot en Discord. Inténtalo de nuevo.');
  }
  return [...guilds.values()].sort((a, b) => a.name.localeCompare(b.name));
}
