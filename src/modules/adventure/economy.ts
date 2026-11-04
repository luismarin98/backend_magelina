import { integrationDefaults } from './integration.js';
import type { WorldAccess } from './world.js';
import { createHash } from 'node:crypto';
import mongoose from 'mongoose';
import { Router } from 'express';
import { AdventureCharacter, AdventureConfig, AdventureMembership } from '../../database/models/Adventure.js';
import { AdventureItem } from '../../database/models/AdventureItem.js';
import { AdventureInventory, AdventureListing, AdventureReceipt } from '../../database/models/AdventureEconomy.js';
import { object, text, id, cursor, page, version } from '../common/input.js';
import { workflowError } from '../workflow/rules.js';
import { hasCode } from '../../types/errors.js';
import { assertAvailable } from '../operations/service.js';
import { baseItems, ECONOMY, positiveInteger, changeCoins, changeStack, craft, type ItemSpec } from './economy-rules.js';

const sessionError = () => workflowError(503, 'El comercio requiere MongoDB con transacciones habilitadas (replica set). No se realizó la operación.');
function key(value: unknown) {
  const result = text(value, 64);
  if (!/^[a-zA-Z0-9-]{16,64}$/.test(result)) throw workflowError(400, 'Identificador de operación no válido.');
  return result;
}
async function spec(itemId: string, session?: mongoose.ClientSession, designs = AdventureItem): Promise<ItemSpec> {
  const standard = baseItems.find(item => item.id === itemId);
  if (standard) return standard;
  if (!/^design:[a-f\d]{24}$/.test(itemId)) throw workflowError(400, 'Objeto desconocido.');
  const design = await designs.findOne({ _id: itemId.slice(7), status: 'approved', category: 'cosmetic' }).session(session ?? null).lean();
  if (!design) throw workflowError(409, 'El diseño debe ser un cosmético aprobado.');
  return { id: itemId, name: design.name, icon: design.icon, category: 'Cosmético', sellPrice: 5, ingredients: design.archived ? undefined : { wood: 2, herb: 2 } };
}
export const economyModels = { AdventureConfig, AdventureMembership, AdventureCharacter, AdventureItem, AdventureInventory, AdventureListing, AdventureReceipt };
export async function economyOperation(userId: string, action: string, input: Record<string, unknown>, models = economyModels, world?: WorldAccess) {
  const { AdventureConfig, AdventureMembership, AdventureCharacter, AdventureItem, AdventureInventory, AdventureListing, AdventureReceipt } = models;
  const operationKey = key(input.key);
  const fingerprint = createHash('sha256').update(JSON.stringify({ action, ...Object.fromEntries(Object.entries(input).filter(([name]) => name !== 'key').sort(([a], [b]) => a.localeCompare(b))) })).digest('hex');
  const replay = (receipt: any) => {
    if (receipt.fingerprint !== fingerprint) throw workflowError(409, 'Ese identificador ya se utilizó para otra operación.');
    return receipt.result;
  };
  const previous = await AdventureReceipt.findOne({ userId, key: operationKey }).lean();
  if (previous) return replay(previous);
  const countryAction = ['travel', 'list', 'buy', 'sell'].includes(action);
  const guildId = countryAction ? (action === 'travel' && input.guildId === null ? null : id(input.guildId, true)) : null;
  let guildName: string | null = null;
  if (guildId) {
    if (!world) throw workflowError(503, 'No se pudo validar el acceso al pa\u00eds.');
    guildName = await world.verify(userId, guildId);
  }
  const session = await mongoose.startSession();
  try {
    let result: Record<string, unknown> = {};
    await session.withTransaction(async () => {
      const receipt = await AdventureReceipt.findOne({ userId, key: operationKey }).session(session).lean();
      if (receipt) { result = replay(receipt); return; }
      const character = await AdventureCharacter.findOne({ userId }).session(session);
      if (!character) throw workflowError(409, 'Inicia tu aventura antes de usar el inventario.');
      if (character.activeAdventureId && ['travel', 'gather'].includes(action)) throw workflowError(409, 'Termina o abandona tu aventura antes de viajar o recolectar.');
      let destinationConfig;
      if (guildId) {
        const config = await AdventureConfig.findOne({ guildId }).session(session).lean();
        destinationConfig = config;
        const membership = await AdventureMembership.findOne({ guildId, userId }).session(session).lean();
        if (!config?.enabled) throw workflowError(409, 'El juego est\u00e1 desactivado en ese pa\u00eds.');
        if (!membership) throw workflowError(403, 'Inscr\u00edbete en el gremio de ese pa\u00eds para comerciar o viajar.');
        // A write on the country configuration serializes trades with disabling the game.
        await AdventureConfig.updateOne({ _id: config._id }, { $inc: { commerceRevision: 1 } }, { session });
      }
      if (action === 'travel') {
        if (character.version !== version(input.version)) throw workflowError(409, 'Tu personaje cambi\u00f3. Revisa tu ubicaci\u00f3n antes de viajar.');
        const from = character.currentGuildId ?? null;
        character.currentGuildId = guildId; character.currentGuildName = guildName; character.version++;
        await character.save({ session });
        result = { travelled: true, from, guildId, guildName };
        const settings = integrationDefaults(destinationConfig);
        const notice = guildId && from !== guildId && settings.enabled && settings.announceArrivals && settings.channelId && settings.categoryId
          ? { state: 'pending', attempts: 0, dueAt: new Date(), guildId, channelId: settings.channelId, categoryId: settings.categoryId, alias: character.alias }
          : { state: 'skipped' };
        await AdventureReceipt.create([{ userId, key: operationKey, fingerprint, result, notice }], { session });
        return;
      }
      if (['list', 'buy', 'sell'].includes(action) && character.currentGuildId !== guildId) throw workflowError(409, 'Debes viajar a ese pa\u00eds antes de comprar o vender.');
      // Serializes listing publication with a concurrent journey, even without a balance change.
      if (action === 'list') { character.version++; await character.save({ session }); }
      let bag = await AdventureInventory.findOne({ userId }).session(session);
      if (!bag) [bag] = await AdventureInventory.create([{ userId }], { session });
      let stacks = new Map<string, number>(bag!.stacks);
      if (action === 'gather') {
        const availableAt = (bag!.gatheredAt?.getTime() ?? 0) + ECONOMY.gatherCooldown;
        if (availableAt > Date.now()) throw workflowError(409, `Podrás recolectar de nuevo a las ${new Date(availableAt).toISOString()}.`);
        changeStack(stacks, 'wood', 2); changeStack(stacks, 'herb', 2);
        bag!.gatheredAt = new Date(); result = { gathered: { wood: 2, herb: 2 } };
      } else if (action === 'craft' || action === 'sell' || action === 'list') {
        const item = await spec(text(input.itemId, 64), session, AdventureItem), quantity = positiveInteger(input.quantity);
        if (action === 'craft') {
          stacks = craft(stacks, item, quantity); result = { crafted: item.id, quantity };
        } else {
          changeStack(stacks, item.id, -quantity);
          if (action === 'sell') {
            const total = item.sellPrice * quantity;
            character.coins = changeCoins(character.coins, total); character.version++;
            await character.save({ session }); result = { sold: item.id, quantity, total };
          } else {
            const unitPrice = positiveInteger(input.unitPrice, ECONOMY.maxUnitPrice);
            const [listing] = await AdventureListing.create([{ sellerId: userId, guildId, guildName, itemId: item.id, itemName: item.name, icon: item.icon, quantity, unitPrice }], { session });
            result = { listingId: String(listing!._id), quantity, total: quantity * unitPrice };
          }
        }
      } else if (action === 'buy' || action === 'cancel') {
        const listing = await AdventureListing.findOne({ _id: id(input.listingId), status: 'open' }).session(session);
        if (!listing) throw workflowError(409, 'La oferta ya no está disponible.');
        if (action === 'cancel') {
          if (listing.sellerId !== userId) throw workflowError(403, 'Solo el vendedor puede cancelar la oferta.');
          changeStack(stacks, listing.itemId, listing.quantity); listing.status = 'cancelled';
          result = { cancelled: String(listing._id) };
        } else {
          if (!listing.guildId || listing.guildId !== guildId) throw workflowError(409, 'La oferta no pertenece al mercado seleccionado.');
          if (listing.sellerId === userId) throw workflowError(400, 'No puedes comprar tu propia oferta.');
          const total = listing.quantity * listing.unitPrice;
          character.coins = changeCoins(character.coins, -total);
          const seller = await AdventureCharacter.findOne({ userId: listing.sellerId }).session(session);
          if (!seller) throw workflowError(409, 'El vendedor ya no está disponible.');
          seller.coins = changeCoins(seller.coins, total); seller.version++;
          changeStack(stacks, listing.itemId, listing.quantity);
          listing.status = 'sold'; listing.buyerId = userId;
          character.version++;
          await seller.save({ session }); await character.save({ session });
          result = { purchased: listing.itemId, quantity: listing.quantity, total };
        }
        await listing.save({ session });
      } else throw workflowError(400, 'Operación desconocida.');
      bag!.set('stacks', stacks);
      await bag!.save({ session });
      await AdventureReceipt.create([{ userId, key: operationKey, fingerprint, result }], { session });
    }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } });
    return result;
  } catch (error) {
    if (hasCode(error, 11000)) {
      const receipt = await AdventureReceipt.findOne({ userId, key: operationKey }).lean();
      if (receipt) return replay(receipt);
      throw workflowError(409, 'Otra operación modificó tu inventario. Reintenta.');
    }
    if (hasCode(error, 20) || hasCode(error, 303)) throw sessionError();
    throw error;
  } finally { await session.endSession(); }
}

