// Content-stream interpreter: executes a page's operators against a CanvasLike
// 2-D context. Vectors, clipping, color (gray/RGB/CMYK), and text are handled
// here; images go through drawImageXObject (see images.ts). Text is drawn in a
// fallback web font — glyph outlines from the embedded font are deliberately
// not rasterized (the MVP tradeoff).

import { Lexer, TokenType } from './lexer';
import type { Token } from './lexer';
import { buildFont } from './fonts';
import type { Glyph, PdfFont } from './fonts';
import { IDENTITY, matMul, translate } from './matrix';
import type { Matrix } from './matrix';
import { drawImageXObject } from './images';
import {
  PdfName,
  PdfStream,
  dictOf,
  isArray,
  isName,
  isNumber,
  isStream,
} from './types';
import type { PdfDict, PdfObject } from './types';
import { decodeStream } from './filters';

// The subset of CanvasRenderingContext2D the interpreter relies on. Both
// OffscreenCanvasRenderingContext2D and a recording test mock satisfy it.
export interface CanvasLike {
  fillStyle: string;
  strokeStyle: string;
  lineWidth: number;
  font: string;
  save(): void;
  restore(): void;
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;
  transform(a: number, b: number, c: number, d: number, e: number, f: number): void;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  bezierCurveTo(cp1x: number, cp1y: number, cp2x: number, cp2y: number, x: number, y: number): void;
  closePath(): void;
  rect(x: number, y: number, w: number, h: number): void;
  fill(rule?: CanvasFillRule): void;
  stroke(): void;
  clip(rule?: CanvasFillRule): void;
  fillText(text: string, x: number, y: number): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  drawImage(image: CanvasImageSource, dx: number, dy: number, dw: number, dh: number): void;
}

export const FALLBACK_FONT_FAMILY = 'sans-serif';

type Resolver = (o: PdfObject | undefined) => PdfObject | undefined;

interface GraphicsState {
  ctm: Matrix;
  fill: string;
  stroke: string;
  lineWidth: number;
  fillComps: number; // number of components expected by sc/scn
  strokeComps: number;
  // text state
  font: PdfFont | null;
  fontSize: number;
  charSpacing: number;
  wordSpacing: number;
  leading: number;
  hScale: number; // Tz / 100
  textRise: number;
  renderMode: number;
}

function initialState(ctm: Matrix): GraphicsState {
  return {
    ctm,
    fill: '#000000',
    stroke: '#000000',
    lineWidth: 1,
    fillComps: 1,
    strokeComps: 1,
    font: null,
    fontSize: 0,
    charSpacing: 0,
    wordSpacing: 0,
    leading: 0,
    hScale: 1,
    textRise: 0,
    renderMode: 0,
  };
}

export interface InterpreterOptions {
  ctx: CanvasLike;
  resolve: Resolver;
  baseCtm: Matrix; // maps PDF user space (y-up) to device pixels
  resources: PdfDict;
}

const MAX_FORM_DEPTH = 12;

export class ContentInterpreter {
  private ctx: CanvasLike;
  private resolve: Resolver;
  private resourceStack: PdfDict[];
  private gs: GraphicsState;
  private stateStack: GraphicsState[] = [];
  private tm: Matrix = IDENTITY;
  private tlm: Matrix = IDENTITY;
  private pendingClip: CanvasFillRule | null = null;
  private fontCache = new Map<PdfDict, PdfFont>();

  constructor(opts: InterpreterOptions) {
    this.ctx = opts.ctx;
    this.resolve = opts.resolve;
    this.resourceStack = [opts.resources];
    this.gs = initialState(opts.baseCtm);
    this.ctx.setTransform(
      opts.baseCtm.a,
      opts.baseCtm.b,
      opts.baseCtm.c,
      opts.baseCtm.d,
      opts.baseCtm.e,
      opts.baseCtm.f,
    );
  }

  private get resources(): PdfDict {
    return this.resourceStack[this.resourceStack.length - 1];
  }

