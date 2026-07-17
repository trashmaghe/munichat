import { describe, expect, it } from 'vitest';
import { Lexer, TokenType, bytesOf } from './lexer';

function tokenize(src: string): ReturnType<Lexer['next']>[] {
  const lexer = new Lexer(bytesOf(src));
  const out: ReturnType<Lexer['next']>[] = [];
  for (;;) {
    const t = lexer.next();
    out.push(t);
    if (t.type === TokenType.Eof) break;
  }
  return out;
}

function text(bytes: Uint8Array | undefined): string {
  return bytes ? String.fromCharCode(...bytes) : '';
}

describe('Lexer', () => {
  it('tokenizes integers and reals, including signs and bare dots', () => {
    const toks = tokenize('0 42 -17 +3 .5 -.002 4.');
    const nums = toks.filter((t) => t.type === TokenType.Number).map((t) => t.num);
    expect(nums).toEqual([0, 42, -17, 3, 0.5, -0.002, 4]);
  });

  it('reads names and decodes #XX escapes', () => {
    const toks = tokenize('/Type /A#20B /Wide#28');
    const names = toks.filter((t) => t.type === TokenType.Name).map((t) => t.name);
    expect(names).toEqual(['Type', 'A B', 'Wide(']);
  });

  it('distinguishes << >> from hex strings', () => {
    const toks = tokenize('<< <414243> >>');
    expect(toks[0].type).toBe(TokenType.DictOpen);
    expect(toks[1].type).toBe(TokenType.String);
    expect(text(toks[1].bytes)).toBe('ABC');
    expect(toks[2].type).toBe(TokenType.DictClose);
  });

  it('pads an odd final hex digit with zero', () => {
    const toks = tokenize('<41F>');
    expect(Array.from(toks[0].bytes ?? [])).toEqual([0x41, 0xf0]);
  });

  it('handles literal strings with escapes, octal, and nested parens', () => {
    const toks = tokenize(String.raw`(a\(b\)c\n\101 (d))`);
    expect(toks[0].type).toBe(TokenType.String);
    // \101 octal = 'A', \n = newline, nested (d) preserved
    expect(text(toks[0].bytes)).toBe('a(b)c\nA (d)');
  });

  it('treats a backslash-newline as a line continuation', () => {
    const toks = tokenize('(line1\\\nline2)');
    expect(text(toks[0].bytes)).toBe('line1line2');
  });

  it('emits keywords for obj/endobj/R/true/false/null', () => {
    const toks = tokenize('12 0 obj true null R endobj');
    const kws = toks.filter((t) => t.type === TokenType.Keyword).map((t) => t.name);
    expect(kws).toEqual(['obj', 'true', 'null', 'R', 'endobj']);
  });

  it('skips comments to end of line', () => {
    const toks = tokenize('1 % this is ignored\n2');
    const nums = toks.filter((t) => t.type === TokenType.Number).map((t) => t.num);
    expect(nums).toEqual([1, 2]);
  });

  it('tokenizes array and brace delimiters', () => {
    const toks = tokenize('[ 1 2 ] { }');
    expect(toks.map((t) => t.type)).toEqual([
      TokenType.ArrayOpen,
      TokenType.Number,
      TokenType.Number,
      TokenType.ArrayClose,
      TokenType.BraceOpen,
      TokenType.BraceClose,
      TokenType.Eof,
    ]);
  });
});
