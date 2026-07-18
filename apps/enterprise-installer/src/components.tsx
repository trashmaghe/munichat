import type { ReactNode } from 'react';

export function Field({
  label,
  value,
  onChange,
  hint,
  error,
  type = 'text',
  mono = false,
  placeholder,
  full = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: ReactNode;
  error?: string;
  type?: 'text' | 'password' | 'number' | 'email';
  mono?: boolean;
  placeholder?: string;
  full?: boolean;
}) {
  return (
    <div className={`field${full ? ' full' : ''}`} data-error={error ? 'true' : 'false'}>
      <label>{label}</label>
      <input
        className={mono ? 'mono' : undefined}
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
      />
      {error ? <span className="err">{error}</span> : hint ? <span className="hint">{hint}</span> : null}
    </div>
  );
}

export function SecretField({
  label,
  value,
  onChange,
  onRegenerate,
  hint,
  error,
  full = true,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onRegenerate: () => void;
  hint?: ReactNode;
  error?: string;
  full?: boolean;
}) {
  return (
    <div className={`field${full ? ' full' : ''}`} data-error={error ? 'true' : 'false'}>
      <label>{label}</label>
      <div className="input-row">
        <input className="mono" type="text" value={value} onChange={(e) => onChange(e.target.value)} />
        <button type="button" className="btn-mini" onClick={onRegenerate}>
          Regenerate
        </button>
      </div>
      {error ? <span className="err">{error}</span> : hint ? <span className="hint">{hint}</span> : null}
    </div>
  );
}

export function Select({
  label,
  value,
  onChange,
  options,
  hint,
  full = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  hint?: ReactNode;
  full?: boolean;
}) {
  return (
    <div className={`field${full ? ' full' : ''}`}>
      <label>{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {hint ? <span className="hint">{hint}</span> : null}
    </div>
  );
}

export function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}