  async run(content: Uint8Array, depth = 0): Promise<void> {
    const lexer = new Lexer(content);
    const stack: PdfObject[] = [];
    for (;;) {
      const t = lexer.next();
      if (t.type === TokenType.Eof) break;
      switch (t.type) {
        case TokenType.Number:
          stack.push(t.num ?? 0);
          break;
        case TokenType.String:
          stack.push(t.bytes ?? new Uint8Array(0));
          break;
        case TokenType.Name:
          stack.push(new PdfName(t.name ?? ''));
          break;
        case TokenType.ArrayOpen:
          stack.push(readArray(lexer));
          break;
        case TokenType.DictOpen:
          stack.push(readDict(lexer));
          break;
        case TokenType.Keyword:
          if (t.name === 'true') stack.push(true);
          else if (t.name === 'false') stack.push(false);
          else if (t.name === 'null') stack.push(null);
          else if (t.name === 'BI') this.skipInlineImage(lexer);
          else {
            await this.execute(t.name ?? '', stack, depth);
            stack.length = 0;
          }
          break;
        default:
          break;
      }
    }
  }

  private async execute(op: string, args: PdfObject[], depth: number): Promise<void> {
    const ctx = this.ctx;
    switch (op) {
      // --- graphics state ---
      case 'q':
        this.stateStack.push({ ...this.gs });
        ctx.save();
        break;
      case 'Q':
        if (this.stateStack.length > 0) this.gs = this.stateStack.pop() as GraphicsState;
        ctx.restore();
        break;
      case 'cm': {
        const m = num6(args);
        this.gs.ctm = matMul(m, this.gs.ctm);
        ctx.transform(m.a, m.b, m.c, m.d, m.e, m.f);
        break;
      }
      case 'w':
        this.gs.lineWidth = n(args, 0);
        ctx.lineWidth = this.gs.lineWidth;
        break;
      case 'gs':
        // ExtGState: alpha/blend not modelled in this MVP.
        break;

      // --- path construction ---
      case 'm':
        ctx.moveTo(n(args, 0), n(args, 1));
        break;
      case 'l':
        ctx.lineTo(n(args, 0), n(args, 1));
        break;
      case 'c':
        ctx.bezierCurveTo(n(args, 0), n(args, 1), n(args, 2), n(args, 3), n(args, 4), n(args, 5));
        break;
      case 'v':
        // first control point = current point; canvas has no "current point"
        // getter, so approximate with a line-then-curve is wrong — use the
        // start as both controls is closest without tracking. Track manually:
        ctx.bezierCurveTo(n(args, 0), n(args, 1), n(args, 0), n(args, 1), n(args, 2), n(args, 3));
        break;
      case 'y':
        ctx.bezierCurveTo(n(args, 0), n(args, 1), n(args, 2), n(args, 3), n(args, 2), n(args, 3));
        break;
      case 're': {
        const x = n(args, 0);
        const y = n(args, 1);
        ctx.rect(x, y, n(args, 2), n(args, 3));
        break;
      }
      case 'h':
        ctx.closePath();
        break;

      // --- path painting ---
      case 'S':
        this.paint(false, true, 'nonzero');
        break;
      case 's':
        ctx.closePath();
        this.paint(false, true, 'nonzero');
        break;
      case 'f':
      case 'F':
        this.paint(true, false, 'nonzero');
        break;
      case 'f*':
        this.paint(true, false, 'evenodd');
        break;
      case 'B':
      case 'B*':
        this.paint(true, true, op === 'B*' ? 'evenodd' : 'nonzero');
        break;
      case 'b':
      case 'b*':
        ctx.closePath();
        this.paint(true, true, op === 'b*' ? 'evenodd' : 'nonzero');
        break;
      case 'n':
        this.paint(false, false, 'nonzero');
        break;
      case 'W':
        this.pendingClip = 'nonzero';
        break;
      case 'W*':
        this.pendingClip = 'evenodd';
        break;

      // --- color ---
      case 'g':
        this.gs.fill = gray(n(args, 0));
        break;
      case 'G':
        this.gs.stroke = gray(n(args, 0));
        break;
      case 'rg':
        this.gs.fill = rgb(n(args, 0), n(args, 1), n(args, 2));
        break;
      case 'RG':
        this.gs.stroke = rgb(n(args, 0), n(args, 1), n(args, 2));
        break;
      case 'k':
        this.gs.fill = cmyk(n(args, 0), n(args, 1), n(args, 2), n(args, 3));
        break;
      case 'K':
        this.gs.stroke = cmyk(n(args, 0), n(args, 1), n(args, 2), n(args, 3));
        break;
      case 'cs':
        this.gs.fillComps = this.colorSpaceComps(args[0]);
        break;
      case 'CS':
        this.gs.strokeComps = this.colorSpaceComps(args[0]);
        break;
      case 'sc':
      case 'scn':
        this.gs.fill = colorFromComps(args);
        break;
      case 'SC':
      case 'SCN':
        this.gs.stroke = colorFromComps(args);
        break;

      // --- text ---
      case 'BT':
        this.tm = IDENTITY;
        this.tlm = IDENTITY;
        break;
      case 'ET':
        break;
      case 'Tc':
        this.gs.charSpacing = n(args, 0);
        break;
      case 'Tw':
        this.gs.wordSpacing = n(args, 0);
        break;
      case 'Tz':
        this.gs.hScale = n(args, 0) / 100;
        break;
      case 'TL':
        this.gs.leading = n(args, 0);
        break;
      case 'Ts':
        this.gs.textRise = n(args, 0);
        break;
      case 'Tr':
        this.gs.renderMode = n(args, 0);
        break;
      case 'Tf':
        await this.setFont(args);
        break;
      case 'Td':
        this.tlm = matMul(translate(n(args, 0), n(args, 1)), this.tlm);
        this.tm = this.tlm;
        break;
      case 'TD':
        this.gs.leading = -n(args, 1);
        this.tlm = matMul(translate(n(args, 0), n(args, 1)), this.tlm);
        this.tm = this.tlm;
        break;
      case 'Tm':
        this.tlm = num6(args);
        this.tm = this.tlm;
        break;
      case 'T*':
        this.nextLine();
        break;
      case 'Tj':
        this.showText(args[0]);
        break;
      case 'TJ':
        this.showTextArray(args[0]);
        break;
      case "'":
        this.nextLine();
        this.showText(args[0]);
        break;
      case '"':
        this.gs.wordSpacing = n(args, 0);
        this.gs.charSpacing = n(args, 1);
        this.nextLine();
        this.showText(args[2]);
        break;

      // --- XObjects ---
      case 'Do':
        await this.doXObject(args[0], depth);
        break;

      default:
        // Unsupported operator — ignore (marked content, shadings, etc.).
        break;
    }
  }

