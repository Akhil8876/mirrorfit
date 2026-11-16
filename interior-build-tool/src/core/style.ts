// GEN-03: style attributes from reference images — palette by k-means, plus readable tags.
// Runs locally in the browser; images never leave the workspace (GEN-22, NFR-22).

import { THEMES } from './themes';

export interface StyleResult { palette: string[]; tags: string[]; theme: string }

const hex = (r: number, g: number, b: number) => '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');

function hsl(r: number, g: number, b: number) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  if (mx === mn) return { h: 0, s: 0, l };
  const d = mx - mn;
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  let h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: h * 60, s, l };
}

export function extractStyle(data: Uint8ClampedArray, w: number, h: number, k = 5): StyleResult {
  const px: number[][] = [];
  for (let i = 0; i < data.length; i += 4 * 3) if (data[i + 3] > 128) px.push([data[i], data[i + 1], data[i + 2]]);
  if (!px.length) return { palette: [], tags: [], theme: 'modern' };
  // k-means++-ish init: spread over luminance
  const sorted = [...px].sort((a, b) => a[0] + a[1] + a[2] - (b[0] + b[1] + b[2]));
  let cents = Array.from({ length: k }, (_, i) => sorted[Math.floor(((i + 0.5) / k) * sorted.length)].slice());
  let counts = new Array(k).fill(0);
  for (let it = 0; it < 12; it++) {
    const sums = cents.map(() => [0, 0, 0]);
    counts = new Array(k).fill(0);
    for (const p of px) {
      let bi = 0, bd = Infinity;
      for (let c = 0; c < k; c++) { const d = (p[0] - cents[c][0]) ** 2 + (p[1] - cents[c][1]) ** 2 + (p[2] - cents[c][2]) ** 2; if (d < bd) { bd = d; bi = c; } }
      sums[bi][0] += p[0]; sums[bi][1] += p[1]; sums[bi][2] += p[2]; counts[bi]++;
    }
    cents = cents.map((c, i) => (counts[i] ? sums[i].map((s) => s / counts[i]) : c));
  }
  const order = cents.map((c, i) => ({ c, n: counts[i] })).sort((a, b) => b.n - a.n);
  const palette = order.map((o) => hex(o.c[0], o.c[1], o.c[2]));
  const tags = new Set<string>();
  const H = order.map((o) => ({ ...hsl(o.c[0], o.c[1], o.c[2]), n: o.n / px.length }));
  const avgL = H.reduce((s, x) => s + x.l * x.n, 0);
  const avgS = H.reduce((s, x) => s + x.s * x.n, 0);
  const warm = H.reduce((s, x) => s + (x.s > 0.12 && (x.h < 60 || x.h > 330) ? x.n : 0), 0);
  const cool = H.reduce((s, x) => s + (x.s > 0.12 && x.h > 170 && x.h < 260 ? x.n : 0), 0);
  tags.add(avgL > 0.62 ? 'light & airy' : avgL < 0.38 ? 'dark & moody' : 'mid-tone');
  tags.add(avgS < 0.18 ? 'muted' : avgS > 0.4 ? 'vivid colour' : 'soft colour');
  if (warm > cool + 0.1) tags.add('warm palette'); else if (cool > warm + 0.1) tags.add('cool palette'); else tags.add('neutral palette');
  if (H.some((x) => x.h >= 18 && x.h <= 42 && x.s > 0.25 && x.l > 0.25 && x.l < 0.7 && x.n > 0.08)) tags.add(H.some((x) => x.h >= 18 && x.h <= 42 && x.l < 0.4) ? 'dark wood' : 'warm wood');
  if (H.some((x) => x.s < 0.08 && x.l > 0.85 && x.n > 0.15)) tags.add('white walls');
  if (H.some((x) => x.h > 70 && x.h < 160 && x.s > 0.2 && x.n > 0.06)) tags.add('greenery');
  if (H.some((x) => x.s < 0.1 && x.l < 0.25 && x.n > 0.08)) tags.add('black metal');
  // pattern density from local contrast
  let edges = 0, cnt = 0;
  for (let y = 1; y < h - 1; y += 2) for (let x = 1; x < w - 1; x += 2) {
    const i = (y * w + x) * 4, j = (y * w + x + 1) * 4, q = ((y + 1) * w + x) * 4;
    const g = (o: number) => data[o] * 0.3 + data[o + 1] * 0.59 + data[o + 2] * 0.11;
    if (Math.abs(g(i) - g(j)) + Math.abs(g(i) - g(q)) > 40) edges++;
    cnt++;
  }
  const density = cnt ? edges / cnt : 0;
  tags.add(density > 0.22 ? 'busy pattern' : density > 0.1 ? 'some pattern' : 'minimal pattern');
  return { palette, tags: [...tags], theme: suggestTheme(palette) };
}

export function suggestTheme(palette: string[]): string {
  const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  let best = THEMES[0].id, bd = Infinity;
  for (const t of THEMES) {
    let d = 0;
    for (const c of palette.slice(0, 4)) {
      const [r, g, b] = rgb(c);
      d += Math.min(...t.palette.map((tc) => { const [R, G, B] = rgb(tc); return (R - r) ** 2 + (G - g) ** 2 + (B - b) ** 2; }));
    }
    if (d < bd) { bd = d; best = t.id; }
  }
  return best;
}

/** GEN-05: free-text prompt → must-haves and style tags (deterministic keyword parse; a hosted LLM can replace this). */
export function parsePrompt(prompt: string): { mustHaves: string[]; tags: string[] } {
  const p = prompt.toLowerCase();
  const mustHaves = ['study', 'pooja', 'bar', 'tv', 'dining', 'dresser', 'shoe'].filter((k) => p.includes(k));
  const tags: string[] = [];
  if (/no gloss|matte|matt\b/.test(p)) tags.push('matte');
  if (/wood|oak|walnut|teak/.test(p)) tags.push('warm wood');
  if (/cane|rattan/.test(p)) tags.push('cane');
  if (/storage/.test(p)) tags.push('storage-heavy');
  if (/white|light/.test(p)) tags.push('light & airy');
  if (/plant|green/.test(p)) tags.push('greenery');
  return { mustHaves, tags };
}
