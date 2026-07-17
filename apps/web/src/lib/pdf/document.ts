// Document layer: cross-reference resolution and the page tree.
//
// Handles all three ways a modern PDF locates its objects:
//   - classic `xref` tables + `trailer`
//   - cross-reference streams (PDF 1.5+, /Type /XRef)
//   - object streams (/Type /ObjStm, objects compressed inside another stream)
// plus /Prev chains and hybrid /XRefStm. If the structured path fails, it falls
// back to scanning the whole file for `N G obj` headers (recovery mode), which
// is how real-world lenient viewers cope with damaged files.

import { Lexer, TokenType } from './lexer';
import { Parser } from './parser';
import { decodeStream } from './filters';
import {
  PdfRef,
  dictOf,
  isArray,
  isDict,
  isName,
  isNumber,
  isRef,
  isStream,
} from './types';
import type { PdfDict, PdfObject, PdfStream } from './types';

type XrefEntry =
  | { kind: 'uncompressed'; offset: number; gen: number }
  | { kind: 'compressed'; streamObjNum: number; index: number };

export interface PdfPage {
  dict: PdfDict;
  mediaBox: [number, number, number, number];
  resources: PdfDict;
  rotate: number;
}

const DEFAULT_MEDIA_BOX: [number, number, number, number] = [0, 0, 612, 792];
const INHERITABLE = ['MediaBox', 'CropBox', 'Resources', 'Rotate'];

function findLast(bytes: Uint8Array, needle: number[]): number {
  for (let i = bytes.length - needle.length; i >= 0; i--) {
    let ok = true;
    for (let j = 0; j < needle.length; j++) {
      if (bytes[i + j] !== needle[j]) {
        ok = false;
        break;
      }
    }
    if (ok) return i;
  }
  return -1;
}

const STARTXREF = [0x73, 0x74, 0x61, 0x72, 0x74, 0x78, 0x72, 0x65, 0x66];

export class PdfDocument {
  readonly bytes: Uint8Array;
  private parser: Parser;
  private xref = new Map<number, XrefEntry>();
  private cache = new Map<number, PdfObject>();
  private trailer: PdfDict = {};
  private pages: PdfPage[] = [];
  encrypted = false;

  private constructor(bytes: Uint8Array) {
    this.bytes = bytes;
    this.parser = new Parser(bytes);
  }

  static async load(bytes: Uint8Array): Promise<PdfDocument> {
    const doc = new PdfDocument(bytes);
    try {
      await doc.readXrefChain();
    } catch {
      // fall through to recovery
    }
    if (!doc.trailer['Root'] || doc.xref.size === 0) {
      doc.rebuildByScan();
    }
    doc.encrypted = doc.trailer['Encrypt'] !== undefined;
    if (!doc.encrypted) {
      await doc.preloadObjectStreams();
      doc.buildPages();
    }
    return doc;
  }

  get pageCount(): number {
    return this.pages.length;
  }

  getPage(index: number): PdfPage {
    const page = this.pages[index];
    if (!page) throw new Error(`Page ${index} out of range (0..${this.pages.length - 1})`);
    return page;
  }

  get title(): string | undefined {
    const info = dictOf(this.resolve(this.trailer['Info']));
    const t = this.resolve(info?.['Title']);
    if (t instanceof Uint8Array) return decodePdfText(t);
    return undefined;
  }

  // Resolve indirect references (following short chains) to a concrete object.
  resolve(o: PdfObject | undefined): PdfObject | undefined {
    let cur = o;
    for (let depth = 0; depth < 32; depth++) {
      if (!isRef(cur)) return cur;
      cur = this.fetch(cur);
    }
    return cur;
  }

  private fetch(ref: PdfRef): PdfObject | undefined {
    if (this.cache.has(ref.num)) return this.cache.get(ref.num);
    const entry = this.xref.get(ref.num);
    if (!entry) return null;
    if (entry.kind === 'uncompressed') {
      try {
        const io = this.parser.parseIndirectObjectAt(entry.offset);
        this.cache.set(ref.num, io.value);
        return io.value;
      } catch {
        this.cache.set(ref.num, null);
        return null;
      }
    }
    // Compressed entries are populated by preloadObjectStreams(); if we get
    // here it wasn't preloaded (e.g. encrypted doc), so treat as missing.
    return this.cache.get(ref.num) ?? null;
  }

