// IMP-14 / IMP-24: everything is mm internally; display units are a user choice.

/** DXF $INSUNITS code → millimetres per drawing unit. */
export const INSUNITS_TO_MM: Record<number, number> = { 1: 25.4, 2: 304.8, 4: 1, 5: 10, 6: 1000 };
export const UNIT_NAMES: Record<string, number> = { mm: 1, cm: 10, m: 1000, in: 25.4, ft: 304.8 };

export function unitNameFromFactor(f: number): string {
  for (const [k, v] of Object.entries(UNIT_NAMES)) if (Math.abs(v - f) < 1e-9) return k;
  return `${f} mm/unit`;
}

/** Guess drawing units from the extent of the plan when the header has none. */
export function guessUnitFactor(extent: number): { factor: number; name: string } {
  // A residential unit is typically 6–40 m across.
  const cands = Object.entries(UNIT_NAMES).map(([name, f]) => ({ name, factor: f, m: (extent * f) / 1000 }));
  const scored = cands.map((c) => ({ ...c, score: c.m >= 5 && c.m <= 60 ? Math.abs(Math.log(c.m / 15)) : 99 }));
  scored.sort((a, b) => a.score - b.score);
  return { factor: scored[0].factor, name: scored[0].name };
}

export type DisplayUnits = 'mm' | 'm' | 'ftin';

export function fmtLen(mm: number, u: DisplayUnits = 'mm'): string {
  if (!isFinite(mm)) return '–';
  if (u === 'm') return (mm / 1000).toFixed(3) + ' m';
  if (u === 'ftin') {
    const totalIn = mm / 25.4;
    const ft = Math.floor(totalIn / 12);
    const inch = totalIn - ft * 12;
    return `${ft}'-${inch.toFixed(1).replace(/\.0$/, '')}"`;
  }
  return Math.round(mm) + ' mm';
}

export const MM2_PER_SQFT = 92903.04;
export const MM_PER_FT = 304.8;
export const sqft = (mm2: number) => mm2 / MM2_PER_SQFT;
export const sqm = (mm2: number) => mm2 / 1e6;
export const rft = (mm: number) => mm / MM_PER_FT;

export function fmtArea(mm2: number, u: DisplayUnits = 'mm'): string {
  if (u === 'ftin') return sqft(mm2).toFixed(1) + ' sq ft';
  return sqm(mm2).toFixed(2) + ' m² (' + sqft(mm2).toFixed(0) + ' sq ft)';
}

/** Parse "3200", "3.2m", "320cm", "10'6\"", "10ft", "126in" into mm. */
export function parseLength(s: string, defaultUnit: DisplayUnits = 'mm'): number | null {
  const t = s.trim().toLowerCase();
  if (!t) return null;
  const ftin = t.match(/^(\d+(?:\.\d+)?)\s*(?:'|ft)\s*-?\s*(?:(\d+(?:\.\d+)?)\s*(?:"|in)?)?$/);
  if (ftin) return parseFloat(ftin[1]) * 304.8 + (ftin[2] ? parseFloat(ftin[2]) * 25.4 : 0);
  const m = t.match(/^(-?\d+(?:\.\d+)?)\s*(mm|cm|m|in|"|ft)?$/);
  if (!m) return null;
  const v = parseFloat(m[1]);
  const unit = m[2] === '"' ? 'in' : m[2];
  if (unit) return v * UNIT_NAMES[unit];
  if (defaultUnit === 'm') return v * 1000;
  if (defaultUnit === 'ftin') return v * 304.8;
  return v;
}
