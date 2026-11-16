// GEN-10 … GEN-16, GEN-34, REL-05, NFR-21: constraint-based layout generator.
// Builds 3 options per room from real catalog items, sized to the actual walls, scores
// several seeded candidates per option and keeps the best one.

import type { Brief, Floor, GenOption, Item, MepPoint, PointKind, Room, RulePack, Vec2 } from './types';
import type { Catalog, CatalogItem } from './catalog';
import { CATALOG_VERSION, itemById, materialById } from './catalog';
import { Theme } from './themes';
import { BUDGET_BANDS } from './themes';
import { roomEdges, RoomEdge, finishedCeiling } from './measure';
import { add, bbox, centroid, convexOverlap, dist, dot, mul, polygonArea, pointInPolygonTol, rectCorners, sub, angleOf, norm } from './geom';
import { checkRoom, doorZones, footprint, frontZone, RULE_PACK_VERSION } from './rules';
import { estimateRoom } from './boq';
import { fixturesNeeded } from './lighting';
import { uid, rng, shuffle, nowIso } from './util';
import { MM2_PER_SQFT } from './units';
import { vastuZoneOf } from './vastu';

export const GENERATOR_VERSION = 'layout-solver 1.2';

export interface GenInput {
  floor: Floor;
  room: Room;
  theme: Theme;
  brief: Brief;
  styleTags: string[];
  palette: string[];
  prompt: string;
  catalog: Catalog;
  rules: RulePack;
  seed: number;
  budgetShare?: number;
}

interface Interval { s: number; e: number }

class Placer {
  items: Item[] = [];
  points: MepPoint[] = [];
  notes: string[] = [];
  edges: RoomEdge[];
  doorPolys: Vec2[][];
  colPolys: Vec2[][];
  constructor(public inp: GenInput, public r: () => number, public variant: number) {
    this.edges = roomEdges(inp.floor, inp.room);
    this.doorPolys = doorZones(inp.floor).map((d) => d.poly);
    this.colPolys = inp.floor.columns.map((c) => rectCorners(c.center, c.w, c.d, 0));
    // keep existing fixtures (GEN-11 fixed points)
    this.items = inp.floor.items.filter((i) => i.roomId === inp.room.id && i.existing).map((i) => ({ ...i }));
  }
  cat(id: string) { return itemById(this.inp.catalog, id); }
  has(cat: string) { return this.items.some((i) => this.cat(i.catalogId)?.category === cat); }
  get H() { return finishedCeiling(this.inp.room); }

  /** Free stretches of an edge: minus doors (+100 mm) and, for tall items, windows. */
  free(e: RoomEdge, opts: { avoidWindows?: boolean; minTop?: number } = {}): Interval[] {
    let ivs: Interval[] = [{ s: 0, e: e.len }];
    const cut = (s: number, t: number) => {
      const out: Interval[] = [];
      for (const iv of ivs) {
        if (t <= iv.s || s >= iv.e) { out.push(iv); continue; }
        if (s > iv.s) out.push({ s: iv.s, e: s });
        if (t < iv.e) out.push({ s: t, e: iv.e });
      }
      ivs = out;
    };
    for (const o of e.openings) {
      if (o.kind !== 'window') cut(o.s - 100, o.e + 100);
      else if (opts.avoidWindows || (opts.minTop !== undefined && opts.minTop > o.sill)) cut(o.s - 50, o.e + 50);
    }
    return ivs.filter((iv) => iv.e - iv.s > 200);
  }

  pose(e: RoomEdge, s: number, d: number) {
    return { pos: add(add(e.a, mul(e.dir, s)), mul(e.n, d / 2 + 2)), rot: angleOf(e.n) - 90 };
  }

  fits(it: Item, clearance?: number, ignore: Item[] = []): boolean {
    const fp = footprint(it);
    const c = centroid(fp);
    if (!fp.every((p) => pointInPolygonTol(add(p, mul(sub(c, p), 0.002)), this.inp.room.polygon, 3))) return false;
    const ci = this.cat(it.catalogId);
    for (const o of this.items) {
      if (ignore.includes(o)) continue;
      const co = this.cat(o.catalogId);
      if (co?.category === 'rug' || ci?.category === 'rug' || co?.category === 'curtain' || ci?.category === 'curtain') continue;
      if (it.elev < o.elev + o.h - 1 && o.elev < it.elev + it.h - 1 && convexOverlap(fp, footprint(o), 3)) return false;
    }
    if (it.elev < 2000) for (const dz of this.doorPolys) if (convexOverlap(fp, dz, 3)) return false;
    for (const cp of this.colPolys) if (convexOverlap(fp, cp, 1)) return false;
    if (clearance && !ci?.low) {
      const fz = frontZone(it, clearance);
      const fc = centroid(fz);
      if (!fz.every((p) => pointInPolygonTol(add(p, mul(sub(fc, p), 0.002)), this.inp.room.polygon, 3))) return false;
      for (const o of this.items) if (!this.cat(o.catalogId)?.low && !this.cat(o.catalogId)?.wallMounted && o.elev < 900 && convexOverlap(fz, footprint(o), 3)) return false;
      for (const cp of this.colPolys) if (convexOverlap(fz, cp, 1)) return false;
    }
    // nothing new may sit in the clearance zone of an already placed item
    if (!ci?.low && !ci?.wallMounted && it.elev < 900) {
      for (const o of this.items) {
        const co = this.cat(o.catalogId);
        if (ignore.includes(o) || !co?.clearance || co.low) continue;
        if (convexOverlap(fp, frontZone(o, co.category === 'wardrobe' && o.joinery?.shutter !== 'sliding' ? this.inp.rules.wardrobeFront : co.clearance), 3)) return false;
      }
    }
    return true;
  }

  make(ci: CatalogItem, e: RoomEdge, s: number, w: number, d = ci.d, h = ci.h, elev = ci.elev ?? 0, reason = ''): Item {
    const { pos, rot } = this.pose(e, s, d);
    return {
      id: uid('item'), roomId: this.inp.room.id, catalogId: ci.id, pos, rot, w, d, h, elev, draft: true, reason,
      prov: { engine: GENERATOR_VERSION, version: GENERATOR_VERSION, seed: this.inp.seed, catalogVersion: CATALOG_VERSION, rulePack: RULE_PACK_VERSION, at: nowIso() },
    };
  }

