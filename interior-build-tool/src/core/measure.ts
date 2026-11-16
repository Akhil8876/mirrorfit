// IMP-20 / IMP-21 / IMP-43: room dimensions, derived quantities and the area statement.

import type { Floor, Opening, Room, Vec2, Wall } from './types';
import { add, cross, dist, dot, distToLine, mul, norm, perp, polygonArea, projectParam, sub, ensureCCW, bbox } from './geom';

export interface EdgeOpening { id: string; kind: Opening['kind']; s: number; e: number; sill: number; height: number; width: number }

export interface RoomEdge {
  i: number;
  a: Vec2;
  b: Vec2;
  len: number;
  dir: Vec2;
  n: Vec2; // inward normal
  wall?: Wall;
  openings: EdgeOpening[];
}

export function openingEnds(o: Opening, w: Wall): [Vec2, Vec2] {
  const d = norm(sub(w.b, w.a));
  return [add(w.a, mul(d, o.offset - o.width / 2)), add(w.a, mul(d, o.offset + o.width / 2))];
}

export function roomEdges(f: Floor, room: Room): RoomEdge[] {
  const poly = ensureCCW(room.polygon);
  const edges: RoomEdge[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const L = dist(a, b);
    if (L < 1) continue;
    const dir = norm(sub(b, a));
    const n = perp(dir);
    // the wall whose face this edge lies on
    let wall: Wall | undefined;
    let best = Infinity;
    for (const w of f.walls) {
      const wd = norm(sub(w.b, w.a));
      if (Math.abs(cross(wd, dir)) > 0.02) continue;
      const off = Math.abs(distToLine(a, w.a, w.b) - w.thickness / 2);
      if (off > 25) continue;
      const t0 = projectParam(a, w.a, w.b), t1 = projectParam(b, w.a, w.b);
      if (Math.max(t0, t1) < -0.01 || Math.min(t0, t1) > 1.01) continue;
      if (off < best) { best = off; wall = w; }
    }
    const openings: EdgeOpening[] = [];
    for (const w of f.walls) {
      const wd = norm(sub(w.b, w.a));
      if (Math.abs(cross(wd, dir)) > 0.02) continue;
      if (Math.abs(distToLine(a, w.a, w.b) - w.thickness / 2) > 25) continue;
      for (const o of f.openings.filter((o) => o.wallId === w.id)) {
        const [p0, p1] = openingEnds(o, w);
        let s0 = dot(sub(p0, a), dir), s1 = dot(sub(p1, a), dir);
        if (s0 > s1) [s0, s1] = [s1, s0];
        if (s1 < 1 || s0 > L - 1) continue;
        openings.push({ id: o.id, kind: o.kind, s: Math.max(0, s0), e: Math.min(L, s1), sill: o.sill, height: o.height, width: o.width });
      }
    }
    edges.push({ i, a, b, len: L, dir, n, wall, openings });
  }
  return edges;
}

export interface RoomMeasure {
  roomId: string;
  name: string;
  floorArea: number; // mm²
  perimeter: number;
  width: number; // bounding dims
  depth: number;
  ceilingHeight: number; // finished (after false ceiling)
  grossWallArea: number;
  openingArea: number;
  netWallArea: number;
  ceilingArea: number;
  skirting: number;
  windowArea: number;
  edges: { i: number; len: number; net: number; openings: number; site?: number }[];
}

export function finishedCeiling(r: Room) { return r.ceilingHeight - (r.falseCeiling.enabled ? r.falseCeiling.drop : 0); }

export function measureRoom(f: Floor, room: Room): RoomMeasure {
  const edges = roomEdges(f, room);
  const H = finishedCeiling(room);
  let gross = 0, openA = 0, skirting = 0, windowA = 0;
  const per: RoomMeasure['edges'] = [];
  for (const e of edges) {
    const site = f.siteMeasures.find((m) => m.roomId === room.id && m.edge === e.i && m.resolution === 'accept-site')?.site;
    const L = site ?? e.len;
    const g = L * H;
    let oa = 0, doorW = 0;
    for (const o of e.openings) {
      const w = o.e - o.s;
      const top = Math.min(H, o.sill + o.height);
      oa += w * Math.max(0, top - o.sill);
      if (o.kind !== 'window') doorW += w;
      if (o.kind === 'window') windowA += w * o.height;
    }
    gross += g; openA += oa; skirting += L - doorW;
    per.push({ i: e.i, len: e.len, net: g - oa, openings: e.openings.length, site });
  }
  const bb = bbox(room.polygon);
  const area = polygonArea(room.polygon);
  return {
    roomId: room.id, name: room.name, floorArea: area, perimeter: edges.reduce((s, e) => s + e.len, 0),
    width: bb.maxX - bb.minX, depth: bb.maxY - bb.minY, ceilingHeight: H,
    grossWallArea: gross, openingArea: openA, netWallArea: gross - openA, ceilingArea: area, skirting, windowArea: windowA, edges: per,
  };
}

export interface AreaStatement {
  rows: { room: string; type: string; carpet: number }[];
  carpet: number; // sum of rooms (excl. balcony, shafts)
  balcony: number;
  internalWalls: number; // footprint of internal walls
  reraCarpet: number; // RERA: net usable floor area incl. internal partitions, excl. external walls, shafts, balconies
  builtUp: number;
}

export function areaStatement(f: Floor): AreaStatement {
  const rows = f.rooms.map((r) => ({ room: r.name, type: r.type, carpet: polygonArea(r.polygon) }));
  const carpet = rows.filter((r) => r.type !== 'balcony' && r.type !== 'shaft').reduce((s, r) => s + r.carpet, 0);
  const balcony = rows.filter((r) => r.type === 'balcony').reduce((s, r) => s + r.carpet, 0);
  // internal wall footprint: centreline length minus the half-thickness of the walls it meets
  let internal = 0;
  for (const w of f.walls) {
    if (w.exterior || w.status === 'demolish') continue;
    let L = dist(w.a, w.b);
    for (const end of [w.a, w.b]) {
      const host = f.walls.find((o) => o !== w && distToLine(end, o.a, o.b) < 2 && Math.abs(cross(norm(sub(o.b, o.a)), norm(sub(w.b, w.a)))) > 0.5);
      if (host) L -= host.thickness / 2;
    }
    internal += Math.max(0, L) * w.thickness;
  }
  const builtUp = f.builtUpArea ?? carpet + internal;
  return { rows, carpet, balcony, internalWalls: internal, reraCarpet: carpet + internal, builtUp };
}

/** Nearest distances from a point to the room boundary in 4 directions (used for live dimensions while dragging). */
export function clearDistances(poly: Vec2[], p: Vec2): { left: number; right: number; up: number; down: number } {
  const ray = (d: Vec2) => {
    let best = Infinity;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const e = sub(b, a);
      const den = cross(d, e);
      if (Math.abs(den) < 1e-9) continue;
      const t = cross(sub(a, p), e) / den;
      const u = cross(sub(a, p), d) / den;
      if (t > 0 && u >= 0 && u <= 1) best = Math.min(best, t);
    }
    return best;
  };
  return { left: ray({ x: -1, y: 0 }), right: ray({ x: 1, y: 0 }), up: ray({ x: 0, y: 1 }), down: ray({ x: 0, y: -1 }) };
}
