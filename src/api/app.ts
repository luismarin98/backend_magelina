import { apiLimiter } from '../modules/operations/limiter.js';
import { logEvent } from '../modules/operations/service.js';
import type { ErrorRequestHandler } from 'express';
import type { AppDependencies } from '../types/http.js';
import express from 'express';
import cors from 'cors';
import session from 'express-session';
import { createSessionStore } from '../auth/session-store.js';
import mongoose from 'mongoose';
import { authRoutes } from '../auth/routes.js';
import { managementRoutes } from './management.js';
import { isDatabaseReady } from '../database/connection.js';
import { serializeBot } from '../discord/images.js';
import { requestLogging } from '../observability/logging.js';

export function createApp({ config, bot, isStopping }: AppDependencies) {
  const app = express();
  app.disable('x-powered-by');
  app.use(requestLogging);
  if (config.trustProxy) app.set('trust proxy', 1);
  app.use(cors({ origin: config.dashboardOrigin, credentials: true }));
  app.use(express.json({ limit: '32kb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.get('/api/ready', (_req, res) => {
    const ready = !isStopping() && isDatabaseReady() && bot.isReady();
    res.status(ready ? 200 : 503).json({ status: ready ? 'ready' : 'unavailable' });
  });

  app.use('/api', apiLimiter());
  app.use('/api', (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  app.use('/api', (req, res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.get('origin') !== config.dashboardOrigin) {
      return res.status(403).json({ error: 'Origen de solicitud no permitido.' });
    }
    next();
  });
  app.get('/api/bot', (_req, res) => { res.json({ bot: serializeBot(bot.user) }); });
  app.use(session({
    name: 'bot.sid', secret: config.sessionSecret, resave: false, saveUninitialized: false,
    store: createSessionStore(mongoose.connection.getClient(), config.sessionSecret),
    cookie: { httpOnly: true, secure: config.production, sameSite: 'lax', maxAge: 8 * 60 * 60 * 1000 },
  }));
  app.use('/api/auth', authRoutes(config));
  app.use('/api', managementRoutes({ bot, config }));

  app.use((_req, res) => {
    res.status(404).json({ error: 'Endpoint no encontrado.' });
  });

  const handleError: ErrorRequestHandler = (cause: unknown, _req, res, _next) => {
    const error = {
      status: typeof cause === 'object' && cause !== null && 'status' in cause && typeof cause.status === 'number' ? cause.status : undefined,
      publicMessage: typeof cause === 'object' && cause !== null && 'publicMessage' in cause && typeof cause.publicMessage === 'string' ? cause.publicMessage : undefined,
    };
    const status = error.status !== undefined && [400, 401, 403, 404, 409, 413, 429, 502, 503].includes(error.status) ? error.status : 500;
    if (status === 500) { console.error('Error interno en la API.'); void logEvent('api.error', 'Se produjo un error interno en la API.'); }
    res.status(status).json({
      error: error.publicMessage && status !== 500 ? error.publicMessage : status === 400 ? 'Solicitud invalida.' : status === 401 ? 'La sesion ha expirado. Inicia sesion de nuevo.' : status === 502 ? 'Discord no esta disponible. Intentalo de nuevo.' : status === 413 ? 'Solicitud demasiado grande.' : 'Error interno del servidor.',
    });
  };
  app.use(handleError);

  return app;
}