  /** Try to place a catalog item on an edge. align: where in a free interval to put it. */
  onEdge(ci: CatalogItem, e: RoomEdge, opts: { w?: number; d?: number; h?: number; elev?: number; align?: 'center' | 'start' | 'end' | 'scan'; clearance?: number; at?: number; reason?: string; avoidWindows?: boolean } = {}): Item | null {
    const w = opts.w ?? ci.w, d = opts.d ?? ci.d, h = opts.h ?? ci.h, elev = opts.elev ?? ci.elev ?? 0;
    const ivs = this.free(e, { avoidWindows: opts.avoidWindows, minTop: ci.low ? undefined : elev + h });
    const cands: number[] = [];
    for (const iv of ivs) {
      if (iv.e - iv.s < w) continue;
      if (opts.at !== undefined) { if (opts.at - w / 2 >= iv.s - 1 && opts.at + w / 2 <= iv.e + 1) cands.push(opts.at); continue; }
      const mid = (iv.s + iv.e) / 2, st = iv.s + w / 2 + 5, en = iv.e - w / 2 - 5;
      const align = opts.align ?? 'center';
      if (align === 'center') cands.push(mid);
      if (align === 'start') cands.push(st);
      if (align === 'end') cands.push(en);
      for (let s = st; s <= en; s += 100) cands.push(s);
      cands.push(en, st, mid);
    }
    for (const s of cands) {
      const it = this.make(ci, e, s, w, d, h, elev, opts.reason);
      if (this.fits(it, opts.clearance ?? ci.clearance)) return it;
    }
    return null;
  }

  /** Parametric fit: the widest module multiple that fits the best free interval (GEN-12). */
  fitted(ci: CatalogItem, edges: RoomEdge[], opts: { max?: number; h?: number; clearance?: number; reason?: string; avoidWindows?: boolean; align?: 'start' | 'end' | 'center' } = {}): Item | null {
    const mod = ci.module ?? 300;
    const tries: { e: RoomEdge; iv: Interval }[] = [];
    for (const e of edges) for (const iv of this.free(e, { avoidWindows: opts.avoidWindows ?? !ci.low, minTop: (ci.elev ?? 0) + (opts.h ?? ci.h) })) tries.push({ e, iv });
    tries.sort((a, b) => (b.iv.e - b.iv.s) - (a.iv.e - a.iv.s));
    for (const { e, iv } of tries) {
      let w = Math.min(opts.max ?? ci.maxW ?? ci.w, ci.maxW ?? Infinity, Math.floor((iv.e - iv.s - 20) / mod) * mod);
      while (w >= (ci.minW ?? ci.w)) {
        const it = this.onEdge(ci, e, { w, h: opts.h, clearance: opts.clearance, align: opts.align ?? (this.r() < 0.5 ? 'start' : 'end'), reason: opts.reason, avoidWindows: opts.avoidWindows });
        if (it) return it;
        w -= mod;
      }
    }
    return null;
  }

  /** Free-standing placement (dining tables, rugs) on a grid, scored by a preference function. */
  freePlace(ci: CatalogItem, score: (p: Vec2) => number, opts: { w?: number; d?: number; clearance?: number; reason?: string } = {}): Item | null {
    const bb = bbox(this.inp.room.polygon);
    let best: Item | null = null, bs = -Infinity;
    for (let x = bb.minX + 300; x < bb.maxX - 300; x += 150) for (let y = bb.minY + 300; y < bb.maxY - 300; y += 150) {
      for (const rot of [0, 90]) {
        const it: Item = { ...this.make(ci, this.edges[0], 0, opts.w ?? ci.w, opts.d ?? ci.d), pos: { x, y }, rot, reason: opts.reason };
        // keep 600 mm around a free-standing set
        const halo: Item = { ...it, w: it.w + 1200, d: it.d + 1200 };
        if (!this.fits(it)) continue;
        if (!this.fits(halo, undefined)) continue;
        const sc = score(it.pos);
        if (sc > bs) { bs = sc; best = it; }
      }
    }
    return best;
  }

  add(it: Item | null, note?: string) {
    if (it) { this.items.push(it); return it; }
    if (note) this.notes.push(note);
    return null;
  }

  point(kind: PointKind, pos: Vec2, height: number, label?: string) {
    this.points.push({ id: uid('pt'), roomId: this.inp.room.id, kind, pos, height, label, draft: true });
  }
  wallPoint(kind: PointKind, e: RoomEdge, s: number, height: number, label?: string) {
    this.point(kind, add(add(e.a, mul(e.dir, Math.max(50, Math.min(e.len - 50, s)))), mul(e.n, 20)), height, label);
  }
  edgeOf(it: Item): RoomEdge | undefined {
    const back = add(it.pos, mul({ x: -Math.sin((it.rot * Math.PI) / 180) * -1, y: -Math.cos((it.rot * Math.PI) / 180) }, it.d / 2));
    let best: RoomEdge | undefined, bd = Infinity;
    for (const e of this.edges) {
      if (dot(e.n, { x: -Math.sin((it.rot * Math.PI) / 180), y: Math.cos((it.rot * Math.PI) / 180) }) < 0.95) continue;
      const t = dot(sub(back, e.a), e.dir);
      if (t < -10 || t > e.len + 10) continue;
      const dd = Math.abs(dot(sub(back, e.a), e.n));
      if (dd < bd) { bd = dd; best = e; }
    }
    return best;
  }
  sOn(e: RoomEdge, p: Vec2) { return dot(sub(p, e.a), e.dir); }

  doorEdges() { return this.edges.filter((e) => e.openings.some((o) => o.kind !== 'window')); }
  solidEdges() { return this.edges.filter((e) => !e.openings.some((o) => o.kind !== 'window')); }
  windowEdges() { return this.edges.filter((e) => e.openings.some((o) => o.kind === 'window')); }
  exteriorEdges() { return this.edges.filter((e) => e.wall?.exterior); }

