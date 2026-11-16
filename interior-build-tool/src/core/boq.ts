// BOQ-01 … BOQ-12: Bill of Quantities from the model, item-, room- and trade-wise, with locked specs.

import type { Floor, Item, MepPoint, Project, Room, Trade, Version, ChangeOrder, BoqLineSnapshot } from './types';
import type { Catalog, Spec } from './catalog';
import { POINTS, itemById, materialById, buildCatalog } from './catalog';
import { measureRoom, finishedCeiling } from './measure';
import { designElectrical } from './electrical';
import { MM2_PER_SQFT, MM_PER_FT } from './units';
import { dist, polygonArea, perimeter } from './geom';
import { uid, nowIso } from './util';

export interface BoqLine {
  key: string;
  roomId: string;
  room: string;
  trade: Trade;
  group: string;
  desc: string;
  spec: Spec;
  code?: string;
  unit: 'sqft' | 'rft' | 'nos' | 'sqft-front' | 'set';
  qty: number;
  rate: number;
  amount: number;
  kind: 'sku' | 'custom-joinery' | 'finish' | 'service';
  refId?: string;
  wastage?: number;
}

const r2 = (v: number) => Math.round(v * 100) / 100;

export function itemLine(it: Item, room: Room | undefined, cat: Catalog): BoqLine | null {
  const ci = itemById(cat, it.catalogId);
  if (!ci || it.existing) return null;
  const finish = materialById(cat, it.finish);
  if (ci.unit === 'sqft-front') {
    const qty = r2((it.w * it.h) / MM2_PER_SQFT);
    const shutter = it.joinery?.shutter ? `, ${it.joinery.shutter} shutters` : '';
    return {
      key: `item:${it.id}`, roomId: room?.id ?? '', room: room?.name ?? '—', trade: ci.trade, group: 'Joinery',
      desc: `${ci.name} ${Math.round(it.w)}×${Math.round(it.d)}×${Math.round(it.h)} mm${shutter}${finish ? `, ${finish.name} (${finish.code})` : ''}`,
      spec: ci.spec, code: finish?.code, unit: 'sqft-front', qty, rate: ci.rate, amount: qty * ci.rate, kind: 'custom-joinery', refId: it.id,
    };
  }
  return {
    key: `item:${it.id}`, roomId: room?.id ?? '', room: room?.name ?? '—', trade: ci.trade, group: ci.trade === 'decor' ? 'Decor' : ci.trade === 'furniture' ? 'Loose furniture' : 'Fixtures & appliances',
    desc: ci.name, spec: ci.spec, code: ci.sku, unit: 'nos', qty: 1, rate: ci.rate, amount: ci.rate, kind: 'sku', refId: it.id,
  };
}

export function pointLines(points: MepPoint[], room: Room | undefined): BoqLine[] {
  const by = new Map<string, number>();
  for (const p of points) by.set(p.kind, (by.get(p.kind) ?? 0) + 1);
  return [...by].map(([kind, n]) => {
    const P = POINTS[kind as MepPoint['kind']];
    return { key: `pt:${room?.id ?? 'floor'}:${kind}`, roomId: room?.id ?? '', room: room?.name ?? 'Common', trade: P.trade, group: P.trade === 'plumbing' ? 'Plumbing points' : 'Electrical points', desc: P.name, spec: P.spec, unit: 'nos', qty: n, rate: P.rate, amount: n * P.rate, kind: 'service' } as BoqLine;
  });
}

