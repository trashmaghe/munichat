import { useEffect, useRef, useState } from 'react';
import { Dialog } from '@base-ui/react/dialog';
import { Download, X, ZoomIn, ZoomOut } from 'lucide-react';
import type { LoadedPdf } from '@/lib/pdf/pdf-client';
import { pdfClient } from '@/lib/pdf/pdf-client';
import type { PageSize } from '@/lib/pdf/pdf-protocol';
import { cn } from '@/lib/utils';

const MIN_SCALE = 0.5;
const MAX_SCALE = 3;
const STEP = 0.25;

export function PdfViewerDialog({
  open,
  onOpenChange,
  loaded,
  fileName,
  downloadUrl,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  loaded: LoadedPdf;
  fileName: string;
  downloadUrl: string;
}) {
  const [scale, setScale] = useState(1.25);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/70 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
        <Dialog.Popup className="fixed inset-0 z-50 flex flex-col bg-background outline-none">
          <header className="flex items-center justify-between gap-3 border-b border-border bg-card px-4 py-2">
            <Dialog.Title className="truncate text-sm font-medium">{fileName}</Dialog.Title>
            <div className="flex items-center gap-1 text-sm">
              <button
                type="button"
                aria-label="Diminuir zoom"
                className="rounded-md p-1.5 hover:bg-muted disabled:opacity-40"
                disabled={scale <= MIN_SCALE}
                onClick={() => setScale((s) => Math.max(MIN_SCALE, s - STEP))}
              >
                <ZoomOut className="size-4" />
              </button>
              <span className="w-12 text-center tabular-nums text-muted-foreground">
                {Math.round(scale * 100)}%
              </span>
              <button
                type="button"
                aria-label="Aumentar zoom"
                className="rounded-md p-1.5 hover:bg-muted disabled:opacity-40"
                disabled={scale >= MAX_SCALE}
                onClick={() => setScale((s) => Math.min(MAX_SCALE, s + STEP))}
              >
                <ZoomIn className="size-4" />
              </button>
              <a
                href={downloadUrl}
                target="_blank"
                rel="noreferrer"
                aria-label="Baixar PDF"
                className="rounded-md p-1.5 hover:bg-muted"
              >
                <Download className="size-4" />
              </a>
              <Dialog.Close
                aria-label="Fechar"
                className="rounded-md p-1.5 hover:bg-muted"
              >
                <X className="size-4" />
              </Dialog.Close>
            </div>
          </header>

          <div className="flex flex-1 flex-col items-center gap-4 overflow-auto bg-muted/40 p-4">
            {loaded.pageSizes.map((size, i) => (
              <PdfPageCanvas key={i} docId={loaded.docId} index={i} size={size} scale={scale} />
            ))}
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function PdfPageCanvas({
  docId,
  index,
  size,
  scale,
}: {
  docId: string;
  index: number;
  size: PageSize;
  scale: number;
}) {
  const slotRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [inView, setInView] = useState(false);
  const [rendered, setRendered] = useState(false);

  const cssW = Math.round(size.width * scale);
  const cssH = Math.round(size.height * scale);

  useEffect(() => {
    const el = slotRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => setInView(entries.some((e) => e.isIntersecting)),
      { rootMargin: '300px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!inView) return;
    let cancelled = false;
    const dpr = window.devicePixelRatio || 1;
    void (async () => {
      try {
        const bitmap = await pdfClient.renderPage(docId, index, scale * dpr);
        if (cancelled) return;
        const canvas = canvasRef.current;
        if (canvas) {
          canvas.width = bitmap.width;
          canvas.height = bitmap.height;
          canvas.getContext('2d')?.drawImage(bitmap, 0, 0);
          setRendered(true);
        }
      } catch {
        // leave the placeholder in place
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [inView, scale, docId, index]);

  return (
    <div
      ref={slotRef}
      className="relative shrink-0 border border-border bg-white shadow-sm"
      style={{ width: cssW, height: cssH }}
    >
      <canvas
        ref={canvasRef}
        className={cn('h-full w-full', !rendered && 'opacity-0')}
        style={{ width: cssW, height: cssH }}
      />
    </div>
  );
}