  /** Common points: switchboard by each door, ceiling lights by lumen method, fan, cove. */
  basics(opts: { fan?: boolean; ac?: boolean } = {}) {
    const room = this.inp.room;
    const H = room.ceilingHeight;
    const sbH = this.inp.brief.accessibility ? 1000 : 1200;
    for (const e of this.doorEdges()) for (const o of e.openings.filter((o) => o.kind !== 'window')) {
      // latch side first; skip spots hidden behind joinery or furniture
      const cands = [o.e + 250, o.s - 250, o.e + 600, o.s - 600, o.e + 1000, o.s - 1000].filter((s) => s > 80 && s < e.len - 80);
      const free = (s: number) => {
        const p = add(add(e.a, mul(e.dir, s)), mul(e.n, 20));
        return !this.items.some((it) => it.elev < sbH && it.elev + it.h > sbH && pointInPolygonTol(p, rectCorners(it.pos, it.w + 60, it.d + 60, it.rot), 0));
      };
      const s = cands.find(free) ?? cands[0] ?? e.len / 2;
      this.wallPoint('switchboard', e, s, sbH, 'Main switchboard');
    }
    const n = fixturesNeeded(room);
    const bb = bbox(room.polygon);
    const cols = Math.max(1, Math.round(Math.sqrt((n * (bb.maxX - bb.minX)) / Math.max(1, bb.maxY - bb.minY))));
    const rows = Math.max(1, Math.ceil(n / cols));
    let placed = 0;
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
      if (placed >= n) break;
      const p = { x: bb.minX + ((i + 0.5) * (bb.maxX - bb.minX)) / cols, y: bb.minY + ((j + 0.5) * (bb.maxY - bb.minY)) / rows };
      if (!pointInPolygonTol(p, room.polygon, 0)) continue;
      this.point('light', p, H - (room.falseCeiling.enabled ? room.falseCeiling.drop : 0), 'Downlight');
      placed++;
    }
    if (placed === 0) this.point('light', centroid(room.polygon), H, 'Ceiling light');
    if (room.falseCeiling.enabled && room.falseCeiling.cove) this.point('cove', add(centroid(room.polygon), { x: 300, y: 300 }), H - room.falseCeiling.drop, 'Cove strip');
    if (opts.fan) {
      const A = polygonArea(room.polygon) / 1e6;
      const c = centroid(room.polygon);
      if (A > 22) { const w = bb.maxX - bb.minX > bb.maxY - bb.minY; this.point('fan', add(c, w ? { x: -(bb.maxX - bb.minX) / 4, y: 0 } : { x: 0, y: -(bb.maxY - bb.minY) / 4 }), H, 'Fan'); this.point('fan', add(c, w ? { x: (bb.maxX - bb.minX) / 4, y: 0 } : { x: 0, y: (bb.maxY - bb.minY) / 4 }), H, 'Fan'); }
      else this.point('fan', add(c, { x: 1, y: 1 }), H, 'Fan');
    }
    if (opts.ac) this.airCon();
  }

  airCon() {
    const ci = this.cat('ac-split')!;
    const ext = this.exteriorEdges();
    const order = [...ext, ...this.solidEdges(), ...this.edges];
    for (const e of order) {
      const it = this.onEdge(ci, e, { elev: 2150, h: 320, align: 'center', clearance: 0, avoidWindows: true, reason: `Split AC on ${e.wall?.exterior ? 'an exterior' : 'a'} wall for a short refrigerant run and drain` });
      if (it && it.elev + it.h <= this.H + 50) {
        this.items.push(it);
        const s = this.sOn(e, it.pos);
        this.wallPoint('ac', e, s + ci.w / 2 - 100, 2100, 'AC 20 A');
        this.wallPoint('ac-drain', e, s - ci.w / 2 + 100, 2050, 'AC drain');
        return;
      }
    }
    this.notes.push('No wall space for a split AC');
  }
}

// ---------------------------------------------------------------------------

function wants(inp: GenInput, key: string) {
  const p = inp.prompt.toLowerCase();
  return inp.brief.mustHaves.map((m) => m.toLowerCase()).includes(key) || p.includes(key);
}

function storageLevel(inp: GenInput): 'low' | 'medium' | 'high' {
  if (/lots of storage|more storage|maximum storage|max storage/i.test(inp.prompt)) return 'high';
  return inp.brief.storage;
}

function pickBed(inp: GenInput, P: Placer, variant: number): CatalogItem {
  const bb = bbox(inp.room.polygon);
  const minDim = Math.min(bb.maxX - bb.minX, bb.maxY - bb.minY);
  const c = (id: string) => inp.catalog.items.find((i) => i.id === id)!;
  if (variant === 2) return minDim >= 3000 ? c('bed-queen') : c('bed-single');
  if (inp.theme.preferItems.includes('bed-traditional') && minDim >= 3200 && variant === 0) return c('bed-traditional');
  if ((inp.theme.preferItems.includes('bed-king') || variant === 1) && minDim >= 3400) return c('bed-king');
  if (minDim >= 3000) return c('bed-queen');
  void P;
  return c('bed-single');
}

function bedroom(inp: GenInput, P: Placer, v: number) {
  const C = (id: string) => P.cat(id)!;
  const bed = pickBed(inp, P, v);
  const doorEdges = P.doorEdges();
  const doorDir = doorEdges[0]?.n;
  let order = [...P.edges].sort((a, b) => b.len - a.len);
  if (v === 0) order = [...P.solidEdges().filter((e) => !e.openings.length).sort((a, b) => b.len - a.len), ...order];
  if (v === 1 && doorDir) order = [...P.edges.filter((e) => dot(e.n, doorDir) < -0.9), ...order];
  if (v === 2) order = shuffle(order, P.r);
  let bedItem: Item | null = null;
  for (const e of order) {
    bedItem = P.onEdge(bed, e, { align: 'center', clearance: 600, avoidWindows: true, reason: `Bed head against the ${e.len > 3500 ? 'longest' : 'solid'} wall (${(e.len / 1000).toFixed(2)} m), clear of door swing and windows` });
    if (bedItem) break;
  }
  if (!bedItem) for (const e of order) { bedItem = P.onEdge(bed, e, { align: 'scan', clearance: 450, reason: 'Bed placed where it fits; review headboard wall' }); if (bedItem) break; }
  P.add(bedItem, `Could not fit ${bed.name}`);
  const bedEdge = bedItem ? P.edgeOf(bedItem) : undefined;
  if (bedItem && bedEdge) {
    const s = P.sOn(bedEdge, bedItem.pos);
    for (const side of [-1, 1]) P.add(P.onEdge(C('side-table'), bedEdge, { at: s + side * (bedItem.w / 2 + 240), clearance: 0, reason: 'Bedside table' }));
    P.wallPoint('socket6', bedEdge, s - bedItem.w / 2 - 120, 650, 'Bedside socket');
    P.wallPoint('socket6', bedEdge, s + bedItem.w / 2 + 120, 650, 'Bedside socket');
    P.wallPoint('switchboard', bedEdge, s + bedItem.w / 2 + 300, 750, 'Bedside 2-way switch');
    if (inp.theme.id !== 'minimalist' && v !== 2) inp.room.finishes.accentWall = bedEdge.i;
  }
  // wardrobe
  const slidingPref = inp.theme.preferItems.includes('wardrobe-sliding');
  const wid = v === 2 ? 'wardrobe-hinged' : (v === 0) === slidingPref ? 'wardrobe-sliding' : 'wardrobe-hinged';
  const st = storageLevel(inp);
  const wmax = st === 'high' ? 3600 : st === 'medium' ? 2400 : 1800;
  const wh = st === 'high' ? Math.min(P.H - 50, 2700) : 2400;
  const others = P.edges.filter((e) => e !== bedEdge);
  const ward = P.fitted(C(wid), others, { max: wmax, h: Math.min(wh, P.H - 50), clearance: wid === 'wardrobe-sliding' ? 600 : inp.rules.wardrobeFront, reason: `Wardrobe sized to the free wall in ${C(wid).module} mm modules; ${wid === 'wardrobe-sliding' ? 600 : inp.rules.wardrobeFront} mm clear in front` });
  if (ward) ward.joinery = { shutter: wid === 'wardrobe-sliding' ? 'sliding' : 'hinged', shutters: Math.max(2, Math.round(ward.w / (wid === 'wardrobe-sliding' ? 1000 : 450))), internal: st === 'high' ? ['loft', 'drawers', 'hanging rail', 'trouser pull-out'] : ['drawers', 'hanging rail'] };
  P.add(ward, 'No wall long enough for a wardrobe');
  // study
  if (wants(inp, 'study') || (v === 1 && polygonArea(inp.room.polygon) > 13e6)) {
    const pref = [...P.windowEdges(), ...P.edges];
    let st: Item | null = null;
    for (const e of pref) { st = P.onEdge(C('study-table'), e, { align: 'center', reason: 'Study table near daylight' }); if (st) break; }
    if (P.add(st, 'No space for a study table') && st) { const e = P.edgeOf(st); if (e) P.wallPoint('socket6', e, P.sOn(e, st.pos) + 300, 900, 'Study socket'); }
  }
  if (v === 0 || wants(inp, 'dresser')) {
    let dr: Item | null = null;
    for (const e of others) { dr = P.onEdge(C('dresser'), e, { align: 'scan', reason: 'Dresser on a free wall' }); if (dr) break; }
    if (P.add(dr) && dr) { const e = P.edgeOf(dr); if (e) P.wallPoint('socket6', e, P.sOn(e, dr.pos), 1000, 'Dresser socket'); }
  }
  if ((wants(inp, 'tv') || v === 1) && bedItem && bedEdge) {
    const opp = P.edges.filter((e) => dot(e.n, bedEdge.n) < -0.9);
    for (const e of opp) {
      const tv = P.onEdge(C('tv-panel-bed'), e, { at: P.sOn(e, bedItem.pos), clearance: 0, reason: 'TV panel facing the bed' }) ?? P.onEdge(C('tv-panel-bed'), e, { align: 'scan', clearance: 0, reason: 'TV panel opposite the bed' });
      if (P.add(tv) && tv) { P.wallPoint('tv', e, P.sOn(e, tv.pos), 1100, 'TV'); P.wallPoint('data', e, P.sOn(e, tv.pos) + 200, 1100, 'Data'); break; }
    }
  }
  curtains(inp, P);
  P.basics({ fan: true, ac: true });
}

