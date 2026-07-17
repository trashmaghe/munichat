// Core PDF object model shared by the lexer, parser, and document layers.
//
// PDF has eight basic object types (ISO 32000-1 §7.3). We map them to
// TypeScript as follows:
//   - null      -> null
//   - boolean   -> boolean
//   - number    -> number (PDF integers and reals are both JS numbers)
//   - string    -> Uint8Array (PDF strings are byte strings; text decoding
//                  happens later, per-font, in fonts.ts)
//   - name      -> PdfName   (wrapped so `/Foo` is distinguishable from a
//                  string that happens to read "Foo")
//   - array     -> PdfObject[]
//   - dictionary-> PdfDict (plain record keyed by the name, sans leading slash)
//   - stream    -> PdfStream
// Indirect references (`12 0 R`) are their own wrapper, PdfRef.
//
// NOTE: `erasableSyntaxOnly` is on in tsconfig.app.json — no TS `enum`s and no
// constructor parameter-properties anywhere in this module tree.

export class PdfName {
  readonly name: string;
  constructor(name: string) {
    this.name = name;
  }
}

export class PdfRef {
  readonly num: number;
  readonly gen: number;
  constructor(num: number, gen: number) {
    this.num = num;
    this.gen = gen;
  }
}

// An interface (not `Record<string, PdfObject>`) so the mutual recursion with
// PdfObject resolves without a TS2456 "circularly references itself" error.
export interface PdfDict {
  [key: string]: PdfObject;
}

export class PdfStream {
  readonly dict: PdfDict;
  // The raw, still-encoded bytes between `stream` and `endstream`. Decoding
  // (Flate, predictors, …) is applied lazily by filters.ts.
  readonly raw: Uint8Array;
  constructor(dict: PdfDict, raw: Uint8Array) {
    this.dict = dict;
    this.raw = raw;
  }
}

export type PdfObject =
  | null
  | boolean
  | number
  | Uint8Array
  | PdfName
  | PdfRef
  | PdfObject[]
  | PdfDict
  | PdfStream;

// ---- Narrowing helpers ------------------------------------------------------
// A plain PdfDict and a PdfObject[] are both `typeof === 'object'`, so callers
// need reliable discriminators. These keep call sites readable.

export function isName(o: PdfObject | undefined, name?: string): o is PdfName {
  return o instanceof PdfName && (name === undefined || o.name === name);
}

export function isRef(o: PdfObject | undefined): o is PdfRef {
  return o instanceof PdfRef;
}

export function isStream(o: PdfObject | undefined): o is PdfStream {
  return o instanceof PdfStream;
}

export function isBytes(o: PdfObject | undefined): o is Uint8Array {
  return o instanceof Uint8Array;
}

export function isNumber(o: PdfObject | undefined): o is number {
  return typeof o === 'number';
}

export function isArray(o: PdfObject | undefined): o is PdfObject[] {
  return Array.isArray(o);
}

export function isDict(o: PdfObject | undefined): o is PdfDict {
  return (
    typeof o === 'object' &&
    o !== null &&
    !Array.isArray(o) &&
    !(o instanceof Uint8Array) &&
    !(o instanceof PdfName) &&
    !(o instanceof PdfRef) &&
    !(o instanceof PdfStream)
  );
}

// The dictionary of a stream is where most stream metadata lives, so callers
// frequently want "the dict, whether this is a bare dict or a stream".
export function dictOf(o: PdfObject | undefined): PdfDict | undefined {
  if (isStream(o)) return o.dict;
  if (isDict(o)) return o;
  return undefined;
}
