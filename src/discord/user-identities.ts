import type { Client } from 'discord.js';
import type { RequestHandler } from 'express';

/** Public identities only; route authorization is supplied by managementRoutes. */
export function userIdentities(bot: Client): RequestHandler {
  const pending = new Map<string, Promise<{ id: string; name: string; username: string } | null>>();
  return async (req, res) => {
    const raw = req.query.ids;
    if (typeof raw !== 'string' || raw.split(',').length > 50 || !raw.split(',').every((id) => /^\d{17,20}$/.test(id))) {
      res.status(400).json({ error: 'Se requieren entre 1 y 50 IDs de usuario válidos.' }); return;
    }
    const ids = [...new Set(raw.split(','))];
    const guildId = typeof req.params.guildId === 'string' ? req.params.guildId : undefined;
    const users = [];
    // Bound concurrent Discord requests, including simultaneous dashboard batches.
    for (const id of ids) {
      let lookup = pending.get(id);
      if (!lookup) {
        if (pending.size >= 50) { users.push({ id, name: null, username: null }); continue; }
        lookup = bot.users.fetch(id).then((user) => ({ id, name: user.globalName || user.username, username: user.username })).catch(() => null);
        pending.set(id, lookup);
        void lookup.finally(() => pending.delete(id));
      }
      const user = await lookup;
      const nickname = guildId ? bot.guilds.cache.get(guildId)?.members.cache.get(id)?.displayName : undefined;
      users.push({ id, name: nickname || user?.name || null, username: user?.username || null });
    }
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({ users });
  };
}