function living(inp: GenInput, P: Placer, v: number) {
  const C = (id: string) => P.cat(id)!;
  const A = polygonArea(inp.room.polygon) / 1e6;
  const sofaId = v === 2 ? 'sofa-3' : v === 1 ? (A > 20 ? 'sofa-l' : 'sofa-3') : inp.theme.preferItems.find((i) => i.startsWith('sofa')) ?? 'sofa-3';
  const sofaC = C(sofaId);
  let order = [...P.edges].sort((a, b) => b.len - a.len);
  if (v === 2) order = shuffle(order, P.r);
  let sofa: Item | null = null;
  for (const e of order) {
    sofa = P.onEdge(sofaC, e, { align: v === 1 ? 'start' : 'center', clearance: 450, avoidWindows: true, reason: `Sofa against a ${(e.len / 1000).toFixed(1)} m wall, facing the TV wall` });
    if (sofa) break;
  }
  if (!sofa && sofaId !== 'sofa-3') for (const e of order) { sofa = P.onEdge(C('sofa-3'), e, { align: 'center', clearance: 450, reason: 'Fallback 3-seater where the sectional did not fit' }); if (sofa) break; }
  P.add(sofa, 'Could not fit a sofa');
  const se = sofa ? P.edgeOf(sofa) : undefined;
  let tv: Item | null = null;
  if (sofa && se) {
    const s = P.sOn(se, sofa.pos);
    P.wallPoint('socket6', se, s - sofa.w / 2 - 150, 300, 'Sofa-side socket');
    P.wallPoint('socket6', se, s + sofa.w / 2 + 150, 300, 'Sofa-side socket');
    if (v !== 2) inp.room.finishes.accentWall = se.i;
    const opp = P.edges.filter((e) => dot(e.n, se.n) < -0.9).sort((a, b) => Math.abs(P.sOn(a, sofa!.pos) - a.len / 2) - Math.abs(P.sOn(b, sofa!.pos) - b.len / 2));
    for (const e of opp) {
      const at = P.sOn(e, sofa.pos);
      tv = P.onEdge(C('tv-unit'), e, { at, clearance: 0, reason: 'TV unit centred on the sofa' }) ?? P.onEdge(C('tv-unit'), e, { align: 'scan', clearance: 0, reason: 'TV unit on the wall opposite the sofa' });
      if (tv) { P.add(tv); P.wallPoint('tv', e, P.sOn(e, tv.pos), 1100, 'TV'); P.wallPoint('data', e, P.sOn(e, tv.pos) + 250, 1100, 'Data'); P.wallPoint('socket6', e, P.sOn(e, tv.pos) - 250, 600, 'Set-top box'); break; }
    }
    // coffee table + rug in the gap between sofa and TV
    const front = { x: -Math.sin((sofa.rot * Math.PI) / 180), y: Math.cos((sofa.rot * Math.PI) / 180) };
    const ct = C('coffee-table');
    const c = add(sofa.pos, mul(front, sofa.d / 2 + 450 + ct.d / 2));
    const cti: Item = { ...P.make(ct, se, 0, ct.w, ct.d), pos: c, rot: sofa.rot, reason: '450 mm from the sofa front' };
    if (P.fits(cti)) P.add(cti);
    if (inp.theme.density !== 'sparse' || v === 1) {
      const rug: Item = { ...P.make(C('rug'), se, 0, 2400, 1700), pos: add(sofa.pos, mul(front, sofa.d / 2 + 700)), rot: sofa.rot, reason: 'Rug anchoring the seating group' };
      if (P.fits(rug)) P.add(rug);
    }
  }
  if (A > 18 || wants(inp, 'dining') || inp.room.name.toLowerCase().includes('dining')) {
    const dc = C(A > 24 && v !== 2 ? 'dining-6' : 'dining-4');
    const kitchenDoor = P.doorEdges()[0];
    const kd = kitchenDoor ? add(kitchenDoor.a, mul(kitchenDoor.dir, kitchenDoor.len / 2)) : centroid(inp.room.polygon);
    const dining = P.freePlace(dc, (p) => (sofa ? dist(p, sofa.pos) : 0) - 0.5 * dist(p, kd), { reason: 'Dining zone separated from seating, nearer the kitchen' });
    if (!P.add(dining) && dc.id === 'dining-6') P.add(P.freePlace(C('dining-4'), (p) => (sofa ? dist(p, sofa.pos) : 0), { reason: 'Smaller dining set to keep walkways' }), 'No room for a dining table with 600 mm around it');
  }
  if (wants(inp, 'pooja') || inp.theme.id === 'traditional') pooja(inp, P);
  if (wants(inp, 'bar')) { let b: Item | null = null; for (const e of P.edges) { b = P.onEdge(C('bar-unit'), e, { align: 'scan', reason: 'Bar unit as requested' }); if (b) break; } P.add(b, 'No wall for a bar unit'); }
  if (wants(inp, 'shoe') || v !== 2) {
    // shoe cabinet beside the main (exterior) door
    const de = P.doorEdges().find((e) => e.wall?.exterior);
    if (de) { const o = de.openings.find((o) => o.kind === 'door')!; P.add(P.onEdge(C('shoe-rack'), de, { at: o.e + 100 + 450, clearance: 600, reason: 'Shoe cabinet by the entrance' }) ?? P.onEdge(C('shoe-rack'), de, { at: o.s - 100 - 450, clearance: 600, reason: 'Shoe cabinet by the entrance' })); }
  }
  if (['scandinavian', 'bohemian', 'japandi', 'coastal'].includes(inp.theme.id)) {
    const pl = P.freePlace(C('plant'), (p) => -dist(p, bboxCorner(inp.room)), { reason: 'Planter in a free corner' });
    P.add(pl);
  }
  curtains(inp, P);
  // DB near the main door (EDT-22)
  const main = P.doorEdges().find((e) => e.wall?.exterior);
  if (main && !inp.floor.points.some((p) => p.kind === 'db' && p.roomId !== inp.room.id)) {
    const o = main.openings.find((o) => o.kind === 'door')!;
    P.wallPoint('db', main, o.s - 400 > 100 ? o.s - 400 : o.e + 600, 1800, 'DB');
  }
  P.basics({ fan: true, ac: true });
}

