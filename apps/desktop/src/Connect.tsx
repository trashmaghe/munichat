import { useEffect, useRef, useState, type FormEvent } from 'react';
import { AsphodelMark } from './brand';
import { useUpdate } from './useUpdate';

const STORAGE_KEY = 'elyzian.serverUrl';
const AUTO_REDIRECT_MS = 1500;

/** Normalize a user-typed host into an https origin (bare host → https://host). */
function normalizeUrl(raw: string): string | null {
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (!trimmed) return null;
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const u = new URL(withScheme);
    return u.origin;
  } catch {
    return null;
  }
}

export function Connect() {
  const stored = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
  const [value, setValue] = useState(stored ?? '');
  const [error, setError] = useState<string | null>(null);
  // When we already know the server, auto-reconnect after a short, cancelable delay.
  const [autoConnecting, setAutoConnecting] = useState<string | null>(stored);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const update = useUpdate();

  useEffect(() => {
    if (!autoConnecting) return;
    timer.current = setTimeout(() => connect(autoConnecting), AUTO_REDIRECT_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [autoConnecting]);

  function connect(url: string) {
    localStorage.setItem(STORAGE_KEY, url);
    // Top-level navigation loads the server's hosted Elyzian web app in this window.
    window.location.href = url;
  }

  function cancelAuto() {
    if (timer.current) clearTimeout(timer.current);
    setAutoConnecting(null);
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const normalized = normalizeUrl(value);
    if (!normalized) {
      setError('Enter a valid server address, e.g. chat.novaserrana.mg.gov.br');
      return;
    }
    setError(null);
    connect(normalized);
  }

  return (
    <div className="shell">
      <div className="aperture" aria-hidden>
        <span />
        <span />
      </div>

      {update.state.status === 'available' && (
        <button className="update-pill" onClick={() => void update.install()}>
          Update to v{update.state.version} — restart to apply
        </button>
      )}
      {update.state.status === 'installing' && (
        <div className="update-pill" aria-live="polite">
          Installing update…
        </div>
      )}

      <main className="card">
        <div className="logo">
          <AsphodelMark className="mark" title="Elyzian" />
        </div>
        <h1>Elyzian</h1>
        <p className="sub">Prefeitura Municipal de Nova Serrana</p>

        {autoConnecting ? (
          <div className="auto">
            <p>
              Connecting to <strong>{autoConnecting}</strong>…
            </p>
            <div className="auto-actions">
              <button className="btn-primary" onClick={() => connect(autoConnecting)}>
                Connect now
              </button>
              <button className="btn-ghost" onClick={cancelAuto}>
                Change server
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <label htmlFor="server">Server address</label>
            <input
              id="server"
              autoFocus
              value={value}
              placeholder="chat.novaserrana.mg.gov.br"
              onChange={(e) => setValue(e.target.value)}
              aria-invalid={error ? true : undefined}
            />
            {error ? <p className="err">{error}</p> : <p className="hint">Ask your IT team for the Elyzian address.</p>}
            <button type="submit" className="btn-primary block">
              Connect
            </button>
          </form>
        )}
      </main>

      <footer>Elyzian Desktop</footer>
    </div>
  );
}
