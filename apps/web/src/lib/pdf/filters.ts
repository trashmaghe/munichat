// Stream decode filters (ISO 32000-1 §7.4). Applies the /Filter chain to a
// stream's raw bytes. The "binary content" filters (Flate, LZW, ASCII85/Hex,
// RunLength) are fully decoded here; image-specific filters (DCT/JPX/CCITT/
// JBIG2) are not — the chain stops and hands the still-encoded bytes plus the
// filter name to the image path in the content interpreter.

import { PdfStream, isArray, isDict, isName, isNumber } from './types';
import type { PdfObject } from './types';

export interface DecodeResult {
  bytes: Uint8Array;
  imageFilter?: string; // set if the chain ended at an image filter
  imageParams?: PdfObject; // DecodeParms for that image filter
}

const IMAGE_FILTERS = new Set([
  'DCTDecode',
  'DCT',
  'JPXDecode',
  'CCITTFaxDecode',
  'CCF',
  'JBIG2Decode',
]);

type Resolver = (o: PdfObject | undefined) => PdfObject | undefined;

function filterNames(o: PdfObject | undefined, resolve: Resolver): string[] {
  const v = resolve(o);
  if (isName(v)) return [v.name];
  if (isArray(v)) {
    const out: string[] = [];
    for (const x of v) {
      const r = resolve(x);
      if (isName(r)) out.push(r.name);
    }
    return out;
  }
  return [];
}

function paramsList(o: PdfObject | undefined, resolve: Resolver, count: number): (PdfObject | undefined)[] {
  const v = resolve(o);
  if (isArray(v)) return v.map((x) => resolve(x));
  const out: (PdfObject | undefined)[] = new Array(count).fill(undefined);
  if (count > 0) out[0] = v;
  return out;
}

export async function decodeStream(stream: PdfStream, resolve: Resolver): Promise<DecodeResult> {
  const dict = stream.dict;
  const names = [
    ...filterNames(dict['Filter'], resolve),
    ...filterNames(dict['F'], resolve),
  ];
  const parms = paramsList(dict['DecodeParms'] ?? dict['DP'], resolve, names.length);

  let bytes = stream.raw;
  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    if (IMAGE_FILTERS.has(name)) {
      return { bytes, imageFilter: name, imageParams: parms[i] };
    }
    switch (name) {
      case 'FlateDecode':
      case 'Fl':
        bytes = await inflate(bytes);
        bytes = applyPredictor(bytes, parms[i], resolve);
        break;
      case 'LZWDecode':
      case 'LZW':
        bytes = lzwDecode(bytes, earlyChange(parms[i], resolve));
        bytes = applyPredictor(bytes, parms[i], resolve);
        break;
      case 'ASCII85Decode':
      case 'A85':
        bytes = ascii85Decode(bytes);
        break;
      case 'ASCIIHexDecode':
      case 'AHx':
        bytes = asciiHexDecode(bytes);
        break;
      case 'RunLengthDecode':
      case 'RL':
        bytes = runLengthDecode(bytes);
        break;
      default:
        // Unknown/identity filter — pass through unchanged.
        break;
    }
  }
  return { bytes };
}

export async function inflate(data: Uint8Array): Promise<Uint8Array> {
  // PDF FlateDecode is zlib-wrapped (RFC 1950) → 'deflate' in the Web API.
  // Some producers emit raw deflate; fall back to 'deflate-raw' on failure.
  try {
    return await inflateWith(data, 'deflate');
  } catch {
    return await inflateWith(data, 'deflate-raw');
  }
}

async function inflateWith(data: Uint8Array, format: 'deflate' | 'deflate-raw'): Promise<Uint8Array> {
  const ds = new DecompressionStream(format);
  const writer = ds.writable.getWriter();
  // Fire-and-forget the write; errors surface through the readable side.
  void writer.write(data as BufferSource);
  void writer.close();
  return readAll(ds.readable);
}

