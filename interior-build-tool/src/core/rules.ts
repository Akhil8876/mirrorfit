// GEN-11, GEN-13, GEN-21, EDT-15, EDT-21, IMP-44, GEN-32: rule checker used by the generator,
// live while editing, and as a gate before issuing drawings.

import type { Floor, Item, MepPoint, Room, RulePack, Vec2 } from './types';
import type { Catalog, CatalogItem } from './catalog';
import { itemById } from './catalog';
import { add, convexOverlap, dist, mul, pointInPolygonTol, rectCorners, rot, sub, polygonArea, centroid } from './geom';
import { roomEdges, finishedCeiling, measureRoom } from './measure';

export const RULE_PACK_VERSION = 'IN-generic-2026.1';

/** Values are configurable and versioned (NFR-20). The building-code edition still needs confirming (PRD 10.4). */
export const DEFAULT_RULES: RulePack = {
  id: RULE_PACK_VERSION,
  edition: 'Generic Indian residential minimums (edition to be confirmed: NBC 2016 / SP 7:2026)',
  city: 'Generic',
  minHabitableArea: 9.5,
  minKitchenArea: 5.0,
  minHabitableCeiling: 2750,
  minToiletCeiling: 2100,
  minWindowRatio: 0.1,
  walkway: 750,
  wardrobeFront: 900,
  bedSide: 450,
  switchMin: 1000,
  switchMax: 1350,
  counterMin: 820,
  counterMax: 920,
};

export type Severity = 'error' | 'warning' | 'info';
export interface Issue { id: string; rule: string; severity: Severity; msg: string; roomId?: string; itemIds?: string[]; pos?: Vec2 }

export function footprint(i: Pick<Item, 'pos' | 'w' | 'd' | 'rot'>): Vec2[] { return rectCorners(i.pos, i.w, i.d, i.rot); }

/** Rectangle in front of an item, depth = clearance. */
export function frontZone(i: Pick<Item, 'pos' | 'w' | 'd' | 'rot'>, clearance: number): Vec2[] {
  const f = rot({ x: 0, y: 1 }, i.rot);
  return rectCorners(add(i.pos, mul(f, i.d / 2 + clearance / 2)), i.w - 20, clearance, i.rot);
}

const vOverlap = (a: Item, b: Item) => a.elev < b.elev + b.h - 1 && b.elev < a.elev + a.h - 1;

/** Door swing keep-out squares on the room side(s) of every door. */
export function doorZones(f: Floor): { id: string; poly: Vec2[] }[] {
  const out: { id: string; poly: Vec2[] }[] = [];
  for (const o of f.openings) {
    if (o.kind !== 'door') continue;
    const w = f.walls.find((w) => w.id === o.wallId);
    if (!w) continue;
    const d = sub(w.b, w.a);
    const L = Math.hypot(d.x, d.y);
    const dir = { x: d.x / L, y: d.y / L };
    const n = { x: -dir.y, y: dir.x };
    const c = add(w.a, mul(dir, o.offset));
    if (o.swing) {
      // quarter circle swept by the leaf, as a convex fan from the hinge
      const s = o.swing.side;
      const hingeAlong = o.swing.hinge === 'a' ? -o.width / 2 : o.width / 2;
      const hinge = add(add(c, mul(dir, hingeAlong)), mul(n, s * (w.thickness / 2)));
      const closed = mul(dir, o.swing.hinge === 'a' ? 1 : -1);
      const open = mul(n, s);
      const poly = [hinge];
      for (let k = 0; k <= 6; k++) {
        const t = (k / 6) * (Math.PI / 2);
        poly.push(add(hinge, mul(add(mul(closed, Math.cos(t)), mul(open, Math.sin(t))), o.width + 50)));
      }
      out.push({ id: o.id, poly });
    } else {
      for (const s of [1, -1]) {
        const center = add(c, mul(n, s * (w.thickness / 2 + o.width / 2)));
        const ang = (Math.atan2(dir.y, dir.x) * 180) / Math.PI;
        out.push({ id: o.id, poly: rectCorners(center, o.width, o.width, ang) });
      }
    }
  }
  return out;
}

