import { AdventureConfig } from '../../database/models/Adventure.js';
import { AdventureOffer } from '../../database/models/AdventureExpedition.js';
import { getControls } from '../operations/service.js';
import { CYCLE_MS, expeditionCycle, generateExpeditions } from './expedition-rules.js';

export async function generateCountryExpeditions(now = new Date()) {
  const controls = await getControls();
  if (controls.maintenance) return;
  const cycle = expeditionCycle(now);
  const countries = await AdventureConfig.find({ enabled: true, guildId: { $nin: controls.blockedGuildIds }, lastAdventureCycle: { $ne: cycle } }).sort({ _id: 1 }).limit(Math.min(25, controls.jobsPerTick)).lean();
  for (const country of countries) {
    const definitions = generateExpeditions(country.guildId, cycle);
    await AdventureOffer.bulkWrite(definitions.map(definition => ({ updateOne: {
      filter: { guildId: country.guildId, cycle, templateId: definition.templateId },
      update: { $setOnInsert: { definition, expiresAt: new Date((cycle + 1) * CYCLE_MS) } }, upsert: true,
    } })));
    // Only mark complete after all three upserts succeed. Replays reuse their unique keys.
    await AdventureConfig.updateOne({ _id: country._id, enabled: true }, { $set: { lastAdventureCycle: cycle } });
  }
}
