import { routeParam } from '../common/input.js';
import type { RequireCapability } from '../permissions/access.js';
import { Router } from 'express';
import { KnowledgeArticle } from '../../database/models/KnowledgeArticle.js';
import { createArticle, updateArticle } from './service.js';
import { escapeSearch } from './rules.js';
import { workflowError } from '../workflow/rules.js';
import { serializeArticle } from '../../api/serialize.js';

export function knowledgeRoutes({ requireCapability }: { requireCapability: RequireCapability }) {
  const router = Router({ mergeParams: true });
  router.get('/', requireCapability('knowledge.read'), async (req, res) => {
    const search = escapeSearch(req.query.q ?? '');
    const { before, archived = 'false', due = 'false' } = req.query;
    if ((before !== undefined && (typeof before !== 'string' || !/^[a-f0-9]{24}$/i.test(before))) ||
        typeof archived !== 'string' || typeof due !== 'string' || !['true', 'false'].includes(archived) || !['true', 'false'].includes(due)) throw workflowError(400, 'Filtros no validos.');
    const articles = await KnowledgeArticle.find({ guildId: routeParam(req, 'guildId'), archived: archived === 'true',
      ...(before ? { _id: { $lt: before } } : {}), ...(due === 'true' ? { reviewDueAt: { $lte: new Date() } } : {}),
      ...(search ? { $or: ['title', 'content', 'tags'].map((field) => ({ [field]: { $regex: search, $options: 'i' } })) } : {}),
    }).sort({ _id: -1 }).limit(21).lean();
    const hasMore = articles.length > 20;
    if (hasMore) articles.pop();
    res.json({ articles: articles.map(serializeArticle), nextCursor: hasMore ? String(articles.at(-1)!._id) : null });
  });
  router.post('/', requireCapability('knowledge.manage'), requireCapability('workflow.read'), async (req, res) => {
    const article = await createArticle({ guildId: routeParam(req, 'guildId'), actorId: req.session.user!.id, body: req.body });
    res.status(201).json({ article: serializeArticle(article) });
  });
  router.patch('/:articleId', requireCapability('knowledge.manage'), async (req, res) => {
    if (!/^[a-f0-9]{24}$/i.test(routeParam(req, 'articleId'))) throw workflowError(400, 'ID de solucion no valido.');
    const article = await updateArticle({ guildId: routeParam(req, 'guildId'), articleId: routeParam(req, 'articleId'), actorId: req.session.user!.id, body: req.body });
    res.json({ article: serializeArticle(article) });
  });
  return router;
}
