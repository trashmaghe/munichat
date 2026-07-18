/**
 * The Elyzian mark — an asphodel, the flower of the Elysian fields.
 *
 * Six tepals in a star, built from one petal rotated in 60° steps. The mark
 * fills `currentColor`, so colour it by setting `text-*` (or `color`) on the
 * element or an ancestor. This is the solid form — no interior veins — which
 * is what stays legible from a 16px favicon up to a hero. See the brand sketch
 * for the full construction.
 */

// One petal, pointing up; the whole mark is this shape at six rotations.
const PETAL = 'M50 9 C 44.5 21, 43 33, 50 47 C 57 33, 55.5 21, 50 9 Z';
const ANGLES = [0, 60, 120, 180, 240, 300];

export function AsphodelMark({
  className,
  title,
}: {
  className?: string;
  title?: string;
}) {
  return (
    <svg
      viewBox="0 0 100 100"
      className={className}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      {title ? <title>{title}</title> : null}
      {ANGLES.map((angle) => (
        <path key={angle} d={PETAL} fill="currentColor" transform={`rotate(${angle} 50 50)`} />
      ))}
    </svg>
  );
}
