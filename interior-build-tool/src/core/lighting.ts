// EDT-20: lumen-method lighting check per room.
import type { Floor, Room } from './types';
import { polygonArea } from './geom';
import { POINTS } from './catalog';

export const LUX_TARGET: Record<string, number> = {
  living: 200, dining: 200, bedroom: 150, kitchen: 300, toilet: 150, passage: 100, foyer: 150,
  balcony: 75, utility: 150, study: 400, pooja: 200, shaft: 0, other: 150,
};
export const LUMENS_PER_WATT = 100;
export const UF = 0.6; // utilisation factor
export const MF = 0.8; // maintenance factor

export function fixturesNeeded(room: Room, lumensPerFixture = POINTS.light.watts * LUMENS_PER_WATT): number {
  const A = polygonArea(room.polygon) / 1e6;
  const E = LUX_TARGET[room.type] ?? 150;
  if (!E) return 0;
  return Math.max(1, Math.ceil((E * A) / (lumensPerFixture * UF * MF)));
}

export interface LightingResult { target: number; achieved: number; fixtures: number; needed: number; connectedLoad: number; cct: number }

export function lightingFor(f: Floor, room: Room, cct = 3000): LightingResult {
  const A = polygonArea(room.polygon) / 1e6;
  const pts = f.points.filter((p) => p.roomId === room.id);
  const lights = pts.filter((p) => p.kind === 'light');
  const lumens = lights.reduce((s, p) => s + (p.watts ?? POINTS.light.watts) * LUMENS_PER_WATT, 0) + pts.filter((p) => p.kind === 'cove').length * 600;
  const achieved = A > 0 ? (lumens * UF * MF) / A : 0;
  const load = pts.reduce((s, p) => s + (p.watts ?? POINTS[p.kind].watts), 0);
  return { target: LUX_TARGET[room.type] ?? 150, achieved: Math.round(achieved), fixtures: lights.length, needed: fixturesNeeded(room), connectedLoad: load, cct };
}
