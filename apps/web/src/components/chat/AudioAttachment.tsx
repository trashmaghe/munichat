import { useEffect, useRef, useState } from 'react';
import { Download, Pause, Play } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDuration } from '@/lib/format-duration';

const PEAK_COUNT = 56;
// Above this, skip decoding the whole file for a waveform (fall back to a plain
// progress bar) — playback still streams via the Range-backed <audio> element.
const MAX_DECODE_BYTES = 10 * 1024 * 1024;

// Compact inline audio player: play/pause + a real waveform (decoded from the
// file's samples) or a progress bar for larger files, with click-to-seek.
export function AudioAttachment({
  url,
  fileName,
  sizeBytes,
}: {
  url: string;
  fileName: string;
  sizeBytes: number;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);
  const [peaks, setPeaks] = useState<number[] | null>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const el = rootRef.current;
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

  // Decode a downsampled waveform lazily, once in view.
  useEffect(() => {
    if (!inView || peaks || sizeBytes > MAX_DECODE_BYTES) return;
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(url, { credentials: 'include' });
        if (!res.ok) return;
        const buffer = await res.arrayBuffer();
        const ctx = new Ctx();
        const decoded = await ctx.decodeAudioData(buffer);
        void ctx.close();
        if (!cancelled) setPeaks(downsamplePeaks(decoded, PEAK_COUNT));
      } catch {
        // no waveform — the progress-bar fallback still works
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [inView, peaks, url, sizeBytes]);

  const progress = duration > 0 ? current / duration : 0;

  function toggle() {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) void audio.play();
    else audio.pause();
  }

  function seekTo(fraction: number) {
    const audio = audioRef.current;
    if (!audio || !duration) return;
    audio.currentTime = Math.max(0, Math.min(1, fraction)) * duration;
  }

  if (failed) {
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
    <div
      ref={rootRef}
      data-slot="audio-attachment"
      className="flex w-80 max-w-full items-center gap-3 rounded-lg border border-border bg-card p-3"
    >
      <audio
        ref={audioRef}
        src={url}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        onError={() => setFailed(true)}
        className="hidden"
      >
        <track kind="captions" />
      </audio>

      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? 'Pausar' : 'Reproduzir'}
        className="grid size-9 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground"
      >
        {playing ? <Pause className="size-4" /> : <Play className="ml-0.5 size-4" />}
      </button>

      <div className="min-w-0 flex-1">
        <div className="mb-1.5 truncate text-xs font-medium">{fileName}</div>
        <div className="flex items-center gap-3">
          {peaks ? (
            <Waveform peaks={peaks} progress={progress} onSeek={seekTo} />
          ) : (
            <ProgressTrack progress={progress} onSeek={seekTo} />
          )}
          <span className="shrink-0 text-[0.6875rem] tabular-nums text-muted-foreground">
            {formatDuration(playing || current > 0 ? current : duration)}
          </span>
        </div>
      </div>
    </div>
  );
}

function Waveform({
  peaks,
  progress,
  onSeek,
}: {
  peaks: number[];
  progress: number;
  onSeek: (fraction: number) => void;
}) {
  function handleClick(e: React.MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    onSeek((e.clientX - rect.left) / rect.width);
  }
  return (
    <div
      onClick={handleClick}
      className="flex h-6 flex-1 cursor-pointer items-center gap-[2px] overflow-hidden"
    >
      {peaks.map((peak, i) => (
        <span
          key={i}
          className={cn(
            'w-[3px] shrink-0 rounded-full',
            i / peaks.length < progress ? 'bg-primary' : 'bg-muted-foreground/40',
          )}
          style={{ height: `${Math.max(12, peak * 100)}%` }}
        />
      ))}
    </div>
  );
}

function ProgressTrack({
  progress,
  onSeek,
}: {
  progress: number;
  onSeek: (fraction: number) => void;
}) {
  function handleClick(e: React.MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    onSeek((e.clientX - rect.left) / rect.width);
  }
  return (
    <div onClick={handleClick} className="flex h-6 flex-1 cursor-pointer items-center">
      <div className="relative h-1 w-full rounded-full bg-muted">
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-primary"
          style={{ width: `${Math.min(100, progress * 100)}%` }}
        />
      </div>
    </div>
  );
}

function downsamplePeaks(buffer: AudioBuffer, count: number): number[] {
  const data = buffer.getChannelData(0);
  const block = Math.floor(data.length / count) || 1;
  const peaks: number[] = [];
  let max = 0.0001;
  for (let i = 0; i < count; i++) {
    let peak = 0;
    const start = i * block;
    const end = Math.min(data.length, start + block);
    for (let j = start; j < end; j++) {
      const v = Math.abs(data[j]);
      if (v > peak) peak = v;
    }
    peaks.push(peak);
    if (peak > max) max = peak;
  }
  return peaks.map((p) => p / max);
}
