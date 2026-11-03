import { inflateSync } from 'node:zlib';
import { workflowError } from '../workflow/rules.js';

export function pngImage(input: unknown): Buffer {
  const invalid = () => workflowError(400, 'La imagen debe ser un PNG válido de hasta 512 KB y 512 × 512 píxeles.');
  if (typeof input !== 'string' || input.length > 700000 || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(input)) throw invalid();
  const bytes = Buffer.from(input.slice(input.indexOf(',') + 1), 'base64');
  if (bytes.length > 512 * 1024 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw invalid();
  let offset = 8, width = 0, height = 0, channels = 0, ended = false, idatEnded = false;
  const data: Buffer[] = [];
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset), end = offset + 12 + length;
    if (end > bytes.length) throw invalid();
    const name = bytes.toString('ascii', offset + 4, offset + 8), content = bytes.subarray(offset + 8, end - 4);
    let crc = 0xffffffff;
    for (const byte of bytes.subarray(offset + 4, end - 4)) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
    if (((crc ^ 0xffffffff) >>> 0) !== bytes.readUInt32BE(end - 4)) throw invalid();
    if (offset === 8 && name !== 'IHDR') throw invalid();
    if (name === 'IHDR') {
      if (width || length !== 13) throw invalid();
      width = content.readUInt32BE(0); height = content.readUInt32BE(4);
      channels = content[9] === 6 ? 4 : content[9] === 2 ? 3 : 0;
      if (!width || !height || width > 512 || height > 512 || !channels || content[8] !== 8 || content[10] !== 0 || content[11] !== 0 || content[12] !== 0) throw invalid();
    } else if (name === 'IDAT') {
      if (idatEnded) throw invalid(); data.push(content);
    } else if (name === 'IEND') {
      if (length || !data.length || end !== bytes.length) throw invalid(); ended = true; offset = end; break;
    } else {
      if (data.length) idatEnded = true;
      if (!['sRGB', 'gAMA', 'cHRM', 'pHYs', 'sBIT'].includes(name)) throw invalid(); // Normalized raster only; no animations or embedded payloads.
    }
    offset = end;
  }
  if (!ended || offset !== bytes.length) throw invalid();
  const row = width * channels + 1, expected = row * height;
  let decoded: Buffer;
  try { decoded = inflateSync(Buffer.concat(data), { maxOutputLength: expected }); } catch { throw invalid(); }
  if (decoded.length !== expected) throw invalid();
  for (let i = 0; i < decoded.length; i += row) if (decoded[i] > 4) throw invalid();
  return bytes;
}
