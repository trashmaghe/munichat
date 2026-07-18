/** The Elyzian asphodel mark — solid six-petal star, inherits currentColor. */
const PETAL = 'M50 9 C 44.5 21, 43 33, 50 47 C 57 33, 55.5 21, 50 9 Z';
const ANGLES = [0, 60, 120, 180, 240, 300];

export function AsphodelMark({ className, title }: { className?: string; title?: string }) {
  return (
    <svg
      viewBox="0 0 100 100"
      className={className}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      {title ? <title>{title}</title> : null}
      {ANGLES.map((a) => (
        <path key={a} d={PETAL} fill="currentColor" transform={`rotate(${a} 50 50)`} />
      ))}
    </svg>
  );
}