export function economyRoutes(world?: WorldAccess) {
  const router = Router();
  router.use(async (req, _res, next) => {
    if (!await AdventureCharacter.exists({ userId: req.session.user!.id })) throw workflowError(409, 'Primero inicia tu aventura.');
    if (!['GET', 'HEAD'].includes(req.method)) await assertAvailable('');
    next();
  });
  router.get('/', async (req, res) => {
    const userId = req.session.user!.id;
    const [bag, character] = await Promise.all([AdventureInventory.findOne({ userId }).lean(), AdventureCharacter.findOne({ userId }).lean()]);
    const stacks = bag?.stacks instanceof Map ? [...bag.stacks] : Object.entries(bag?.stacks ?? {});
    const designs = await AdventureItem.find({ _id: { $in: stacks.map(([itemId]) => itemId).filter(itemId => itemId.startsWith('design:')).map(itemId => itemId.slice(7)) } }).select('name icon').lean();
    res.json({ activeAdventureId: character!.activeAdventureId ?? null, currentGuildId: character!.currentGuildId ?? null, coins: character!.coins, nextGatherAt: bag?.gatheredAt ? new Date(bag.gatheredAt.getTime() + ECONOMY.gatherCooldown).toISOString() : null,
      inventory: stacks.filter(([, quantity]) => quantity > 0).map(([itemId, quantity]) => {
        const item = baseItems.find(item => item.id === itemId), design = designs.find(item => String(item._id) === itemId.slice(7));
        return { itemId, quantity, name: item?.name ?? design?.name ?? 'Cosmético', icon: item?.icon ?? design?.icon ?? 'sparkles', sellPrice: item?.sellPrice ?? 5 };
      }), recipes: baseItems.filter(item => item.ingredients), limits: ECONOMY });
  });
  router.get('/recipes', async (req, res) => {
    const result = page(await AdventureItem.find({ status: 'approved', archived: { $ne: true }, category: 'cosmetic', ...cursor(req.query.before) }).sort({ _id: -1 }).limit(11).lean(), 10);
    res.json({ items: result.items.map(item => ({ id: `design:${item._id}`, name: item.name, icon: item.icon, category: 'Cosmético', sellPrice: 5, ingredients: { wood: 2, herb: 2 } })), nextCursor: result.nextCursor });
  });
  router.get('/market', async (req, res) => {
    const mine = req.query.mine === 'true';
    const guildId = mine ? null : id(req.query.guildId, true);
    if (guildId) {
      if (!world) throw workflowError(503, 'No se pudo validar el mercado.');
      await world.verify(req.session.user!.id, guildId);
      if (!(await AdventureConfig.findOne({ guildId }).lean())?.enabled) throw workflowError(409, 'El mercado est\u00e1 desactivado.');
    }
    const result = page(await AdventureListing.find({ ...(mine ? { sellerId: req.session.user!.id } : { guildId }), status: 'open', ...cursor(req.query.before) }).sort({ _id: -1 }).limit(11).lean(), 10);
    res.json({ items: result.items.map(item => ({ id: String(item._id), guildId: item.guildId ?? null, guildName: item.guildName ?? 'Mercado anterior', itemId: item.itemId, name: item.itemName, icon: item.icon, quantity: item.quantity, unitPrice: item.unitPrice, total: item.quantity * item.unitPrice, mine: item.sellerId === req.session.user!.id })), nextCursor: result.nextCursor });
  });
  for (const action of ['gather', 'craft', 'sell', 'list', 'buy', 'cancel', 'travel']) router.post(`/${action}`, async (req, res) => {
    const fields = ['key', ...(['craft', 'sell', 'list'].includes(action) ? ['itemId', 'quantity'] : []), ...(action === 'list' ? ['unitPrice'] : []), ...(['list', 'sell', 'buy', 'travel'].includes(action) ? ['guildId'] : []), ...(action === 'travel' ? ['version'] : []), ...(['buy', 'cancel'].includes(action) ? ['listingId'] : [])];
    const input = object(req.body, fields);
    res.json(await economyOperation(req.session.user!.id, action, input, economyModels, world));
  });
  return router;
}
