import { workflowError } from '../workflow/rules.js';
import type { Request } from 'express';

export function routeParam(req: Pick<Request, 'params'>, key: string): string {
  const value = req.params[key];
  if (typeof value !== 'string' || !value) throw workflowError(400, 'Parametro de ruta no valido.');
  return value;
}

export function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some((key) => !keys.includes(key))) throw workflowError(400, 'Campos no validos.');
  return value as Record<string, unknown>;
}
export function text(value: unknown, max: number, allowEmpty = false): string {
  if (typeof value !== 'string' || (!allowEmpty && !value.trim()) || value.trim().length > max) throw workflowError(400, `Texto no valido (maximo ${max} caracteres).`);
  return value.trim();
}
export function strings(value: unknown, max: number, length: number): string[] {
  if (!Array.isArray(value) || value.length > max) throw workflowError(400, 'Lista demasiado larga.');
  return [...new Set(value.map((item: unknown) => text(item, length)))];
}
export function version(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw workflowError(400, 'Version no valida.'); return value;
}
export function boolean(value: unknown): boolean {
  if (typeof value !== 'boolean') throw workflowError(400, 'Se requiere un valor booleano.'); return value;
}
export function id(value: unknown, snowflake = false): string {
  if (typeof value !== 'string' || !(snowflake ? /^\d{17,20}$/ : /^[a-f0-9]{24}$/i).test(value)) throw workflowError(400, 'ID no valido.'); return value;
}
export function date(value: unknown): Date | null {
  if (value === null) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) throw workflowError(400, 'Fecha ISO con zona horaria no valida.'); return new Date(value);
}
export function cursor(value: unknown): { _id?: { $lt: string } } { return value === undefined ? {} : { _id: { $lt: id(value) } }; }
export function page<T extends { _id: unknown }>(items: T[], size = 30) {
  const more = items.length > size; if (more) items.pop(); return { items, nextCursor: more ? String(items.at(-1)!._id) : null };
}