// Drain a ReadableStream<Uint8Array> to a single buffer without relying on
// Blob.stream()/Response — both are unavailable or incomplete in jsdom, and
// this keeps the worker path dependency-free too.
async function readAll(readable: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = readable.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      total += value.length;
    }
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

// ---- Predictors (PNG 10-15, TIFF 2) ----------------------------------------

interface PredictorParams {
  predictor: number;
  colors: number;
  bpc: number;
  columns: number;
}

function readPredictorParams(parms: PdfObject | undefined, resolve: Resolver): PredictorParams | null {
  const p = resolve(parms);
  if (!isDict(p)) return null;
  const predictor = numOr(resolve(p['Predictor']), 1);
  if (predictor <= 1) return null;
  return {
    predictor,
    colors: numOr(resolve(p['Colors']), 1),
    bpc: numOr(resolve(p['BitsPerComponent']), 8),
    columns: numOr(resolve(p['Columns']), 1),
  };
}

function applyPredictor(data: Uint8Array, parms: PdfObject | undefined, resolve: Resolver): Uint8Array {
  const p = readPredictorParams(parms, resolve);
  if (!p) return data;
  const bytesPerPixel = Math.max(1, Math.ceil((p.colors * p.bpc) / 8));
  const rowLen = Math.ceil((p.colors * p.bpc * p.columns) / 8);
  if (rowLen <= 0) return data;

  if (p.predictor === 2) return tiffPredictor2(data, p, rowLen);
  return pngPredictor(data, rowLen, bytesPerPixel);
}

