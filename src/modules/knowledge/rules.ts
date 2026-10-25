import { workflowError } from '../workflow/rules.js';
import type { ArticleFields } from '../../types/contracts.js';

export function validateArticle(input: unknown, editing = false): ArticleFields {
  const body = input as Record<string, unknown> | null;
  const allowed = editing ? ['title', 'content', 'tags', 'version'] : ['title', 'content', 'tags', 'sourceItemId'];
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some((key) => !allowed.includes(key))) {
    throw workflowError(400, 'Datos de solucion no validos.');
  }
  if (typeof body.title !== 'string' || !body.title.trim() || body.title.trim().length > 160 ||
      typeof body.content !== 'string' || !body.content.trim() || body.content.trim().length > 8000) {
    throw workflowError(400, 'Introduce un titulo de hasta 160 caracteres y una solucion de hasta 8000.');
  }
  if (!Array.isArray(body.tags) || body.tags.length > 8 || body.tags.some((tag) => typeof tag !== 'string' || !tag.trim() || tag.trim().length > 30)) {
    throw workflowError(400, 'Usa hasta 8 etiquetas de entre 1 y 30 caracteres.');
  }
  if (editing) validateVersion(body.version);
  else if (typeof body.sourceItemId !== 'string' || !/^[a-f0-9]{24}$/i.test(body.sourceItemId)) throw workflowError(400, 'Tarea de origen no valida.');
  return { title: body.title.trim(), content: body.content.trim(), tags: [...new Set(body.tags.map((tag) => tag.trim().toLowerCase()))] };
}

export function validateVersion(version: unknown): asserts version is number {
  if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 0) throw workflowError(400, 'Version no valida.');
}

export function escapeSearch(value: unknown) {
  if (typeof value !== 'string' || value.length > 120) throw workflowError(400, 'La busqueda admite hasta 120 caracteres.');
  return value.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
