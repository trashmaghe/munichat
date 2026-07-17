import { describe, expect, it } from 'vitest';
import { PdfDocument } from './document';
import { ContentInterpreter } from './content-interpreter';
import type { CanvasLike } from './content-interpreter';
import { IDENTITY } from './matrix';

// End-to-end: a real (constructed) PDF is parsed, its page content decoded, and
// run through the interpreter against a recording canvas. Covers the full chain
// document → getPageContent → interpreter (the OffscreenCanvas rasterization in
// render.ts needs a real browser and is verified manually).

const enc = (s: string) => new TextEncoder().encode(s);

function buildClassicPdf(bodies: string[]): Uint8Array {
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (let i = 0; i < bodies.length; i++) {
    offsets[i] = out.length;
    out += `${i + 1} 0 obj\n${bodies[i]}\nendobj\n`;
  }
  const xrefPos = out.length;
  const n = bodies.length + 1;
  out += `xref\n0 ${n}\n0000000000 65535 f \n`;
  for (let i = 0; i < bodies.length; i++) {
    out += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  out += `trailer\n<< /Size ${n} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF`;
  return enc(out);
}

class Recorder implements CanvasLike {
  fillStyle = '#000000';
  strokeStyle = '#000000';
  lineWidth = 1;
  font = '';
  texts: string[] = [];
  fillColors: string[] = [];
  ops: string[] = [];
  save() {
    this.ops.push('save');
  }
  restore() {
    this.ops.push('restore');
  }
  setTransform() {}
  transform() {}
  beginPath() {}
  moveTo() {}
  lineTo() {}
  bezierCurveTo() {}
  closePath() {}
  rect() {
    this.ops.push('rect');
  }
  fill() {
    this.fillColors.push(this.fillStyle);
    this.ops.push('fill');
  }
  stroke() {}
  clip() {}
  fillText(t: string) {
    this.texts.push(t);
  }
  fillRect() {}
  drawImage() {}
}

describe('PDF integration — parse to draw', () => {
  const content =
    '1 0 0 rg 10 10 100 50 re f BT /F1 12 Tf 20 120 Td (Oi) Tj ET';
  const pdf = buildClassicPdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] ' +
      '/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]);

  it('renders a filled rectangle and text from a parsed page', async () => {
    const doc = await PdfDocument.load(pdf);
    expect(doc.pageCount).toBe(1);
    const page = doc.getPage(0);
    const bytes = await doc.getPageContent(page);

    const canvas = new Recorder();
    const interp = new ContentInterpreter({
      ctx: canvas,
      resolve: (o) => doc.resolve(o),
      baseCtm: IDENTITY,
      resources: page.resources,
    });
    await interp.run(bytes);

    // The rectangle was filled red…
    expect(canvas.ops).toContain('rect');
    expect(canvas.fillColors).toContain('rgb(255, 0, 0)');
    // …and the text glyphs were drawn (font resolved via the page resources).
    expect(canvas.texts.join('')).toBe('Oi');
  });
});
