import { createHash, createHmac } from 'node:crypto';
import { workflowError } from '../workflow/rules.js';

export const CYCLE_MS = 6 * 60 * 60 * 1000;
export interface ExpeditionDefinition {
  templateId: string; title: string; description: string; minLevel: number;
  steps: { title: string; description: string; seconds: number; material: 'wood' | 'herb' }[];
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
