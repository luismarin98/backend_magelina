import { KnowledgeArticle } from '../../database/models/KnowledgeArticle.js';
import { WorkItem } from '../../database/models/WorkItem.js';
import { validateArticle, validateVersion } from './rules.js';
import { workflowError } from '../workflow/rules.js';
import type { ArticleFields, CreateArticleInput, KnowledgeAction } from '../../types/contracts.js';
import { hasCode } from '../../types/errors.js';
import { requireModule } from '../settings/service.js';

const nextReview = (now: Date, days: number) => new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
function isChangeAction(action: unknown): action is Exclude<KnowledgeAction, 'created'> {
  return action === 'updated' || action === 'reviewed' || action === 'archived' || action === 'restored';
}

export async function createArticle({ guildId, actorId, body }: { guildId: string; actorId: string; body: unknown }) {
  const settings = await requireModule(guildId, 'knowledge');
  const fields = validateArticle(body);
  const source = await WorkItem.findOne({ _id: (body as CreateArticleInput).sourceItemId, guildId }).lean();
  if (!source) throw workflowError(404, 'Tarea de origen no encontrada.');
  if (source.status !== 'completed') throw workflowError(409, 'Completa la tarea antes de guardar una solucion.');
  const now = new Date();
  try {
    return await KnowledgeArticle.create({ ...fields, guildId, sourceItemId: source._id, createdBy: actorId,
      reviewedAt: now, reviewDueAt: nextReview(now, settings.knowledge.reviewDays), history: [{ actorId, action: 'created', at: now }],
    });
  } catch (error) {
    if (hasCode(error, 11000)) throw workflowError(409, 'Esta tarea ya tiene una solucion. Consultala en Conocimiento.');
    throw error;
  }
}

export async function updateArticle({ guildId, articleId, actorId, body: input }: { guildId: string; articleId: string; actorId: string; body: unknown }) {
  const settings = await requireModule(guildId, 'knowledge');
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw workflowError(400, 'Cambio no valido.');
  const body = input as Record<string, unknown>;
  const { action, version } = body;
  validateVersion(version);
  if (!isChangeAction(action)) throw workflowError(400, 'Accion no valida.');
  let fields: Partial<ArticleFields> & { reviewedAt?: Date; reviewDueAt?: Date; archived?: boolean } = {};
  if (action === 'updated') {
    const { action: _action, ...input } = body;
    fields = validateArticle(input, true);
  } else if (Object.keys(body).some((key) => !['action', 'version'].includes(key))) throw workflowError(400, 'Campos no permitidos.');
  const now = new Date();
  if (action === 'reviewed' || action === 'updated') fields = { ...fields, reviewedAt: now, reviewDueAt: nextReview(now, settings.knowledge.reviewDays) };
  if (action === 'archived') fields.archived = true;
  if (action === 'restored') fields.archived = false;
  const article = await KnowledgeArticle.findOneAndUpdate({ _id: articleId, guildId, version,
    archived: action === 'restored',
  }, {
    $set: fields, $inc: { version: 1 },
    $push: { history: { $each: [{ actorId, action, at: now }], $slice: -100 } },
  }, { new: true, runValidators: true });
  if (!article) throw workflowError(409, 'La solucion no esta disponible, cambio o esta archivada. Actualiza la lista.');
  return article;
}
