import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { REST } from 'discord.js';
import { logRecord, observedFetch, observeDiscordRest, requestLogging, safeRoute, requestOutcome, formatLog } from '../src/observability/logging.js';

function capture(t: test.TestContext) {
  const previous = process.env.REQUEST_LOGGING;
  const previousFormat = process.env.LOG_FORMAT; process.env.LOG_FORMAT = 'json';
  t.after(()=>{if(previousFormat === undefined) delete process.env.LOG_FORMAT; else process.env.LOG_FORMAT=previousFormat;});
  process.env.REQUEST_LOGGING = 'true';
  t.after(() => { if (previous === undefined) delete process.env.REQUEST_LOGGING; else process.env.REQUEST_LOGGING = previous; });
  const records: string[] = [];
  for (const method of ['info', 'warn', 'error'] as const) t.mock.method(console, method, (...args: unknown[]) => { records.push(args.join(' ')); });
  return records;
}
test('routes remove queries, credentials, unknown segments and Discord interaction/webhook tokens', () => {
  assert.equal(safeRoute('https://user:password@discord.com/api/v10/oauth2/token?code=secret&state=private'), '/api/v10/oauth2/token');
  assert.equal(safeRoute('/api/v10/webhooks/100000000000000001/token?wait=true'), '/api/v10/webhooks/:id/:redacted');
  assert.equal(safeRoute('/interactions/100000000000000001/bot/callback'), '/interactions/:id/:redacted/callback');
  assert.equal(safeRoute('/api/sensitive-private-string'), '/api/:value');
});
test('incoming requests correlate outgoing calls and never log body, cookies or authorization', async t => {
  const records = capture(t), actualFetch = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => String(input).startsWith('https://discord.com/') ? new Response('{}', { status: 200 }) : actualFetch(input, init));
  const app = express(); app.use(requestLogging); app.use(express.json());
  app.post('/api/auth/discord/callback', async (_req, res) => {
    await observedFetch('discord-oauth', 'https://discord.com/api/v10/oauth2/token?api_key=private-query', { method: 'POST', headers: { Authorization: 'Bearer private-bearer' }, body: 'client_secret=private-client' });
    res.status(201).json({ ok: true });
  });
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  try {
    const response = await actualFetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/auth/discord/callback?code=private-code&state=private-state`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: 'bot.sid=private-cookie' }, body: JSON.stringify({ password: 'private-password' }) });
    const parsed = records.map(record => JSON.parse(record));
    assert.equal(parsed.length, 4);
    assert.ok(parsed.every(record => record.requestId === response.headers.get('x-request-id')));
    assert.equal(parsed.at(-1).status, 201);
    assert.ok(parsed.at(-1).durationMs >= 0);
    assert.ok(!records.join('\n').includes('private-'));
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
test('outgoing failures are logged without changing their exceptions or printing secrets', async t => {
  const records = capture(t), error = new Error('private-token');
  t.mock.method(globalThis, 'fetch', async () => { throw error; });
  await assert.rejects(observedFetch('audius', 'https://api.audius.co/v1/tracks?api_key=private-key'), value => value === error);
  assert.equal(JSON.parse(records.at(-1)!).outcome, 'failed');
  assert.ok(!records.join('\n').includes('private-'));
});
test('Discord REST instrumentation is idempotent and preserves successful and failed requests', async t => {
  const records = capture(t), rest = new REST();
  let fail = false;
  const error = new Error('private-discord-token');
  t.mock.method(rest, 'request', async () => { if (fail) throw error; return { ok: true }; });
  observeDiscordRest(rest); observeDiscordRest(rest);
  assert.deepEqual(await rest.get('/gateway/bot'), { ok: true });
  assert.equal(records.length, 2);
  fail = true;
  await assert.rejects(rest.get('/webhooks/100000000000000001/private-token'), value => value === error);
  assert.equal(records.length, 4);
  assert.equal(JSON.parse(records.at(-1)!).outcome, 'failed');
  assert.ok(!records.join('\n').includes('private-'));
});
test('request logging can be disabled without changing application behavior', t => {
  const records = capture(t);
  process.env.REQUEST_LOGGING = 'false';
  logRecord('test.event');
  assert.equal(records.length, 0);
});

test('HTTP results distinguish redirects, rejection and server failure',()=>{
 assert.equal(requestOutcome(200),'completed');assert.equal(requestOutcome(302),'redirected');
 assert.equal(requestOutcome(403),'rejected');assert.equal(requestOutcome(503),'failed');
 assert.equal(safeRoute('/api/guilds/100000000000000001/team-space/summary?secret=x'),'/api/guilds/:id/team-space/summary');
});
test('readable output includes endpoint, status, duration and correlation',()=>{
 const line=formatLog({time:'2026-10-27T22:00:00Z',level:'warn',event:'http.in.end',message:'Peticion rechazada',method:'POST',route:'/api/guilds/:id/team-space/prepare',status:403,statusLabel:'Forbidden',durationMs:12.5,requestId:'request-test'});
 assert.ok(line.includes('Peticion rechazada'));assert.ok(line.includes('HTTP 403 Forbidden'));assert.ok(line.includes('12.5 ms'));assert.ok(line.includes('request=request-test'));
});
test('JSON logs include a readable explanation and outgoing operation correlation',async t=>{
 const records=capture(t);t.mock.method(globalThis,'fetch',async()=>new Response('{}',{status:403}));
 await observedFetch('audius','https://api.audius.co/v1/tracks?token=private-token');
 const [start,end]=records.map(row=>JSON.parse(row));assert.equal(start.operationId,end.operationId);assert.ok(start.operationId);
 assert.equal(end.statusLabel,'Forbidden');assert.equal(end.outcome,'rejected');assert.equal(end.message,'Peticion rechazada');
 assert.ok(!records.join('').includes('private-token'));
});
