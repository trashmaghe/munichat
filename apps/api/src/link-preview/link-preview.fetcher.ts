import { SsrfGuardOptions, validateUrl } from './link-preview.ssrf-guard';

const FETCH_TIMEOUT_MS = 5000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 3;

export type GuardedFetchResult = { html: string } | { failed: true };

export async function guardedFetchHtml(
  url: string,
  options: SsrfGuardOptions = {},
): Promise<GuardedFetchResult> {
  let current: URL;
  try {
    current = new URL(url);
  } catch {
    return { failed: true };
  }

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    try {
      await validateUrl(current, options);
    } catch {
      return { failed: true };
    }

    let response: Response;
    try {
      response = await fetch(current, {
        redirect: 'manual',
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: { Accept: 'text/html' },
      });
    } catch {
      return { failed: true };
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) {
        return { failed: true };
      }
      try {
        current = new URL(location, current);
      } catch {
        return { failed: true };
      }
      continue;
    }

    if (response.status < 200 || response.status >= 300) {
      return { failed: true };
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.toLowerCase().includes('text/html')) {
      return { failed: true };
    }

    const contentLength = response.headers.get('content-length');
    if (contentLength && Number(contentLength) > MAX_RESPONSE_BYTES) {
      return { failed: true };
    }

    const html = await readBodyWithCap(response);
    if (html === null) {
      return { failed: true };
    }
    return { html };
  }

  return { failed: true };
}

async function readBodyWithCap(response: Response): Promise<string | null> {
  const reader = response.body?.getReader();
  if (!reader) {
    const text = await response.text();
    return text.length <= MAX_RESPONSE_BYTES ? text : null;
  }

  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const result: Awaited<ReturnType<typeof reader.read>> = await reader.read();
    if (result.done) break;
    // Node's built-in fetch types the stream reader's chunk value loosely
    // (no full DOM lib in this tsconfig) — it's a Uint8Array at runtime.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const value: Uint8Array = result.value;
    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }

  return Buffer.concat(chunks).toString('utf8');
}
