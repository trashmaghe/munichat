// Recursive-descent parser that turns the lexer's token stream into the PDF
// object model in types.ts. Handles direct objects, indirect references
// (`N G R`), indirect object definitions (`N G obj … endobj`), and stream
// bodies (`stream … endstream`).

import { Lexer, TokenType } from './lexer';
import type { Token } from './lexer';
import { PdfName, PdfRef, PdfStream } from './types';
import type { PdfDict, PdfObject } from './types';

const LF = 10;
const CR = 13;

const ENDSTREAM = [0x65, 0x6e, 0x64, 0x73, 0x74, 0x72, 0x65, 0x61, 0x6d]; // "endstream"

function matchesAt(b: Uint8Array, at: number, needle: number[]): boolean {
  if (at < 0 || at + needle.length > b.length) return false;
  for (let i = 0; i < needle.length; i++) {
    if (b[at + i] !== needle[i]) return false;
  }
  return true;
}

function indexOf(b: Uint8Array, needle: number[], from: number): number {
  for (let i = from; i + needle.length <= b.length; i++) {
    if (matchesAt(b, i, needle)) return i;
  }
  return -1;
}

export interface IndirectObject {
  num: number;
  gen: number;
  value: PdfObject;
}

export class Parser {
  readonly lexer: Lexer;
  private buffer: Token[] = [];

  constructor(bytes: Uint8Array, pos = 0) {
    this.lexer = new Lexer(bytes, pos);
  }

  get bytes(): Uint8Array {
    return this.lexer.bytes;
  }

  seek(pos: number): void {
    this.lexer.pos = pos;
    this.buffer = [];
  }

  private read(): Token {
    return this.buffer.length > 0 ? (this.buffer.shift() as Token) : this.lexer.next();
  }

  private peek(n = 0): Token {
    while (this.buffer.length <= n) {
      this.buffer.push(this.lexer.next());
    }
    return this.buffer[n];
  }

  // Parse a single object at the current position.
  parseObject(): PdfObject {
    const t = this.read();
    switch (t.type) {
      case TokenType.Number:
        return this.maybeRef(t);
      case TokenType.Name:
        return new PdfName(t.name ?? '');
      case TokenType.String:
        return t.bytes ?? new Uint8Array(0);
      case TokenType.ArrayOpen:
        return this.parseArray();
      case TokenType.DictOpen:
        return this.parseDictOrStream();
      case TokenType.Keyword:
        if (t.name === 'true') return true;
        if (t.name === 'false') return false;
        if (t.name === 'null') return null;
        // 'endobj', 'R', etc. arriving here means malformed input; treat as null.
        return null;
      default:
        return null;
    }
  }

  private maybeRef(numTok: Token): PdfObject {
    const t1 = this.peek(0);
    const t2 = this.peek(1);
    if (
      t1.type === TokenType.Number &&
      t2.type === TokenType.Keyword &&
      t2.name === 'R'
    ) {
      this.read();
      this.read();
      return new PdfRef(numTok.num ?? 0, t1.num ?? 0);
    }
    return numTok.num ?? 0;
  }

  private parseArray(): PdfObject[] {
    const arr: PdfObject[] = [];
    for (;;) {
      const t = this.peek();
      if (t.type === TokenType.ArrayClose) {
        this.read();
        break;
      }
      if (t.type === TokenType.Eof) break;
      arr.push(this.parseObject());
    }
    return arr;
  }

  private parseDictOrStream(): PdfDict | PdfStream {
    const dict: PdfDict = {};
    for (;;) {
      const t = this.read();
      if (t.type === TokenType.DictClose || t.type === TokenType.Eof) break;
      if (t.type !== TokenType.Name) {
        // Malformed entry — skip stray tokens rather than aborting.
        continue;
      }
      const key = t.name ?? '';
      dict[key] = this.parseObject();
    }

    const next = this.peek();
    if (next.type === TokenType.Keyword && next.name === 'stream') {
      this.read(); // consume 'stream'
      return this.parseStream(dict, next);
    }
    return dict;
  }

  private parseStream(dict: PdfDict, streamTok: Token): PdfStream {
    const b = this.lexer.bytes;
    // The 'stream' keyword is followed by CRLF or LF (a lone CR is tolerated).
    let dataStart = streamTok.end;
    if (b[dataStart] === CR && b[dataStart + 1] === LF) dataStart += 2;
    else if (b[dataStart] === LF) dataStart += 1;
    else if (b[dataStart] === CR) dataStart += 1;

    let dataEnd = -1;
    const lengthObj = dict['Length'];
    if (typeof lengthObj === 'number' && lengthObj >= 0) {
      const candidate = dataStart + lengthObj;
      // Trust /Length only if 'endstream' really follows (allowing EOL).
      let probe = candidate;
      while (probe < b.length && (b[probe] === CR || b[probe] === LF)) probe++;
      if (matchesAt(b, probe, ENDSTREAM)) dataEnd = candidate;
    }
    if (dataEnd < 0) {
      // Fall back to scanning for 'endstream' — many producers emit a wrong
      // /Length or an indirect one we can't resolve during the initial pass.
      const idx = indexOf(b, ENDSTREAM, dataStart);
      dataEnd = idx < 0 ? b.length : idx;
      // Trim a single trailing EOL that belongs to the 'endstream' line.
      if (dataEnd > dataStart && b[dataEnd - 1] === LF) dataEnd--;
      if (dataEnd > dataStart && b[dataEnd - 1] === CR) dataEnd--;
    }

    const raw = b.subarray(dataStart, dataEnd);

    // Reposition the lexer just past 'endstream' and drop buffered tokens.
    const endIdx = indexOf(b, ENDSTREAM, dataEnd);
    this.lexer.pos = endIdx < 0 ? b.length : endIdx + ENDSTREAM.length;
    this.buffer = [];

    return new PdfStream(dict, raw);
  }

  // Parse an indirect object definition (`N G obj … endobj`) at `offset`.
  parseIndirectObjectAt(offset: number): IndirectObject {
    this.seek(offset);
    const numTok = this.read();
    const genTok = this.read();
    const objTok = this.read();
    if (
      numTok.type !== TokenType.Number ||
      genTok.type !== TokenType.Number ||
      objTok.type !== TokenType.Keyword ||
      objTok.name !== 'obj'
    ) {
      throw new Error(
        `Expected 'N G obj' at offset ${offset}, got ` +
          `${numTok.type}/${genTok.type}/${objTok.name ?? objTok.type}`,
      );
    }
    const value = this.parseObject();
    return { num: numTok.num ?? 0, gen: genTok.num ?? 0, value };
  }
}
