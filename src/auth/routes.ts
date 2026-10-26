import { effectiveRole } from '../modules/operations/roles.js';
import { safeReturnPath } from './return-path.js';
import type { RequestHandler } from 'express';
import type { Session } from 'express-session';
import type { Config } from '../config/env.js';
import { Router } from 'express';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { exchangeCode, discordRequest } from './discord.js';
import { serializeSessionUser } from '../discord/images.js';
import type { SessionUser } from '../types/contracts.js';

const save = (session: Session) => new Promise<void>((resolve, reject) => session.save((error) => error ? reject(error) : resolve()));
const regenerate = (session: Session) => new Promise<void>((resolve, reject) => session.regenerate((error) => error ? reject(error) : resolve()));

export const requireUser: RequestHandler = (req, res, next) => {
  if (!req.session.user || !req.session.accessToken || !req.session.tokenExpiresAt || Date.now() >= req.session.tokenExpiresAt) {
    return res.status(401).json({ error: 'Inicia sesion con Discord.' });
  }
  next();
}

export function authRoutes(config: Config) {
  const router = Router();
  const profiles = new Map<string, { user: SessionUser; checkedAt: number }>();
  router.get('/discord', async (req, res) => {
    req.session.oauthState = randomBytes(32).toString('hex');
    req.session.oauthStartedAt = Date.now();
    req.session.oauthReturnTo = safeReturnPath(req.query.returnTo);
    await save(req.session);
    const params = new URLSearchParams({
      client_id: config.discordClientId,
      redirect_uri: config.discordRedirectUri,
      response_type: 'code', scope: 'identify guilds', state: req.session.oauthState,
    });
    res.redirect(`https://discord.com/oauth2/authorize?${params}`);
  });

  router.get('/discord/callback', async (req, res) => {
    const { state, code } = req.query;
    const expected = req.session.oauthState;
    const started = req.session.oauthStartedAt;
    const returnTo = safeReturnPath(req.session.oauthReturnTo);
    delete req.session.oauthState;
    delete req.session.oauthStartedAt;
    delete req.session.oauthReturnTo;
    await save(req.session);
    if (typeof state !== 'string' || !/^[a-f0-9]{64}$/.test(state) || typeof expected !== 'string' || !started || Date.now() - started > 600000 ||
        state.length !== expected.length || !timingSafeEqual(Buffer.from(state), Buffer.from(expected)) || typeof code !== 'string') {
      return res.redirect(`${config.dashboardOrigin}/?auth=failed`);
    }
    try {
      const token = await exchangeCode(code, config);
      if (typeof token.access_token !== 'string' || !Number.isFinite(token.expires_in) || token.expires_in <= 0) throw new Error('Invalid token');
      const user = await discordRequest('/users/@me', token.access_token);
      await regenerate(req.session);
      req.session.user = serializeSessionUser(user);
      req.session.profileUpdatedAt = Date.now();
      req.session.accessToken = token.access_token;
      req.session.tokenExpiresAt = Date.now() + token.expires_in * 1000;
      await save(req.session);
      res.redirect(`${config.dashboardOrigin}${returnTo}`);
    } catch {
      res.redirect(`${config.dashboardOrigin}/?auth=failed`);
    }
  });

  router.get('/me', requireUser, async (req, res) => {
    const cached = profiles.get(req.sessionID);
    let user = cached?.user ?? req.session.user!;
    const checkedAt = cached?.checkedAt ?? req.session.profileUpdatedAt;
    if (!checkedAt || Date.now() - checkedAt >= 5 * 60 * 1000) {
      try {
        const profile = await discordRequest('/users/@me', req.session.accessToken!);
        if (profile.id !== req.session.user!.id) throw Object.assign(new Error('Identidad de sesion no valida.'), { status: 401 });
        user = serializeSessionUser(profile);
      } catch (cause) {
        if (typeof cause === 'object' && cause !== null && 'status' in cause && cause.status === 401) throw cause;
        // Un fallo temporal no impide usar el perfil previamente verificado.
      }
      if (profiles.size >= 1000) profiles.delete(profiles.keys().next().value!);
      // Refrescar imagenes no modifica la sesion ni renueva el vencimiento de la cookie.
      profiles.set(req.sessionID, { user, checkedAt: Date.now() });
    }
    res.json({ user, role: await effectiveRole(req.session.user!.id, config) });
  });

  router.post('/logout', (req, res, next) => {
    profiles.delete(req.sessionID);
    req.session.destroy((error) => {
      if (error) return next(error);
      res.clearCookie('bot.sid', { path: '/', httpOnly: true, sameSite: config.production ? 'none' : 'lax', secure: config.production });
      res.status(204).end();
    });
  });
  return router;
}
