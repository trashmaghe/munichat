// Image XObject rendering. Flate/raw rasters are blitted via a temporary
// ImageData; JPEG (DCTDecode) is decoded natively with createImageBitmap.
// Scanned-page formats (CCITT/JBIG2/CMYK-JPEG) are out of scope and draw
// nothing.

import { decodeStream } from './filters';
import { PdfStream, isArray, isName, isNumber, isStream } from './types';
import type { PdfObject } from './types';
import type { CanvasLike } from './content-interpreter';
import type { Matrix } from './matrix';

type Resolver = (o: PdfObject | undefined) => PdfObject | undefined;

// A PDF image XObject occupies the unit square (0,0)-(1,1) in user space; the
// CTM maps that square to the page. We draw the decoded bitmap into that unit
// square with a local flip (image rows are top-down; our device space is y-up).
export async function drawImageXObject(
  ctx: CanvasLike,
  image: PdfStream,
  resolve: Resolver,
  ctm: Matrix,
  fillColor: string,
): Promise<void> {
  const dict = image.dict;
  const width = numOr(resolve(dict['Width'] ?? dict['W']), 0);
  const height = numOr(resolve(dict['Height'] ?? dict['H']), 0);
  if (width <= 0 || height <= 0) return;

  const source = await decodeImage(image, resolve, width, height, fillColor);
  if (!source) return;

  ctx.save();
  // Map the unit square to the page, then flip vertically so the top image row
  // lands at the top of that square.
  ctx.setTransform(ctm.a, ctm.b, ctm.c, ctm.d, ctm.e, ctm.f);
  ctx.transform(1 / width, 0, 0, -1 / height, 0, 1);
  ctx.drawImage(source, 0, 0, width, height);
  ctx.restore();
}

async function decodeImage(
  image: PdfStream,
  resolve: Resolver,
  width: number,
  height: number,
  fillColor: string,
): Promise<CanvasImageSource | null> {
  const decoded = await decodeStream(image, resolve);

  if (decoded.imageFilter === 'DCTDecode' || decoded.imageFilter === 'DCT') {
    // Hand the JPEG bytes straight to the platform decoder.
    try {
      const copy = decoded.bytes.slice();
      const blob = new Blob([copy as BlobPart], { type: 'image/jpeg' });
      return await createImageBitmap(blob);
    } catch {
      return null;
    }
  }
  if (decoded.imageFilter) {
    // CCITT/JBIG2/JPX — unsupported in this MVP.
    return null;
  }

  return rasterToBitmap(image, decoded.bytes, resolve, width, height, fillColor);
}

// Convert raw (already Flate-decoded) sample bytes into an ImageBitmap. Handles
// the common cases: 1-bit image masks, 8-bit gray, and 8-bit RGB.
async function rasterToBitmap(
  image: PdfStream,
  data: Uint8Array,
  resolve: Resolver,
  width: number,
  height: number,
  fillColor: string,
): Promise<CanvasImageSource | null> {
  const dict = image.dict;
  const bpc = numOr(resolve(dict['BitsPerComponent'] ?? dict['BPC']), 8);
  const isMask = resolve(dict['ImageMask'] ?? dict['IM']) === true;
  const rgba = new Uint8ClampedArray(width * height * 4);

  if (isMask || bpc === 1) {
    const [fr, fg, fb] = parseRgb(fillColor);
    const rowBytes = Math.ceil(width / 8);
    // For an image mask, a 0 bit paints (with the fill colour) and 1 is
    // transparent by default (/Decode can invert, not handled here).
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const bit = (data[y * rowBytes + (x >> 3)] >> (7 - (x & 7))) & 1;
        const o = (y * width + x) * 4;
        if (isMask) {
          const paint = bit === 0;
          rgba[o] = fr;
          rgba[o + 1] = fg;
          rgba[o + 2] = fb;
          rgba[o + 3] = paint ? 255 : 0;
        } else {
          const v = bit ? 255 : 0;
          rgba[o] = v;
          rgba[o + 1] = v;
          rgba[o + 2] = v;
          rgba[o + 3] = 255;
        }
      }
    }
    return bitmapFrom(rgba, width, height);
  }

  const comps = componentCount(dict, resolve);
  if (bpc === 8 && comps === 1) {
    for (let i = 0; i < width * height; i++) {
      const v = data[i] ?? 0;
      rgba[i * 4] = v;
      rgba[i * 4 + 1] = v;
      rgba[i * 4 + 2] = v;
      rgba[i * 4 + 3] = 255;
    }
    return bitmapFrom(rgba, width, height);
  }
  if (bpc === 8 && comps === 3) {
    for (let i = 0; i < width * height; i++) {
      rgba[i * 4] = data[i * 3] ?? 0;
      rgba[i * 4 + 1] = data[i * 3 + 1] ?? 0;
      rgba[i * 4 + 2] = data[i * 3 + 2] ?? 0;
      rgba[i * 4 + 3] = 255;
    }
    return bitmapFrom(rgba, width, height);
  }
  if (bpc === 8 && comps === 4) {
    // DeviceCMYK raster.
    for (let i = 0; i < width * height; i++) {
      const c = (data[i * 4] ?? 0) / 255;
      const m = (data[i * 4 + 1] ?? 0) / 255;
      const yl = (data[i * 4 + 2] ?? 0) / 255;
      const k = (data[i * 4 + 3] ?? 0) / 255;
      rgba[i * 4] = 255 * (1 - c) * (1 - k);
      rgba[i * 4 + 1] = 255 * (1 - m) * (1 - k);
      rgba[i * 4 + 2] = 255 * (1 - yl) * (1 - k);
      rgba[i * 4 + 3] = 255;
    }
    return bitmapFrom(rgba, width, height);
  }

  return null; // unsupported depth
}

function componentCount(dict: Record<string, PdfObject>, resolve: Resolver): number {
  const cs = resolve(dict['ColorSpace'] ?? dict['CS']);
  if (isName(cs)) {
    if (cs.name === 'DeviceGray' || cs.name === 'G' || cs.name === 'CalGray') return 1;
    if (cs.name === 'DeviceCMYK' || cs.name === 'CMYK') return 4;
    return 3;
  }
  if (isArray(cs)) {
    const kind = isName(cs[0]) ? cs[0].name : '';
    if (kind === 'ICCBased') {
      const s = resolve(cs[1]);
      if (isStream(s) && isNumber(s.dict['N'])) return s.dict['N'];
    }
    if (kind === 'Indexed') return 1;
    if (kind === 'CalGray') return 1;
    if (kind === 'DeviceN') {
      const names = resolve(cs[1]);
      return isArray(names) ? names.length : 1;
    }
  }
  return 1;
}

async function bitmapFrom(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
): Promise<CanvasImageSource | null> {
  try {
    const imageData = new ImageData(rgba as unknown as Uint8ClampedArray<ArrayBuffer>, width, height);
    return await createImageBitmap(imageData);
  } catch {
    return null;
  }
}

function parseRgb(css: string): [number, number, number] {
  const m = /rgb\((\d+),\s*(\d+),\s*(\d+)\)/.exec(css);
  if (!m) return [0, 0, 0];
  return [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10)];
}

function numOr(o: PdfObject | undefined, fallback: number): number {
  return isNumber(o) ? o : fallback;
}
