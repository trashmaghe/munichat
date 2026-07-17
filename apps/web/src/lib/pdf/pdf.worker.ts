// Web Worker entry point. Parses PDFs and rasterizes pages off the main thread,
// transferring ImageBitmaps back (zero-copy). See pdf-client.ts for the caller.
//
// We avoid pulling in the TS "webworker" lib (it conflicts with the app's DOM
// lib) by treating the worker global through a minimal local interface.

import { PdfDocument } from './document';
import { pagePixelSize, renderPage } from './render';
import type { PageSize, PdfWorkerRequest, PdfWorkerResponse } from './pdf-protocol';

interface WorkerCtx {
  onmessage: ((e: MessageEvent<PdfWorkerRequest>) => void) | null;
  postMessage(message: PdfWorkerResponse, transfer?: Transferable[]): void;
}

const ctx = self as unknown as WorkerCtx;
const docs = new Map<string, PdfDocument>();

ctx.onmessage = (e: MessageEvent<PdfWorkerRequest>) => {
  void handle(e.data);
};

async function handle(msg: PdfWorkerRequest): Promise<void> {
  try {
    if (msg.type === 'load') {
      const doc = await PdfDocument.load(new Uint8Array(msg.bytes));
      if (doc.encrypted) {
        ctx.postMessage({ id: msg.id, ok: false, reason: 'encrypted' });
        return;
      }
      docs.set(msg.docId, doc);
      const pageSizes: PageSize[] = [];
      for (let i = 0; i < doc.pageCount; i++) {
        pageSizes.push(pagePixelSize(doc.getPage(i), 1));
      }
      ctx.postMessage({
        id: msg.id,
        ok: true,
        type: 'load',
        pageCount: doc.pageCount,
        title: doc.title,
        pageSizes,
      });
    } else if (msg.type === 'renderPage') {
      const doc = docs.get(msg.docId);
      if (!doc) {
        ctx.postMessage({ id: msg.id, ok: false, reason: 'not-loaded' });
        return;
      }
      const { bitmap, width, height } = await renderPage(doc, msg.pageIndex, msg.scale);
      ctx.postMessage({ id: msg.id, ok: true, type: 'renderPage', bitmap, width, height }, [bitmap]);
    } else if (msg.type === 'dispose') {
      docs.delete(msg.docId);
      ctx.postMessage({ id: msg.id, ok: true, type: 'dispose' });
    }
  } catch (err) {
    ctx.postMessage({ id: msg.id, ok: false, reason: 'corrupt', message: String(err) });
  }
}