  // ---- xref chain --------------------------------------------------------

  private async readXrefChain(): Promise<void> {
    const sxIdx = findLast(this.bytes, STARTXREF);
    if (sxIdx < 0) throw new Error('no startxref');
    const lexer = new Lexer(this.bytes, sxIdx + STARTXREF.length);
    const offTok = lexer.next();
    if (offTok.type !== TokenType.Number) throw new Error('bad startxref');

    const visited = new Set<number>();
    let offset: number | undefined = offTok.num;
    while (offset !== undefined && !visited.has(offset)) {
      visited.add(offset);
      offset = await this.readXrefSection(offset);
    }
  }

  // Reads one xref section (classic table or stream) at `offset`, merges its
  // entries + trailer (newer wins), and returns the /Prev offset if any.
  private async readXrefSection(offset: number): Promise<number | undefined> {
    const peek = new Lexer(this.bytes, offset);
    const first = peek.next();
    if (first.type === TokenType.Keyword && first.name === 'xref') {
      return this.readClassicXref(offset);
    }
    return this.readXrefStream(offset);
  }

  private readClassicXref(offset: number): number | undefined {
    const lexer = new Lexer(this.bytes, offset);
    lexer.next(); // consume 'xref'
    for (;;) {
      const t = lexer.next();
      if (t.type === TokenType.Keyword && t.name === 'trailer') break;
      if (t.type !== TokenType.Number) return undefined;
      const start = t.num ?? 0;
      const count = lexer.next().num ?? 0;
      for (let i = 0; i < count; i++) {
        const off = lexer.next().num ?? 0;
        const gen = lexer.next().num ?? 0;
        const kind = lexer.next();
        const objNum = start + i;
        if (kind.name === 'n' && !this.xref.has(objNum)) {
          this.xref.set(objNum, { kind: 'uncompressed', offset: off, gen });
        }
      }
    }
    // trailer dictionary follows
    const trailerParser = new Parser(this.bytes, lexer.pos);
    const trailer = trailerParser.parseObject();
    if (isDict(trailer)) {
      this.mergeTrailer(trailer);
      // Hybrid-reference files point to an xref *stream* via /XRefStm.
      const xrefStm = trailer['XRefStm'];
      if (isNumber(xrefStm)) void this.readXrefStream(xrefStm);
      const prev = trailer['Prev'];
      if (isNumber(prev)) return prev;
    }
    return undefined;
  }

  private async readXrefStream(offset: number): Promise<number | undefined> {
    const io = this.parser.parseIndirectObjectAt(offset);
    if (!isStream(io.value)) return undefined;
    const stream = io.value;
    const dict = stream.dict;
    this.mergeTrailer(dict);

    const decoded = await decodeStream(stream, (o) => this.resolve(o));
    const data = decoded.bytes;

    const w = this.resolve(dict['W']);
    if (!isArray(w) || w.length < 3) return undefined;
    const w0 = num(w[0]);
    const w1 = num(w[1]);
    const w2 = num(w[2]);
    const entryLen = w0 + w1 + w2;
    if (entryLen === 0) return undefined;

    const size = num(this.resolve(dict['Size']));
    const index = this.resolve(dict['Index']);
    const ranges: number[] = [];
    if (isArray(index)) {
      for (const n of index) ranges.push(num(this.resolve(n)));
    } else {
      ranges.push(0, size);
    }

    let pos = 0;
    for (let r = 0; r + 1 < ranges.length; r += 2) {
      let objNum = ranges[r];
      const count = ranges[r + 1];
      for (let i = 0; i < count; i++) {
        if (pos + entryLen > data.length) break;
        const f0 = w0 === 0 ? 1 : readBE(data, pos, w0);
        const f1 = readBE(data, pos + w0, w1);
        const f2 = readBE(data, pos + w0 + w1, w2);
        pos += entryLen;
        if (!this.xref.has(objNum)) {
          if (f0 === 1) {
            this.xref.set(objNum, { kind: 'uncompressed', offset: f1, gen: f2 });
          } else if (f0 === 2) {
            this.xref.set(objNum, { kind: 'compressed', streamObjNum: f1, index: f2 });
          }
        }
        objNum++;
      }
    }

    const prev = dict['Prev'];
    return isNumber(prev) ? prev : undefined;
  }

