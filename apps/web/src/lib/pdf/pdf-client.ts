// Main-thread API over the PDF worker. One shared worker serves every open
// viewer; requests are correlated by an incrementing id.

import type { PageSize, PdfErrorReason, PdfWorkerRequest, PdfWorkerResponse } from './pdf-protocol';

export class PdfError extends Error {
  readonly reason: PdfErrorReason;
  constructor(reason: PdfErrorReason, message?: string) {
    super(message ?? reason);
    this.name = 'PdfError';
    this.reason = reason;
  }
}

export interface LoadedPdf {
  docId: string;
  pageCount: number;
  title?: string;
  pageSizes: PageSize[];
}

interface Pending {
  resolve: (value: PdfWorkerResponse) => void;
  reject: (err: Error) => void;
}

class PdfClient {
  private worker: Worker | null = null;
  private nextId = 1;
  private pending = new Map<number, Pending>();

  private ensureWorker(): Worker {
    if (!this.worker) {
      this.worker = new Worker(new URL('./pdf.worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e: MessageEvent<PdfWorkerResponse>) => {
        const msg = e.data;
        const p = this.pending.get(msg.id);
        if (!p) return;
        this.pending.delete(msg.id);
        if (msg.ok) p.resolve(msg);
        else p.reject(new PdfError(msg.reason, msg.message));
      };
      this.worker.onerror = () => {
        for (const [, p] of this.pending) p.reject(new PdfError('corrupt', 'worker error'));
        this.pending.clear();
      };
    }
    return this.worker;
  }

  private send(req: PdfWorkerRequest, transfer: Transferable[] = []): Promise<PdfWorkerResponse> {
    const worker = this.ensureWorker();
    return new Promise((resolve, reject) => {
      this.pending.set(req.id, { resolve, reject });
      worker.postMessage(req, transfer);
    });
  }

  async loadPdf(bytes: ArrayBuffer): Promise<LoadedPdf> {
    const docId = crypto.randomUUID();
    const id = this.nextId++;
    // Transfer the buffer to the worker (zero-copy); the caller must not reuse it.
    const res = await this.send({ id, type: 'load', docId, bytes }, [bytes]);
    if (res.ok && res.type === 'load') {
      return { docId, pageCount: res.pageCount, title: res.title, pageSizes: res.pageSizes };
    }
    throw new PdfError('corrupt', 'unexpected load response');
  }

  async renderPage(docId: string, pageIndex: number, scale: number): Promise<ImageBitmap> {
    const id = this.nextId++;
    const res = await this.send({ id, type: 'renderPage', docId, pageIndex, scale });
    if (res.ok && res.type === 'renderPage') return res.bitmap;
    throw new PdfError('corrupt', 'unexpected render response');
  }

  dispose(docId: string): void {
    const id = this.nextId++;
    void this.send({ id, type: 'dispose', docId }).catch(() => undefined);
  }
}

// Shared singleton — the worker is created lazily on first use.
export const pdfClient = new PdfClient();