function inside(poly: Vec2[], room: Room) {
  const c = centroid(poly);
  return poly.every((p) => pointInPolygonTol(add(p, mul(sub(c, p), 0.002)), room.polygon, 3));
}

export interface RuleContext { catalog: Catalog; rules: RulePack; accessibility?: boolean }

export function checkRoom(f: Floor, room: Room, ctx: RuleContext, items = f.items.filter((i) => i.roomId === room.id), points = f.points.filter((p) => p.roomId === room.id)): Issue[] {
  const R = ctx.rules;
  const issues: Issue[] = [];
  const add_ = (i: Omit<Issue, 'id'>) => issues.push({ id: `${i.rule}:${(i.itemIds ?? []).join('+')}:${i.roomId ?? ''}:${issues.length}`, ...i });
  const doors = doorZones(f);
  const cols = f.columns.map((c) => ({ id: c.id, poly: rectCorners(c.center, c.w, c.d, 0) }));
  const cat = (i: Item): CatalogItem | undefined => itemById(ctx.catalog, i.catalogId);

  for (const it of items) {
    const fp = footprint(it);
    const ci = cat(it);
    if (!inside(fp, room)) add_({ rule: 'R-OUTSIDE', severity: 'error', msg: `${ci?.name ?? 'Item'} runs into a wall or outside ${room.name}`, roomId: room.id, itemIds: [it.id], pos: it.pos });
    if (!ci?.wallMounted || it.elev < 2100) {
      for (const dz of doors) if (convexOverlap(fp, dz.poly, 5) && it.elev < 2000) {
        add_({ rule: 'R-DOOR', severity: 'error', msg: `${ci?.name ?? 'Item'} blocks a door swing`, roomId: room.id, itemIds: [it.id], pos: it.pos });
        break;
      }
    }
    for (const c of cols) if (convexOverlap(fp, c.poly, 2)) add_({ rule: 'R-COLUMN', severity: 'error', msg: `${ci?.name ?? 'Item'} overlaps a structural column`, roomId: room.id, itemIds: [it.id], pos: it.pos });
    // tall items in front of windows
    if (!ci?.low && it.h + it.elev > 1000) {
      for (const e of roomEdges(f, room)) for (const o of e.openings) if (o.kind === 'window') {
        const mid = add(e.a, mul(e.dir, (o.s + o.e) / 2));
        const probe = rectCorners(add(mid, mul(e.n, 150)), o.e - o.s - 50, 250, (Math.atan2(e.dir.y, e.dir.x) * 180) / Math.PI);
        if (convexOverlap(fp, probe, 2) && it.elev < o.sill + o.height && it.elev + it.h > o.sill) add_({ rule: 'R-WINDOW', severity: 'warning', msg: `${ci?.name ?? 'Item'} blocks a window`, roomId: room.id, itemIds: [it.id], pos: it.pos });
      }
    }
    // front clearance (walkway / wardrobe)
    const need = ci?.category === 'wardrobe' ? (it.joinery?.shutter === 'sliding' ? 600 : R.wardrobeFront) : ci?.clearance;
    if (need && !ci?.low) {
      const fz = frontZone(it, need);
      const blocked = items.find((o) => o !== it && !cat(o)?.low && !cat(o)?.wallMounted && o.elev < 900 && convexOverlap(fz, footprint(o), 5));
      const outside = !inside(fz, room);
      if (blocked || outside) add_({ rule: 'R-CLEARANCE', severity: 'warning', msg: `${ci?.name ?? 'Item'} has less than ${need} mm clear in front${blocked ? ` (${cat(blocked)?.name})` : ''}`, roomId: room.id, itemIds: blocked ? [it.id, blocked.id] : [it.id], pos: it.pos });
    }
  }
  // overlaps
  for (let a = 0; a < items.length; a++) for (let b = a + 1; b < items.length; b++) {
    const A = items[a], B = items[b];
    const ca = cat(A), cb = cat(B);
    if (ca?.category === 'rug' || cb?.category === 'rug' || ca?.category === 'curtain' || cb?.category === 'curtain') continue;
    if ((ca?.category === 'sink' || ca?.category === 'hob') && cb?.category === 'kitchen-base') continue;
    if ((cb?.category === 'sink' || cb?.category === 'hob') && ca?.category === 'kitchen-base') continue;
    if (!vOverlap(A, B)) continue;
    if (convexOverlap(footprint(A), footprint(B), 5)) add_({ rule: 'R-OVERLAP', severity: 'error', msg: `${ca?.name ?? 'Item'} overlaps ${cb?.name ?? 'item'}`, roomId: room.id, itemIds: [A.id, B.id], pos: A.pos });
  }
  // bed side clearance
  for (const bed of items.filter((i) => cat(i)?.category === 'bed')) {
    const left = rectCorners(add(bed.pos, rot({ x: -(bed.w / 2 + R.bedSide / 2 + 5), y: 0 }, bed.rot)), R.bedSide, bed.d * 0.6, bed.rot);
    const right = rectCorners(add(bed.pos, rot({ x: bed.w / 2 + R.bedSide / 2 + 5, y: 0 }, bed.rot)), R.bedSide, bed.d * 0.6, bed.rot);
    const free = (z: Vec2[]) => inside(z, room) && !items.some((o) => o !== bed && !cat(o)?.low && cat(o)?.category !== 'side-table' && o.elev < 900 && convexOverlap(z, footprint(o), 5));
    if (!free(left) && !free(right)) add_({ rule: 'R-BED-SIDE', severity: 'warning', msg: `Bed has less than ${R.bedSide} mm access on both sides`, roomId: room.id, itemIds: [bed.id], pos: bed.pos });
  }
  // kitchen ergonomics (GEN-13)
  if (room.type === 'kitchen') {
    for (const b of items.filter((i) => cat(i)?.category === 'kitchen-base')) {
      if (b.h < R.counterMin || b.h > R.counterMax) add_({ rule: 'R-COUNTER', severity: 'warning', msg: `Counter height ${b.h} mm is outside ${R.counterMin}–${R.counterMax} mm`, roomId: room.id, itemIds: [b.id], pos: b.pos });
    }
    const sink = items.find((i) => cat(i)?.category === 'sink');
    const hob = items.find((i) => cat(i)?.category === 'hob');
    const fridge = items.find((i) => cat(i)?.category === 'fridge');
    if (sink && hob && fridge) {
      const tri = dist(sink.pos, hob.pos) + dist(hob.pos, fridge.pos) + dist(fridge.pos, sink.pos);
      if (tri < 3600 || tri > 7900) add_({ rule: 'R-TRIANGLE', severity: 'warning', msg: `Work triangle is ${(tri / 1000).toFixed(1)} m (aim for 3.6–7.9 m)`, roomId: room.id, itemIds: [sink.id, hob.id, fridge.id] });
      if (dist(sink.pos, hob.pos) < 600) add_({ rule: 'R-SINK-HOB', severity: 'warning', msg: 'Sink and hob are closer than 600 mm', roomId: room.id, itemIds: [sink.id, hob.id] });
    }
  }
  // electrical / plumbing points
  const sMin = ctx.accessibility ? 900 : R.switchMin, sMax = ctx.accessibility ? 1100 : R.switchMax;
  for (const p of points) {
    if (p.kind === 'switchboard' && !/bedside/i.test(p.label ?? '') && (p.height < sMin || p.height > sMax)) add_({ rule: 'R-SWITCH', severity: 'warning', msg: `Switchboard at ${p.height} mm is outside reach range ${sMin}–${sMax} mm`, roomId: room.id, itemIds: [p.id], pos: p.pos });
    for (const c of cols) if (pointInPolygonTol(p.pos, c.poly, 0) && !['light', 'fan', 'cove'].includes(p.kind)) add_({ rule: 'R-COLUMN', severity: 'warning', msg: `${p.kind} point is on a structural column (chasing RCC not allowed)`, roomId: room.id, itemIds: [p.id], pos: p.pos });
    // clash: points hidden behind joinery / furniture (EDT-21)
    if (!['light', 'fan', 'cove', 'floor-trap'].includes(p.kind)) {
      for (const it of items) {
        const ci = cat(it);
        if (!ci || ci.low || ci.category === 'rug' || ci.category === 'curtain') continue;
        if (['sink', 'hob', 'chimney', 'geyser', 'ac', 'basin', 'wc', 'fridge', 'washing', 'tv-unit', 'tv-panel-bed', 'kitchen-wall', 'shower'].includes(ci.category)) continue;
        const fp = rectCorners(it.pos, it.w + 40, it.d + 40, it.rot);
        if (pointInPolygonTol(p.pos, fp, 0) && p.height > it.elev && p.height < it.elev + it.h) {
          add_({ rule: 'R-CLASH', severity: 'warning', msg: `${p.kind} point is behind ${ci.name}`, roomId: room.id, itemIds: [p.id, it.id], pos: p.pos });
        }
      }
    }
  }
  // bye-law hints (IMP-44) — advisory
  const habitable = ['living', 'bedroom', 'dining', 'study'].includes(room.type);
  const A = polygonArea(room.polygon) / 1e6;
  if (room.type === 'bedroom' && A < R.minHabitableArea) add_({ rule: 'B-ROOM-SIZE', severity: 'info', msg: `${room.name} is ${A.toFixed(1)} m², below ${R.minHabitableArea} m² habitable minimum (${R.id})`, roomId: room.id });
  if (room.type === 'kitchen' && A < R.minKitchenArea) add_({ rule: 'B-KITCHEN-SIZE', severity: 'info', msg: `Kitchen is ${A.toFixed(1)} m², below ${R.minKitchenArea} m²`, roomId: room.id });
  const H = finishedCeiling(room);
  if (habitable && H < R.minHabitableCeiling) add_({ rule: 'B-CEILING', severity: 'warning', msg: `Finished ceiling ${H} mm is below ${R.minHabitableCeiling} mm for habitable rooms`, roomId: room.id });
  if (room.type === 'toilet' && H < R.minToiletCeiling) add_({ rule: 'B-CEILING', severity: 'warning', msg: `Toilet ceiling ${H} mm is below ${R.minToiletCeiling} mm`, roomId: room.id });
  if (habitable || room.type === 'kitchen') {
    const m = measureRoom(f, room);
    if (m.windowArea / m.floorArea < R.minWindowRatio) add_({ rule: 'B-DAYLIGHT', severity: 'info', msg: `Window area is ${((m.windowArea / m.floorArea) * 100).toFixed(1)}% of floor area (min ${R.minWindowRatio * 100}%)`, roomId: room.id });
  }
  // accessibility (GEN-32)
  if (ctx.accessibility) {
    for (const e of roomEdges(f, room)) for (const o of e.openings) if (o.kind === 'door' && o.width < 900) add_({ rule: 'A-DOOR-WIDTH', severity: 'info', msg: `Door ${o.width} mm wide; 900 mm recommended for wheelchair access`, roomId: room.id });
  }
  return issues;
}

export function checkFloor(f: Floor, ctx: RuleContext): Issue[] {
  const out: Issue[] = [];
  for (const r of f.rooms) if (r.type !== 'shaft') out.push(...checkRoom(f, r, ctx));
  for (const p of f.points) if (!p.roomId) continue;
  return out;
}

export function roomOf(f: Floor, p: Vec2): Room | undefined {
  return f.rooms.find((r) => pointInPolygonTol(p, r.polygon, 1));
}

export type { MepPoint };