  private mergeTrailer(src: PdfDict): void {
    for (const key of Object.keys(src)) {
      if (this.trailer[key] === undefined) this.trailer[key] = src[key];
    }
  }

  // ---- object streams ----------------------------------------------------

  private async preloadObjectStreams(): Promise<void> {
    // Group compressed entries by their containing ObjStm.
    const byStream = new Map<number, { objNum: number; index: number }[]>();
    for (const [objNum, entry] of this.xref) {
      if (entry.kind === 'compressed') {
        const list = byStream.get(entry.streamObjNum) ?? [];
        list.push({ objNum, index: entry.index });
        byStream.set(entry.streamObjNum, list);
      }
    }

    for (const [streamObjNum, members] of byStream) {
      const streamObj = this.resolve(new PdfRef(streamObjNum, 0));
      if (!isStream(streamObj)) continue;
      let decoded;
      try {
        decoded = await decodeStream(streamObj, (o) => this.resolve(o));
      } catch {
        continue;
      }
      const data = decoded.bytes;
      const n = num(this.resolve(streamObj.dict['N']));
      const first = num(this.resolve(streamObj.dict['First']));

      // Header: N pairs of (objNum, relativeOffset).
      const headerParser = new Parser(data, 0);
      const offsets: { objNum: number; offset: number }[] = [];
      for (let i = 0; i < n; i++) {
        const on = num(headerParser.parseObject());
        const off = num(headerParser.parseObject());
        offsets.push({ objNum: on, offset: off });
      }

      for (const m of members) {
        const rec = offsets[m.index];
        if (!rec) continue;
        try {
          const objParser = new Parser(data, first + rec.offset);
          this.cache.set(m.objNum, objParser.parseObject());
        } catch {
          this.cache.set(m.objNum, null);
        }
      }
    }
  }

  // ---- recovery ----------------------------------------------------------

  private rebuildByScan(): void {
    // Scan for "N G obj" headers and take the last occurrence of each object
    // number (later definitions supersede earlier ones).
    const b = this.bytes;
    const OBJ = [0x6f, 0x62, 0x6a]; // "obj"
    for (let i = 0; i + 3 < b.length; i++) {
      if (b[i] === OBJ[0] && b[i + 1] === OBJ[1] && b[i + 2] === OBJ[2] && isDelim(b[i + 3])) {
        // Walk back over "N G " to find the header start.
        const header = readBackHeader(b, i);
        if (header) {
          this.xref.set(header.num, { kind: 'uncompressed', offset: header.start, gen: header.gen });
        }
      }
    }
    // Recover the trailer by finding the object that has /Type /Catalog.
    if (!this.trailer['Root']) {
      for (const [objNum] of this.xref) {
        const obj = dictOf(this.resolve(new PdfRef(objNum, 0)));
        if (obj && isName(obj['Type'], 'Catalog')) {
          this.trailer['Root'] = new PdfRef(objNum, 0);
          break;
        }
      }
    }
  }

  // ---- page tree ---------------------------------------------------------

  private buildPages(): void {
    const root = dictOf(this.resolve(this.trailer['Root']));
    if (!root) return;
    const pagesRoot = root['Pages'];
    const seen = new Set<number>();
    this.walkPageTree(pagesRoot, {}, seen);
    if (this.pages.length === 0) {
      // Some malformed files hang a lone /Type /Page off the catalog.
      const single = dictOf(this.resolve(pagesRoot));
      if (single) this.pushPage(single, {});
    }
  }

