// IMP-10 … IMP-16, IMP-22, IMP-30, IMP-40: turn DXF entities into a dimensioned room model.

import type { DxfDoc, DxfEntity } from './dxf';
import type { Column, DimCheck, Floor, Item, LayerRole, Opening, Room, RoomType, Underlay, Vec2, Wall } from './types';
import { INSUNITS_TO_MM, guessUnitFactor, unitNameFromFactor } from './units';
import {
  add, bbox, centroid, cleanPolygon, cross, dist, dot, ensureCCW, len, mul, norm, perp, polygonArea, projectParam,
  simplifyClosed, sub, distToLine,
} from './geom';
import { uid, hashString, nowIso } from './util';

export function guessLayerRole(name: string): LayerRole {
  const n = name.toLowerCase();
  if (/(^|[-_ ])(wall|walls|wal|brick|partition)([-_ ]|$)|a-wall|^wall/.test(n)) return 'wall';
  if (/door|a-door|^dr/.test(n)) return 'door';
  if (/win|glaz|window|vent/.test(n)) return 'window';
  if (/col|column|struct|s-col|beam|shear|^s-/.test(n)) return 'column';
  if (/room|area|space|zone/.test(n)) return 'room';
  if (/furn|furniture|fixt|eqpm/.test(n)) return 'furniture';
  if (/plumb|sanit|sanr|^p-|wc|toilet/.test(n)) return 'plumbing';
  if (/elec|^e-|light|power/.test(n)) return 'electrical';
  if (/text|anno|dim|label|title/.test(n)) return 'annotation';
  return 'ignore';
}

export function roomTypeFromName(name: string): RoomType {
  const n = name.toLowerCase();
  if (/living|lounge|drawing|family/.test(n)) return 'living';
  if (/dining/.test(n)) return 'dining';
  if (/bed|master|guest|kids|br\b/.test(n)) return 'bedroom';
  if (/kitchen|kit\b|pantry/.test(n)) return 'kitchen';
  if (/toilet|bath|wc|powder|wash/.test(n)) return 'toilet';
  if (/passage|corridor|lobby|hall\b/.test(n)) return 'passage';
  if (/foyer|entry|entrance/.test(n)) return 'foyer';
  if (/balcony|deck|terrace|sit.?out/.test(n)) return 'balcony';
  if (/utility|wash area|store|service/.test(n)) return 'utility';
  if (/study|office|work/.test(n)) return 'study';
  if (/pooja|puja|prayer|mandir/.test(n)) return 'pooja';
  if (/shaft|duct/.test(n)) return 'shaft';
  return 'other';
}

const STD_THICKNESS = [75, 100, 115, 150, 200, 230, 250, 300];

interface Seg { a: Vec2; b: Vec2; layer: string }
interface Piece { a: Vec2; b: Vec2; t: number; conf: number; layer: string }
interface OpeningCand { kind: 'door' | 'window'; center: Vec2; hinge?: Vec2; r?: number; extent: number; conf: number; layer: string }

export interface ImportOptions {
  layerMap?: Record<string, LayerRole>;
  unitFactor?: number; // mm per drawing unit; overrides header
  defaultCeiling?: number;
  fileName?: string;
  fileText?: string;
  user?: string;
}

export interface ImportResult {
  floors: Floor[];
  underlays: Record<string, Underlay>;
  layerMap: Record<string, LayerRole>;
  unitFactor: number;
  unitSource: 'header' | 'guess' | 'user';
  stats: { walls: number; openings: number; rooms: number; columns: number; lowConfidence: number; dimMismatches: number };
}

function scaleEntity(e: DxfEntity, k: number): DxfEntity {
  const S = (p: Vec2) => ({ x: p.x * k, y: p.y * k });
  switch (e.type) {
    case 'LINE': return { ...e, a: S(e.a), b: S(e.b) };
    case 'POLY': return { ...e, pts: e.pts.map(S) };
    case 'TEXT': return { ...e, pos: S(e.pos), h: e.h * k };
    case 'ARC': return { ...e, c: S(e.c), r: e.r * k };
    case 'CIRCLE': return { ...e, c: S(e.c), r: e.r * k };
    case 'INSERT': return { ...e, pos: S(e.pos) };
    case 'DIMENSION': return { ...e, p1: S(e.p1), p2: S(e.p2) };
  }
}

function segmentsOf(e: DxfEntity): Seg[] {
  if (e.type === 'LINE') return [{ a: e.a, b: e.b, layer: e.layer }];
  if (e.type === 'POLY') {
    const out: Seg[] = [];
    const n = e.pts.length;
    for (let i = 0; i < (e.closed ? n : n - 1); i++) out.push({ a: e.pts[i], b: e.pts[(i + 1) % n], layer: e.layer });
    return out;
  }
  return [];
}

function entityPoints(e: DxfEntity): Vec2[] {
  switch (e.type) {
    case 'LINE': return [e.a, e.b];
    case 'POLY': return e.pts;
    case 'TEXT': return [e.pos];
    case 'ARC': case 'CIRCLE': return [add(e.c, { x: -e.r, y: -e.r }), add(e.c, { x: e.r, y: e.r })];
    case 'INSERT': return [e.pos];
    case 'DIMENSION': return [e.p1, e.p2];
  }
}

