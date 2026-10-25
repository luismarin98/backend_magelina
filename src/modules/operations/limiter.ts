import type { RequestHandler } from 'express';
import { getControls } from './service.js';

/** Limite por IP e instancia. Las credenciales y los cuerpos no se almacenan. */
export function apiLimiter(): RequestHandler {
  const buckets = new Map<string, { count: number; until: number }>();
  return async (req, res, next) => {
    const now = Date.now(); const key = req.ip || req.socket.remoteAddress || 'unknown';
    if (buckets.size > 1000) for (const [ip, bucket] of buckets) if (bucket.until <= now) buckets.delete(ip);
    const maximum = (await getControls()).requestsPerMinute;
    let bucket = buckets.get(key);
    if (!bucket || bucket.until <= now) { if (buckets.size >= 10000 && !buckets.has(key)) return res.status(429).json({ error: 'Demasiadas solicitudes. Intentalo mas tarde.' }); bucket = { count: 0, until: now + 60000 }; buckets.set(key, bucket); }
    bucket.count++;
    if (bucket.count > maximum) { res.set('Retry-After', String(Math.ceil((bucket.until - now) / 1000))); return res.status(429).json({ error: 'Limite de solicitudes alcanzado. Espera un minuto.' }); }
    next();
  };
}
