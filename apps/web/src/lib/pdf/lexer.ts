// Byte-level tokenizer for PDF (ISO 32000-1 §7.2). Operates directly on the
// raw file bytes with a movable cursor, so the parser can seek to arbitrary
// offsets (xref-referenced object positions) and tokenize from there.

export const TokenType = {
  Number: 'num',
  Name: 'name',
  String: 'string',
  DictOpen: 'dict-open',
  DictClose: 'dict-close',
  ArrayOpen: 'array-open',
  ArrayClose: 'array-close',
  BraceOpen: 'brace-open',
  BraceClose: 'brace-close',
  Keyword: 'keyword',
  Eof: 'eof',
} as const;
export type TokenType = (typeof TokenType)[keyof typeof TokenType];

export interface Token {
  type: TokenType;
  num?: number;
  name?: string; // for Name (sans slash) and Keyword
  bytes?: Uint8Array; // for String
  start: number;
  end: number;
}

const NUL = 0;
const TAB = 9;
const LF = 10;
const FF = 12;
const CR = 13;
const SP = 32;

function isWhitespace(b: number): boolean {
  return b === NUL || b === TAB || b === LF || b === FF || b === CR || b === SP;
}

function isDelimiter(b: number): boolean {
  // ( ) < > [ ] { } / %
  return (
    b === 0x28 ||
    b === 0x29 ||
    b === 0x3c ||
    b === 0x3e ||
    b === 0x5b ||
    b === 0x5d ||
    b === 0x7b ||
    b === 0x7d ||
    b === 0x2f ||
    b === 0x25
  );
}

function isRegular(b: number): boolean {
  return !isWhitespace(b) && !isDelimiter(b);
}

function isDigit(b: number): boolean {
  return b >= 0x30 && b <= 0x39;
}

function hexVal(b: number): number {
  if (b >= 0x30 && b <= 0x39) return b - 0x30;
  if (b >= 0x41 && b <= 0x46) return b - 0x41 + 10;
  if (b >= 0x61 && b <= 0x66) return b - 0x61 + 10;
  return -1;
}

export class Lexer {
  readonly bytes: Uint8Array;
  pos: number;

  constructor(bytes: Uint8Array, pos = 0) {
    this.bytes = bytes;
    this.pos = pos;
  }

  private skipWhitespaceAndComments(): void {
    const b = this.bytes;
    while (this.pos < b.length) {
      const c = b[this.pos];
      if (isWhitespace(c)) {
        this.pos++;
      } else if (c === 0x25) {
        // '%' comment — skip to end of line
        this.pos++;
        while (this.pos < b.length && b[this.pos] !== LF && b[this.pos] !== CR) {
          this.pos++;
        }
      } else {
        break;
      }
    }
  }

  next(): Token {
    this.skipWhitespaceAndComments();
    const b = this.bytes;
    const start = this.pos;
    if (this.pos >= b.length) {
      return { type: TokenType.Eof, start, end: start };
    }

    const c = b[this.pos];

    switch (c) {
      case 0x5b: // [
        this.pos++;
        return { type: TokenType.ArrayOpen, start, end: this.pos };
      case 0x5d: // ]
        this.pos++;
        return { type: TokenType.ArrayClose, start, end: this.pos };
      case 0x7b: // {
        this.pos++;
        return { type: TokenType.BraceOpen, start, end: this.pos };
      case 0x7d: // }
        this.pos++;
        return { type: TokenType.BraceClose, start, end: this.pos };
      case 0x3c: // <  -> either '<<' or a hex string
        if (b[this.pos + 1] === 0x3c) {
          this.pos += 2;
          return { type: TokenType.DictOpen, start, end: this.pos };
        }
        return this.readHexString(start);
      case 0x3e: // >  -> expect '>>'
        if (b[this.pos + 1] === 0x3e) {
          this.pos += 2;
          return { type: TokenType.DictClose, start, end: this.pos };
        }
        // Stray '>' — skip it and continue.
        this.pos++;
        return this.next();
      case 0x28: // (
        return this.readLiteralString(start);
      case 0x2f: // /
        return this.readName(start);
      default:
        break;
    }

    if (isDigit(c) || c === 0x2b || c === 0x2d || c === 0x2e) {
      return this.readNumber(start);
    }
    if (isRegular(c)) {
      return this.readKeyword(start);
    }
    // Unknown byte — skip and retry.
    this.pos++;
    return this.next();
  }