/** Pair parallel face lines into wall pieces with a thickness (IMP-11). */
export function pairWallFaces(segs: Seg[]): Piece[] {
  const S = segs.filter((s) => dist(s.a, s.b) > 20).map((s) => {
    // canonical direction so parallel lines compare cleanly
    let a = s.a, b = s.b;
    const d = sub(b, a);
    if (d.x < -1e-6 || (Math.abs(d.x) < 1e-6 && d.y < 0)) [a, b] = [b, a];
    return { ...s, a, b, dir: norm(sub(b, a)), L: dist(a, b) };
  });
  const used = new Set<number>();
  const pieces: Piece[] = [];
  const best = (i: number) => {
    let bj = -1, bd = Infinity;
    for (let j = 0; j < S.length; j++) {
      if (j === i || used.has(j)) continue;
      const A = S[i], B = S[j];
      if (Math.abs(cross(A.dir, B.dir)) > 0.017) continue;
      const d = distToLine(B.a, A.a, A.b);
      if (d < 40 || d > 450) continue;
      const t0 = projectParam(B.a, A.a, A.b) * A.L, t1 = projectParam(B.b, A.a, A.b) * A.L;
      const lo = Math.max(0, Math.min(t0, t1)), hi = Math.min(A.L, Math.max(t0, t1));
      if (hi - lo < Math.min(A.L, B.L) * 0.5 || hi - lo < 50) continue;
      if (d < bd) { bd = d; bj = j; }
    }
    return { j: bj, d: bd };
  };
  for (let i = 0; i < S.length; i++) {
    if (used.has(i)) continue;
    const { j, d } = best(i);
    if (j < 0) continue;
    if (best(j).j !== i) continue; // mutual nearest only
    used.add(i); used.add(j);
    const A = S[i], B = S[j];
    const t0 = projectParam(B.a, A.a, A.b) * A.L, t1 = projectParam(B.b, A.a, A.b) * A.L;
    const lo = Math.max(0, Math.min(t0, t1)), hi = Math.min(A.L, Math.max(t0, t1));
    const n = perp(A.dir);
    const side = Math.sign(dot(sub(B.a, A.a), n)) || 1;
    const off = mul(n, (side * d) / 2);
    const a = add(add(A.a, mul(A.dir, lo)), off), b = add(add(A.a, mul(A.dir, hi)), off);
    const overlapRatio = (hi - lo) / Math.max(A.L, B.L);
    const std = STD_THICKNESS.some((t) => Math.abs(t - d) <= 6);
    pieces.push({ a, b, t: Math.round(d * 10) / 10, conf: Math.min(0.99, 0.55 + 0.35 * overlapRatio + (std ? 0.1 : 0)), layer: A.layer });
  }
  // Unpaired long lines on a wall layer become thin walls the user should review.
  for (let i = 0; i < S.length; i++) {
    if (used.has(i) || S[i].L < 600) continue;
    pieces.push({ a: S[i].a, b: S[i].b, t: 115, conf: 0.4, layer: S[i].layer });
  }
  return pieces;
}

function openingCandidates(ents: DxfEntity[], role: (l: string) => LayerRole): OpeningCand[] {
  const out: OpeningCand[] = [];
  const doors = ents.filter((e) => role(e.layer) === 'door');
  const wins = ents.filter((e) => role(e.layer) === 'window');
  for (const e of doors) if (e.type === 'ARC' && e.r > 450 && e.r < 1800) {
    const mid = (((e.start + e.end) / 2) * Math.PI) / 180;
    out.push({ kind: 'door', hinge: e.c, r: e.r, center: add(e.c, mul({ x: Math.cos(mid), y: Math.sin(mid) }, e.r / 2)), extent: e.r, conf: 0.95, layer: e.layer });
  }
  // windows: cluster entities by insert group, or by touching bounding boxes
  const groups = new Map<string, Vec2[]>();
  let k = 0;
  for (const e of wins) {
    const key = e.group ?? `w${k++}`;
    const pts = entityPoints(e);
    groups.set(key, [...(groups.get(key) ?? []), ...pts]);
  }
  const boxes = [...groups.values()].map((pts) => bbox(pts));
  // merge loose boxes that touch (windows drawn as separate lines)
  const merged: typeof boxes = [];
  for (const b of boxes) {
    const hit = merged.find((m) => m.minX - 20 <= b.maxX && b.minX - 20 <= m.maxX && m.minY - 20 <= b.maxY && b.minY - 20 <= m.maxY);
    if (hit) { hit.minX = Math.min(hit.minX, b.minX); hit.minY = Math.min(hit.minY, b.minY); hit.maxX = Math.max(hit.maxX, b.maxX); hit.maxY = Math.max(hit.maxY, b.maxY); }
    else merged.push({ ...b });
  }
  for (const b of merged) {
    const w = b.maxX - b.minX, h = b.maxY - b.minY;
    if (Math.max(w, h) < 300) continue;
    out.push({ kind: 'window', center: { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 }, extent: Math.max(w, h), conf: 0.9, layer: '' });
  }
  return out;
}

