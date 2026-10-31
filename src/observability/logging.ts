import { STATUS_CODES } from 'node:http';
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';
import { REST, RESTEvents } from 'discord.js';

const context = new AsyncLocalStorage<{ requestId: string }>();
const segments = new Set('api v10 v1 auth discord callback logout me users @me guilds channels members roles messages applications commands interactions webhooks oauth2 token gateway bot work-items knowledge projects collaboration automations audit-logs music search connect queue control settings access permissions admin overview operations jobs retry targets sync unpublish health ready profiles mentorships cases moderation tracks stream team-space prepare summary followups catalog resources type apply-template youtube enable voices'.split(' '));
/** Routes never include query strings, credentials or arbitrary path segments. */
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
interface Fields { operationId?: string; method?: string; route?: string; service?: string; status?: number; durationMs?: number; outcome?: string; command?: string; guildId?: string | null; action?: string; requestId?: string; positionMs?: number; expectedDurationMs?: number; exitCode?: number | null; reason?: string }
export function requestOutcome(status: number): string { return status >= 500 ? 'failed' : status >= 400 ? 'rejected' : status >= 300 ? 'redirected' : 'completed'; }
export function describeEvent(event: string, fields: Fields): string {
  const incoming = event.startsWith('http.in.');
  const label = event.endsWith('.start') ? (incoming ? 'Peticion recibida' : 'Peticion enviada') : event === 'discord.rate-limited' ? 'Discord solicita esperar antes de reintentar' : fields.outcome === 'aborted' ? 'Conexion interrumpida antes de completar la respuesta' : fields.outcome === 'failed' ? 'La operacion fallo' : fields.outcome === 'rejected' ? 'Peticion rechazada' : fields.outcome === 'redirected' ? 'Redireccion enviada' : fields.outcome === 'headers-received' ? 'Cabeceras de respuesta recibidas' : incoming ? 'Respuesta enviada' : event === 'discord.http.response' ? 'Respuesta HTTP de Discord' : 'Operacion completada';
  if (!event.startsWith('http.') && !event.startsWith('discord.')) return event;
  return label;
}
export function formatLog(record: Record<string, unknown>): string {
  const endpoint = [record.method, record.route].filter(Boolean).join(' ');
  const status = typeof record.status === 'number' ? `HTTP ${record.status} ${record.statusLabel ?? ''}`.trim() : '';
  const timing = typeof record.durationMs === 'number' ? `${record.durationMs} ms` : '';
  const context = [record.requestId ? `request=${record.requestId}` : '', record.operationId ? `operation=${record.operationId}` : ''].filter(Boolean).join(' ');
  const known = new Set(['time','level','event','message','method','route','status','statusLabel','durationMs','requestId','operationId','service','outcome','requestBody','responseBody']);
  const extra = Object.fromEntries(Object.entries(record).filter(([key])=>!known.has(key)));
  const summary = [record.time, String(record.level).toUpperCase(), record.service ?? 'backend', record.event, record.message, endpoint, status, timing, context, Object.keys(extra).length ? JSON.stringify(extra) : ''].filter(Boolean).join(' | ');
  const bodies = (['requestBody', 'responseBody'] as const)
    .filter(key => key in record)
    .map(key => `${key === 'requestBody' ? 'REQUEST JSON' : 'RESPONSE JSON'}:\n${JSON.stringify(record[key] ?? null, null, 2)}`);
  return [summary, ...bodies].join('\n');
}
export function logRecord(event: string, fields: Fields = {}) {
  if (process.env.REQUEST_LOGGING === 'false') return;
  const level = fields.outcome === 'failed' || (fields.status ?? 0) >= 500 ? 'error' : fields.outcome === 'aborted' || (fields.status ?? 0) >= 400 ? 'warn' : 'info';
  const record = { time: new Date().toISOString(), level, event, message: describeEvent(event,fields), ...context.getStore(), ...fields,
    ...(fields.status === undefined ? {} : {statusLabel:STATUS_CODES[fields.status] ?? 'Unknown status'}) };
  const output = process.env.LOG_FORMAT === 'pretty' ? formatLog(record) : JSON.stringify(record);
  if (level === 'error') console.error(output); else if (level === 'warn') console.warn(output); else console.info(output);
}
export function traceOperation<T>(operation: () => T): T { return context.run({ requestId: randomUUID() }, operation); }
interface Fields { requestBody?: unknown; responseBody?: unknown }

