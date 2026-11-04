import { createHash, createHmac } from 'node:crypto';
import { workflowError } from '../workflow/rules.js';

export const CYCLE_MS = 6 * 60 * 60 * 1000;
export interface ExpeditionDefinition {
  templateId: string; title: string; description: string; minLevel: number;
  steps: { title: string; description: string; seconds: number; material: 'wood' | 'herb'; encounter?: EnemyEncounter }[];
}
export const expeditionCycle = (now: Date) => Math.floor(now.getTime() / CYCLE_MS);
export function generateExpeditions(guildId: string, cycle: number): ExpeditionDefinition[] {
  const digest = createHash('sha256').update(`${guildId}:${cycle}:v1`).digest();
  const places = ['Bosque del Alba', 'Sendero de los Sauces', 'Colinas del Viento', 'Ribera Serena', 'Arboleda del Eco'];
  const templates = [
    { id: 'exploration', title: 'Reconocer', description: 'Reconoce una ruta y reúne recursos para el gremio.', minLevel: 1 },
    { id: 'gathering', title: 'Recolectar en', description: 'Localiza provisiones y materiales aprovechables.', minLevel: 1 },
    { id: 'escort', title: 'Acompañar una caravana por', description: 'Ayuda a una caravana a recorrer un tramo poco conocido.', minLevel: 2 },
  ];
  return templates.map((template, index) => {
    const place = places[digest[index]! % places.length];
    return { templateId: template.id, title: `${template.title} ${place}`, description: template.description, minLevel: template.minLevel,
      steps: [
        { title: 'Reconocer el terreno', description: `Has alcanzado ${place}. Decide cómo avanzar por sus alrededores.`, seconds: 180 + (digest[index + 3]! % 3) * 60, material: 'wood' },
        { title: 'Explorar y regresar', description: 'Encuentras una zona con provisiones. Elige cómo completar el recorrido.', seconds: 180 + (digest[index + 6]! % 3) * 60, material: 'herb' },
      ] };
  });
}
export function resolveExpeditionStep(seed: string, stage: number, choice: unknown) {
  if (choice !== 'careful' && choice !== 'bold') throw workflowError(400, 'Elige avanzar con cautela o explorar a fondo.');
  const roll = createHmac('sha256', seed).update(`${stage}:${choice}`).digest().readUInt32BE(0) / 0x100000000;
  const success = choice === 'careful' || roll < 0.65;
  return { choice, quantity: success ? choice === 'bold' ? 3 : 1 : 0, experience: success ? choice === 'bold' ? 9 : 4 : 2,
    event: success ? choice === 'bold' ? 'La exploración dio fruto: encontraste recursos adicionales.' : 'Avanzaste con seguridad y reuniste algunos recursos.' : 'Un contratiempo te obligó a retroceder sin recoger materiales. Conservas tus pertenencias.' };
}

export interface EnemyEncounter { name: string; level: number; fightChance: number; avoidChance: number }
// Snapshot encounters when accepting: future configuration or level changes cannot reroll them.
export function prepareEncounters(definition: ExpeditionDefinition, seed: string, level: number): ExpeditionDefinition {
  const enemies = ['Lobo del sendero', 'Jabal\u00ed territorial', 'Bandido errante'];
  return { ...definition, steps: definition.steps.map((step, stage) => {
    const digest = createHmac('sha256', seed).update(`encounter:${stage}`).digest();
    if (digest[0]! % 100 >= 45) return { ...step };
    const enemyLevel = definition.minLevel + digest[1]! % 3;
    return { ...step, encounter: { name: enemies[digest[2]! % enemies.length]!, level: enemyLevel,
      fightChance: Math.max(35, Math.min(90, 65 + (level - enemyLevel) * 5)), avoidChance: 80 } };
  }) };
}
export function resolveEnemyEncounter(seed: string, stage: number, choice: unknown, encounter: EnemyEncounter) {
  if (choice !== 'fight' && choice !== 'avoid') throw workflowError(400, 'Elige combatir, evitar al enemigo o retirarte.');
  const roll = createHmac('sha256', seed).update(`enemy:${stage}:${choice}`).digest().readUInt32BE(0) / 0x100000000;
  const success = roll * 100 < (choice === 'fight' ? encounter.fightChance : encounter.avoidChance);
  return { choice, success, failed: choice === 'avoid' && !success,
    quantity: choice === 'fight' && success ? 3 : 0, experience: success ? choice === 'fight' ? 12 : 4 : 0,
    event: choice === 'fight' ? success ? `Venciste a ${encounter.name} y recuperaste materiales.` : `No lograste vencer a ${encounter.name}. Perdiste parte del bot\u00edn pendiente y continuaste.`
      : success ? `Evitaste a ${encounter.name} y continuaste el recorrido.` : `No pudiste evitar a ${encounter.name}. El encargo termin\u00f3 sin recompensas.` };
}

export interface ExpeditionLoot { itemId: string; quantity: number }
export function rollEnemyLoot(seed: string, stage: number, enemy: EnemyEncounter): ExpeditionLoot[] {
  const digest = createHmac('sha256', seed).update(`loot:v1:${stage}`).digest();
  const roll = digest[0]! % 100;
  const itemId = enemy.name === 'Bandido errante' ? roll < 60 ? 'metal-scrap' : roll < 90 ? 'recovered-sword' : 'recovered-shield'
    : enemy.name === 'Lobo del sendero' ? roll < 60 ? 'enemy-fang' : 'enemy-hide'
    : 'enemy-hide';
  return [{ itemId, quantity: itemId.startsWith('recovered-') ? 1 : 1 + digest[1]! % 2 }];
}