function bboxCorner(room: Room): Vec2 { const b = bbox(room.polygon); return { x: b.minX, y: b.minY }; }

function pooja(inp: GenInput, P: Placer) {
  const ci = P.cat('pooja-unit')!;
  // Vastu: north-east is preferred for pooja (GEN-31). Otherwise any quiet wall.
  const c = centroid(inp.room.polygon);
  const ranked = [...P.edges].map((e) => {
    const mid = add(e.a, mul(e.dir, e.len / 2));
    const zone = vastuZoneOf(inp.floor, c, mid);
    return { e, score: inp.brief.vastu ? (['NE', 'ENE', 'NNE', 'N', 'E'].indexOf(zone) >= 0 ? 10 - ['NE', 'ENE', 'NNE', 'N', 'E'].indexOf(zone) : 0) : P.r() };
  }).sort((a, b) => b.score - a.score);
  for (const { e } of ranked) {
    const it = P.onEdge(ci, e, { align: 'scan', reason: inp.brief.vastu ? 'Pooja unit in the north-east zone (Vastu, advisory)' : 'Pooja unit on a quiet wall' });
    if (it) { P.add(it); P.wallPoint('socket6', e, P.sOn(e, it.pos), it.h + 150, 'Pooja light'); return; }
  }
  P.notes.push('No wall for a pooja unit');
}

function curtains(inp: GenInput, P: Placer) {
  if (inp.theme.id === 'minimalist' && P.variant === 2) return;
  const ci = P.cat('curtains')!;
  for (const e of P.windowEdges()) for (const o of e.openings.filter((o) => o.kind === 'window' && o.width > 700)) {
    const it = P.make(ci, e, (o.s + o.e) / 2, o.width + 300, 150, P.H - 50, 0, 'Curtains on window track');
    P.items.push(it);
  }
}

