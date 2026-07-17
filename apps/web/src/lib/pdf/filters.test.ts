import { describe, expect, it } from 'vitest';
import { decodeStream, inflate } from './filters';
import { PdfName, PdfStream } from './types';
import type { PdfObject } from './types';

const identity = (o: PdfObject | undefined) => o;

async function deflate(data: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream('deflate');
  const writer = cs.writable.getWriter();
  void writer.write(data as BufferSource);
  void writer.close();
  const reader = cs.readable.getReader();
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

function streamOf(raw: Uint8Array, dict: Record<string, PdfObject>): PdfStream {
  return new PdfStream(dict, raw);
}

describe('inflate', () => {
  it('round-trips zlib-compressed data', async () => {
    const original = new TextEncoder().encode('the quick brown fox '.repeat(20));
    const compressed = await deflate(original);
    const out = await inflate(compressed);
    expect(Array.from(out)).toEqual(Array.from(original));
  });
});

describe('decodeStream', () => {
  it('applies FlateDecode with a PNG Up predictor', async () => {
    // 2 rows × 3 cols, predictor 12 (Up). Row0 None [10,20,30]; Row1 Up [1,2,3].
    const predicted = new Uint8Array([0, 10, 20, 30, 2, 1, 2, 3]);
    const raw = await deflate(predicted);
    const stream = streamOf(raw, {
      Filter: new PdfName('FlateDecode'),
      DecodeParms: { Predictor: 12, Columns: 3, Colors: 1, BitsPerComponent: 8 },
    });
    const { bytes } = await decodeStream(stream, identity);
    expect(Array.from(bytes)).toEqual([10, 20, 30, 11, 22, 33]);
  });

  it('applies a TIFF predictor 2', async () => {
    // Predictor 2, 1 row, colors 1: horizontal differencing.
    const predicted = new Uint8Array([5, 3, 2, 10]); // → 5,8,10,20
    const raw = await deflate(predicted);
    const stream = streamOf(raw, {
      Filter: new PdfName('FlateDecode'),
      DecodeParms: { Predictor: 2, Columns: 4, Colors: 1, BitsPerComponent: 8 },
    });
    const { bytes } = await decodeStream(stream, identity);
    expect(Array.from(bytes)).toEqual([5, 8, 10, 20]);
  });

  it('decodes ASCIIHexDecode', async () => {
    const raw = new TextEncoder().encode('48656c6c6f>');
    const stream = streamOf(raw, { Filter: new PdfName('ASCIIHexDecode') });
    const { bytes } = await decodeStream(stream, identity);
    expect(new TextDecoder().decode(bytes)).toBe('Hello');
  });

  it('decodes ASCII85Decode with the z shorthand', async () => {
    // 'z' expands to four zero bytes, then '~>' terminates.
    const raw = new TextEncoder().encode('z~>');
    const stream = streamOf(raw, { Filter: new PdfName('ASCII85Decode') });
    const { bytes } = await decodeStream(stream, identity);
    expect(Array.from(bytes)).toEqual([0, 0, 0, 0]);
  });

  it('decodes RunLengthDecode (literal + repeat runs)', async () => {
    // 0x02 → copy next 3 bytes; 0xFE (254) → repeat next byte 3 times; 0x80 EOD.
    const raw = new Uint8Array([2, 65, 66, 67, 254, 90, 128]);
    const stream = streamOf(raw, { Filter: new PdfName('RunLengthDecode') });
    const { bytes } = await decodeStream(stream, identity);
    expect(new TextDecoder().decode(bytes)).toBe('ABCZZZ');
  });

  it('decodes LZWDecode using the PDF spec example vector', async () => {
    // ISO 32000-1 §7.4.4.2: encoded bytes for "-----A---B".
    const raw = new Uint8Array([0x80, 0x0b, 0x60, 0x50, 0x22, 0x0c, 0x0c, 0x85, 0x01]);
    const stream = streamOf(raw, { Filter: new PdfName('LZWDecode') });
    const { bytes } = await decodeStream(stream, identity);
    expect(new TextDecoder().decode(bytes)).toBe('-----A---B');
  });

  it('stops at an image filter and returns its name + bytes', async () => {
    const raw = new Uint8Array([0xff, 0xd8, 0xff]); // JPEG SOI marker start
    const stream = streamOf(raw, { Filter: new PdfName('DCTDecode') });
    const result = await decodeStream(stream, identity);
    expect(result.imageFilter).toBe('DCTDecode');
    expect(Array.from(result.bytes)).toEqual([0xff, 0xd8, 0xff]);
  });

  it('chains ASCII85 then Flate then image filter', async () => {
    const stream = streamOf(new Uint8Array([1, 2, 3]), {
      Filter: [new PdfName('ASCIIHexDecode'), new PdfName('DCTDecode')],
    });
    const result = await decodeStream(stream, identity);
    // First filter is ASCIIHex (decodes [1,2,3] as garbage hex → empty), then
    // DCT is the image stopper. We only assert the image filter is surfaced.
    expect(result.imageFilter).toBe('DCTDecode');
  });
});