  private walkPageTree(nodeRef: PdfObject | undefined, inherited: PdfDict, seen: Set<number>): void {
    if (isRef(nodeRef)) {
      if (seen.has(nodeRef.num)) return;
      seen.add(nodeRef.num);
    }
    const node = dictOf(this.resolve(nodeRef));
    if (!node) return;

    const merged: PdfDict = { ...inherited };
    for (const key of INHERITABLE) {
      if (node[key] !== undefined) merged[key] = node[key];
    }

    const kids = this.resolve(node['Kids']);
    if (isArray(kids)) {
      for (const kid of kids) this.walkPageTree(kid, merged, seen);
    } else if (isName(node['Type'], 'Page') || node['Contents'] !== undefined) {
      this.pushPage(node, merged);
    }
  }

  private pushPage(node: PdfDict, inherited: PdfDict): void {
    const effective: PdfDict = { ...inherited, ...node };
    const mb = this.resolve(effective['MediaBox']);
    let mediaBox = DEFAULT_MEDIA_BOX;
    if (isArray(mb) && mb.length === 4) {
      mediaBox = [num(this.resolve(mb[0])), num(this.resolve(mb[1])), num(this.resolve(mb[2])), num(this.resolve(mb[3]))];
    }
    const resources = dictOf(this.resolve(effective['Resources'])) ?? {};
    const rotate = isNumber(effective['Rotate']) ? effective['Rotate'] : 0;
    this.pages.push({ dict: effective, mediaBox, resources, rotate });
  }

  // Concatenated, fully decoded content-stream bytes for a page.
  async getPageContent(page: PdfPage): Promise<Uint8Array> {
    const contents = this.resolve(page.dict['Contents']);
    const streams: PdfStream[] = [];
    if (isStream(contents)) streams.push(contents);
    else if (isArray(contents)) {
      for (const c of contents) {
        const s = this.resolve(c);
        if (isStream(s)) streams.push(s);
      }
    }
    const parts: Uint8Array[] = [];
    let total = 0;
    for (const s of streams) {
      const { bytes } = await decodeStream(s, (o) => this.resolve(o));
      parts.push(bytes);
      parts.push(SPACE);
      total += bytes.length + 1;
    }
    const out = new Uint8Array(total);
    let off = 0;
    for (const p of parts) {
      out.set(p, off);
      off += p.length;
    }
    return out;
  }
}

const SPACE = new Uint8Array([0x20]);

function num(o: PdfObject | undefined): number {
  return isNumber(o) ? o : 0;
}

function readBE(data: Uint8Array, at: number, width: number): number {
  let v = 0;
  for (let i = 0; i < width; i++) v = v * 256 + (data[at + i] ?? 0);
  return v;
}

function isDelim(b: number): boolean {
  return (
    b === 0x20 || b === 0x0a || b === 0x0d || b === 0x09 || b === 0x0c || b === 0x00 ||
    b === 0x3c || b === 0x5b || b === 0x2f || b === 0x28
  );
}

function readBackHeader(b: Uint8Array, objPos: number): { num: number; gen: number; start: number } | null {
  // From "obj" at objPos, walk back over: ws, gen digits, ws, num digits.
  let i = objPos - 1;
  const skipWs = () => {
    while (i >= 0 && (b[i] === 0x20 || b[i] === 0x0a || b[i] === 0x0d || b[i] === 0x09)) i--;
  };
  const readDigitsBack = (): number | null => {
    const end = i;
    while (i >= 0 && b[i] >= 0x30 && b[i] <= 0x39) i--;
    if (i === end) return null;
    let s = '';
    for (let k = i + 1; k <= end; k++) s += String.fromCharCode(b[k]);
    return parseInt(s, 10);
  };
  skipWs();
  const gen = readDigitsBack();
  if (gen === null) return null;
  skipWs();
  const start = i + 1;
  const objNum = readDigitsBack();
  if (objNum === null) return null;
  return { num: objNum, gen, start: i + 1 < start ? i + 1 : start };
}

// Decode a PDF text string (used for /Title). Handles UTF-16BE with BOM and
// falls back to PDFDocEncoding/Latin-1 for the common ASCII case.
export function decodePdfText(bytes: Uint8Array): string {
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    let s = '';
    for (let i = 2; i + 1 < bytes.length; i += 2) {
      s += String.fromCharCode((bytes[i] << 8) | bytes[i + 1]);
    }
    return s;
  }
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return s;
}
