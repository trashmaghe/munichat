// Font handling for text extraction/positioning — NOT glyph rasterizing.
// Produces, per font: (a) the byte-string → glyph split with advance widths so
// text advances correctly, and (b) a Unicode string per glyph so the content
// interpreter can draw it in a fallback web font.

import { Lexer, TokenType } from './lexer';
import { decodeStream } from './filters';
import { glyphNameToUnicode, winAnsiChar } from './encodings';
import {
  dictOf,
  isArray,
  isName,
  isNumber,
  isStream,
} from './types';
import type { PdfDict, PdfObject } from './types';

export interface Glyph {
  char: string; // Unicode text for canvas fillText ('' if unmapped)
  width: number; // advance in glyph space (1/1000 em)
  code: number; // original char code (32 == space, for word spacing)
  bytes: number; // source bytes consumed (1 simple, 2 CID/Identity)
}

export interface PdfFont {
  decodeString(bytes: Uint8Array): Glyph[];
}

type Resolver = (o: PdfObject | undefined) => PdfObject | undefined;

const DEFAULT_SIMPLE_WIDTH = 500;
const DEFAULT_CID_WIDTH = 1000;

export async function buildFont(fontDict: PdfDict, resolve: Resolver): Promise<PdfFont> {
  const subtype = nameOf(resolve(fontDict['Subtype']));
  const toUnicode = await getToUnicode(fontDict, resolve);
  if (subtype === 'Type0') {
    return buildType0Font(fontDict, resolve, toUnicode);
  }
  return buildSimpleFont(fontDict, resolve, toUnicode);
}

// ---- simple fonts (Type1 / TrueType / MMType1) ------------------------------

function buildSimpleFont(
  fontDict: PdfDict,
  resolve: Resolver,
  toUnicode: Map<number, string> | null,
): PdfFont {
  const firstChar = numOr(resolve(fontDict['FirstChar']), 0);
  const widthsArr = resolve(fontDict['Widths']);
  const widths: number[] = [];
  if (isArray(widthsArr)) {
    for (const w of widthsArr) widths.push(numOr(resolve(w), 0));
  }
  const descriptor = dictOf(resolve(fontDict['FontDescriptor']));
  const missingWidth = numOr(resolve(descriptor?.['MissingWidth']), DEFAULT_SIMPLE_WIDTH);
  const encoding = buildSimpleEncoding(fontDict, resolve);

  return {
    decodeString(bytes: Uint8Array): Glyph[] {
      const glyphs: Glyph[] = [];
      for (let i = 0; i < bytes.length; i++) {
        const code = bytes[i];
        const idx = code - firstChar;
        const width = idx >= 0 && idx < widths.length && widths[idx] > 0 ? widths[idx] : missingWidth;
        const char =
          toUnicode?.get(code) ?? encoding.get(code) ?? winAnsiChar(code);
        glyphs.push({ char, width, code, bytes: 1 });
      }
      return glyphs;
    },
  };
}

function buildSimpleEncoding(fontDict: PdfDict, resolve: Resolver): Map<number, string> {
  const map = new Map<number, string>();
  const enc = resolve(fontDict['Encoding']);
  // Base encoding: default to WinAnsi (handled lazily via winAnsiChar); only
  // the /Differences overrides need to be materialised here.
  const diffs = isName(enc) ? undefined : dictOf(enc)?.['Differences'];
  const arr = resolve(diffs);
  if (isArray(arr)) {
    let current = 0;
    for (const item of arr) {
      const r = resolve(item);
      if (isNumber(r)) {
        current = r;
      } else if (isName(r)) {
        const u = glyphNameToUnicode(r.name);
        if (u !== null) map.set(current, u);
        current++;
      }
    }
  }
  return map;
}

// ---- Type0 / CID composite fonts --------------------------------------------

function buildType0Font(
  fontDict: PdfDict,
  resolve: Resolver,
  toUnicode: Map<number, string> | null,
): PdfFont {
  const descendants = resolve(fontDict['DescendantFonts']);
  const cidFont = dictOf(resolve(isArray(descendants) ? descendants[0] : descendants)) ?? {};
  const dw = numOr(resolve(cidFont['DW']), DEFAULT_CID_WIDTH);
  const widths = parseCidWidths(resolve(cidFont['W']), resolve);

  // MVP assumes Identity-H/V encoding (2-byte codes == CIDs), which is what
  // Word/LibreOffice emit. Named non-identity CMap encodings are not handled.
  return {
    decodeString(bytes: Uint8Array): Glyph[] {
      const glyphs: Glyph[] = [];
      for (let i = 0; i + 1 < bytes.length; i += 2) {
        const code = (bytes[i] << 8) | bytes[i + 1];
        const width = widths.get(code) ?? dw;
        const char = toUnicode?.get(code) ?? '';
        glyphs.push({ char, width, code, bytes: 2 });
      }
      return glyphs;
    },
  };
}

