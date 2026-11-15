// Genera src/app/icon.svg con la misma silueta de estrella que la mascota y el logotipo.
// Uso: node scripts/generate-icon.mjs
import { writeFileSync } from 'node:fs';

function starPath(cx, cy, outer, inner, softness = 1.65, samples = 120) {
  let d = '';
  for (let i = 0; i <= samples; i++) {
    const a = (i / samples) * Math.PI * 2 - Math.PI / 2;
    const k = Math.pow(0.5 + 0.5 * Math.cos(5 * (a + Math.PI / 2)), softness);
    const r = inner + (outer - inner) * k;
    d += `${i ? 'L' : 'M'}${(cx + Math.cos(a) * r).toFixed(2)} ${(cy + Math.sin(a) * r).toFixed(2)}`;
  }
  return `${d}Z`;
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><defs><radialGradient id="g" cx="50%" cy="48%" r="58%"><stop offset="0" stop-color="#fff8e6"/><stop offset="0.5" stop-color="#ffd08a"/><stop offset="1" stop-color="#ff9a4a"/></radialGradient></defs><rect width="32" height="32" rx="7" fill="#050a14"/><path d="${starPath(16, 16.6, 12.4, 6.5)}" fill="url(#g)"/><rect x="9.4" y="11.8" width="13.2" height="4.2" rx="2.1" fill="#0b1424"/><path d="M10.8 13.9h10.4" stroke="#7fe8ff" stroke-width="0.9" stroke-linecap="round"/></svg>
`;

writeFileSync(new URL('../src/app/icon.svg', import.meta.url), svg);
console.log('icon.svg generado');