/** Finish quantities from room geometry (BOQ-02), wastage included (BOQ-03). */
export function finishLines(f: Floor, room: Room, cat: Catalog, finishes = room.finishes): BoqLine[] {
  const out: BoqLine[] = [];
  const m = measureRoom(f, room);
  const mat = (id: string | undefined) => materialById(cat, id);
  const push = (key: string, trade: Trade, group: string, id: string | undefined, qtyRaw: number, unit: BoqLine['unit'], label?: string) => {
    const M = mat(id);
    if (!M || qtyRaw <= 0) return;
    const qty = r2(qtyRaw * (1 + M.wastage));
    out.push({ key: `${key}:${room.id}`, roomId: room.id, room: room.name, trade, group, desc: label ?? M.name, spec: M.spec, code: M.code, unit, qty, rate: M.rate, amount: qty * M.rate, kind: 'finish', wastage: M.wastage });
  };
  const floorSqft = m.floorArea / MM2_PER_SQFT;
  const fm = mat(finishes.floor);
  push('floor', 'civil', 'Flooring', finishes.floor, floorSqft, 'sqft', fm ? `${fm.name} – flooring incl. laying${fm.tile ? ` (≈${Math.ceil((m.floorArea * (1 + fm.wastage)) / (fm.tile.w * fm.tile.h))} tiles)` : ''}` : undefined);
  // walls: per edge so wall-wise overrides and accent walls are honoured
  const wallBy = new Map<string, number>();
  let dado = 0;
  const H = m.ceilingHeight;
  for (const e of m.edges) {
    let id = room.wallFinishOverrides[e.i] ?? (finishes.accentWall === e.i && finishes.accent ? finishes.accent : finishes.wall);
    let net = e.net;
    if (mat(id)?.kind === 'tile') {
      // dado to 2100, paint above
      const share = Math.min(1, 2100 / H);
      dado += net * share;
      net = net * (1 - share);
      id = 'pt-white';
    }
    wallBy.set(id, (wallBy.get(id) ?? 0) + net);
  }
  for (const [id, a] of wallBy) push(`wall-${id}`, 'painting', 'Wall finishes', id, a / MM2_PER_SQFT, 'sqft', `${mat(id)?.name} – walls`);
  if (dado > 0) push('dado', 'civil', 'Wall tiling', finishes.wall, dado / MM2_PER_SQFT, 'sqft', `${mat(finishes.wall)?.name} – dado`);
  if (room.falseCeiling.enabled) {
    push('fc', 'civil', 'False ceiling', 'cl-gypsum', floorSqft, 'sqft', `Gypsum false ceiling, ${room.falseCeiling.drop} mm drop`);
    if (room.falseCeiling.cove) {
      const qty = r2((m.perimeter - 600) / MM_PER_FT);
      out.push({ key: `cove:${room.id}`, roomId: room.id, room: room.name, trade: 'civil', group: 'False ceiling', desc: 'Cove profile with LED strip channel', spec: { brand: 'Firm approved make', series: 'Gypsum cove', grade: '150 mm cove, aluminium LED channel' }, unit: 'rft', qty, rate: 180, amount: qty * 180, kind: 'service' });
    }
    push('ceil-paint', 'painting', 'Ceiling finishes', 'cl-paint', floorSqft, 'sqft', 'Ceiling paint on false ceiling');
  } else push('ceil', 'painting', 'Ceiling finishes', finishes.ceiling === 'cl-gypsum' ? 'cl-paint' : finishes.ceiling, floorSqft, 'sqft');
  if (finishes.skirting) push('skirting', 'civil', 'Skirting', finishes.skirting, m.skirting / MM_PER_FT, 'rft');
  // waterproofing (EXP-36)
  if (['toilet', 'balcony', 'utility'].includes(room.type)) {
    const qty = r2((m.floorArea + m.perimeter * 300) / MM2_PER_SQFT);
    out.push({ key: `wp:${room.id}`, roomId: room.id, room: room.name, trade: 'civil', group: 'Waterproofing', desc: 'Waterproofing, floor + 300 mm upturn (shower walls to 1800 mm)', spec: { brand: 'Firm approved make', series: 'Polymer-modified cementitious', grade: 'IS 2645 admixture, 2 coats, 48-h ponding test' }, unit: 'sqft', qty, rate: 65, amount: qty * 65, kind: 'service' });
  }
  return out;
}

