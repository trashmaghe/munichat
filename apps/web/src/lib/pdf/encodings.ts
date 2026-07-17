// Character-encoding tables for text extraction. This is NOT glyph rendering —
// it maps a font's byte codes to Unicode so the interpreter can draw readable
// text in a fallback web font (the agreed MVP tradeoff).

// Windows-1252 (WinAnsiEncoding) differs from Latin-1 only in 0x80-0x9F. Codes
// outside this table fall back to Latin-1 (String.fromCharCode), which is
// correct for the accented Portuguese letters (≥0xC0) that matter most here.
const WIN1252_80_9F: Record<number, number> = {
  0x80: 0x20ac,
  0x82: 0x201a,
  0x83: 0x0192,
  0x84: 0x201e,
  0x85: 0x2026,
  0x86: 0x2020,
  0x87: 0x2021,
  0x88: 0x02c6,
  0x89: 0x2030,
  0x8a: 0x0160,
  0x8b: 0x2039,
  0x8c: 0x0152,
  0x8e: 0x017d,
  0x91: 0x2018,
  0x92: 0x2019,
  0x93: 0x201c,
  0x94: 0x201d,
  0x95: 0x2022,
  0x96: 0x2013,
  0x97: 0x2014,
  0x98: 0x02dc,
  0x99: 0x2122,
  0x9a: 0x0161,
  0x9b: 0x203a,
  0x9c: 0x0153,
  0x9e: 0x017e,
  0x9f: 0x0178,
};

export function winAnsiChar(code: number): string {
  if (code >= 0x80 && code <= 0x9f) {
    const u = WIN1252_80_9F[code];
    return u ? String.fromCharCode(u) : '';
  }
  return String.fromCharCode(code);
}

// A focused Adobe Glyph List subset: enough to resolve /Differences glyph
// names in the documents this MVP targets (ASCII punctuation/digits + the
// Portuguese accented letters). Single-character names ('a', 'A', '1') and
// 'uniXXXX' names are handled programmatically in glyphNameToUnicode.
const AGL: Record<string, string> = {
  space: ' ',
  period: '.',
  comma: ',',
  colon: ':',
  semicolon: ';',
  hyphen: '-',
  underscore: '_',
  slash: '/',
  backslash: '\\',
  bar: '|',
  exclam: '!',
  question: '?',
  quotesingle: "'",
  quotedbl: '"',
  grave: '`',
  asciitilde: '~',
  at: '@',
  numbersign: '#',
  dollar: '$',
  percent: '%',
  ampersand: '&',
  asterisk: '*',
  plus: '+',
  equal: '=',
  less: '<',
  greater: '>',
  parenleft: '(',
  parenright: ')',
  bracketleft: '[',
  bracketright: ']',
  braceleft: '{',
  braceright: '}',
  zero: '0',
  one: '1',
  two: '2',
  three: '3',
  four: '4',
  five: '5',
  six: '6',
  seven: '7',
  eight: '8',
  nine: '9',
  bullet: '•',
  endash: '–',
  emdash: '—',
  quoteleft: '‘',
  quoteright: '’',
  quotedblleft: '“',
  quotedblright: '”',
  ellipsis: '…',
  degree: '°',
  ordfeminine: 'ª',
  ordmasculine: 'º',
  // Portuguese accented letters
  aacute: 'á',
  acircumflex: 'â',
  atilde: 'ã',
  agrave: 'à',
  ccedilla: 'ç',
  eacute: 'é',
  ecircumflex: 'ê',
  iacute: 'í',
  oacute: 'ó',
  ocircumflex: 'ô',
  otilde: 'õ',
  uacute: 'ú',
  udieresis: 'ü',
  Aacute: 'Á',
  Acircumflex: 'Â',
  Atilde: 'Ã',
  Agrave: 'À',
  Ccedilla: 'Ç',
  Eacute: 'É',
  Ecircumflex: 'Ê',
  Iacute: 'Í',
  Oacute: 'Ó',
  Ocircumflex: 'Ô',
  Otilde: 'Õ',
  Uacute: 'Ú',
  Udieresis: 'Ü',
};

export function glyphNameToUnicode(name: string): string | null {
  const uni = /^uni([0-9A-Fa-f]{4})$/.exec(name);
  if (uni) return String.fromCharCode(parseInt(uni[1], 16));
  if (name.length === 1) return name;
  return AGL[name] ?? null;
}
