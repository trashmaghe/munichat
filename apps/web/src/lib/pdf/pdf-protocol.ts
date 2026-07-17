// Message contract between the main thread (pdf-client) and the worker.
// Type-only — imported by both sides so the wire shapes never drift.

export type PdfWorkerRequest =
  | { id: number; type: 'load'; docId: string; bytes: ArrayBuffer }
  | { id: number; type: 'renderPage'; docId: string; pageIndex: number; scale: number }
  | { id: number; type: 'dispose'; docId: string };

export type PdfErrorReason = 'encrypted' | 'not-loaded' | 'corrupt';

export interface PageSize {
  width: number; // points (1/72 inch) at scale 1, rotation applied
  height: number;
}

export type PdfWorkerResponse =
  | { id: number; ok: true; type: 'load'; pageCount: number; title?: string; pageSizes: PageSize[] }
  | { id: number; ok: true; type: 'renderPage'; bitmap: ImageBitmap; width: number; height: number }
  | { id: number; ok: true; type: 'dispose' }
  | { id: number; ok: false; reason: PdfErrorReason; message?: string };