interface Line { dir: Vec2; n: Vec2; c: number; t: number; pieces: { s: number; e: number; conf: number; layer: string }[] }

/** Merge collinear pieces into walls, turning gaps that hold doors/windows into openings. */
function buildWalls(pieces: Piece[], cands: OpeningCand[], user: string): { walls: Wall[]; openings: Opening[] } {
  const lines: Line[] = [];
  for (const p of pieces) {
    const dir = norm(sub(p.b, p.a));
    const n = perp(dir);
    const c = dot(p.a, n);
    let s = dot(p.a, dir), e = dot(p.b, dir);
    if (s > e) [s, e] = [e, s];
    const line = lines.find((l) => Math.abs(cross(l.dir, dir)) < 0.017 && Math.abs(l.c - c * Math.sign(dot(l.n, n))) < 8 && Math.abs(l.t - p.t) < 8);
    if (line) {
      const flip = Math.sign(dot(line.dir, dir));
      const ss = flip > 0 ? s : -e, ee = flip > 0 ? e : -s;
      line.pieces.push({ s: ss, e: ee, conf: p.conf, layer: p.layer });
    } else lines.push({ dir, n, c, t: p.t, pieces: [{ s, e, conf: p.conf, layer: p.layer }] });
  }
  const walls: Wall[] = [];
  const openings: Opening[] = [];
  const usedCands = new Set<OpeningCand>();
  for (const line of lines) {
    line.pieces.sort((a, b) => a.s - b.s);
    const P = (s: number) => add(mul(line.dir, s), mul(line.n, line.c));
    let cur = { ...line.pieces[0] };
    let pendingOpenings: { s: number; e: number; kind: Opening['kind']; conf: number; cand?: OpeningCand }[] = [];
    const flush = () => {
      const wall: Wall = {
        id: uid('wall'), a: P(cur.s), b: P(cur.e), thickness: line.t, structural: false, exterior: false, status: 'existing',
        det: { confidence: cur.conf, source: 'dxf', layer: cur.layer, reason: `Paired face lines ${line.t} mm apart` },
      };
      walls.push(wall);
      for (const o of pendingOpenings) {
        const width = o.e - o.s;
        const isVent = o.kind === 'window' && width <= 700;
        let swing: Opening['swing'];
        if (o.cand?.hinge) {
          const hp = dot(o.cand.hinge, line.dir);
          const side = Math.sign(dot(sub(o.cand.center, P((o.s + o.e) / 2)), line.n)) as 1 | -1;
          swing = { hinge: Math.abs(hp - o.s) < Math.abs(hp - o.e) ? 'a' : 'b', side: side || 1 };
        }
        const conf = o.cand?.r ? (Math.abs(o.cand.r - width) < 60 ? o.conf : o.conf * 0.85) : o.conf;
        openings.push({
          id: uid('op'), wallId: wall.id, kind: o.kind, offset: (o.s + o.e) / 2 - cur.s, width,
          height: o.kind === 'window' ? (isVent ? 600 : 1200) : 2100, sill: o.kind === 'window' ? (isVent ? 1800 : 900) : 0, swing,
          det: { confidence: conf, source: 'dxf', reason: o.cand ? `${o.kind} symbol found in wall gap` : 'Gap in wall with no door/window symbol' },
        });
      }
      pendingOpenings = [];
    };
    for (let i = 1; i < line.pieces.length; i++) {
      const nx = line.pieces[i];
      const gap = nx.s - cur.e;
      if (gap <= 5) { cur.e = Math.max(cur.e, nx.e); cur.conf = Math.min(cur.conf, nx.conf); continue; }
      const mid = P((cur.e + nx.s) / 2);
      const cand = cands.find((c) => !usedCands.has(c) && (
        c.kind === 'window'
          ? dist(c.center, mid) < Math.max(line.t, 150) && Math.abs(c.extent - gap) < 120
          : !!c.hinge && Math.min(dist(c.hinge, P(cur.e)), dist(c.hinge, P(nx.s))) < line.t + 60
      ));
      if (cand || gap <= 1500) {
        if (cand) usedCands.add(cand);
        pendingOpenings.push({ s: cur.e, e: nx.s, kind: cand ? cand.kind : 'opening', conf: cand ? cand.conf : 0.6, cand });
        cur.e = Math.max(cur.e, nx.e);
        cur.conf = Math.min(cur.conf, nx.conf);
      } else { flush(); cur = { ...nx }; }
    }
    flush();
  }
  void user;
  return { walls, openings };
}

// ---------------------------------------------------------------------------
// Room detection by raster flood fill (IMP-12). 10 mm cells, then snapped to wall faces.

const CELL = 10;

interface Grid { w: number; h: number; ox: number; oy: number; data: Uint8Array } // 0 free, 1 wall, 2 outside, >=3 room id + 3