// Bound both traversal and output, and remove credentials before serialization.
export function safeBody(value: unknown): unknown {
  let remaining = 4096;
  const visit = (item: unknown, depth: number): unknown => {
    if (remaining <= 0) return '[Truncated]';
    if (item === null || typeof item === 'boolean' || typeof item === 'number') { remaining -= 16; return item; }
    if (typeof item === 'string') {
      const length = Math.min(remaining, 1024);
      remaining -= Math.min(item.length, length);
      return item.length > length ? item.slice(0, length) + '[Truncated]' : item;
    }
    if (typeof item !== 'object') return undefined;
    if (Buffer.isBuffer(item)) return '[Binary omitted]';
    if (depth >= 5) return '[Truncated]';
    if (Array.isArray(item)) return item.slice(0, 25).map(child => visit(child, depth + 1));
    const result: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(item).slice(0, 40)) {
      if (remaining <= 0) { result._truncated = true; break; }
      remaining -= key.length;
      result[key.slice(0, 128)] = /token|secret|password|passwd|authorization|cookie|session|api.?key|credential|^code$|^state$/i.test(key)
        ? '[Redacted]' : visit(child, depth + 1);
    }
    return result;
  };
  return visit(value, 0);
}
const elapsed = (start: number) => Math.round((performance.now() - start) * 10) / 10;
export const requestLogging: RequestHandler = (req, res, next) => {
  traceOperation(() => {
    const start = performance.now(), requestId = context.getStore()!.requestId;
    const fields = { requestId, method: req.method, route: safeRoute(req.originalUrl) };
    const includeBodies = process.env.REQUEST_LOGGING !== 'false' && process.env.REQUEST_LOG_BODIES !== 'false'
      && !/^\/api\/auth(?:\/|$)/.test(req.path);
    let responseBody: unknown;
    if (includeBodies) {
      const send = res.send;
      res.send = function (body) {
        if (String(this.getHeader('Content-Type') ?? '').includes('json') && (typeof body === 'string' || Buffer.isBuffer(body))) {
          try { responseBody = safeBody(JSON.parse(body.toString())); }
          catch { responseBody = '[Invalid JSON omitted]'; }
        }
        return send.call(this, body);
      };
    }
    res.setHeader('X-Request-ID', requestId);
    logRecord('http.in.start', fields);
    let finished = false;
    res.once('finish', () => { finished = true; logRecord('http.in.end', { ...fields, status: res.statusCode, durationMs: elapsed(start), outcome: requestOutcome(res.statusCode),
      ...(includeBodies ? { requestBody: safeBody(req.body), responseBody } : {}) }); });
    res.once('close', () => { if (!finished) logRecord('http.in.end', { ...fields, durationMs: elapsed(start), outcome: 'aborted' }); });
    next();
  });
};
export async function observedFetch(service: 'discord-oauth' | 'audius', input: string | URL, init?: RequestInit): Promise<Response> {
  const fields = { operationId: randomUUID(), service, method: init?.method ?? 'GET', route: safeRoute(String(input)) }, start = performance.now();
  logRecord('http.out.start', fields);
  try {
    const response = await fetch(input, init);
    logRecord('http.out.end', { ...fields, status: response.status, durationMs: elapsed(start), outcome: response.status >= 400 ? requestOutcome(response.status) : 'headers-received' });
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
    const fields = { operationId: randomUUID(), service: 'discord', method: options.method, route: safeRoute(options.fullRoute) }, start = performance.now();
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
