// GEN-31: Vastu overlay — 16 zones around the plan centre relative to true north. Advisory only.

import type { Floor, Vec2 } from './types';
import { centroid, sub, add, mul } from './geom';

export const ZONES = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

/** Compass bearing (deg, clockwise from true north) of p seen from c. */
export function bearing(f: Floor, c: Vec2, p: Vec2): number {
  const d = sub(p, c);
  const planAngle = (Math.atan2(d.y, d.x) * 180) / Math.PI; // CCW from +x
  return (((f.northDeg - planAngle) % 360) + 360) % 360;
}

export function vastuZoneOf(f: Floor, c: Vec2, p: Vec2): string {
  const b = bearing(f, c, p);
  return ZONES[Math.round(b / 22.5) % 16];
}

export function planCentre(f: Floor): Vec2 {
  if (f.outline && f.outline.length > 2) return centroid(f.outline);
  const pts = f.rooms.flatMap((r) => r.polygon);
  return pts.length ? centroid(pts) : { x: 0, y: 0 };
}

/** Ray endpoint for drawing a zone boundary at a compass bearing. */
export function rayAt(f: Floor, c: Vec2, bearingDeg: number, length: number): Vec2 {
  const planAngle = ((f.northDeg - bearingDeg) * Math.PI) / 180;
  return add(c, mul({ x: Math.cos(planAngle), y: Math.sin(planAngle) }, length));
}

const PREF: Record<string, { good: string[]; avoid: string[]; label: string }> = {
  entrance: { good: ['N', 'NNE', 'NE', 'ENE', 'E'], avoid: ['SW', 'SSW', 'WSW'], label: 'Main entrance' },
  kitchen: { good: ['SE', 'SSE', 'ESE', 'NW'], avoid: ['NE', 'NNE', 'ENE', 'N'], label: 'Kitchen' },
  pooja: { good: ['NE', 'NNE', 'ENE', 'E', 'N'], avoid: ['S', 'SW', 'SSW'], label: 'Pooja' },
  master: { good: ['SW', 'SSW', 'WSW', 'S'], avoid: ['NE', 'SE'], label: 'Master bedroom' },
  toilet: { good: ['NW', 'WNW', 'W', 'SSE', 'S'], avoid: ['NE', 'NNE', 'ENE', 'SW'], label: 'Toilet' },
};

export interface VastuFlag { subject: string; zone: string; status: 'favourable' | 'neutral' | 'avoid'; note: string }

export function vastuFlags(f: Floor): VastuFlag[] {
  const c = planCentre(f);
  const out: VastuFlag[] = [];
  const judge = (key: keyof typeof PREF, p: Vec2, name: string) => {
    const z = vastuZoneOf(f, c, p);
    const pref = PREF[key];
    const status = pref.good.includes(z) ? 'favourable' : pref.avoid.includes(z) ? 'avoid' : 'neutral';
    out.push({ subject: name, zone: z, status, note: status === 'favourable' ? `${pref.label} in ${z} is traditionally preferred` : status === 'avoid' ? `${pref.label} in ${z} is traditionally avoided; preferred: ${pref.good.slice(0, 3).join(', ')}` : `${pref.label} in ${z} is acceptable` });
  };
  for (const o of f.openings) if (o.kind === 'door') {
    const w = f.walls.find((w) => w.id === o.wallId);
    if (!w?.exterior) continue;
    const d = sub(w.b, w.a);
    const L = Math.hypot(d.x, d.y);
    judge('entrance', add(w.a, mul(d, o.offset / L)), 'Main entrance');
  }
  for (const r of f.rooms) {
    const p = centroid(r.polygon);
    if (r.type === 'kitchen') judge('kitchen', p, r.name);
    if (r.type === 'pooja') judge('pooja', p, r.name);
    if (r.type === 'toilet') judge('toilet', p, r.name);
    if (r.type === 'bedroom' && /master/i.test(r.name)) judge('master', p, r.name);
  }
  for (const it of f.items) if (it.catalogId === 'pooja-unit') judge('pooja', it.pos, 'Pooja unit');
  return out;
}