function rasterize(walls: Wall[], columns: Column[]): Grid {
  const pts = walls.flatMap((w) => [w.a, w.b]);
  const bb = bbox(pts);
  const pad = 600;
  const ox = Math.floor((bb.minX - pad) / CELL) * CELL, oy = Math.floor((bb.minY - pad) / CELL) * CELL;
  const w = Math.ceil((bb.maxX - ox + pad) / CELL), h = Math.ceil((bb.maxY - oy + pad) / CELL);
  const data = new Uint8Array(w * h);
  const fillRect = (corners: Vec2[]) => {
    const b = bbox(corners);
    const x0 = Math.max(0, Math.floor((b.minX - ox) / CELL)), x1 = Math.min(w - 1, Math.ceil((b.maxX - ox) / CELL));
    const y0 = Math.max(0, Math.floor((b.minY - oy) / CELL)), y1 = Math.min(h - 1, Math.ceil((b.maxY - oy) / CELL));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const p = { x: ox + (x + 0.5) * CELL, y: oy + (y + 0.5) * CELL };
      let inside = true;
      for (let i = 0; i < 4 && inside; i++) {
        const a = corners[i], c = corners[(i + 1) % 4];
        if (cross(sub(c, a), sub(p, a)) < -1e-6) inside = false;
      }
      if (inside) data[y * w + x] = 1;
    }
  };
  for (const wall of walls) {
    if (wall.status === 'demolish') continue;
    const d = norm(sub(wall.b, wall.a));
    const n = perp(d);
    const ht = wall.thickness / 2;
    const a = sub(wall.a, mul(d, ht)), b = add(wall.b, mul(d, ht));
    fillRect([add(a, mul(n, -ht)), add(b, mul(n, -ht)), add(b, mul(n, ht)), add(a, mul(n, ht))]);
  }
  for (const c of columns) {
    const hw = c.w / 2, hd = c.d / 2;
    fillRect([{ x: c.center.x - hw, y: c.center.y - hd }, { x: c.center.x + hw, y: c.center.y - hd }, { x: c.center.x + hw, y: c.center.y + hd }, { x: c.center.x - hw, y: c.center.y + hd }]);
  }
  return { w, h, ox, oy, data };
}

function flood(g: Grid, sx: number, sy: number, val: number): number {
  if (g.data[sy * g.w + sx] !== 0) return 0;
  const stack = new Int32Array(g.w * g.h);
  let sp = 0, count = 0;
  stack[sp++] = sy * g.w + sx;
  g.data[sy * g.w + sx] = val;
  while (sp > 0) {
    const idx = stack[--sp];
    count++;
    const x = idx % g.w, y = (idx / g.w) | 0;
    if (x > 0 && g.data[idx - 1] === 0) { g.data[idx - 1] = val; stack[sp++] = idx - 1; }
    if (x < g.w - 1 && g.data[idx + 1] === 0) { g.data[idx + 1] = val; stack[sp++] = idx + 1; }
    if (y > 0 && g.data[idx - g.w] === 0) { g.data[idx - g.w] = val; stack[sp++] = idx - g.w; }
    if (y < g.h - 1 && g.data[idx + g.w] === 0) { g.data[idx + g.w] = val; stack[sp++] = idx + g.w; }
  }
  return count;
}

/** Trace the outer boundary of all cells equal to val, CCW, in mm. */
function trace(g: Grid, val: number): Vec2[] {
  const next = new Map<string, string[]>();
  const key = (x: number, y: number) => `${x},${y}`;
  const at = (x: number, y: number) => x >= 0 && y >= 0 && x < g.w && y < g.h && g.data[y * g.w + x] === val;
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
    if (!at(x, y)) continue;
    // edges with the region on the left (CCW)
    if (!at(x, y - 1)) (next.get(key(x, y)) ?? next.set(key(x, y), []).get(key(x, y))!).push(key(x + 1, y));
    if (!at(x + 1, y)) (next.get(key(x + 1, y)) ?? next.set(key(x + 1, y), []).get(key(x + 1, y))!).push(key(x + 1, y + 1));
    if (!at(x, y + 1)) (next.get(key(x + 1, y + 1)) ?? next.set(key(x + 1, y + 1), []).get(key(x + 1, y + 1))!).push(key(x, y + 1));
    if (!at(x - 1, y)) (next.get(key(x, y + 1)) ?? next.set(key(x, y + 1), []).get(key(x, y + 1))!).push(key(x, y));
  }
  const loops: Vec2[][] = [];
  while (next.size) {
    const start = next.keys().next().value as string;
    const loop: Vec2[] = [];
    let cur = start;
    for (let guard = 0; guard < 2_000_000; guard++) {
      const outs = next.get(cur);
      if (!outs || !outs.length) break;
      const nx = outs.pop()!;
      if (!outs.length) next.delete(cur);
      const [x, y] = cur.split(',').map(Number);
      loop.push({ x: g.ox + x * CELL, y: g.oy + y * CELL });
      cur = nx;
      if (cur === start) break;
    }
    if (loop.length > 2) loops.push(loop);
  }
  loops.sort((a, b) => polygonArea(b) - polygonArea(a));
  return loops[0] ?? [];
}