function kitchen(inp: GenInput, P: Placer, v: number) {
  const C = (id: string) => P.cat(id)!;
  const base = C('kitchen-base'), wall = C('kitchen-wall');
  const ivsOf = (e: RoomEdge) => P.free(e, {});
  const runs: { e: RoomEdge; s: number; t: number }[] = [];
  const longIv = (e: RoomEdge) => ivsOf(e).sort((a, b) => (b.e - b.s) - (a.e - a.s))[0];
  const n = P.edges.length;
  // candidate layouts
  const layouts: { name: string; runs: { e: RoomEdge; s: number; t: number }[] }[] = [];
  for (let i = 0; i < n; i++) {
    const e1 = P.edges[i], e2 = P.edges[(i + 1) % n];
    const i1 = ivsOf(e1).find((iv) => iv.e > e1.len - 5), i2 = ivsOf(e2).find((iv) => iv.s < 5);
    if (i1 && i2 && i1.e - i1.s >= 1500 && i2.e - i2.s >= 1500 && Math.abs(dot(e1.dir, e2.dir)) < 0.1) layouts.push({ name: 'L-shaped', runs: [{ e: e1, s: i1.s, t: e1.len }, { e: e2, s: 600, t: i2.e }] });
  }
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const a = P.edges[i], b = P.edges[j];
    if (dot(a.n, b.n) > -0.9) continue;
    const gap = Math.abs(dot(sub(b.a, a.a), a.n));
    const ia = longIv(a), ib = longIv(b);
    if (gap >= 2200 && ia && ib && ia.e - ia.s >= 1800 && ib.e - ib.s >= 1800) layouts.push({ name: 'Parallel', runs: [{ e: a, s: ia.s, t: ia.e }, { e: b, s: ib.s, t: ib.e }] });
  }
  const straightE = [...P.edges].sort((a, b) => ((longIv(b)?.e ?? 0) - (longIv(b)?.s ?? 0)) - ((longIv(a)?.e ?? 0) - (longIv(a)?.s ?? 0)))[0];
  if (straightE && longIv(straightE)) layouts.push({ name: 'Straight', runs: [{ e: straightE, s: longIv(straightE).s, t: longIv(straightE).e }] });
  const pref = v === 0 ? 'L-shaped' : v === 1 ? 'Parallel' : 'Straight';
  const ordered = [...layouts.filter((l) => l.name === pref), ...layouts.filter((l) => l.name !== pref)];
  let chosen: typeof layouts[number] | undefined;
  let placedRuns: Item[] = [];
  for (const L of ordered) {
    const tmp: Item[] = [];
    let ok = true;
    for (const r of L.runs) {
      const w = Math.floor((r.t - r.s - 10) / 50) * 50;
      if (w < 900) { ok = false; break; }
      const it = P.make(base, r.e, r.s + w / 2 + 5, w, base.d, 850, 0, `${L.name} counter run, ${w} mm, at 850 mm counter height`);
      it.joinery = { shutter: 'hinged', internal: ['tandem drawers', 'cutlery organiser', 'bottle pull-out'] };
      it.finish = inp.room.finishes.floor ? undefined : undefined;
      if (!P.fits(it, 1000, [])) { ok = false; break; }
      tmp.push(it);
      P.items.push(it);
    }
    if (ok) { chosen = L; placedRuns = tmp; break; }
    P.items = P.items.filter((i) => !tmp.includes(i));
  }
  if (!chosen) { P.notes.push('No counter layout fits; check door positions'); P.basics({}); return; }
  runs.push(...chosen.runs);
  // fridge at the far end of the longest run (reserve 750 mm)
  const longest = placedRuns.reduce((a, b) => (a.w > b.w ? a : b));
  const le = P.edgeOf(longest)!;
  const ls = P.sOn(le, longest.pos);
  const farEnd = chosen.name === 'L-shaped' && longest === placedRuns[0] ? -1 : 1;
  if (longest.w > 2400) {
    longest.w -= 760;
    longest.pos = add(longest.pos, mul(le.dir, (-farEnd * 760) / 2));
    const fr = P.make(C('fridge-space'), le, ls + farEnd * (longest.w + 760) / 2 - farEnd * 375 + (farEnd > 0 ? 0 : 0), 750, 700, 1800, 0, 'Fridge at the end of the run, outside the cooking zone');
    fr.pos = add(add(le.a, mul(le.dir, ls + farEnd * ((longest.w + 760) / 2 - 375))), mul(le.n, 352));
    if (P.fits(fr, 900)) { P.items.push(fr); P.wallPoint('socket6', le, P.sOn(le, fr.pos), 1200, 'Fridge socket'); }
    else { longest.w += 760; longest.pos = add(longest.pos, mul(le.dir, (farEnd * 760) / 2)); }
  }
  // sink under the window if possible, else on the first run
  const sinkC = C('sink'), hobC = C('hob');
  let sink: Item | null = null;
  for (const r of placedRuns) {
    const e = P.edgeOf(r)!;
    const win = e.openings.find((o) => o.kind === 'window');
    const rs = P.sOn(e, r.pos);
    const at = win ? Math.max(rs - r.w / 2 + 450, Math.min(rs + r.w / 2 - 450, (win.s + win.e) / 2)) : rs - r.w / 2 + 600;
    sink = { ...P.make(sinkC, e, at, sinkC.w, sinkC.d, sinkC.h, 650, win ? 'Sink under the window for light and ventilation' : 'Sink at the end of the run'), pos: add(add(e.a, mul(e.dir, at)), mul(e.n, 300)) };
    if (win || r === placedRuns[0]) break;
  }
  if (sink) {
    P.items.push(sink);
    const e = P.edgeOf(sink) ?? P.edges[0];
    const s = P.sOn(e, sink.pos);
    P.wallPoint('inlet-cold', e, s - 100, 450, 'Sink CW');
    P.wallPoint('inlet-hot', e, s + 100, 450, 'Sink HW');
    P.wallPoint('outlet', e, s, 300, 'Sink drain');
    P.wallPoint('socket6', e, s + 450, 450, 'RO / dishwasher');
  }
  // hob on another run (L / parallel) or ≥ 1200 from the sink
  let hob: Item | null = null;
  for (const r of placedRuns.length > 1 ? [placedRuns[1], placedRuns[0]] : placedRuns) {
    const e = P.edgeOf(r)!;
    const rs = P.sOn(e, r.pos);
    const cands = [rs, rs - r.w / 4, rs + r.w / 4];
    for (const at of cands) {
      if (sink && dist(add(add(e.a, mul(e.dir, at)), mul(e.n, 300)), sink.pos) < 1200) continue;
      const win = e.openings.find((o) => o.kind === 'window' && at > o.s - 500 && at < o.e + 500);
      if (win) continue;
      hob = { ...P.make(hobC, e, at, hobC.w, hobC.d, hobC.h, 850, 'Hob away from the window draught and ≥ 1200 mm from the sink'), pos: add(add(e.a, mul(e.dir, at)), mul(e.n, 300)) };
      break;
    }
    if (hob) break;
  }
  if (hob) {
    P.items.push(hob);
    const e = P.edgeOf(hob) ?? P.edges[0];
    const s = P.sOn(e, hob.pos);
    const ch = P.make(C('chimney'), e, s, 900, 480, 450, 1600, 'Chimney centred over the hob');
    P.items.push(ch);
    P.wallPoint('socket6', e, s, 2150, 'Chimney');
  } else P.notes.push('No safe hob position');
  // wall units over the runs, avoiding windows and the chimney
  for (const r of placedRuns) {
    const e = P.edgeOf(r)!;
    const rs = P.sOn(e, r.pos);
    let ivs: Interval[] = [{ s: rs - r.w / 2, e: rs + r.w / 2 }];
    const cut = (a: number, b: number) => { ivs = ivs.flatMap((iv) => (b <= iv.s || a >= iv.e ? [iv] : [...(a > iv.s ? [{ s: iv.s, e: a }] : []), ...(b < iv.e ? [{ s: b, e: iv.e }] : [])])); };
    for (const o of e.openings) if (o.kind === 'window') cut(o.s - 50, o.e + 50);
    if (hob && P.edgeOf(hob) === e) { const hs = P.sOn(e, hob.pos); cut(hs - 460, hs + 460); }
    for (const iv of ivs) {
      const w = Math.floor((iv.e - iv.s) / 50) * 50;
      if (w < 450) continue;
      const wu = P.make(wall, e, (iv.s + iv.e) / 2, w, wall.d, 700, 1450, 'Wall units 600 mm above the counter');
      wu.joinery = { shutter: v === 1 ? 'hinged' : 'hinged', internal: ['shelves'] };
      if (P.fits(wu)) P.items.push(wu);
    }
    // counter sockets every ~1.2 m
    const count = Math.min(3, Math.max(1, Math.floor(r.w / 1200)));
    for (let k = 0; k < count; k++) P.wallPoint(k === 0 ? 'socket16' : 'socket6', e, rs - r.w / 2 + ((k + 0.5) * r.w) / count, 1100, k === 0 ? 'Microwave/OTG 16 A' : 'Counter socket');
  }
  if (v === 0) {
    const tall = P.fitted(C('tall-unit'), P.edges.filter((e) => !runs.some((r) => r.e === e)), { max: 600, reason: 'Tall pantry unit for dry storage' });
    P.add(tall);
  }
  P.basics({});
  P.point('exhaust', centroid(inp.room.polygon), 2200, 'Exhaust');
}