export function civilLines(f: Floor, cat: Catalog, ceiling = 3000): BoqLine[] {
  const out: BoqLine[] = [];
  for (const w of f.walls) {
    const L = dist(w.a, w.b);
    const area = r2((L * ceiling) / MM2_PER_SQFT);
    if (w.status === 'new') out.push({ key: `wall-new:${w.id}`, roomId: '', room: 'Civil', trade: 'civil', group: 'New construction', desc: `New ${w.thickness} mm partition wall, ${(L / 1000).toFixed(2)} m long, incl. plaster both sides`, spec: { brand: 'Firm approved make', series: 'AAC block masonry', grade: 'IS 2185 Pt 3 AAC blocks, 1:6 CM plaster', thickness: `${w.thickness} mm` }, unit: 'sqft', qty: area, rate: 135, amount: area * 135, kind: 'service', refId: w.id });
    if (w.status === 'demolish') out.push({ key: `wall-demo:${w.id}`, roomId: '', room: 'Civil', trade: 'civil', group: 'Demolition', desc: `Demolish ${w.thickness} mm wall, ${(L / 1000).toFixed(2)} m, incl. debris removal`, spec: { brand: '—', series: 'Demolition', grade: 'Non-structural only; structural walls need engineer sign-off' }, unit: 'sqft', qty: area, rate: 38, amount: area * 38, kind: 'service', refId: w.id });
  }
  if (f.level <= 0) {
    const a = r2(f.rooms.reduce((s, r) => s + polygonArea(r.polygon), 0) / MM2_PER_SQFT);
    if (a > 0) out.push({ key: `att:${f.id}`, roomId: '', room: 'Civil', trade: 'civil', group: 'Anti-termite', desc: 'Pre-flooring anti-termite treatment', spec: { brand: 'Firm approved make', series: 'Chemical barrier', grade: 'IS 6313 Pt 2, Imidacloprid 30.5% SC' }, unit: 'sqft', qty: a, rate: 12, amount: a * 12, kind: 'service' });
  }
  void cat;
  return out;
}

export function dbLines(f: Floor): BoqLine[] {
  if (!f.points.length) return [];
  const e = designElectrical(f);
  const S = (series: string, grade: string): Spec => ({ brand: 'Firm approved make', series, grade });
  const L: BoqLine[] = [];
  const add = (key: string, desc: string, spec: Spec, qty: number, rate: number) => L.push({ key: `db:${f.id}:${key}`, roomId: '', room: 'Electrical DB', trade: 'electrical', group: 'Distribution board', desc, spec, unit: 'nos', qty, rate, amount: qty * rate, kind: 'service' });
  if (!e.db) add('db', POINTS.db.name, POINTS.db.spec, 1, POINTS.db.rate);
  add('main', e.mainSwitch, S('Isolator', 'IS/IEC 60947-3'), 1, 1800);
  add('mcb', 'MCB SP C-curve (6–20 A per circuit)', S('MCB', 'IS/IEC 60898-1, 10 kA'), e.circuits.length, 420);
  add('rccb', 'RCCB DP (30 mA / 100 mA)', S('RCCB', 'IS 12640-1'), e.rccbs.filter((r) => r.covers.length).length, 3900);
  add('earth', 'Earthing pit with interconnection', POINTS.earth.spec, e.earthing.length, POINTS.earth.rate);
  return L;
}

export function roomConfirmed(r: Room) { return !r.det || !!r.det.confirmed; }

export interface BoqResult {
  lines: BoqLine[];
  subtotal: number;
  margin: number;
  gst: number;
  total: number;
  excludedRooms: string[];
  byTrade: Record<string, number>;
  byRoom: Record<string, number>;
  carpetSqft: number;
}

export function projectCatalog(p: Project) { return buildCatalog(p.catalogOverrides, p.customCatalog); }

export function computeBoq(p: Project, floors = p.floors): BoqResult {
  const cat = projectCatalog(p);
  const lines: BoqLine[] = [];
  const excludedRooms: string[] = [];
  for (const f of floors) {
    for (const r of f.rooms) {
      if (r.type === 'shaft') continue;
      // IMP-41: unconfirmed AI-detected rooms do not feed measurement-derived quantities.
      if (roomConfirmed(r)) lines.push(...finishLines(f, r, cat));
      else excludedRooms.push(r.name);
      lines.push(...pointLines(f.points.filter((pt) => pt.roomId === r.id), r));
    }
    lines.push(...pointLines(f.points.filter((pt) => !pt.roomId || !f.rooms.some((r) => r.id === pt.roomId)), undefined));
    for (const it of f.items) {
      const l = itemLine(it, f.rooms.find((r) => r.id === it.roomId), cat);
      if (l) lines.push(l);
    }
    lines.push(...civilLines(f, cat, f.rooms[0]?.ceilingHeight ?? 3000));
    lines.push(...dbLines(f));
  }
  const subtotal = lines.reduce((s, l) => s + l.amount, 0);
  const margin = (subtotal * p.settings.marginPct) / 100;
  const gst = ((subtotal + margin) * p.settings.gstPct) / 100;
  const byTrade: Record<string, number> = {};
  const byRoom: Record<string, number> = {};
  for (const l of lines) { byTrade[l.trade] = (byTrade[l.trade] ?? 0) + l.amount; byRoom[l.room] = (byRoom[l.room] ?? 0) + l.amount; }
  const carpetSqft = floors.reduce((s, f) => s + f.rooms.filter((r) => r.type !== 'shaft' && r.type !== 'balcony').reduce((a, r) => a + polygonArea(r.polygon), 0), 0) / MM2_PER_SQFT;
  return { lines, subtotal, margin, gst, total: subtotal + margin + gst, excludedRooms, byTrade, byRoom, carpetSqft };
}