function snapPolygon(poly: Vec2[], walls: Wall[], columns: Column[]): Vec2[] {
  const xs: number[] = [], ys: number[] = [];
  for (const w of walls) {
    const d = sub(w.b, w.a);
    if (Math.abs(d.x) < 1) { xs.push(w.a.x - w.thickness / 2, w.a.x + w.thickness / 2); }
    if (Math.abs(d.y) < 1) { ys.push(w.a.y - w.thickness / 2, w.a.y + w.thickness / 2); }
    // wall ends (exterior corners extend by half thickness)
    if (Math.abs(d.x) < 1) { ys.push(Math.min(w.a.y, w.b.y) - w.thickness / 2, Math.max(w.a.y, w.b.y) + w.thickness / 2); }
    if (Math.abs(d.y) < 1) { xs.push(Math.min(w.a.x, w.b.x) - w.thickness / 2, Math.max(w.a.x, w.b.x) + w.thickness / 2); }
  }
  for (const c of columns) { xs.push(c.center.x - c.w / 2, c.center.x + c.w / 2); ys.push(c.center.y - c.d / 2, c.center.y + c.d / 2); }
  const snap = (val: number, arr: number[]) => {
    let best = val, bd = CELL * 1.3;
    for (const a of arr) { const d = Math.abs(a - val); if (d < bd) { bd = d; best = a; } }
    return best;
  };
  return poly.map((p) => ({ x: Math.round(snap(p.x, xs) * 10) / 10, y: Math.round(snap(p.y, ys) * 10) / 10 }));
}

export function detectRooms(walls: Wall[], columns: Column[], labels: { pos: Vec2; text: string }[], defaultCeiling: number): { rooms: Room[]; outline: Vec2[]; builtUp: number } {
  if (!walls.length) return { rooms: [], outline: [], builtUp: 0 };
  const g = rasterize(walls, columns);
  flood(g, 0, 0, 2);
  let total = 0;
  for (let i = 0; i < g.data.length; i++) if (g.data[i] !== 2) total++;
  const builtUp = total * CELL * CELL;
  // outline = everything that is not outside
  const og: Grid = { ...g, data: new Uint8Array(g.data.length) };
  for (let i = 0; i < g.data.length; i++) og.data[i] = g.data[i] === 2 ? 0 : 1;
  const outline = cleanPolygon(simplifyClosed(cleanPolygon(trace(og, 1)), 12));

  const named: { val: number; names: string[]; conf: number }[] = [];
  let nextVal = 3;
  const cellOf = (p: Vec2) => ({ x: Math.floor((p.x - g.ox) / CELL), y: Math.floor((p.y - g.oy) / CELL) });
  for (const l of labels) {
    const c = cellOf(l.pos);
    if (c.x < 0 || c.y < 0 || c.x >= g.w || c.y >= g.h) continue;
    const cur = g.data[c.y * g.w + c.x];
    if (cur >= 3) { named.find((n) => n.val === cur)?.names.push(l.text); continue; }
    if (cur !== 0 || nextVal > 250) continue;
    const val = nextVal++;
    flood(g, c.x, c.y, val);
    named.push({ val, names: [l.text], conf: 0.9 });
  }
  // unlabelled enclosed spaces
  let unnamed = 1;
  for (let y = 0; y < g.h; y += 5) for (let x = 0; x < g.w; x += 5) {
    if (g.data[y * g.w + x] !== 0 || nextVal > 250) continue;
    const val = nextVal++;
    const n = flood(g, x, y, val);
    const area = n * CELL * CELL;
    if (area < 0.05e6) continue;
    named.push({ val, names: [area < 1.5e6 ? 'Shaft' : `Space ${unnamed++}`], conf: area < 1.5e6 ? 0.55 : 0.6 });
  }
  const rooms: Room[] = [];
  for (const n of named) {
    const raw = trace(g, n.val);
    if (raw.length < 3) continue;
    let poly = cleanPolygon(raw);
    poly = cleanPolygon(simplifyClosed(poly, 12));
    poly = ensureCCW(cleanPolygon(snapPolygon(poly, walls, columns)));
    const name = titleCase(n.names.join(' / '));
    const type = roomTypeFromName(name);
    rooms.push({
      id: uid('room'), name, type, polygon: poly, ceilingHeight: defaultCeiling,
      falseCeiling: { enabled: ['living', 'bedroom', 'dining'].includes(type), drop: 300, cove: type === 'living' || type === 'bedroom' },
      finishes: defaultFinishes(type), wallFinishOverrides: {}, status: 'concept',
      det: { confidence: n.conf, source: 'dxf', reason: n.conf >= 0.9 ? `Enclosed area containing label "${n.names[0]}"` : 'Enclosed area with no label' },
    });
  }
  return { rooms, outline, builtUp };
}

export function defaultFinishes(type: RoomType): Room['finishes'] {
  const wet = type === 'toilet' || type === 'balcony' || type === 'utility';
  return {
    floor: wet ? 'fl-antiskid' : type === 'kitchen' ? 'fl-concrete' : 'fl-vit-grey',
    wall: type === 'toilet' ? 'wt-dado' : 'pt-white',
    ceiling: ['living', 'bedroom', 'dining'].includes(type) ? 'cl-gypsum' : 'cl-paint',
    skirting: wet ? '' : 'sk-tile',
  };
}

function titleCase(s: string) { return s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()).replace(/\s+/g, ' ').trim(); }

