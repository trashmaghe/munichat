import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAudioRecorder } from './useAudioRecorder';

// Controllable MediaRecorder stub: stop() synchronously emits one data chunk
// then fires onstop, mirroring the real event sequence.
class FakeMediaRecorder {
  static isTypeSupported = vi.fn(() => true);
  state: 'inactive' | 'recording' = 'inactive';
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  mimeType: string;
  constructor(_stream: MediaStream, opts?: { mimeType?: string }) {
    this.mimeType = opts?.mimeType ?? 'audio/webm';
  }
  start() {
    this.state = 'recording';
  }
  stop() {
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob(['audio-bytes'], { type: 'audio/webm' }) });
    this.onstop?.();
  }
}

let getUserMedia: ReturnType<typeof vi.fn>;
let trackStop: ReturnType<typeof vi.fn>;

describe('useAudioRecorder', () => {
  beforeEach(() => {
    trackStop = vi.fn();
    getUserMedia = vi.fn().mockResolvedValue({ getTracks: () => [{ stop: trackStop }] });
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getUserMedia },
      configurable: true,
    });
    vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('records and produces a File tagged with the base mime type', async () => {
    const { result } = renderHook(() => useAudioRecorder());

    await act(async () => {
      await result.current.start();
    });
    expect(result.current.status).toBe('recording');

    act(() => {
      result.current.stop();
    });

    await waitFor(() => expect(result.current.status).toBe('recorded'));
    expect(result.current.file).toBeInstanceOf(File);
    // MediaRecorder used audio/webm;codecs=opus but the File is tagged with the
    // bare container type that the upload allow-list accepts.
    expect(result.current.file?.type).toBe('audio/webm');
    expect(result.current.file?.name).toMatch(/\.webm$/);
  });

  it('cancel discards the clip, returns to idle, and stops the mic tracks', async () => {
    const { result } = renderHook(() => useAudioRecorder());
    await act(async () => {
      await result.current.start();
    });

    act(() => {
      result.current.cancel();
    });

    await waitFor(() => expect(result.current.status).toBe('idle'));
    expect(result.current.file).toBeNull();
    expect(trackStop).toHaveBeenCalled();
  });

  it('surfaces an error when microphone permission is denied', async () => {
    getUserMedia.mockRejectedValueOnce(new DOMException('denied', 'NotAllowedError'));
    const { result } = renderHook(() => useAudioRecorder());

    await act(async () => {
      await result.current.start();
    });

    expect(result.current.status).toBe('error');
    expect(result.current.error).toBeTruthy();
  });
});
