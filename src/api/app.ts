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

  app.get('/', (_req, res) => {
    res.type('html').send(`<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#101827">
  <title>Backend Magelina | Estado del servicio</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #101827; color: #e5edf7; }
    * { box-sizing: border-box; }
    body { min-height: 100vh; margin: 0; display: grid; place-items: center; padding: 24px; background: radial-gradient(ellipse at 50% 0%, #233554 0, #101827 58%); }
    main { width: min(100%, 620px); padding: clamp(28px, 7vw, 52px); border: 1px solid #34445b; border-radius: 24px; background: rgb(21 32 49 / 92%); box-shadow: 0 24px 80px rgb(0 0 0 / 28%); }
    .eyebrow { margin: 0 0 20px; color: #9bb4d2; font-size: .78rem; font-weight: 700; letter-spacing: .16em; text-transform: uppercase; }
    h1 { margin: 0; font-size: clamp(2rem, 8vw, 3.4rem); line-height: 1.08; letter-spacing: -.045em; }
    .intro { margin: 18px 0 30px; color: #b8c6d8; font-size: 1.05rem; line-height: 1.7; }
    .status { display: flex; align-items: center; gap: 12px; padding: 16px; border: 1px solid #34445b; border-radius: 14px; background: #111c2b; }
    .indicator { width: 11px; height: 11px; flex: 0 0 auto; border-radius: 50%; background: #fbbf24; box-shadow: 0 0 16px currentColor; color: #fbbf24; }
    .indicator.ready { background: #4ade80; color: #4ade80; }
    .indicator.unavailable { background: #fb7185; color: #fb7185; }
    #status-title { margin: 0; font-size: 1rem; font-weight: 700; }
    #status-detail { margin: 4px 0 0; color: #9aabc0; font-size: .9rem; line-height: 1.5; }
    .links { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 24px; }
    .links a { padding: 11px 15px; border: 1px solid #435570; border-radius: 10px; color: #d9e8fa; font-size: .9rem; font-weight: 650; text-decoration: none; transition: background .15s ease, border-color .15s ease; }
    .links a:hover, .links a:focus-visible { border-color: #7da7df; background: #233554; }
    footer { margin-top: 30px; color: #8293a9; font-size: .82rem; }
  </style>
</head>
<body>
  <main>
    <p class="eyebrow">Backend Magelina</p>
    <h1>Proyecto desplegado</h1>
    <p class="intro">El servicio web está publicado y responde correctamente. Aquí puedes consultar en tiempo real la disponibilidad de sus servicios.</p>
    <section class="status" aria-live="polite" aria-atomic="true">
      <span id="indicator" class="indicator"></span>
      <div>
        <p id="status-title">Verificando servicios…</p>
        <p id="status-detail">Consultando el estado de la API.</p>
      </div>
    </section>
    <nav class="links" aria-label="Estado del servicio">
      <a href="/api/health">Salud de la API</a>
      <a href="/api/ready">Disponibilidad completa</a>
    </nav>
    <footer>El estado se actualiza automáticamente cada 15 segundos.</footer>
  </main>
  <script>
    const indicator = document.getElementById('indicator');
    const title = document.getElementById('status-title');
    const detail = document.getElementById('status-detail');
    async function updateStatus() {
      try {
        const response = await fetch('/api/ready', { cache: 'no-store' });
        const result = await response.json();
        if (response.ok && result.status === 'ready') {
          indicator.className = 'indicator ready';
          title.textContent = 'Todos los servicios están operativos';
          detail.textContent = 'La API, la base de datos y el bot están disponibles.';
        } else {
          indicator.className = 'indicator unavailable';
          title.textContent = 'Servicios todavía no disponibles';
          detail.textContent = 'El proyecto está desplegado, pero la base de datos o el bot no están listos.';
        }
      } catch {
        indicator.className = 'indicator unavailable';
        title.textContent = 'No se pudo verificar el estado';
        detail.textContent = 'La página está publicada, pero no fue posible consultar la API.';
      }
    }
    void updateStatus();
    window.setInterval(updateStatus, 15000);
  </script>
</body>
</html>`);
  });

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
    cookie: { httpOnly: true, secure: config.production, sameSite: config.production ? 'none' : 'lax', maxAge: 8 * 60 * 60 * 1000 },
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