  private paint(doFill: boolean, doStroke: boolean, rule: CanvasFillRule): void {
    const ctx = this.ctx;
    if (doFill) {
      ctx.fillStyle = this.gs.fill;
      ctx.fill(rule);
    }
    if (doStroke) {
      ctx.strokeStyle = this.gs.stroke;
      ctx.lineWidth = this.gs.lineWidth;
      ctx.stroke();
    }
    if (this.pendingClip) {
      ctx.clip(this.pendingClip);
      this.pendingClip = null;
    }
    ctx.beginPath();
  }

  // --- text helpers ---

  private nextLine(): void {
    this.tlm = matMul(translate(0, -this.gs.leading), this.tlm);
    this.tm = this.tlm;
  }

  private async setFont(args: PdfObject[]): Promise<void> {
    const name = args[0];
    const size = n(args, 1);
    this.gs.fontSize = size;
    if (!isName(name)) return;
    const fontDict = dictOf(this.resolve(this.getResource('Font', name.name)));
    if (!fontDict) {
      this.gs.font = null;
      return;
    }
    let font = this.fontCache.get(fontDict);
    if (!font) {
      font = await buildFont(fontDict, this.resolve);
      this.fontCache.set(fontDict, font);
    }
    this.gs.font = font;
  }

  private showText(arg: PdfObject | undefined): void {
    if (!(arg instanceof Uint8Array) || !this.gs.font) return;
    const glyphs = this.gs.font.decodeString(arg);
    for (const g of glyphs) this.drawGlyph(g);
  }

  private showTextArray(arg: PdfObject | undefined): void {
    if (!isArray(arg) || !this.gs.font) return;
    for (const el of arg) {
      if (el instanceof Uint8Array) {
        this.showText(el);
      } else if (isNumber(el)) {
        const tx = (-el / 1000) * this.gs.fontSize * this.gs.hScale;
        this.tm = matMul(translate(tx, 0), this.tm);
      }
    }
  }

