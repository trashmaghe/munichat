// Page rasterization: sets up the base transform that maps a page's MediaBox
// (with rotation) to device pixels, runs the content interpreter against an
// OffscreenCanvas, and returns the result as an ImageBitmap.

import { PdfDocument } from './document';
import type { PdfPage } from './document';
import { ContentInterpreter } from './content-interpreter';
import type { CanvasLike } from './content-interpreter';
import { matMul } from './matrix';
import type { Matrix } from './matrix';

export interface RenderedPage {
  bitmap: ImageBitmap;
  width: number; // device pixels
  height: number;
}

// Compute the device size of a page at a given scale, accounting for rotation.
export function pagePixelSize(page: PdfPage, scale: number): { width: number; height: number } {
  const [x0, y0, x1, y1] = page.mediaBox;
  const w = Math.abs(x1 - x0);
  const h = Math.abs(y1 - y0);
  const rot = ((page.rotate % 360) + 360) % 360;
  const swap = rot === 90 || rot === 270;
  return {
    width: Math.max(1, Math.round((swap ? h : w) * scale)),
    height: Math.max(1, Math.round((swap ? w : h) * scale)),
  };
}

// Base transform: PDF user space (y-up, MediaBox origin) → device pixels
// (y-down, top-left origin), including page rotation and the render scale.
function baseTransform(page: PdfPage, scale: number, pxW: number, pxH: number): Matrix {
  const [x0, y0, , y1] = page.mediaBox;
  const pageH = Math.abs(y1 - y0);

  // Map user space (y-up) to an unrotated, top-left-origin device space.
  const flip: Matrix = {
    a: scale,
    b: 0,
    c: 0,
    d: -scale,
    e: -x0 * scale,
    f: (pageH + y0) * scale,
  };

  // Then rotate into the final pxW×pxH canvas (rare for the target documents).
  const rot = ((page.rotate % 360) + 360) % 360;
  let rotM: Matrix;
  switch (rot) {
    case 90:
      rotM = { a: 0, b: 1, c: -1, d: 0, e: pxW, f: 0 };
      break;
    case 180:
      rotM = { a: -1, b: 0, c: 0, d: -1, e: pxW, f: pxH };
      break;
    case 270:
      rotM = { a: 0, b: -1, c: 1, d: 0, e: 0, f: pxH };
      break;
    default:
      return flip;
  }
  return matMul(flip, rotM);
}

export async function renderPage(
  doc: PdfDocument,
  pageIndex: number,
  scale: number,
): Promise<RenderedPage> {
  const page = doc.getPage(pageIndex);
  const { width, height } = pagePixelSize(page, scale);

  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D context unavailable');

  // White page background.
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.restore();

  const baseCtm = baseTransform(page, scale, width, height);
  const content = await doc.getPageContent(page);
  const interpreter = new ContentInterpreter({
    ctx: ctx as unknown as CanvasLike,
    resolve: (o) => doc.resolve(o),
    baseCtm,
    resources: page.resources,
  });
  try {
    await interpreter.run(content);
  } catch {
    // Partial render is better than none — return whatever was drawn.
  }

  return { bitmap: canvas.transferToImageBitmap(), width, height };
}
