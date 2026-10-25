import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';
import { REST, RESTEvents } from 'discord.js';

const context = new AsyncLocalStorage<{ requestId: string }>();
const segments = new Set('api v10 v1 auth discord callback logout me users @me guilds channels members roles messages applications commands interactions webhooks oauth2 token gateway bot work-items knowledge projects collaboration automations audit-logs music search connect queue control settings access permissions admin overview operations jobs retry targets sync unpublish health ready profiles mentorships cases moderation tracks stream'.split(' '));
/** Logs never include query strings, credentials, request bodies or arbitrary path segments. */
export function safeRoute(value: string): string {
  let pathname: string;
  try { pathname = new URL(value, 'https://redacted.invalid').pathname; } catch { return '/:invalid'; }
  const parts = pathname.split('/').filter(Boolean);
  const secretRoute = parts.findIndex(part => part === 'webhooks' || part === 'interactions');
  return '/' + parts.slice(0, 16).map((part, index) => {
    if (secretRoute >= 0 && index === secretRoute + 2) return ':redacted';
    if (segments.has(part)) return part;
    return /^\d{17,20}$/.test(part) || /^[a-f\d]{24}$/i.test(part) ? ':id' : ':value';
  }).join('/');
}
interface Fields { method?: string; route?: string; service?: string; status?: number; durationMs?: number; outcome?: string; command?: string; guildId?: string | null; action?: string; requestId?: string; positionMs?: number; expectedDurationMs?: number; exitCode?: number | null; reason?: string }
export function logRecord(event: string, fields: Fields = {}) {
  if (process.env.REQUEST_LOGGING === 'false') return;
  const level = fields.outcome === 'failed' || (fields.status ?? 0) >= 500 ? 'error' : (fields.status ?? 0) >= 400 ? 'warn' : 'info';
  const record = JSON.stringify({ time: new Date().toISOString(), level, event, ...context.getStore(), ...fields });
  if (level === 'error') console.error(record); else if (level === 'warn') console.warn(record); else console.info(record);
}
export function traceOperation<T>(operation: () => T): T { return context.run({ requestId: randomUUID() }, operation); }
const elapsed = (start: number) => Math.round((performance.now() - start) * 10) / 10;
export const requestLogging: RequestHandler = (req, res, next) => {
  traceOperation(() => {
    const start = performance.now(), requestId = context.getStore()!.requestId;
    const fields = { requestId, method: req.method, route: safeRoute(req.originalUrl) };
    res.setHeader('X-Request-ID', requestId);
    logRecord('http.in.start', fields);
    let finished = false;
    res.once('finish', () => { finished = true; logRecord('http.in.end', { ...fields, status: res.statusCode, durationMs: elapsed(start), outcome: 'completed' }); });
    res.once('close', () => { if (!finished) logRecord('http.in.end', { ...fields, durationMs: elapsed(start), outcome: 'aborted' }); });
    next();
  });
};
export async function observedFetch(service: 'discord-oauth' | 'audius', input: string | URL, init?: RequestInit): Promise<Response> {
  const fields = { service, method: init?.method ?? 'GET', route: safeRoute(String(input)) }, start = performance.now();
  logRecord('http.out.start', fields);
  try {
    const response = await fetch(input, init);
    logRecord('http.out.end', { ...fields, status: response.status, durationMs: elapsed(start), outcome: 'headers-received' });
    return response;
  } catch (error) {
    logRecord('http.out.end', { ...fields, durationMs: elapsed(start), outcome: 'failed' });
    throw error;
  }
}
const observed = new WeakSet<REST>();
export function observeDiscordRest(rest: REST): REST {
  if (observed.has(rest)) return rest;
  observed.add(rest);
  const request = rest.request.bind(rest);
  rest.request = async options => {
    const fields = { service: 'discord', method: options.method, route: safeRoute(options.fullRoute) }, start = performance.now();
    logRecord('http.out.start', fields);
    try {
      const response = await request(options);
      logRecord('http.out.end', { ...fields, durationMs: elapsed(start), outcome: 'completed' });
      return response;
    } catch (error) {
      logRecord('http.out.end', { ...fields, durationMs: elapsed(start), outcome: 'failed' });
      throw error;
    }
  };
  rest.on(RESTEvents.Response, (request, response) => { logRecord('discord.http.response', { service: 'discord', method: request.method, route: safeRoute(request.path), status: response.status }); });
  rest.on(RESTEvents.RateLimited, info => { logRecord('discord.rate-limited', { service: 'discord', method: info.method, route: safeRoute(info.route), status: 429 }); });
  return rest;
}
