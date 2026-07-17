import { useEffect, useRef, useState } from 'react';
import { Send, Trash2 } from 'lucide-react';
import { formatDuration } from '@/lib/format-duration';

const BAR_COUNT = 36;
const SAMPLE_INTERVAL_MS = 90;

// The composer's recording state: a pulsing dot, a running timer, a live
// waveform that scrolls as the mic captures amplitude, and cancel/send.
export function RecordingBar({
  elapsedMs,
  getLevel,
  onCancel,
  onSend,
  disabled = false,
}: {
  elapsedMs: number;
  getLevel: () => number;
  onCancel: () => void;
  onSend: () => void;
  disabled?: boolean;
}) {
  const [bars, setBars] = useState<number[]>(() => new Array(BAR_COUNT).fill(0.08));
  const barsRef = useRef(bars);

  useEffect(() => {
    const reduce =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) return;
    let raf = 0;
    let last = 0;
    const tick = (now: number) => {
      if (now - last >= SAMPLE_INTERVAL_MS) {
        last = now;
        const level = Math.max(0.08, Math.min(1, getLevel()));
        const next = [...barsRef.current.slice(1), level];
        barsRef.current = next;
        setBars(next);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [getLevel]);

  return (
    <div className="flex items-center gap-3 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-1.5">
      <span className="size-2.5 shrink-0 animate-pulse rounded-full bg-destructive" />
      <span className="w-10 shrink-0 text-sm font-semibold tabular-nums text-destructive">
        {formatDuration(elapsedMs / 1000)}
      </span>
      <div className="flex h-7 flex-1 items-center gap-[2px] overflow-hidden">
        {bars.map((level, i) => (
          <span
            key={i}
            className="w-[3px] shrink-0 rounded-full bg-destructive"
            style={{ height: `${Math.max(12, level * 100)}%` }}
          />
        ))}
      </div>
      <button
        type="button"
        onClick={onCancel}
        aria-label="Cancelar gravação"
        className="grid size-9 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-muted"
      >
        <Trash2 className="size-4" />
      </button>
      <button
        type="button"
        onClick={onSend}
        disabled={disabled}
        aria-label="Enviar áudio"
        className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground disabled:opacity-50"
      >
        <Send className="size-4" />
      </button>
    </div>
  );
}