  private readNumber(start: number): Token {
    const b = this.bytes;
    let s = '';
    while (this.pos < b.length) {
      const c = b[this.pos];
      if (isDigit(c) || c === 0x2b || c === 0x2d || c === 0x2e || c === 0x45 || c === 0x65) {
        // digits, sign, dot, and 'E'/'e' (some producers emit exponents)
        s += String.fromCharCode(c);
        this.pos++;
      } else {
        break;
      }
    }
    let num = parseFloat(s);
    if (Number.isNaN(num)) num = 0;
    return { type: TokenType.Number, num, start, end: this.pos };
  }

  private readName(start: number): Token {
    const b = this.bytes;
    this.pos++; // consume '/'
    let name = '';
    while (this.pos < b.length && isRegular(b[this.pos])) {
      let c = b[this.pos];
      if (c === 0x23 && this.pos + 2 < b.length) {
        // '#XX' hex escape in name
        const hi = hexVal(b[this.pos + 1]);
        const lo = hexVal(b[this.pos + 2]);
        if (hi >= 0 && lo >= 0) {
          c = hi * 16 + lo;
          this.pos += 3;
          name += String.fromCharCode(c);
          continue;
        }
      }
      name += String.fromCharCode(c);
      this.pos++;
    }
    return { type: TokenType.Name, name, start, end: this.pos };
  }

  private readKeyword(start: number): Token {
    const b = this.bytes;
    let name = '';
    while (this.pos < b.length && isRegular(b[this.pos])) {
      name += String.fromCharCode(b[this.pos]);
      this.pos++;
    }
    return { type: TokenType.Keyword, name, start, end: this.pos };
  }

  private readLiteralString(start: number): Token {
    const b = this.bytes;
    this.pos++; // consume '('
    const out: number[] = [];
    let depth = 1;
    while (this.pos < b.length) {
      const c = b[this.pos++];
      if (c === 0x5c) {
        // backslash escape
        if (this.pos >= b.length) break;
        const e = b[this.pos++];
        switch (e) {
          case 0x6e: // n
            out.push(LF);
            break;
          case 0x72: // r
            out.push(CR);
            break;
          case 0x74: // t
            out.push(TAB);
            break;
          case 0x62: // b
            out.push(0x08);
            break;
          case 0x66: // f
            out.push(FF);
            break;
          case 0x28: // (
            out.push(0x28);
            break;
          case 0x29: // )
            out.push(0x29);
            break;
          case 0x5c: // backslash
            out.push(0x5c);
            break;
          case CR:
            // line continuation: \<CR> or \<CR><LF>
            if (b[this.pos] === LF) this.pos++;
            break;
          case LF:
            // line continuation
            break;
          default:
            if (e >= 0x30 && e <= 0x37) {
              // octal escape, up to 3 digits
              let val = e - 0x30;
              for (let i = 0; i < 2; i++) {
                const d = b[this.pos];
                if (d >= 0x30 && d <= 0x37) {
                  val = val * 8 + (d - 0x30);
                  this.pos++;
                } else {
                  break;
                }
              }
              out.push(val & 0xff);
            } else {
              // unknown escape: keep the char literally
              out.push(e);
            }
        }
      } else if (c === 0x28) {
        depth++;
        out.push(c);
      } else if (c === 0x29) {
        depth--;
        if (depth === 0) break;
        out.push(c);
      } else {
        out.push(c);
      }
    }
    return { type: TokenType.String, bytes: Uint8Array.from(out), start, end: this.pos };
  }

  private readHexString(start: number): Token {
    const b = this.bytes;
    this.pos++; // consume '<'
    const out: number[] = [];
    let hi = -1;
    while (this.pos < b.length) {
      const c = b[this.pos++];
      if (c === 0x3e) break; // '>'
      const v = hexVal(c);
      if (v < 0) continue; // whitespace/garbage ignored
      if (hi < 0) {
        hi = v;
      } else {
        out.push(hi * 16 + v);
        hi = -1;
      }
    }
    if (hi >= 0) {
      // odd number of digits: assume trailing 0
      out.push(hi * 16);
    }
    return { type: TokenType.String, bytes: Uint8Array.from(out), start, end: this.pos };
  }
}

// Convenience for tests and small callers: encode an ASCII/Latin-1 string to
// the byte array the lexer consumes.
export function bytesOf(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}