  private drawGlyph(g: Glyph): void {
    const { fontSize, hScale, textRise, renderMode } = this.gs;
    if (g.char && renderMode !== 3 && renderMode !== 7) {
      // Text rendering matrix, with a local y-flip so the fallback font (drawn
      // y-down by fillText) appears upright in our y-up device space.
      const textState: Matrix = {
        a: fontSize * hScale,
        b: 0,
        c: 0,
        d: -fontSize,
        e: 0,
        f: textRise,
      };
      const m = matMul(textState, matMul(this.tm, this.gs.ctm));
      const ctx = this.ctx;
      ctx.save();
      ctx.setTransform(m.a, m.b, m.c, m.d, m.e, m.f);
      ctx.font = `1px ${FALLBACK_FONT_FAMILY}`;
      ctx.fillStyle = this.gs.fill;
      ctx.fillText(g.char, 0, 0);
      ctx.restore();
    }
    const w0 = g.width / 1000;
    const wordSpace = g.code === 32 && g.bytes === 1 ? this.gs.wordSpacing : 0;
    const tx = (w0 * fontSize + this.gs.charSpacing + wordSpace) * hScale;
    this.tm = matMul(translate(tx, 0), this.tm);
  }

  // --- resources / XObjects ---

  private getResource(category: string, name: string): PdfObject | undefined {
    const cat = dictOf(this.resolve(this.resources[category]));
    return cat?.[name];
  }

  private async doXObject(arg: PdfObject | undefined, depth: number): Promise<void> {
    if (!isName(arg)) return;
    const xobj = this.resolve(this.getResource('XObject', arg.name));
    if (!isStream(xobj)) return;
    const subtype = nameOf(this.resolve(xobj.dict['Subtype']));
    if (subtype === 'Image') {
      await drawImageXObject(this.ctx, xobj, this.resolve, this.gs.ctm, this.gs.fill);
    } else if (subtype === 'Form' && depth < MAX_FORM_DEPTH) {
      await this.doFormXObject(xobj, depth);
    }
  }

  private async doFormXObject(form: PdfStream, depth: number): Promise<void> {
    const ctx = this.ctx;
    this.stateStack.push({ ...this.gs });
    ctx.save();

    const matrix = this.resolve(form.dict['Matrix']);
    if (isArray(matrix) && matrix.length === 6) {
      const m = num6(matrix);
      this.gs.ctm = matMul(m, this.gs.ctm);
      ctx.transform(m.a, m.b, m.c, m.d, m.e, m.f);
    }

    const formResources = dictOf(this.resolve(form.dict['Resources'])) ?? this.resources;
    this.resourceStack.push(formResources);
    try {
      const { bytes } = await decodeStream(form, this.resolve);
      await this.run(bytes, depth + 1);
    } catch {
      // ignore malformed form content
    }
    this.resourceStack.pop();

    if (this.stateStack.length > 0) this.gs = this.stateStack.pop() as GraphicsState;
    ctx.restore();
  }

  private colorSpaceComps(arg: PdfObject | undefined): number {
    if (isName(arg)) {
      if (arg.name === 'DeviceGray' || arg.name === 'G' || arg.name === 'CalGray') return 1;
      if (arg.name === 'DeviceCMYK' || arg.name === 'CMYK') return 4;
      if (arg.name === 'DeviceRGB' || arg.name === 'RGB' || arg.name === 'CalRGB') return 3;
      // Named color space in resources — resolve to its base.
      const cs = this.resolve(this.getResource('ColorSpace', arg.name));
      if (isArray(cs)) return colorSpaceArrayComps(cs, this.resolve);
    }
    return 1;
  }

  private skipInlineImage(lexer: Lexer): void {
    // Consume the inline-image dictionary up to 'ID', then scan the raw bytes
    // for the 'EI' terminator. Inline images are not drawn in this MVP.
    for (;;) {
      const t = lexer.next();
      if (t.type === TokenType.Eof) return;
      if (t.type === TokenType.Keyword && t.name === 'ID') break;
    }
    const b = lexer.bytes;
    let i = lexer.pos + 1; // skip the single whitespace after ID
    while (i + 1 < b.length) {
      if (b[i] === 0x45 && b[i + 1] === 0x49 && isWs(b[i - 1]) && (i + 2 >= b.length || isWs(b[i + 2]))) {
        lexer.pos = i + 2;
        return;
      }
      i++;
    }
    lexer.pos = b.length;
  }
}

