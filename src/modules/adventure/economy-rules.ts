import { workflowError } from '../workflow/rules.js';

export const ECONOMY = { maxStack: 1000000, maxSlots: 200, maxCoins: 1000000000, maxBatch: 100, maxUnitPrice: 1000000, gatherCooldown: 10 * 60 * 1000 };
export interface ItemSpec { id: string; name: string; icon: string; category: string; sellPrice: number; ingredients?: Record<string, number> }
export const baseItems: ItemSpec[] = [
  { id: 'wood', name: 'Madera', icon: 'leaf', category: 'Material', sellPrice: 2 },
  { id: 'herb', name: 'Hierba', icon: 'leaf', category: 'Material', sellPrice: 1 },
  { id: 'wooden-charm', name: 'Amuleto de madera', icon: 'sparkles', category: 'Cosmético', sellPrice: 5, ingredients: { wood: 2, herb: 2 } },
];
export function positiveInteger(value: unknown, max = ECONOMY.maxBatch): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > max) throw workflowError(400, `Indica un entero entre 1 y ${max}.`);
  return value;
}
export function changeStack(stacks: Map<string, number>, itemId: string, delta: number) {
  const next = (stacks.get(itemId) ?? 0) + delta;
  if (!Number.isSafeInteger(delta) || !Number.isSafeInteger(next) || next < 0) throw workflowError(409, 'No tienes suficientes unidades disponibles.');
  if (next > ECONOMY.maxStack || (next > 0 && !stacks.has(itemId) && stacks.size >= ECONOMY.maxSlots)) throw workflowError(409, 'El inventario no tiene capacidad para estas unidades.');
  if (next === 0) stacks.delete(itemId); else stacks.set(itemId, next);
}
export function changeCoins(balance: number, delta: number) {
  const next = balance + delta;
  if (!Number.isSafeInteger(balance) || !Number.isSafeInteger(delta) || !Number.isSafeInteger(next) || next < 0 || next > ECONOMY.maxCoins) throw workflowError(409, 'Saldo insuficiente o límite de monedas alcanzado.');
  return next;
}
export function craft(stacks: Map<string, number>, recipe: ItemSpec, quantity: number) {
  positiveInteger(quantity);
  if (!recipe.ingredients) throw workflowError(400, 'Este objeto no tiene una receta disponible.');
  // Work on a copy: failed validation never consumes part of a recipe.
  const next = new Map(stacks);
  for (const [itemId, amount] of Object.entries(recipe.ingredients)) changeStack(next, itemId, -amount * quantity);
  changeStack(next, recipe.id, quantity);
  return next;
}