function toilet(inp: GenInput, P: Placer, v: number) {
  const C = (id: string) => P.cat(id)!;
  const doorE = P.doorEdges()[0];
  const door = doorE?.openings.find((o) => o.kind !== 'window');
  const doorPt = doorE && door ? add(doorE.a, mul(doorE.dir, (door.s + door.e) / 2)) : centroid(inp.room.polygon);
  // shower in the corner farthest from the door
  const far = [...P.edges].sort((a, b) => Math.max(dist(b.a, doorPt), dist(b.b, doorPt)) - Math.max(dist(a.a, doorPt), dist(a.b, doorPt)));
  let shower: Item | null = null;
  for (const size of [900, 800]) {
    for (const e of far) {
      const endFar = dist(e.b, doorPt) > dist(e.a, doorPt) ? 'end' : 'start';
      shower = P.onEdge(C('shower'), e, { w: size, d: size, align: endFar, clearance: 0, reason: `Shower ${size} × ${size} mm in the corner farthest from the door (wet zone away from entry)` });
      if (shower) break;
    }
    if (shower) break;
  }
  P.add(shower, 'No 900 × 900 mm space for a shower');
  if (shower) {
    const e = P.edgeOf(shower)!;
    const s = P.sOn(e, shower.pos);
    P.wallPoint('inlet-cold', e, s - 100, 1000, 'Mixer CW');
    P.wallPoint('inlet-hot', e, s + 100, 1000, 'Mixer HW');
    P.wallPoint('inlet-cold', e, s, 2100, 'Overhead shower');
    P.point('floor-trap', shower.pos, 0, 'Shower trap');
    const g = P.make(C('geyser'), e, s, 400, 400, 500, 2050, 'Geyser above the shower, out of the splash zone');
    if (g.elev + g.h <= P.H) { P.items.push(g); P.wallPoint('geyser', e, s + 300, 2200, 'Geyser 20 A'); }
  }
  const existingWc = P.items.find((i) => i.existing && P.cat(i.catalogId)?.category === 'wc');
  if (!existingWc) {
    const order = P.edges.filter((e) => e !== doorE).sort((a, b) => (v === 1 ? a.len - b.len : b.len - a.len));
    let wc: Item | null = null;
    for (const e of order) { wc = P.onEdge(C('wc'), e, { align: 'center', clearance: 600, w: 380, reason: 'WC with 600 mm clear in front, away from the door line' }); if (wc) break; }
    P.add(wc, 'No space for the WC');
  }
  const wcItem = P.items.find((i) => P.cat(i.catalogId)?.category === 'wc');
  if (wcItem) { const e = P.edgeOf(wcItem); if (e) { const s = P.sOn(e, wcItem.pos); P.wallPoint('inlet-cold', e, s + 300, 400, 'Health faucet'); P.wallPoint('outlet', e, s, 230, 'WC outlet'); P.wallPoint('inlet-cold', e, s - 250, 900, 'Concealed cistern'); } }
  const existingBasin = P.items.find((i) => i.existing && P.cat(i.catalogId)?.category === 'basin');
  if (!existingBasin) {
    const near = [...P.edges].sort((a, b) => Math.min(dist(a.a, doorPt), dist(a.b, doorPt)) - Math.min(dist(b.a, doorPt), dist(b.b, doorPt)));
    let b: Item | null = null;
    for (const e of near) { b = P.onEdge(C('basin'), e, { align: 'scan', clearance: 600, reason: 'Vanity basin near the door (dry zone)' }); if (b) break; }
    P.add(b, 'No space for a basin');
  }
  const basin = P.items.find((i) => P.cat(i.catalogId)?.category === 'basin');
  if (basin) {
    const e = P.edgeOf(basin);
    if (e) {
      const s = P.sOn(e, basin.pos);
      P.wallPoint('inlet-cold', e, s - 100, 550, 'Basin CW');
      P.wallPoint('inlet-hot', e, s + 100, 550, 'Basin HW');
      P.wallPoint('outlet', e, s, 450, 'Basin drain');
      const m = P.make(C('mirror'), e, s, 600, 150, 750, 1150, 'Mirror cabinet above the basin');
      if (P.fits(m)) P.items.push(m);
      P.wallPoint('light', e, s, 1950, 'Mirror light');
      P.wallPoint('socket6', e, s + 450, 1200, 'Shaver / dryer socket');
    }
  }
  P.point('floor-trap', add(centroid(inp.room.polygon), { x: 1, y: 1 }), 0, 'Floor trap');
  const vent = P.windowEdges()[0];
  if (vent) { const o = vent.openings.find((o) => o.kind === 'window')!; P.wallPoint('exhaust', vent, (o.s + o.e) / 2, Math.min(2200, o.sill + 300), 'Exhaust in ventilator'); }
  else P.point('exhaust', centroid(inp.room.polygon), 2200, 'Exhaust');
  P.basics({});
}

function smallRoom(inp: GenInput, P: Placer, v: number) {
  const C = (id: string) => P.cat(id)!;
  const t = inp.room.type;
  if (t === 'passage' || t === 'foyer') {
    if (v !== 2 || wants(inp, 'shoe')) { let s: Item | null = null; for (const e of P.solidEdges()) { s = P.onEdge(C('shoe-rack'), e, { align: 'center', clearance: 750, reason: 'Shoe cabinet keeping a 750 mm walkway' }); if (s) break; } P.add(s); }
  } else if (t === 'balcony') {
    P.add(P.freePlace(C('balcony-chairs'), () => P.r(), { reason: 'Seating on the balcony' }));
    P.point('floor-trap', centroid(inp.room.polygon), 0, 'Floor trap');
  } else if (t === 'utility') {
    let w: Item | null = null; for (const e of P.edges) { w = P.onEdge(C('washing'), e, { align: 'start', reason: 'Washing machine space with inlet and drain' }); if (w) break; }
    if (P.add(w) && w) { const e = P.edgeOf(w)!; const s = P.sOn(e, w.pos); P.wallPoint('inlet-cold', e, s, 1000, 'WM inlet'); P.wallPoint('outlet', e, s + 200, 300, 'WM drain'); P.wallPoint('socket16', e, s - 200, 1200, 'WM 16 A'); }
    P.point('floor-trap', centroid(inp.room.polygon), 0, 'Floor trap');
  } else if (t === 'study') {
    let s: Item | null = null; for (const e of [...P.windowEdges(), ...P.edges]) { s = P.onEdge(C('study-table'), e, { align: 'center', reason: 'Desk near daylight' }); if (s) break; } P.add(s);
    P.add(P.fitted(C('bookshelf'), P.solidEdges(), { reason: 'Bookshelf on a solid wall' }));
  } else if (t === 'pooja') pooja(inp, P);
  else if (t === 'dining') { P.add(P.freePlace(C('dining-6'), () => 0, { reason: 'Dining set centred' }) ?? P.freePlace(C('dining-4'), () => 0, { reason: 'Dining set centred' })); }
  P.basics({ fan: t === 'study' || t === 'dining' });
}

// ---------------------------------------------------------------------------

function nearestMaterial(cat: Catalog, kind: string, hex: string, exclude: (id: string) => boolean): string | undefined {
  const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [r, g, b] = rgb(hex);
  let best: string | undefined, bd = Infinity;
  for (const m of cat.materials.filter((m) => m.kind === kind && !exclude(m.id))) {
    const [R, G, B] = rgb(m.color);
    const d = (R - r) ** 2 + (G - g) ** 2 + (B - b) ** 2;
    if (d < bd) { bd = d; best = m.id; }
  }
  return best;
}

function chooseFinishes(inp: GenInput, v: number): Room['finishes'] {
  const t = inp.theme;
  const type = inp.room.type;
  const noGloss = /no gloss|matte|matt/i.test(inp.prompt) || inp.styleTags.includes('matte');
  const glossy = (id: string) => !!materialById(inp.catalog, id)?.glossy;
  const avoid = (id: string) => noGloss && glossy(id);
  const wet = ['toilet', 'balcony', 'utility'].includes(type);
  const tier = inp.brief.budgetBand;
  let floor = v === 1 ? t.floorAlt : t.floor;
  if (v === 2 || tier === 'economy') floor = materialById(inp.catalog, floor)?.tier === 'luxury' || materialById(inp.catalog, floor)?.tier === 'premium' ? 'fl-vit-ivory' : floor;
  if (avoid(floor)) floor = 'fl-vit-grey';
  if (wet) floor = 'fl-antiskid';
  if (type === 'kitchen' && materialById(inp.catalog, floor)?.kind === 'floor' && /wood|oak|walnut/i.test(materialById(inp.catalog, floor)?.name ?? '')) floor = 'fl-concrete';
  let wall = t.wall;
  if (inp.palette.length) wall = nearestMaterial(inp.catalog, 'paint', inp.palette[0], (id) => avoid(id) || id === 'pt-economy') ?? wall;
  if (v === 2 || tier === 'economy') wall = 'pt-economy';
  if (avoid(wall)) wall = 'pt-white';
  if (type === 'toilet') wall = 'wt-dado';
  const accent = v === 2 || wet || type === 'kitchen' ? undefined : (inp.palette[2] ? nearestMaterial(inp.catalog, 'paint', inp.palette[2], avoid) : t.accent);
  const ceiling = ['living', 'bedroom', 'dining'].includes(type) && t.ceiling !== 'none' && v !== 2 ? 'cl-gypsum' : 'cl-paint';
  const skirting = wet ? '' : materialById(inp.catalog, floor)?.name.match(/wood|oak|walnut/i) ? 'sk-wood' : 'sk-tile';
  return { floor, wall, ceiling, skirting, accent };
}