// ---- operand readers --------------------------------------------------------

function readArray(lexer: Lexer): PdfObject[] {
  const arr: PdfObject[] = [];
  for (;;) {
    const t = lexer.next();
    if (t.type === TokenType.ArrayClose || t.type === TokenType.Eof) break;
    const v = tokenValue(t, lexer);
    if (v !== undefined) arr.push(v);
  }
  return arr;
}

function readDict(lexer: Lexer): PdfDict {
  const dict: PdfDict = {};
  for (;;) {
    const key = lexer.next();
    if (key.type === TokenType.DictClose || key.type === TokenType.Eof) break;
    if (key.type !== TokenType.Name) continue;
    const val = tokenValue(lexer.next(), lexer);
    if (val !== undefined) dict[key.name ?? ''] = val;
  }
  return dict;
}

function tokenValue(t: Token, lexer: Lexer): PdfObject | undefined {
  switch (t.type) {
    case TokenType.Number:
      return t.num ?? 0;
    case TokenType.String:
      return t.bytes ?? new Uint8Array(0);
    case TokenType.Name:
      return new PdfName(t.name ?? '');
    case TokenType.ArrayOpen:
      return readArray(lexer);
    case TokenType.DictOpen:
      return readDict(lexer);
    case TokenType.Keyword:
      if (t.name === 'true') return true;
      if (t.name === 'false') return false;
      if (t.name === 'null') return null;
      return undefined;
    default:
      return undefined;
  }
}

// ---- numeric + color helpers ------------------------------------------------

function n(args: PdfObject[], i: number): number {
  const v = args[i];
  return isNumber(v) ? v : 0;
}

function num6(args: PdfObject[]): Matrix {
  return { a: n(args, 0), b: n(args, 1), c: n(args, 2), d: n(args, 3), e: n(args, 4), f: n(args, 5) };
}

function clamp255(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

function gray(v: number): string {
  const x = clamp255(v * 255);
  return `rgb(${x}, ${x}, ${x})`;
}

function rgb(r: number, g: number, b: number): string {
  return `rgb(${clamp255(r * 255)}, ${clamp255(g * 255)}, ${clamp255(b * 255)})`;
}

function cmyk(c: number, m: number, y: number, k: number): string {
  const r = 255 * (1 - c) * (1 - k);
  const g = 255 * (1 - m) * (1 - k);
  const b = 255 * (1 - y) * (1 - k);
  return `rgb(${clamp255(r)}, ${clamp255(g)}, ${clamp255(b)})`;
}

function colorFromComps(args: PdfObject[]): string {
  const nums = args.filter(isNumber);
  if (nums.length === 1) return gray(nums[0]);
  if (nums.length === 3) return rgb(nums[0], nums[1], nums[2]);
  if (nums.length === 4) return cmyk(nums[0], nums[1], nums[2], nums[3]);
  // Pattern or unsupported space — use a neutral mid-gray so content stays
  // visible rather than defaulting to invisible white.
  return 'rgb(128, 128, 128)';
}

function colorSpaceArrayComps(cs: PdfObject[], resolve: Resolver): number {
  const kind = nameOf(resolve(cs[0]));
  if (kind === 'ICCBased') {
    const stream = resolve(cs[1]);
    if (isStream(stream) && isNumber(stream.dict['N'])) return stream.dict['N'];
    return 3;
  }
  if (kind === 'CalRGB' || kind === 'Lab') return 3;
  if (kind === 'CalGray') return 1;
  if (kind === 'Indexed' || kind === 'Separation') return 1;
  if (kind === 'DeviceN') {
    const names = resolve(cs[1]);
    return isArray(names) ? names.length : 1;
  }
  return 3;
}

function nameOf(o: PdfObject | undefined): string {
  return isName(o) ? o.name : '';
}

function isWs(b: number): boolean {
  return b === 0x20 || b === 0x0a || b === 0x0d || b === 0x09 || b === 0x0c || b === 0x00;
}