function markExterior(walls: Wall[], columns: Column[]) {
  const g = rasterize(walls, columns);
  flood(g, 0, 0, 2);
  for (const w of walls) {
    const d = norm(sub(w.b, w.a));
    const n = perp(d);
    const mid = mul(add(w.a, w.b), 0.5);
    let ext = false;
    for (const t of [0.25, 0.5, 0.75]) {
      const p = add(w.a, mul(sub(w.b, w.a), t));
      for (const side of [1, -1]) {
        const q = add(p, mul(n, side * (w.thickness / 2 + 25)));
        const x = Math.floor((q.x - g.ox) / CELL), y = Math.floor((q.y - g.oy) / CELL);
        if (g.data[y * g.w + x] === 2) ext = true;
      }
    }
    void mid;
    w.exterior = ext;
  }
}

function snapWallEndpoints(walls: Wall[]) {
  // Extend wall ends that stop short of (or overshoot) another wall's centreline, so T-junctions close.
  for (const w of walls) {
    for (const end of ['a', 'b'] as const) {
      const p = w[end];
      const d = norm(sub(w.b, w.a));
      for (const o of walls) {
        if (o === w || Math.abs(cross(d, norm(sub(o.b, o.a)))) < 0.5) continue;
        const dl = distToLine(p, o.a, o.b);
        const t = projectParam(p, o.a, o.b);
        if (dl < o.thickness / 2 + 30 && t > -0.02 && t < 1.02) {
          // move the endpoint along w's direction onto o's centreline
          const od = norm(sub(o.b, o.a));
          const on = perp(od);
          const denom = dot(d, on);
          if (Math.abs(denom) < 1e-6) continue;
          const s = dot(sub(o.a, p), on) / denom;
          if (Math.abs(s) < o.thickness / 2 + 30) w[end] = add(p, mul(d, s));
        }
      }
    }
  }
}