/** Fast estimate used by the generator for one room option (GEN-14). */
export function estimateRoom(f: Floor, room: Room, items: Item[], points: MepPoint[], finishes: Room['finishes'], cat: Catalog): number {
  let s = 0;
  for (const l of finishLines(f, { ...room, finishes }, cat, finishes)) s += l.amount;
  for (const it of items) { const l = itemLine(it, room, cat); if (l) s += l.amount; }
  for (const l of pointLines(points, room)) s += l.amount;
  return s;
}

export function snapshotLines(b: BoqResult): BoqLineSnapshot[] {
  return b.lines.map((l) => ({ key: l.key, desc: l.desc, qty: l.qty, unit: l.unit, rate: l.rate, amount: l.amount, trade: l.trade, room: l.room }));
}

/** BOQ-11: lines affected by changes since the approved version, drafted as a change order. */
export function diffBoq(base: BoqLineSnapshot[], current: BoqLineSnapshot[]): ChangeOrder['lines'] {
  const out: ChangeOrder['lines'] = [];
  const B = new Map(base.map((l) => [l.key, l]));
  const C = new Map(current.map((l) => [l.key, l]));
  for (const [k, c] of C) {
    const b = B.get(k);
    if (!b) out.push({ key: k, desc: `${c.room}: ${c.desc}`, before: 0, after: c.amount, delta: c.amount, change: 'added' });
    else if (Math.abs(b.amount - c.amount) > 1) out.push({ key: k, desc: `${c.room}: ${c.desc} (${b.qty} → ${c.qty} ${c.unit})`, before: b.amount, after: c.amount, delta: c.amount - b.amount, change: 'changed' });
  }
  for (const [k, b] of B) if (!C.has(k)) out.push({ key: k, desc: `${b.room}: ${b.desc}`, before: b.amount, after: 0, delta: -b.amount, change: 'removed' });
  return out;
}

export function draftChangeOrder(p: Project, approved: Version): ChangeOrder | null {
  if (!approved.boqLines) return null;
  const cur = snapshotLines(computeBoq(p));
  const lines = diffBoq(approved.boqLines, cur);
  if (!lines.length) return null;
  const delta = lines.reduce((s, l) => s + l.delta, 0);
  const carpentry = lines.filter((l) => l.key.startsWith('item:')).length;
  return {
    id: uid('co'), no: p.changeOrders.length + 1, title: `Changes since "${approved.name}"`, baseVersionId: approved.id, createdAt: nowIso(),
    lines, costDelta: delta, timeImpactDays: Math.max(1, Math.ceil(carpentry * 1.5 + lines.length * 0.25)), status: 'draft',
  };
}

export function quoteAmount(p: Project, b: BoqResult): { label: string; amount: number; note: string } {
  const q = p.quote;
  const tax = (v: number) => v * (1 + p.settings.gstPct / 100);
  switch (q.model) {
    case 'turnkey-sqft': return { label: `Turnkey @ ₹${q.turnkeyRate}/sq ft carpet`, amount: tax(q.turnkeyRate * b.carpetSqft), note: `${b.carpetSqft.toFixed(0)} sq ft carpet; itemised BOQ for reference` };
    case 'design-fee-pct': return { label: `Fit-out + design fee ${q.feePct}%`, amount: tax((b.subtotal + b.margin) * (1 + q.feePct / 100)), note: 'Fee charged on fit-out value' };
    case 'lump-sum': return { label: 'Lump sum', amount: tax(q.lumpSum), note: 'Fixed price for the scope in the BOQ' };
    case 'design-only': return { label: `Design only @ ₹${q.designOnlyRate}/sq ft`, amount: tax(q.designOnlyRate * b.carpetSqft), note: 'Execution by client-appointed contractors' };
    default: return { label: 'Itemised BOQ', amount: b.total, note: 'Item rates incl. margin; GST extra as shown' };
  }
}

export { perimeter, finishedCeiling };
