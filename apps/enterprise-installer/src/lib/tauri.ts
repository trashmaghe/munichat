/**
 * Typed bridge to the installer's Rust backend (Tauri commands + events).
 *
 * Every call has a browser fallback so the wizard UI still runs, typechecks,
 * and can be demoed in a plain browser (or CI) where no Tauri runtime exists —
 * the fallbacks simulate a machine without Docker so the preflight gates are
 * exercised rather than silently skipped.
 */
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

export interface PreflightReport {
  dockerInstalled: boolean;
  dockerRunning: boolean;
  composeAvailable: boolean;
  dockerVersion: string | null;
  stackBundled: boolean;
}

export interface DeployResult {
  ok: boolean;
  exitCode: number | null;
}

export interface DeployLogLine {
  stream: 'stdout' | 'stderr' | 'status';
  line: string;
}

/** True when running inside the Tauri desktop shell (vs a plain browser). */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export async function preflight(): Promise<PreflightReport> {
  if (!isTauri()) {
    return {
      dockerInstalled: false,
      dockerRunning: false,
      composeAvailable: false,
      dockerVersion: null,
      stackBundled: true,
    };
  }
  return invoke<PreflightReport>('preflight');
}

/** Open a URL in the operator's default browser (the "Get Docker" helper). */
export async function openUrl(url: string): Promise<void> {
  if (!isTauri()) {
    window.open(url, '_blank', 'noopener');
    return;
  }
  await invoke('open_url', { url });
}

/**
 * Deploy the stack: stage the compose files, write `.env`, `docker compose
 * pull`, then `up -d` (plus the edge overlay when requested). Log lines stream
 * back through the `deploy-log` event; the promise resolves once compose exits.
 */
export async function deployStack(
  envContent: string,
  useEdge: boolean,
  onLog: (line: DeployLogLine) => void,
): Promise<DeployResult> {
  if (!isTauri()) {
    onLog({ stream: 'status', line: 'No Tauri runtime — deployment is only available in the installer app.' });
    return { ok: false, exitCode: null };
  }
  const unlisten = await listen<DeployLogLine>('deploy-log', (event) => onLog(event.payload));
  try {
    return await invoke<DeployResult>('deploy_stack', { envContent, useEdge });
  } finally {
    unlisten();
  }
}

export async function stackHealth(apiUrl: string): Promise<boolean> {
  if (!isTauri()) return false;
  return invoke<boolean>('stack_health', { apiUrl });
}
