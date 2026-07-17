import { useEffect, useRef, useState } from 'react';
import { Download, FileText } from 'lucide-react';
import { pdfClient } from '@/lib/pdf/pdf-client';
import type { LoadedPdf } from '@/lib/pdf/pdf-client';
import { PdfViewerDialog } from './PdfViewerDialog';
import { cn } from '@/lib/utils';

const THUMB_SCALE = 0.7;

type State = 'idle' | 'loading' | 'ready' | 'error';

export function PdfAttachmentCard({ url, fileName }: { url: string; fileName: string }) {
  const [inView, setInView] = useState(false);
  const [state, setState] = useState<State>('idle');
  const [doc, setDoc] = useState<LoadedPdf | null>(null);
  const [open, setOpen] = useState(false);
  const cardRef = useRef<HTMLButtonElement>(null);
  const thumbRef = useRef<HTMLCanvasElement>(null);

  // Defer loading until the card scrolls into view — a channel may hold many
  // PDFs and we don't want to parse them all eagerly.
  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setInView(true);
          io.disconnect();
        }
      },
      { rootMargin: '200px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!inView || state !== 'idle') return;
    let cancelled = false;
    void (async () => {
      setState('loading');
      try {
        const res = await fetch(url, { credentials: 'include' });
        if (!res.ok) throw new Error(`fetch ${res.status}`);
        const buf = await res.arrayBuffer();
        const loaded = await pdfClient.loadPdf(buf);
        if (cancelled) return;
        setDoc(loaded);
        setState('ready');
        const bitmap = await pdfClient.renderPage(loaded.docId, 0, THUMB_SCALE);
        if (cancelled) return;
        const canvas = thumbRef.current;
        if (canvas) {
          canvas.width = bitmap.width;
          canvas.height = bitmap.height;
          canvas.getContext('2d')?.drawImage(bitmap, 0, 0);
        }
      } catch {
        if (!cancelled) setState('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [inView, state, url]);

  // Graceful fallback: if parsing fails (encrypted, corrupt, unsupported),
  // fall back to the plain download link the app used before.
  if (state === 'error') {
    return (
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="flex items-center gap-2 rounded-lg border border-border bg-card px-2.5 py-1.5 text-sm hover:bg-muted"
      >
        <Download className="size-4 text-muted-foreground" />
        <span>{fileName}</span>
      </a>
    );
  }

  return (
    <>
      <button
        ref={cardRef}
        type="button"
        onClick={() => doc && setOpen(true)}
        disabled={state !== 'ready'}
        className="group flex w-64 flex-col overflow-hidden rounded-lg border border-border bg-card text-left transition-colors hover:bg-muted disabled:cursor-default"
      >
        <div className="relative flex h-40 items-center justify-center overflow-hidden border-b border-border bg-muted/40">
          <canvas ref={thumbRef} className="max-h-full max-w-full object-contain" />
          {state !== 'ready' && (
            <span className="absolute text-xs text-muted-foreground">Carregando prévia…</span>
          )}
        </div>
        <div className="flex items-center gap-2 px-2.5 py-1.5 text-sm">
          <FileText className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate">{fileName}</span>
          {doc && (
            <span className={cn('ml-auto shrink-0 text-xs text-muted-foreground tabular-nums')}>
              {doc.pageCount} pág.
            </span>
          )}
        </div>
      </button>
      {doc && (
        <PdfViewerDialog
          open={open}
          onOpenChange={setOpen}
          loaded={doc}
          fileName={fileName}
          downloadUrl={url}
        />
      )}
    </>
  );
}
