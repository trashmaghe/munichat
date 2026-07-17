import { describe, expect, it } from 'vitest';
import { ContentInterpreter } from './content-interpreter';
import type { CanvasLike } from './content-interpreter';
import { IDENTITY } from './matrix';
import { bytesOf } from './lexer';
import { PdfName } from './types';
import type { PdfDict, PdfObject } from './types';

interface Call {
  op: string;
  args: number[] | string[];
}

class RecordingCanvas implements CanvasLike {
  fillStyle = '#000000';
  strokeStyle = '#000000';
  lineWidth = 1;
  font = '';
  calls: Call[] = [];
  texts: string[] = [];
  transforms: number[][] = [];
  fillStylesAtFill: string[] = [];

  private rec(op: string, args: number[] | string[] = []): void {
    this.calls.push({ op, args });
  }
  save() {
    this.rec('save');
  }
  restore() {
    this.rec('restore');
  }
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number) {
    this.transforms.push([a, b, c, d, e, f]);
    this.rec('setTransform', [a, b, c, d, e, f]);
  }
  transform(a: number, b: number, c: number, d: number, e: number, f: number) {
    this.rec('transform', [a, b, c, d, e, f]);
  }
  beginPath() {
    this.rec('beginPath');
  }
  moveTo(x: number, y: number) {
    this.rec('moveTo', [x, y]);
  }
  lineTo(x: number, y: number) {
    this.rec('lineTo', [x, y]);
  }
  bezierCurveTo(a: number, b: number, c: number, d: number, e: number, f: number) {
    this.rec('bezierCurveTo', [a, b, c, d, e, f]);
  }
  closePath() {
    this.rec('closePath');
  }
  rect(x: number, y: number, w: number, h: number) {
    this.rec('rect', [x, y, w, h]);
  }
  fill(rule?: CanvasFillRule) {
    this.fillStylesAtFill.push(this.fillStyle);
    this.rec('fill', [rule ?? 'nonzero']);
  }
  stroke() {
    this.rec('stroke');
  }
  clip() {
    this.rec('clip');
  }
  fillText(text: string) {
    this.texts.push(text);
    this.rec('fillText', [text]);
  }
  fillRect(x: number, y: number, w: number, h: number) {
    this.rec('fillRect', [x, y, w, h]);
  }
  drawImage() {
    this.rec('drawImage');
  }
}

const identity = (o: PdfObject | undefined) => o;

function makeInterpreter(canvas: CanvasLike, resources: PdfDict = {}) {
  return new ContentInterpreter({ ctx: canvas, resolve: identity, baseCtm: IDENTITY, resources });
}

describe('ContentInterpreter — graphics', () => {
  it('pushes/pops graphics state on q/Q', async () => {
    const c = new RecordingCanvas();
    await makeInterpreter(c).run(bytesOf('q Q'));
    const ops = c.calls.map((x) => x.op);
    expect(ops).toContain('save');
    expect(ops).toContain('restore');
  });

  it('constructs and strokes a path', async () => {
    const c = new RecordingCanvas();
    await makeInterpreter(c).run(bytesOf('10 20 m 30 40 l S'));
    expect(c.calls.find((x) => x.op === 'moveTo')?.args).toEqual([10, 20]);
    expect(c.calls.find((x) => x.op === 'lineTo')?.args).toEqual([30, 40]);
    expect(c.calls.some((x) => x.op === 'stroke')).toBe(true);
  });

  it('fills a rectangle with the active RGB colour', async () => {
    const c = new RecordingCanvas();
    await makeInterpreter(c).run(bytesOf('1 0 0 rg 0 0 100 50 re f'));
    expect(c.calls.find((x) => x.op === 'rect')?.args).toEqual([0, 0, 100, 50]);
    expect(c.fillStylesAtFill).toContain('rgb(255, 0, 0)');
  });

  it('converts CMYK fills to RGB', async () => {
    const c = new RecordingCanvas();
    await makeInterpreter(c).run(bytesOf('0 1 1 0 k 0 0 10 10 re f'));
    // pure magenta+yellow, no black → red
    expect(c.fillStylesAtFill).toContain('rgb(255, 0, 0)');
  });

  it('applies the even-odd fill rule for f*', async () => {
    const c = new RecordingCanvas();
    await makeInterpreter(c).run(bytesOf('0 0 10 10 re f*'));
    expect(c.calls.find((x) => x.op === 'fill')?.args).toEqual(['evenodd']);
  });
});

describe('ContentInterpreter — text', () => {
  const resources: PdfDict = {
    Font: {
      F1: { Subtype: new PdfName('Type1'), FirstChar: 0 },
    },
  };

  it('draws each glyph of a shown string and advances the text position', async () => {
    const c = new RecordingCanvas();
    await makeInterpreter(c, resources).run(bytesOf('BT /F1 12 Tf (Hi) Tj ET'));
    expect(c.texts).toEqual(['H', 'i']);
    // Two glyph draws each preceded by a setTransform; the second glyph's x
    // translation (index 4) must be greater than the first's.
    const glyphTransforms = c.transforms.filter((t) => t[0] === 12); // fontSize scale
    expect(glyphTransforms.length).toBe(2);
    expect(glyphTransforms[1][4]).toBeGreaterThan(glyphTransforms[0][4]);
  });

  it('applies TJ positioning adjustments between substrings', async () => {
    const c = new RecordingCanvas();
    await makeInterpreter(c, resources).run(bytesOf('BT /F1 12 Tf [(A) -500 (B)] TJ ET'));
    expect(c.texts).toEqual(['A', 'B']);
  });

  it('does not draw text in render mode 3 (invisible)', async () => {
    const c = new RecordingCanvas();
    await makeInterpreter(c, resources).run(bytesOf('BT /F1 12 Tf 3 Tr (Hidden) Tj ET'));
    expect(c.texts).toEqual([]);
  });
});
