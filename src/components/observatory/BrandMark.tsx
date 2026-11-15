/**
 * Logotipo: la estrella vigilante (misma silueta suave de cinco puntas que la mascota 3D),
 * sin cara, con su visor de vigía. Generado con la misma fórmula polar que la geometría.
 */
function starPath(cx: number, cy: number, outer: number, inner: number, softness = 1.65, samples = 120): string {
  let d = '';
  for (let i = 0; i <= samples; i++) {
    const a = (i / samples) * Math.PI * 2 - Math.PI / 2;
    const k = Math.pow(0.5 + 0.5 * Math.cos(5 * (a + Math.PI / 2)), softness);
    const r = inner + (outer - inner) * k;
    d += `${i ? 'L' : 'M'}${(cx + Math.cos(a) * r).toFixed(2)} ${(cy + Math.sin(a) * r).toFixed(2)}`;
  }
  return `${d}Z`;
}

const STAR = starPath(16, 16.6, 13, 6.8);

export function BrandMark({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" className="brand-mark">
      <defs>
        <radialGradient id="bm-core" cx="50%" cy="48%" r="58%">
          <stop offset="0" stopColor="#fff8e6" />
          <stop offset="0.5" stopColor="#ffd08a" />
          <stop offset="1" stopColor="#ff9a4a" />
        </radialGradient>
      </defs>
      <path d={STAR} fill="url(#bm-core)" />
      {/* Visor de vigía */}
      <rect x="9.2" y="11.6" width="13.6" height="4.4" rx="2.2" fill="#0b1424" />
      <path d="M10.6 13.8h10.8" stroke="#7fe8ff" strokeWidth="0.9" strokeLinecap="round" opacity="0.9" />
      <circle cx="22.2" cy="13.8" r="1.5" fill="#0b1424" stroke="#c9d6ea" strokeWidth="0.6" />
      <circle cx="22.2" cy="13.8" r="0.6" fill="#7fe8ff" />
    </svg>
  );
}