export function importDxf(doc: DxfDoc, opts: ImportOptions = {}): ImportResult {
  const layerMap: Record<string, LayerRole> = {};
  for (const l of doc.layers) layerMap[l.name] = opts.layerMap?.[l.name] ?? guessLayerRole(l.name);
  const role = (l: string) => layerMap[l] ?? 'ignore';

  let unitFactor = opts.unitFactor ?? 0;
  let unitSource: ImportResult['unitSource'] = 'user';
  if (!unitFactor && INSUNITS_TO_MM[doc.insUnits]) { unitFactor = INSUNITS_TO_MM[doc.insUnits]; unitSource = 'header'; }
  if (!unitFactor) {
    const pts = doc.entities.filter((e) => role(e.layer) === 'wall').flatMap(entityPoints);
    const bb = bbox(pts.length ? pts : doc.entities.flatMap(entityPoints));
    unitFactor = guessUnitFactor(Math.max(bb.maxX - bb.minX, bb.maxY - bb.minY)).factor;
    unitSource = 'guess';
  }
  const ents = doc.entities.map((e) => scaleEntity(e, unitFactor));
  const inserts = doc.inserts.map((e) => scaleEntity(e, unitFactor) as Extract<DxfEntity, { type: 'INSERT' }>);
  const user = opts.user ?? 'Designer';
  const ceiling = opts.defaultCeiling ?? 3000;

  const wallSegs = ents.filter((e) => role(e.layer) === 'wall').flatMap(segmentsOf);
  const pieces = pairWallFaces(wallSegs);
  const cands = openingCandidates(ents, role);
  const { walls: allWalls, openings: allOpenings } = buildWalls(pieces, cands, user);
  snapWallEndpoints(allWalls);

  // Columns / structural layer (IMP-40)
  const allColumns: Column[] = [];
  for (const e of ents) if (role(e.layer) === 'column' && e.type === 'POLY' && e.closed) {
    const b = bbox(e.pts);
    const w = b.maxX - b.minX, d = b.maxY - b.minY;
    if (w < 100 || d < 100) continue;
    const kind: Column['kind'] = Math.max(w, d) / Math.min(w, d) > 4 ? 'shear-wall' : 'column';
    allColumns.push({ id: uid('col'), center: { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 }, w, d, kind, det: { confidence: 0.92, source: 'dxf', layer: e.layer, reason: 'Closed outline on structural layer' } });
  }
  // Walls overlapping a column outline over most of their thickness are structural (shear walls / RCC).
  for (const w of allWalls) {
    w.structural = w.thickness >= 200 && allColumns.some((c) => c.kind === 'shear-wall' && distToLine(c.center, w.a, w.b) < w.thickness);
  }

  const labels = ents.filter((e): e is Extract<DxfEntity, { type: 'TEXT' }> => e.type === 'TEXT')
    .filter((t) => /[a-z]/i.test(t.text) && !/^[\d\s.,x×'"-]+(mm|m|ft)?$/i.test(t.text) && t.text.length < 40)
    .filter((t) => role(t.layer) === 'annotation' || role(t.layer) === 'room' || role(t.layer) === 'ignore');

  // Split into floors: connected clusters of walls far apart from each other (IMP-06).
  const clusters = clusterWalls(allWalls);
  const floors: Floor[] = [];
  const underlays: Record<string, Underlay> = {};
  clusters.forEach((cw, ci) => {
    const ids = new Set(cw.map((w) => w.id));
    const bb = bbox(cw.flatMap((w) => [w.a, w.b]));
    const inBox = (p: Vec2, pad = 500) => p.x >= bb.minX - pad && p.x <= bb.maxX + pad && p.y >= bb.minY - pad && p.y <= bb.maxY + pad;
    const openings = allOpenings.filter((o) => ids.has(o.wallId));
    const columns = allColumns.filter((c) => inBox(c.center));
    markExterior(cw, columns);
    const fl = labels.filter((l) => inBox(l.pos));
    const { rooms, outline, builtUp } = detectRooms(cw, columns, fl, ceiling);
    // name floors from a label like "FIRST FLOOR PLAN"
    const floorLabel = ents.find((e) => e.type === 'TEXT' && /floor|level|ground|stilt/i.test(e.text) && inBox(e.pos)) as Extract<DxfEntity, { type: 'TEXT' }> | undefined;
    const items = detectFixtures(inserts.filter((i) => inBox(i.pos)), role, rooms);
    const dimChecks: DimCheck[] = ents.filter((e): e is Extract<DxfEntity, { type: 'DIMENSION' }> => e.type === 'DIMENSION' && inBox(e.p1, 2000)).map((d) => {
      const drawn = dist(d.p1, d.p2);
      const writtenRaw = d.text ? parseFloat(d.text.replace(/[^\d.]/g, '')) * unitFactor : d.measured !== undefined ? d.measured * unitFactor : drawn;
      const written = isFinite(writtenRaw) ? writtenRaw : drawn;
      return { id: uid('dim'), a: d.p1, b: d.p2, written, drawn, ok: Math.abs(written - drawn) <= 5 };
    });
    const floor: Floor = {
      id: uid('floor'), name: floorLabel ? titleCase(floorLabel.text) : clusters.length > 1 ? `Floor ${ci + 1}` : 'Ground floor', level: 0,
      walls: cw, openings, columns, rooms, items, points: [], annotations: [], siteMeasures: [], dimChecks, outline, builtUpArea: builtUp, northDeg: 90,
      source: opts.fileName ? { fileName: opts.fileName, hash: hashString(opts.fileText ?? ''), importedAt: nowIso(), units: unitNameFromFactor(unitFactor), layerMap } : undefined,
    };
    floors.push(floor);
    underlays[floor.id] = {
      lines: ents.filter((e) => e.type === 'LINE' || e.type === 'POLY').flatMap(segmentsOf).filter((s) => inBox(s.a)).map((s) => ({ a: s.a, b: s.b, layer: s.layer })),
      texts: ents.filter((e): e is Extract<DxfEntity, { type: 'TEXT' }> => e.type === 'TEXT' && inBox(e.pos)).map((t) => ({ pos: t.pos, text: t.text, h: t.h, layer: t.layer })),
    };
  });

  const all = floors.flatMap((f) => [...f.walls, ...f.openings, ...f.rooms, ...f.columns]);
  return {
    floors, underlays, layerMap, unitFactor, unitSource,
    stats: {
      walls: floors.reduce((s, f) => s + f.walls.length, 0),
      openings: floors.reduce((s, f) => s + f.openings.length, 0),
      rooms: floors.reduce((s, f) => s + f.rooms.length, 0),
      columns: floors.reduce((s, f) => s + f.columns.length, 0),
      lowConfidence: all.filter((e) => (e.det?.confidence ?? 1) < 0.75).length,
      dimMismatches: floors.reduce((s, f) => s + f.dimChecks.filter((d) => !d.ok).length, 0),
    },
  };
}

function clusterWalls(walls: Wall[]): Wall[][] {
  const parent = walls.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const boxes = walls.map((w) => bbox([w.a, w.b]));
  for (let i = 0; i < walls.length; i++) for (let j = i + 1; j < walls.length; j++) {
    const a = boxes[i], b = boxes[j], pad = 1500;
    if (a.minX - pad <= b.maxX && b.minX - pad <= a.maxX && a.minY - pad <= b.maxY && b.minY - pad <= a.maxY) parent[find(i)] = find(j);
  }
  const groups = new Map<number, Wall[]>();
  walls.forEach((w, i) => { const r = find(i); groups.set(r, [...(groups.get(r) ?? []), w]); });
  const out = [...groups.values()].filter((g) => g.length >= 3);
  out.sort((a, b) => bbox(a.flatMap((w) => [w.a])).minX - bbox(b.flatMap((w) => [w.a])).minX);
  return out.length ? out : [walls];
}

function detectFixtures(inserts: Extract<DxfEntity, { type: 'INSERT' }>[], role: (l: string) => LayerRole, rooms: Room[]): Item[] {
  const out: Item[] = [];
  for (const ins of inserts) {
    const n = ins.name.toLowerCase();
    let catalogId: string | undefined;
    if (/\bwc\b|^wc|toilet|ewc|commode/.test(n)) catalogId = 'wc';
    else if (/basin|wash|lav/.test(n)) catalogId = 'basin';
    else if (/sink/.test(n)) catalogId = 'sink';
    else if (/\bac\b|^ac|split/.test(n)) catalogId = 'ac-split';
    if (!catalogId && role(ins.layer) !== 'plumbing') continue;
    if (!catalogId) continue;
    const dims = { wc: [380, 540, 400], basin: [600, 450, 850], sink: [860, 500, 200], 'ac-split': [1000, 250, 320] }[catalogId as 'wc'] ?? [500, 500, 500];
    // INSERT base point sits on the wall; place the footprint centre half a depth in front of it.
    const front = { x: -Math.sin((ins.rot * Math.PI) / 180), y: Math.cos((ins.rot * Math.PI) / 180) };
    const pos = add(ins.pos, mul(front, dims[1] / 2));
    const room = rooms.find((r) => pointInPolyLoose(pos, r.polygon));
    out.push({
      id: uid('item'), roomId: room?.id ?? '', catalogId, pos, rot: ins.rot, w: dims[0], d: dims[1], h: dims[2], elev: 0,
      existing: true, reason: `Existing fixture block "${ins.name}" in drawing`,
    });
  }
  return out;
}

function pointInPolyLoose(p: Vec2, poly: Vec2[]) {
  // tolerant test: fixtures sit against walls, so test a point nudged towards the room centre
  const c = centroid(poly);
  const q = add(p, mul(norm(sub(c, p)), 150));
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > q.y) !== (b.y > q.y) && q.x < ((b.x - a.x) * (q.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** IMP-31: compare walls of a re-imported drawing against the current model. */
export function diffWalls(oldWalls: Wall[], newWalls: Wall[]): { added: Wall[]; removed: Wall[]; moved: { from: Wall; to: Wall }[]; same: number } {
  const key = (w: Wall) => { const d = norm(sub(w.b, w.a)); return { d, n: perp(d) }; };
  const matched = new Set<string>();
  const moved: { from: Wall; to: Wall }[] = [];
  let same = 0;
  for (const o of oldWalls) {
    const ok = key(o);
    let exact: Wall | undefined, near: Wall | undefined;
    for (const n of newWalls) {
      if (matched.has(n.id)) continue;
      const nk = key(n);
      if (Math.abs(cross(ok.d, nk.d)) > 0.02) continue;
      const da = Math.min(dist(o.a, n.a) + dist(o.b, n.b), dist(o.a, n.b) + dist(o.b, n.a));
      if (da < 20 && Math.abs(o.thickness - n.thickness) < 5) { exact = n; break; }
      const off = distToLine(n.a, o.a, o.b);
      const overl = Math.min(len(sub(o.b, o.a)), len(sub(n.b, n.a)));
      if (off < 600 && overl > 300 && !near) near = n;
    }
    if (exact) { matched.add(exact.id); same++; }
    else if (near) { matched.add(near.id); moved.push({ from: o, to: near }); }
  }
  const movedFrom = new Set(moved.map((m) => m.from.id));
  const exactOld = oldWalls.filter((o) => !movedFrom.has(o.id));
  const removed = exactOld.filter((o) => !newWalls.some((n) => matched.has(n.id) && Math.min(dist(o.a, n.a) + dist(o.b, n.b), dist(o.a, n.b) + dist(o.b, n.a)) < 20));
  return { added: newWalls.filter((n) => !matched.has(n.id)), removed, moved, same };
}

/** Rescale everything on a floor (calibration by a known distance, IMP-14). */
export function scaleFloor(f: Floor, k: number, origin: Vec2 = { x: 0, y: 0 }): Floor {
  const S = (p: Vec2) => ({ x: origin.x + (p.x - origin.x) * k, y: origin.y + (p.y - origin.y) * k });
  return {
    ...f,
    walls: f.walls.map((w) => ({ ...w, a: S(w.a), b: S(w.b) })),
    openings: f.openings.map((o) => ({ ...o, offset: o.offset * k, width: o.width * k })),
    columns: f.columns.map((c) => ({ ...c, center: S(c.center), w: c.w * k, d: c.d * k })),
    rooms: f.rooms.map((r) => ({ ...r, polygon: r.polygon.map(S) })),
    items: f.items.map((i) => ({ ...i, pos: S(i.pos) })),
    points: f.points.map((p) => ({ ...p, pos: S(p.pos) })),
    outline: f.outline?.map(S),
    builtUpArea: f.builtUpArea ? f.builtUpArea * k * k : undefined,
  };
}

/** Recompute rooms after walls were edited, keeping names/finishes of rooms whose label point still falls inside. */
export function recomputeRooms(f: Floor): Floor {
  const labels = f.rooms.map((r) => ({ pos: centroid(r.polygon), text: r.name }));
  const { rooms, outline, builtUp } = detectRooms(f.walls, f.columns, labels, f.rooms[0]?.ceilingHeight ?? 3000);
  const kept = rooms.map((nr) => {
    const old = f.rooms.find((o) => o.name.toLowerCase() === nr.name.toLowerCase());
    return old ? { ...old, polygon: nr.polygon } : nr;
  });
  return { ...f, rooms: kept, outline, builtUpArea: builtUp };
}