function parseCidWidths(w: PdfObject | undefined, resolve: Resolver): Map<number, number> {
  const map = new Map<number, number>();
  if (!isArray(w)) return map;
  let i = 0;
  while (i < w.length) {
    const c = numOr(resolve(w[i]), 0);
    const next = resolve(w[i + 1]);
    if (isArray(next)) {
      for (let j = 0; j < next.length; j++) {
        map.set(c + j, numOr(resolve(next[j]), 0));
      }
      i += 2;
    } else {
      const cLast = numOr(next, 0);
      const width = numOr(resolve(w[i + 2]), 0);
      for (let k = c; k <= cLast; k++) map.set(k, width);
      i += 3;
    }
  }
  return map;
}

// ---- /ToUnicode CMap --------------------------------------------------------

async function getToUnicode(
  fontDict: PdfDict,
  resolve: Resolver,
): Promise<Map<number, string> | null> {
  const stream = resolve(fontDict['ToUnicode']);
  if (!isStream(stream)) return null;
  try {
    const { bytes } = await decodeStream(stream, resolve);
    return parseToUnicodeCMap(bytes);
  } catch {
    return null;
  }
}

export function parseToUnicodeCMap(bytes: Uint8Array): Map<number, string> {
  const map = new Map<number, string>();
  const lexer = new Lexer(bytes);
  let mode: 'none' | 'bfchar' | 'bfrange' = 'none';

  const readString = (t: ReturnType<Lexer['next']>): Uint8Array | null =>
    t.type === TokenType.String ? (t.bytes ?? new Uint8Array(0)) : null;

  for (;;) {
    const t = lexer.next();
    if (t.type === TokenType.Eof) break;

    if (t.type === TokenType.Keyword) {
      if (t.name === 'beginbfchar') mode = 'bfchar';
      else if (t.name === 'endbfchar') mode = 'none';
      else if (t.name === 'beginbfrange') mode = 'bfrange';
      else if (t.name === 'endbfrange') mode = 'none';
      continue;
    }

    if (mode === 'bfchar' && t.type === TokenType.String) {
      const src = beToNumber(t.bytes ?? new Uint8Array(0));
      const dst = readString(lexer.next());
      if (dst) map.set(src, beToUtf16(dst));
    } else if (mode === 'bfrange' && t.type === TokenType.String) {
      const lo = beToNumber(t.bytes ?? new Uint8Array(0));
      const hiTok = lexer.next();
      const hi = beToNumber(hiTok.bytes ?? new Uint8Array(0));
      const dstTok = lexer.next();
      if (dstTok.type === TokenType.ArrayOpen) {
        // Per-entry destinations: [ <d0> <d1> ... ]
        let code = lo;
        for (;;) {
          const e = lexer.next();
          if (e.type === TokenType.ArrayClose || e.type === TokenType.Eof) break;
          if (e.type === TokenType.String) map.set(code++, beToUtf16(e.bytes ?? new Uint8Array(0)));
        }
      } else if (dstTok.type === TokenType.String) {
        const base = dstTok.bytes ?? new Uint8Array(0);
        const baseNum = beToNumber(base);
        for (let code = lo, k = 0; code <= hi; code++, k++) {
          map.set(code, String.fromCharCode(baseNum + k));
        }
      }
    }
  }
  return map;
}

// ---- small helpers ----------------------------------------------------------

function beToNumber(bytes: Uint8Array): number {
  let n = 0;
  for (const b of bytes) n = n * 256 + b;
  return n;
}

function beToUtf16(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    s += String.fromCharCode((bytes[i] << 8) | bytes[i + 1]);
  }
  if (bytes.length % 2 === 1) s += String.fromCharCode(bytes[bytes.length - 1]);
  return s;
}

function nameOf(o: PdfObject | undefined): string {
  return isName(o) ? o.name : '';
}

function numOr(o: PdfObject | undefined, fallback: number): number {
  return isNumber(o) ? o : fallback;
}
