import { useCallback, useEffect, useState } from 'react';

/**
 * Background auto-update for the desktop client. On launch (inside Tauri) it
 * asks the update endpoint whether a newer signed build exists; if so the UI
 * offers to install it, which downloads, applies, and relaunches. No-ops in a
 * plain browser, and fails soft if the update server is unreachable.
 */
type UpdateState =
  | { status: 'idle' }
  | { status: 'available'; version: string }
  | { status: 'installing' }
  | { status: 'error'; message: string };

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export function useUpdate() {
  const [state, setState] = useState<UpdateState>({ status: 'idle' });

  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    void (async () => {
      try {
        const { check } = await import('@tauri-apps/plugin-updater');
        const update = await check();
        if (!cancelled && update) {
          setState({ status: 'available', version: update.version });
        }
      } catch {
        // Offline or no release published yet — stay silent.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const install = useCallback(async () => {
    setState({ status: 'installing' });
    try {
      const { check } = await import('@tauri-apps/plugin-updater');
      const { relaunch } = await import('@tauri-apps/plugin-process');
      const update = await check();
      if (update) {
        await update.downloadAndInstall();
        await relaunch();
      }
    } catch (err) {
      setState({ status: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }, []);

  return { state, install };
}
