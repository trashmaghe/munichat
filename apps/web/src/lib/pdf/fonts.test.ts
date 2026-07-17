import { describe, expect, it } from 'vitest';
import { buildFont, parseToUnicodeCMap } from './fonts';
import { winAnsiChar, glyphNameToUnicode } from './encodings';
import { PdfName, PdfStream } from './types';
import type { PdfObject } from './types';
import { bytesOf } from './lexer';

const identity = (o: PdfObject | undefined) => o;

function cmapStream(body: string): PdfStream {
  return new PdfStream({}, bytesOf(body));
}

describe('encodings', () => {
  it('maps WinAnsi 0x80-0x9F specials and Latin-1 accents', () => {
    expect(winAnsiChar(0x80)).toBe('€');
    expect(winAnsiChar(0x92)).toBe('’');
    expect(winAnsiChar(0xe9)).toBe('é'); // Latin-1 é
    expect(winAnsiChar(0xe7)).toBe('ç'); // Latin-1 ç
    expect(winAnsiChar(0x41)).toBe('A');
  });

  it('resolves glyph names, uniXXXX, and single-char names', () => {
    expect(glyphNameToUnicode('ccedilla')).toBe('ç');
    expect(glyphNameToUnicode('space')).toBe(' ');
    expect(glyphNameToUnicode('uni00E9')).toBe('é');
    expect(glyphNameToUnicode('A')).toBe('A');
    expect(glyphNameToUnicode('unknownglyph')).toBeNull();
  });
});

describe('parseToUnicodeCMap', () => {
  it('parses bfchar entries', () => {
    const map = parseToUnicodeCMap(
      bytesOf('2 beginbfchar\n<0001> <0058>\n<0002> <0059>\nendbfchar'),
    );
    expect(map.get(1)).toBe('X');
    expect(map.get(2)).toBe('Y');
  });

  it('parses bfrange with a base destination', () => {
    const map = parseToUnicodeCMap(
      bytesOf('1 beginbfrange\n<0041> <0043> <0058>\nendbfrange'),
    );
    expect(map.get(0x41)).toBe('X');
    expect(map.get(0x42)).toBe('Y');
    expect(map.get(0x43)).toBe('Z');
  });

  it('parses bfrange with an array of destinations', () => {
    const map = parseToUnicodeCMap(
      bytesOf('1 beginbfrange\n<0041> <0042> [<0058> <0059>]\nendbfrange'),
    );
    expect(map.get(0x41)).toBe('X');
    expect(map.get(0x42)).toBe('Y');
  });
});

describe('buildFont — simple font', () => {
  it('decodes bytes to glyphs with widths and WinAnsi chars', async () => {
    const font = await buildFont(
      { Subtype: new PdfName('TrueType'), FirstChar: 65, Widths: [500, 600, 700] },
      identity,
    );
    const glyphs = font.decodeString(new Uint8Array([65, 66, 67]));
    expect(glyphs.map((g) => g.char)).toEqual(['A', 'B', 'C']);
    expect(glyphs.map((g) => g.width)).toEqual([500, 600, 700]);
    expect(glyphs.every((g) => g.bytes === 1)).toBe(true);
  });

  it('applies /Encoding /Differences overrides', async () => {
    const font = await buildFont(
      {
        Subtype: new PdfName('Type1'),
        FirstChar: 65,
        Widths: [500],
        Encoding: { Differences: [65, new PdfName('bullet')] },
      },
      identity,
    );
    const glyphs = font.decodeString(new Uint8Array([65]));
    expect(glyphs[0].char).toBe('•');
  });

  it('falls back to a default width for codes outside /Widths', async () => {
    const font = await buildFont(
      { Subtype: new PdfName('TrueType'), FirstChar: 65, Widths: [500] },
      identity,
    );
    const glyphs = font.decodeString(new Uint8Array([90])); // 'Z', out of range
    expect(glyphs[0].width).toBe(500); // default
    expect(glyphs[0].char).toBe('Z');
  });
});

describe('buildFont — Type0/CID font', () => {
  it('decodes 2-byte Identity codes with CID widths and ToUnicode', async () => {
    const font = await buildFont(
      {
        Subtype: new PdfName('Type0'),
        Encoding: new PdfName('Identity-H'),
        DescendantFonts: [{ DW: 1000, W: [1, [222, 333]] }],
        ToUnicode: cmapStream('2 beginbfchar\n<0001> <0058>\n<0002> <0059>\nendbfchar'),
      },
      identity,
    );
    const glyphs = font.decodeString(new Uint8Array([0x00, 0x01, 0x00, 0x02]));
    expect(glyphs.map((g) => g.char)).toEqual(['X', 'Y']);
    expect(glyphs.map((g) => g.width)).toEqual([222, 333]);
    expect(glyphs.every((g) => g.bytes === 2)).toBe(true);
  });

  it('uses /DW for CIDs absent from /W', async () => {
    const font = await buildFont(
      {
        Subtype: new PdfName('Type0'),
        Encoding: new PdfName('Identity-H'),
        DescendantFonts: [{ DW: 750, W: [] }],
      },
      identity,
    );
    const glyphs = font.decodeString(new Uint8Array([0x00, 0x05]));
    expect(glyphs[0].width).toBe(750);
  });
});