function pngPredictor(data: Uint8Array, rowLen: number, bpp: number): Uint8Array {
  const rows = Math.floor(data.length / (rowLen + 1));
  const out = new Uint8Array(rows * rowLen);
  let prev = new Uint8Array(rowLen);
  let src = 0;
  for (let r = 0; r < rows; r++) {
    const filter = data[src++];
    const cur = new Uint8Array(rowLen);
    for (let i = 0; i < rowLen; i++) {
      const raw = data[src++];
      const a = i >= bpp ? cur[i - bpp] : 0; // left
      const b = prev[i]; // up
      const c = i >= bpp ? prev[i - bpp] : 0; // up-left
      let val: number;
      switch (filter) {
        case 1:
          val = raw + a;
          break;
        case 2:
          val = raw + b;
          break;
        case 3:
          val = raw + ((a + b) >> 1);
          break;
        case 4:
          val = raw + paeth(a, b, c);
          break;
        default:
          val = raw; // 0 = None
      }
      cur[i] = val & 0xff;
    }
    out.set(cur, r * rowLen);
    prev = cur;
  }
  return out;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function tiffPredictor2(data: Uint8Array, p: PredictorParams, rowLen: number): Uint8Array {
  // Only the common 8-bit case is supported precisely; other depths pass
  // through (rare in the documents this MVP targets).
  if (p.bpc !== 8) return data;
  const out = data.slice();
  const rows = Math.floor(out.length / rowLen);
  for (let r = 0; r < rows; r++) {
    const base = r * rowLen;
    for (let i = p.colors; i < rowLen; i++) {
      out[base + i] = (out[base + i] + out[base + i - p.colors]) & 0xff;
    }
  }
  return out;
}

// ---- ASCII filters ----------------------------------------------------------

function asciiHexDecode(data: Uint8Array): Uint8Array {
  const out: number[] = [];
  let hi = -1;
  for (let i = 0; i < data.length; i++) {
    const c = data[i];
    if (c === 0x3e) break; // '>'
    const v = hexDigit(c);
    if (v < 0) continue;
    if (hi < 0) hi = v;
    else {
      out.push(hi * 16 + v);
      hi = -1;
    }
  }
  if (hi >= 0) out.push(hi * 16);
  return Uint8Array.from(out);
}

function hexDigit(c: number): number {
  if (c >= 0x30 && c <= 0x39) return c - 0x30;
  if (c >= 0x41 && c <= 0x46) return c - 0x41 + 10;
  if (c >= 0x61 && c <= 0x66) return c - 0x61 + 10;
  return -1;
}

function ascii85Decode(data: Uint8Array): Uint8Array {
  const out: number[] = [];
  const group: number[] = [];
  let i = 0;
  // Optional leading '<~'
  if (data[0] === 0x3c && data[1] === 0x7e) i = 2;
  for (; i < data.length; i++) {
    const c = data[i];
    if (c === 0x7e) break; // '~' begins EOD '~>'
    if (c <= 0x20) continue; // whitespace
    if (c === 0x7a && group.length === 0) {
      // 'z' shorthand for four zero bytes
      out.push(0, 0, 0, 0);
      continue;
    }
    group.push(c - 0x21);
    if (group.length === 5) {
      let n = 0;
      for (let g = 0; g < 5; g++) n = n * 85 + group[g];
      out.push((n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff);
      group.length = 0;
    }
  }
  if (group.length > 0) {
    const n0 = group.length;
    while (group.length < 5) group.push(84);
    let n = 0;
    for (let g = 0; g < 5; g++) n = n * 85 + group[g];
    const bytes = [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
    for (let k = 0; k < n0 - 1; k++) out.push(bytes[k]);
  }
  return Uint8Array.from(out);
}

function runLengthDecode(data: Uint8Array): Uint8Array {
  const out: number[] = [];
  let i = 0;
  while (i < data.length) {
    const len = data[i++];
    if (len === 128) break; // EOD
    if (len < 128) {
      for (let k = 0; k <= len && i < data.length; k++) out.push(data[i++]);
    } else {
      const b = data[i++];
      for (let k = 0; k < 257 - len; k++) out.push(b);
    }
  }
  return Uint8Array.from(out);
}

// ---- LZW --------------------------------------------------------------------

function earlyChange(parms: PdfObject | undefined, resolve: Resolver): number {
  const p = resolve(parms);
  if (isDict(p) && isNumber(p['EarlyChange'])) return p['EarlyChange'];
  return 1;
}

function lzwDecode(data: Uint8Array, earlyChangeVal: number): Uint8Array {
  const out: number[] = [];
  const CLEAR = 256;
  const EOD = 257;
  let dict: number[][] = [];
  const resetDict = () => {
    dict = [];
    for (let i = 0; i < 256; i++) dict[i] = [i];
    dict[CLEAR] = [];
    dict[EOD] = [];
  };
  resetDict();

  let codeWidth = 9;
  let bitBuffer = 0;
  let bitCount = 0;
  let prev: number[] | null = null;
  let pos = 0;

  const nextCode = (): number => {
    while (bitCount < codeWidth) {
      if (pos >= data.length) return EOD;
      bitBuffer = (bitBuffer << 8) | data[pos++];
      bitCount += 8;
    }
    bitCount -= codeWidth;
    return (bitBuffer >> bitCount) & ((1 << codeWidth) - 1);
  };

  for (;;) {
    const code = nextCode();
    if (code === EOD) break;
    if (code === CLEAR) {
      resetDict();
      codeWidth = 9;
      prev = null;
      continue;
    }
    let entry: number[];
    if (code < dict.length && dict[code].length > 0) {
      entry = dict[code];
    } else if (prev) {
      entry = [...prev, prev[0]];
    } else {
      break;
    }
    for (const b of entry) out.push(b);
    if (prev) {
      dict.push([...prev, entry[0]]);
      const size = dict.length + earlyChangeVal;
      if (size > 511 && codeWidth === 9) codeWidth = 10;
      else if (size > 1023 && codeWidth === 10) codeWidth = 11;
      else if (size > 2047 && codeWidth === 11) codeWidth = 12;
    }
    prev = entry;
  }
  return Uint8Array.from(out);
}

// ---- small helpers ----------------------------------------------------------

function numOr(o: PdfObject | undefined, fallback: number): number {
  return isNumber(o) ? o : fallback;
}
