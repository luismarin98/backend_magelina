import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import express from 'express';
import session from 'express-session';
import type { AddressInfo } from 'node:net';
import { pngImage } from '../src/modules/adventure/item-images.js';
import { adventureItemRoutes, itemInput } from '../src/modules/adventure/items.js';
import { AdventureItem } from '../src/database/models/AdventureItem.js';
import { AdventureCharacter, AdventureMembership } from '../src/database/models/Adventure.js';

function png(width = 2, height = 2) {
  const table = Array.from({ length: 256 }, (_, value) => { let c = value; for (let bit = 0; bit < 8; bit++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const chunk = (name: string, content: Buffer) => {
    const bytes = Buffer.concat([Buffer.from(name), content]); let crc = 0xffffffff;
    for (const value of bytes) crc = table[(crc ^ value) & 255] ^ (crc >>> 8);
    const size = Buffer.alloc(4), checksum = Buffer.alloc(4); size.writeUInt32BE(content.length); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([size, bytes, checksum]);
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.alloc((width * 4 + 1) * height))), chunk('IEND', Buffer.alloc(0))]);
}
const dataUrl = (bytes: Buffer) => `data:image/png;base64,${bytes.toString('base64')}`;

test('item images validate raster dimensions, checksum, compressed content and allowed fields', () => {
  const valid = png(); assert.deepEqual(pngImage(dataUrl(valid)), valid);
  const corrupt = Buffer.from(valid); corrupt[valid.length - 1] ^= 1;
  for (const invalid of [dataUrl(corrupt), dataUrl(png(513, 1)), 'https://example.com/file.png', 'data:image/svg+xml;base64,PHN2Zy8+', dataUrl(Buffer.from('not png'))]) assert.throws(() => pngImage(invalid));
  assert.throws(() => itemInput({ name: 'Espada', description: 'Prueba', category: 'equipment', icon: 'sword', damage: 999 }));
});

test('private item drafts, global cosmetic review and image visibility enforce ownership without minting items', async t => {
  const creator = '100000000000000001', visitor = '100000000000000002', guildId = '100000000000000003';
  let actorId = creator, owner = false, registered = true;
  const records = new Map<string, any>();
  const matches = (row: any, filter: any): boolean => Object.entries(filter).every(([field, value]: [string, any]) => field === '$or' ? value.some((part: any) => matches(row, part)) : value && typeof value === 'object' && '$in' in value ? value.$in.includes(row[field]) : value && typeof value === 'object' && '$lt' in value ? row[field] < value.$lt : row[field] === value);
  for (const model of [AdventureCharacter, AdventureMembership]) t.mock.method(model, 'findOne', (() => ({ lean: async () => registered ? ({ userId: actorId, guildId }) : null })) as never);
  t.mock.method(AdventureItem, 'create', (async (fields: any) => { const row = { ...fields, _id: String(records.size + 1).padStart(24, '0'), status: 'draft', version: 0, hasImage: Boolean(fields.imageData), reviewReason: null }; records.set(row._id, row); return row; }) as never);
  t.mock.method(AdventureItem, 'find', ((filter: any) => ({ sort: () => ({ limit: (limit: number) => ({ lean: async () => [...records.values()].filter(row => matches(row, filter)).reverse().slice(0, limit) }) }) })) as never);
  t.mock.method(AdventureItem, 'findOne', ((filter: any) => ({ select: async () => [...records.values()].find(row => matches(row, filter)) ?? null })) as never);
  t.mock.method(AdventureItem, 'findOneAndUpdate', (async (filter: any, update: any) => { const row = [...records.values()].find(row => matches(row, filter)); if (!row) return null; Object.assign(row, update.$set); row.version++; return row; }) as never);
  const app = express(); app.use(express.json({ limit: '768kb' })); app.use(session({ secret: 'items-test', resave: false, saveUninitialized: false }));
  app.use((req, _res, next) => { req.session.user = { id: actorId, username: 'player', name: 'Player' }; req.managedGuild = { id: guildId } as any; req.guildAccess = { source: owner ? 'bot-owner' : 'delegated', canConfigure: false, capabilities: [] }; next(); });
  app.use('/items', adventureItemRoutes());
  app.use(((error, _req, res, _next) => res.status(error.status ?? 500).json({ error: error.publicMessage ?? error.message })) as express.ErrorRequestHandler);
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/items`;
  const write = (path: string, body: unknown, method = 'POST') => fetch(base + path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const fields = { name: 'Corona de hojas', description: 'Diseño decorativo', category: 'cosmetic', icon: 'crown' };
  try {
    assert.equal((await write('', { ...fields, imageData: dataUrl(png()) })).status, 400);
    const created = await write('', fields); assert.equal(created.status, 201);
    const item = (await created.json()).item; assert.equal(item.status, 'draft'); assert.equal(item.canEdit, true); assert.equal('imageData' in item, false);
    records.get(item._id).imageData = png(); // Legacy image: no new upload endpoint.
    actorId = visitor;
    assert.equal((await (await fetch(base)).json()).items.length, 0);
    assert.equal((await fetch(`${base}/${item._id}/image`)).status, 404);
    assert.equal((await fetch(base + '?mode=review')).status, 403);
    assert.equal((await write(`/${item._id}`, { ...fields, version: 0 }, 'PATCH')).status, 409);
    assert.equal((await write(`/${item._id}/submit`, { version: 0 })).status, 409);
    actorId = creator;
    assert.equal((await write(`/${item._id}/submit`, { version: 0 })).status, 200);
    assert.equal((await write(`/${item._id}`, { ...fields, version: 1 }, 'PATCH')).status, 409);
    assert.equal((await write(`/${item._id}/review`, { decision: 'approved', version: 1 })).status, 403);
    owner = true; actorId = visitor; registered = false;
    assert.equal((await (await fetch(base + '?mode=review')).json()).items.length, 1);
    assert.equal((await write(`/${item._id}/review`, { decision: 'approved', version: 1 })).status, 200);
    owner = false; registered = true;
    const catalog = await (await fetch(base + '?mode=catalog')).json(); assert.equal(catalog.items.length, 1); assert.equal(catalog.items[0].canEdit, false);
    const image = await fetch(`${base}/${item._id}/image`); assert.equal(image.status, 200); assert.equal(image.headers.get('content-type'), 'image/png'); assert.deepEqual(Buffer.from(await image.arrayBuffer()), png());
    actorId = creator;
    assert.equal((await write(`/${item._id}`, { ...fields, version: 2 }, 'PATCH')).status, 409);
    const equipment = (await (await write('', { ...fields, category: 'equipment' })).json()).item;
    assert.equal((await write(`/${equipment._id}/submit`, { version: 0 })).status, 409);
    assert.equal((await write('', { ...fields, coins: 999 })).status, 400);
    const revision = (await (await write('', fields)).json()).item;
    await write(`/${revision._id}/submit`, { version: 0 }); owner = true; actorId = visitor;
    assert.equal((await write(`/${revision._id}/review`, { decision: 'rejected', reason: '', version: 1 })).status, 400);
    assert.equal((await write(`/${revision._id}/review`, { decision: 'rejected', reason: 'Revisa el nombre', version: 1 })).status, 200);
    owner = false; actorId = creator;
    const revised = await write(`/${revision._id}`, { ...fields, name: 'Corona revisada', version: 2 }, 'PATCH'); assert.equal(revised.status, 200); assert.equal((await revised.json()).item.status, 'draft');
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});
