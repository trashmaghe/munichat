import { useCallback, useEffect, useRef, useState } from 'react';

export type RecorderStatus =
  | 'idle'
  | 'requesting'
  | 'recording'
  | 'recorded'
  | 'error';

export interface UseAudioRecorder {
  status: RecorderStatus;
  elapsedMs: number;
  /** The recorded clip, available once `stop()` has finalized. */
  file: File | null;
  error: string | null;
  start: () => Promise<void>;
  stop: () => void;
  cancel: () => void;
  reset: () => void;
  /** Live mic amplitude 0..1 for a waveform (0 when unavailable). */
  getLevel: () => number;
}

// MediaRecorder emits a codec-qualified mime type ("audio/webm;codecs=opus"),
// but the upload allow-list matches the bare container type — so we record with
// the qualified type and tag the resulting File with the base type.
const MIME_CANDIDATES: { recorder: string; base: string }[] = [
  { recorder: 'audio/webm;codecs=opus', base: 'audio/webm' },
  { recorder: 'audio/webm', base: 'audio/webm' },
  { recorder: 'audio/mp4', base: 'audio/mp4' },
];

function pickMimeType(): { recorder: string; base: string } {
  if (typeof MediaRecorder === 'undefined') {
    return { recorder: '', base: 'audio/webm' };
  }
  for (const candidate of MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported(candidate.recorder)) return candidate;
  }
  return { recorder: '', base: 'audio/webm' };
}

function extensionFor(baseType: string): string {
  if (baseType === 'audio/mp4') return 'm4a';
  if (baseType === 'audio/ogg') return 'ogg';
  return 'webm';
}

const TIMER_INTERVAL_MS = 200;

export function useAudioRecorder(): UseAudioRecorder {
  const [status, setStatus] = useState<RecorderStatus>('idle');
  const [elapsedMs, setElapsedMs] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const cancelledRef = useRef(false);
  const startTimeRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);

  const teardown = useCallback(() => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
      void audioCtxRef.current.close();
    }
    audioCtxRef.current = null;
    analyserRef.current = null;
    recorderRef.current = null;
  }, []);

  const start = useCallback(async () => {
    if (status === 'recording' || status === 'requesting') return;
    setError(null);
    setFile(null);
    setElapsedMs(0);
    cancelledRef.current = false;
    setStatus('requesting');

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError('Não foi possível acessar o microfone. Verifique a permissão.');
      setStatus('error');
      return;
    }
    streamRef.current = stream;

    const { recorder: recorderType, base } = pickMimeType();
    const recorder = new MediaRecorder(
      stream,
      recorderType ? { mimeType: recorderType } : undefined,
    );
    recorderRef.current = recorder;
    chunksRef.current = [];

    recorder.ondataavailable = (event: BlobEvent) => {
      if (event.data && event.data.size > 0) chunksRef.current.push(event.data);
    };
    recorder.onstop = () => {
      if (timerRef.current !== null) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      if (cancelledRef.current) {
        chunksRef.current = [];
        teardown();
        setStatus('idle');
        setElapsedMs(0);
        return;
      }
      const blob = new Blob(chunksRef.current, { type: base });
      const recorded = new File([blob], `Mensagem de voz.${extensionFor(base)}`, {
        type: base,
      });
      chunksRef.current = [];
      teardown();
      setFile(recorded);
      setStatus('recorded');
    };

    // Optional live-amplitude analyser for the waveform — guarded, since it's
    // not essential to producing the clip.
    try {
      const Ctx =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (Ctx) {
        const ctx = new Ctx();
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        audioCtxRef.current = ctx;
        analyserRef.current = analyser;
      }
    } catch {
      // no live waveform; recording still works
    }

    recorder.start();
    startTimeRef.current = Date.now();
    setStatus('recording');
    timerRef.current = setInterval(() => {
      setElapsedMs(Date.now() - startTimeRef.current);
    }, TIMER_INTERVAL_MS);
  }, [status, teardown]);

  const stop = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      cancelledRef.current = false;
      recorderRef.current.stop();
    }
  }, []);

  const cancel = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      cancelledRef.current = true;
      recorderRef.current.stop();
    } else {
      teardown();
      setStatus('idle');
      setElapsedMs(0);
      setFile(null);
    }
  }, [teardown]);

  const reset = useCallback(() => {
    setStatus('idle');
    setFile(null);
    setError(null);
    setElapsedMs(0);
  }, []);

  const getLevel = useCallback((): number => {
    const analyser = analyserRef.current;
    if (!analyser) return 0;
    const data = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(data);
    let sumSquares = 0;
    for (let i = 0; i < data.length; i++) {
      const centered = (data[i] - 128) / 128;
      sumSquares += centered * centered;
    }
    return Math.min(1, Math.sqrt(sumSquares / data.length) * 2.2);
  }, []);

  // Stop the mic and timers if the component unmounts mid-recording.
  useEffect(() => teardown, [teardown]);

  return { status, elapsedMs, file, error, start, stop, cancel, reset, getLevel };
}
