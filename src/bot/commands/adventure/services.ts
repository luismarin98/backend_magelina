import type { Client } from 'discord.js';
import { AdventureCharacter, AdventureConfig, AdventureMembership } from '../../../database/models/Adventure.js';
import { AdventureItem } from '../../../database/models/AdventureItem.js';
import { AdventureListing } from '../../../database/models/AdventureEconomy.js';
import { startAdventureCharacter } from '../../../modules/adventure/global.js';
import { joinAdventureGuild } from '../../../modules/adventure/routes.js';
import { economyState, economyOperation } from '../../../modules/adventure/economy.js';
import { expeditionState, expeditionOperation } from '../../../modules/adventure/expeditions.js';
import { baseItems } from '../../../modules/adventure/economy-rules.js';
import { createWorldAccess } from '../../../modules/adventure/world.js';
import { assertAvailable } from '../../../modules/operations/service.js';
import { workflowError } from '../../../modules/workflow/rules.js';

export const adventureServices = {
  available: assertAvailable,
  world: createWorldAccess,
  character: async (userId: string) => AdventureCharacter.findOne({ userId }).lean(),
  start: startAdventureCharacter,
  join: joinAdventureGuild,
  inventory: economyState,
  board: expeditionState,
  expedition: expeditionOperation,
  economy: economyOperation,
  async market(userId: string, guildId: string, page: number, client: Client) {
    await createWorldAccess(client).verify(userId, guildId);
    if (!(await AdventureConfig.findOne({ guildId }).lean())?.enabled) throw workflowError(409, 'El mercado esta desactivado en este pais.');
    const rows = await AdventureListing.find({ guildId, status: 'open' }).sort({ _id: -1 }).skip(page * 10).limit(11).lean();
    return { more: rows.length > 10, items: rows.slice(0, 10) };
  },
  async recipes(page: number) {
    const standard = baseItems.filter(item => item.ingredients);
    const offset = page * 10;
    const rows = await AdventureItem.find({ status: 'approved', archived: { $ne: true }, category: 'cosmetic' }).sort({ _id: -1 }).skip(Math.max(0, offset - standard.length)).limit(11).lean();
    const items = [...standard.slice(offset), ...rows.map(item => ({ id: `design:${item._id}`, name: item.name, ingredients: { wood: 2, herb: 2 } }))];
    return { more: items.length > 10, items: items.slice(0, 10) };
  },
  async countries(userId: string, page: number, client: Client) {
    const rows = await AdventureMembership.find({ userId }).sort({ _id: 1 }).skip(page * 10).limit(11).lean();
    const enabled = await AdventureConfig.find({ guildId: { $in: rows.slice(0, 10).map(row => row.guildId) }, enabled: true }).lean();
    const items: { id: string; name: string }[] = [];
    for (const row of rows.slice(0, 10)) {
      if (!enabled.some(config => config.guildId === row.guildId)) continue;
      try { items.push({ id: row.guildId, name: await createWorldAccess(client).verify(userId, row.guildId) }); }
      catch (error) { if (!(error && typeof error === 'object' && 'status' in error && error.status === 403)) throw error; }
    }
    return { more: rows.length > 10, items };
  },
};
