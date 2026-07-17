import { describe, expect, it } from 'vitest';
import { PdfDocument } from './document';
import { PdfRef, dictOf, isName } from './types';

const enc = (s: string) => new TextEncoder().encode(s);

async function deflate(data: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream('deflate');
  const writer = cs.writable.getWriter();
  void writer.write(data as BufferSource);
  void writer.close();
  const reader = cs.readable.getReader();
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

// Assemble a classic-xref PDF from ASCII object bodies (object N = bodies[N-1]).
// Root is assumed to be object 1. ASCII-only, so char length == byte offset.
function buildClassicPdf(bodies: string[], trailerExtra = ''): Uint8Array {
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
  out += `trailer\n<< /Size ${n} /Root 1 0 R ${trailerExtra}>>\nstartxref\n${xrefPos}\n%%EOF`;
  return enc(out);
}

describe('PdfDocument — classic xref', () => {
  const pdf = buildClassicPdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Contents 4 0 R /Resources << >> >>',
    '<< /Length 34 >>\nstream\nBT /F1 12 Tf 10 50 Td (Hi) Tj ET\nendstream',
  ]);

  it('resolves the catalog by indirect reference', async () => {
    const doc = await PdfDocument.load(pdf);
    expect(doc.pageCount).toBe(1);
    const catalog = dictOf(doc.resolve(new PdfRef(1, 0)));
    expect(catalog).toBeDefined();
    expect(isName(catalog?.['Type'], 'Catalog')).toBe(true);
  });

  it('reads the inherited MediaBox and page content', async () => {
    const doc = await PdfDocument.load(pdf);
    const page = doc.getPage(0);
    expect(page.mediaBox).toEqual([0, 0, 200, 100]);
    const content = await doc.getPageContent(page);
    expect(new TextDecoder().decode(content)).toContain('(Hi) Tj');
  });
});

describe('PdfDocument — xref stream + object stream', () => {
  async function buildXrefStreamPdf(): Promise<Uint8Array> {
    const chunks: Uint8Array[] = [];
    let len = 0;
    const push = (u: Uint8Array) => {
      chunks.push(u);
      len += u.length;
    };
    const pushStr = (s: string) => push(enc(s));

    pushStr('%PDF-1.5\n');

    const o1 = '<< /Type /Catalog /Pages 2 0 R >>';
    const o2 = '<< /Type /Pages /Kids [3 0 R] /Count 1 >>';
    const o3 = '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /Resources << >> >>';
    const off2 = (o1 + ' ').length;
    const off3 = (o1 + ' ' + o2 + ' ').length;
    const header = `1 0 2 ${off2} 3 ${off3} `;
    const first = header.length;
    const objstm = await deflate(enc(header + `${o1} ${o2} ${o3}`));

    const obj4Offset = len;
    pushStr(
      `4 0 obj\n<< /Type /ObjStm /N 3 /First ${first} /Length ${objstm.length} /Filter /FlateDecode >>\nstream\n`,
    );
    push(objstm);
    pushStr('\nendstream\nendobj\n');

    const obj5Offset = len;
    const entries: [number, number, number][] = [
      [0, 0, 0],
      [2, 4, 0],
      [2, 4, 1],
      [2, 4, 2],
      [1, obj4Offset, 0],
      [1, obj5Offset, 0],
    ];
    const xdata = new Uint8Array(entries.length * 5);
    entries.forEach((e, i) => {
      xdata[i * 5] = e[0];
      xdata[i * 5 + 1] = (e[1] >> 8) & 0xff;
      xdata[i * 5 + 2] = e[1] & 0xff;
      xdata[i * 5 + 3] = (e[2] >> 8) & 0xff;
      xdata[i * 5 + 4] = e[2] & 0xff;
    });
    const xcomp = await deflate(xdata);
    pushStr(
      `5 0 obj\n<< /Type /XRef /Size 6 /W [1 2 2] /Index [0 6] /Root 1 0 R /Length ${xcomp.length} /Filter /FlateDecode >>\nstream\n`,
    );
    push(xcomp);
    pushStr('\nendstream\nendobj\n');
    pushStr(`startxref\n${obj5Offset}\n%%EOF`);

    const out = new Uint8Array(len);
    let o = 0;
    for (const c of chunks) {
      out.set(c, o);
      o += c.length;
    }
    return out;
  }

  it('resolves objects compressed inside an object stream', async () => {
    const pdf = await buildXrefStreamPdf();
    const doc = await PdfDocument.load(pdf);
    expect(doc.encrypted).toBe(false);
    expect(doc.pageCount).toBe(1);
    expect(doc.getPage(0).mediaBox).toEqual([0, 0, 300, 400]);
  });
});

describe('PdfDocument — edge cases', () => {
  it('flags an encrypted document and skips page building', async () => {
    const pdf = buildClassicPdf(
      [
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Resources << >> >>',
      ],
      '/Encrypt 4 0 R ',
    );
    const doc = await PdfDocument.load(pdf);
    expect(doc.encrypted).toBe(true);
    expect(doc.pageCount).toBe(0);
  });

  it('recovers via full-file scan when startxref is broken', async () => {
    let pdf = new TextDecoder().decode(
      buildClassicPdf([
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 210 297] /Resources << >> >>',
      ]),
    );
    // Corrupt the startxref offset so the structured path fails.
    pdf = pdf.replace(/startxref\n\d+/, 'startxref\n999999');
    const doc = await PdfDocument.load(enc(pdf));
    expect(doc.pageCount).toBe(1);
    expect(doc.getPage(0).mediaBox).toEqual([0, 0, 210, 297]);
  });
});