function laminateFor(inp: GenInput, v: number): string {
  if (v === 2 || inp.brief.budgetBand === 'economy') return 'lam-white';
  let id = v === 1 ? inp.theme.laminateAlt : inp.theme.laminate;
  if (/no gloss|matte|matt/i.test(inp.prompt) && materialById(inp.catalog, id)?.glossy) id = 'lam-oak';
  if (/wood|walnut|oak|teak/i.test(inp.prompt) && v === 0) id = /walnut/i.test(inp.prompt) ? 'lam-walnut' : /teak/i.test(inp.prompt) ? 'ven-teak' : 'lam-oak';
  if (inp.palette.length > 1 && v === 0) id = nearestMaterial(inp.catalog, 'laminate', inp.palette[1], () => false) ?? id;
  return id;
}

const VARIANT_LABELS = ['A · Theme', 'B · Alternate', 'C · Value-engineered'];

export function generateOption(inp: GenInput, variant: number): GenOption {
  const room: Room = { ...inp.room, finishes: chooseFinishes(inp, variant) };
  const ceilingStyle = inp.theme.ceiling;
  room.falseCeiling = ['living', 'bedroom', 'dining'].includes(room.type) && ceilingStyle !== 'none' && variant !== 2
    ? { enabled: true, drop: Math.min(300, Math.max(0, room.ceilingHeight - 2750)) || 0, cove: ceilingStyle === 'cove' }
    : { enabled: false, drop: 0, cove: false };
  if (room.falseCeiling.enabled && room.falseCeiling.drop < 100) room.falseCeiling = { enabled: false, drop: 0, cove: false };
  const sub_: GenInput = { ...inp, room };
  const P = new Placer(sub_, rng(inp.seed * 7919 + variant * 104729), variant);
  switch (room.type) {
    case 'bedroom': bedroom(sub_, P, variant); break;
    case 'living': living(sub_, P, variant); break;
    case 'kitchen': kitchen(sub_, P, variant); break;
    case 'toilet': toilet(sub_, P, variant); break;
    case 'shaft': break;
    default: smallRoom(sub_, P, variant);
  }
  const lam = laminateFor(inp, variant);
  for (const it of P.items) if (!it.existing && P.cat(it.catalogId)?.joinery) it.finish = lam;
  const items = P.items.filter((i) => !i.existing);
  const floorView: Floor = { ...inp.floor, items: [...inp.floor.items.filter((i) => i.roomId !== room.id), ...P.items], points: [...inp.floor.points.filter((p) => p.roomId !== room.id), ...P.points], rooms: inp.floor.rooms.map((r) => (r.id === room.id ? room : r)) };
  const issues = checkRoom(floorView, room, { catalog: inp.catalog, rules: inp.rules, accessibility: inp.brief.accessibility }, P.items, P.points);
  const errors = issues.filter((i) => i.severity === 'error').length;
  const warns = issues.filter((i) => i.severity === 'warning').length;
  const cost = estimateRoom(floorView, room, items, P.points, room.finishes, inp.catalog);
  const share = inp.budgetShare ?? (polygonArea(room.polygon) / MM2_PER_SQFT) * BUDGET_BANDS[inp.brief.budgetBand].perSqft;
  const budgetPenalty = share > 0 ? Math.max(0, cost / share - 1) * 40 : 0;
  const styleHits = items.filter((i) => inp.theme.preferItems.includes(i.catalogId) || P.cat(i.catalogId)?.themes?.includes(inp.theme.id)).length;
  const score = Math.round(100 - errors * 15 - warns * 4 - P.notes.length * 6 + styleHits * 3 - budgetPenalty);
  const skuCount = items.filter((i) => P.cat(i.catalogId)?.kind === 'sku').length;
  const customCount = items.length - skuCount;
  return {
    id: uid('opt'), roomId: inp.room.id, label: VARIANT_LABELS[variant] ?? `Option ${variant + 1}`, variant, items, points: P.points, finishes: room.finishes, falseCeiling: room.falseCeiling,
    cost, score, issues: errors + warns,
    summary: [describe(items, P), ...P.notes].filter(Boolean).join('. '),
    skuCount, customCount,
  };
}

function describe(items: Item[], P: Placer) {
  const names = items.filter((i) => !['curtain', 'rug', 'side-table', 'chimney', 'geyser', 'ac'].includes(P.cat(i.catalogId)?.category ?? '')).map((i) => {
    const c = P.cat(i.catalogId);
    return c?.joinery ? `${c.name.toLowerCase()} ${(i.w / 1000).toFixed(2)} m` : c?.name.toLowerCase();
  });
  return names.length ? names.join(', ').replace(/^./, (c) => c.toUpperCase()) : 'No furniture';
}

/** REL-05: several seeded candidates per option, keep the best-scoring one. */
export function generateRoomOptions(inp: GenInput, count = 3, candidates = 4): GenOption[] {
  const out: GenOption[] = [];
  for (let v = 0; v < count; v++) {
    let best: GenOption | null = null;
    for (let c = 0; c < candidates; c++) {
      const o = generateOption({ ...inp, seed: inp.seed + c * 31 }, v);
      if (!best || o.score > best.score) best = o;
    }
    out.push(best!);
  }
  return out;
}

/** GEN-15: re-place one item with a different seed / variant, keeping the rest of the room fixed. */
export function regenerateItem(inp: GenInput, item: Item, seed: number): Item | null {
  const P = new Placer({ ...inp, seed }, rng(seed), seed % 3);
  P.items = inp.floor.items.filter((i) => i.roomId === inp.room.id && i.id !== item.id);
  const ci = P.cat(item.catalogId);
  if (!ci) return null;
  const alts = inp.catalog.items.filter((c) => c.category === ci.category && c.id !== ci.id);
  const pool = shuffle([ci, ...alts], P.r);
  for (const c of pool) {
    const edges = shuffle(P.edges, P.r);
    const it = c.joinery
      ? P.fitted(c, edges, { reason: `Regenerated: ${c.name} on another wall`, h: item.h })
      : edges.map((e) => P.onEdge(c, e, { align: 'scan', reason: `Regenerated: ${c.name}` })).find(Boolean) ?? null;
    if (it && dist(it.pos, item.pos) > 100) return { ...it, finish: item.finish, joinery: item.joinery ?? it.joinery };
  }
  return null;
}

export { norm };
