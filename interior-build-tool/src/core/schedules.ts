// EXP-30: schedule engine. Every schedule is derived from model tags, so it always matches drawings and BOQ.

import type { Floor, MepPoint, Opening, Project } from './types';
import type { Catalog } from './catalog';
import { POINTS, itemById, materialById } from './catalog';
import { measureRoom, roomEdges, openingEnds } from './measure';
import { designElectrical } from './electrical';
import { polygonArea, dist, distToSegment } from './geom';
import { MM2_PER_SQFT } from './units';
import { LUMENS_PER_WATT } from './lighting';
import { themeById } from './themes';

export interface Schedule { id: string; title: string; trade: string; head: string[]; rows: (string | number)[][]; note?: string }

const fx = (v: number, d = 0) => Number(v.toFixed(d));

export function openingTags(f: Floor): Map<string, string> {
  const tags = new Map<string, string>();
  const sorted = [...f.openings].sort((a, b) => a.kind.localeCompare(b.kind) || a.width - b.width);
  const sizeTag = new Map<string, string>();
  let d = 0, w = 0, o = 0;
  for (const op of sorted) {
    const k = `${op.kind}:${Math.round(op.width)}:${Math.round(op.height)}:${Math.round(op.sill)}`;
    if (!sizeTag.has(k)) sizeTag.set(k, op.kind === 'door' ? `D${++d}` : op.kind === 'window' ? (op.width <= 700 ? `V${++w}` : `W${++w}`) : `O${++o}`);
    tags.set(op.id, sizeTag.get(k)!);
  }
  return tags;
}

function roomsBeside(f: Floor, op: Opening): string {
  const w = f.walls.find((x) => x.id === op.wallId);
  if (!w) return '—';
  const [p0, p1] = openingEnds(op, w);
  const mid = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
  const names = f.rooms.filter((r) => r.polygon.some((_, i) => distToSegment(mid, r.polygon[i], r.polygon[(i + 1) % r.polygon.length]) < w.thickness / 2 + 30)).map((r) => r.name);
  return names.length ? names.join(' ↔ ') + (w.exterior ? ' (external)' : '') : w.exterior ? 'External' : '—';
}

export function doorWindowSchedule(f: Floor): Schedule[] {
  const tags = openingTags(f);
  const group = (kind: Opening['kind'][]) => {
    const m = new Map<string, { tag: string; ops: Opening[] }>();
    for (const o of f.openings.filter((o) => kind.includes(o.kind))) { const t = tags.get(o.id)!; m.set(t, { tag: t, ops: [...(m.get(t)?.ops ?? []), o] }); }
    return [...m.values()].sort((a, b) => a.tag.localeCompare(b.tag, undefined, { numeric: true }));
  };
  return [
    { id: 'door-schedule', title: 'Door schedule', trade: 'carpentry', head: ['Tag', 'Clear W × H (mm)', 'Type', 'Swing', 'Qty', 'Location'],
      rows: group(['door', 'opening']).map((g) => [g.tag, `${Math.round(g.ops[0].width)} × ${Math.round(g.ops[0].height)}`, g.ops[0].kind === 'opening' ? 'Opening (no shutter)' : roomsBeside(f, g.ops[0]).includes('external') ? 'Main door, 40 mm flush, veneer' : '35 mm flush door, laminate', g.ops[0].swing ? (g.ops[0].swing.hinge === 'a' ? 'LH' : 'RH') : '—', g.ops.length, g.ops.map((o) => roomsBeside(f, o)).join('; ')]) },
    { id: 'window-schedule', title: 'Window schedule', trade: 'civil', head: ['Tag', 'W × H (mm)', 'Sill (mm)', 'Type', 'Qty', 'Location'],
      rows: group(['window']).map((g) => [g.tag, `${Math.round(g.ops[0].width)} × ${Math.round(g.ops[0].height)}`, Math.round(g.ops[0].sill), g.ops[0].width <= 700 ? 'Ventilator, louvred' : 'UPVC sliding, 5 mm clear glass', g.ops.length, g.ops.map((o) => roomsBeside(f, o)).join('; ')]) },
  ];
}

export function finishSchedule(f: Floor, cat: Catalog): Schedule {
  const rows: (string | number)[][] = [];
  for (const r of f.rooms.filter((r) => r.type !== 'shaft')) {
    const m = measureRoom(f, r);
    const fl = materialById(cat, r.finishes.floor), sk = materialById(cat, r.finishes.skirting), ce = materialById(cat, r.falseCeiling.enabled ? 'cl-gypsum' : r.finishes.ceiling);
    rows.push([r.name, 'Floor', fl?.name ?? '—', fl?.code ?? '—', fx(m.floorArea / MM2_PER_SQFT, 1) + ' sq ft']);
    if (sk) rows.push([r.name, 'Skirting', sk.name, sk.code, fx(m.skirting / 304.8, 1) + ' rft']);
    for (const e of m.edges) {
      const id = r.wallFinishOverrides[e.i] ?? (r.finishes.accentWall === e.i && r.finishes.accent ? r.finishes.accent : r.finishes.wall);
      const mat = materialById(cat, id);
      rows.push([r.name, `Wall ${e.i + 1} (${(e.len / 1000).toFixed(2)} m)`, mat?.name ?? '—', mat?.code ?? '—', fx(e.net / MM2_PER_SQFT, 1) + ' sq ft']);
    }
    rows.push([r.name, r.falseCeiling.enabled ? `False ceiling @ ${m.ceilingHeight} mm` : `Ceiling @ ${m.ceilingHeight} mm`, ce?.name ?? '—', ce?.code ?? '—', fx(m.ceilingArea / MM2_PER_SQFT, 1) + ' sq ft']);
  }
  return { id: 'finish-schedule', title: 'Finish schedule', trade: 'painting', head: ['Room', 'Surface', 'Finish', 'Product code', 'Quantity'], rows };
}

function itemsSchedule(p: Project, f: Floor, cat: Catalog, id: string, title: string, trade: string, filter: (c: string, t: string) => boolean): Schedule {
  const rows = f.items.filter((i) => { const c = itemById(cat, i.catalogId); return c && filter(c.category, c.trade); }).map((i, n) => {
    const c = itemById(cat, i.catalogId)!;
    const fin = materialById(cat, i.finish);
    return [`${id.slice(0, 2).toUpperCase()}${n + 1}`, c.name, `${Math.round(i.w)} × ${Math.round(i.d)} × ${Math.round(i.h)}`, i.elev ? `${i.elev}` : 'FFL', fin ? `${fin.name} (${fin.code})` : c.spec.grade, c.sku ?? (c.kind === 'custom-joinery' ? 'Custom joinery' : '—'), f.rooms.find((r) => r.id === i.roomId)?.name ?? '—', i.existing ? 'Existing' : 'New'];
  });
  void p;
  return { id, title, trade, head: ['Tag', 'Item', 'W × D × H (mm)', 'Mounting', 'Finish / spec', 'SKU', 'Room', 'Status'], rows };
}

export function sanitarySchedule(p: Project, f: Floor, cat: Catalog) { return itemsSchedule(p, f, cat, 'sanitary-schedule', 'Sanitary & CP fitting schedule', 'plumbing', (c) => ['wc', 'basin', 'shower', 'sink'].includes(c)); }
export function applianceSchedule(p: Project, f: Floor, cat: Catalog) { return itemsSchedule(p, f, cat, 'appliance-schedule', 'Appliance schedule', 'electrical', (c) => ['hob', 'chimney', 'geyser', 'fridge', 'washing', 'ac'].includes(c)); }
export function furnitureSchedule(p: Project, f: Floor, cat: Catalog) { return itemsSchedule(p, f, cat, 'furniture-schedule', 'Furniture & joinery schedule', 'carpentry', (_c, t) => ['furniture', 'carpentry', 'decor'].includes(t)); }

export function lightingSchedule(p: Project, f: Floor): Schedule {
  const e = designElectrical(f);
  const cct = themeById(p.theme).cct;
  const rows = f.points.filter((x) => ['light', 'cove', 'fan', 'exhaust'].includes(x.kind)).map((x, n) => {
    const w = x.watts ?? POINTS[x.kind].watts;
    return [`LF${n + 1}`, x.label ?? POINTS[x.kind].name, POINTS[x.kind].name, w, x.kind === 'light' ? w * LUMENS_PER_WATT : x.kind === 'cove' ? 600 : '—', x.kind === 'light' || x.kind === 'cove' ? `${cct} K, CRI ≥ 90` : '—', f.rooms.find((r) => r.id === x.roomId)?.name ?? '—', e.assignments[x.id] ?? '—'];
  });
  return { id: 'lighting-schedule', title: 'Lighting fixture schedule', trade: 'electrical', head: ['Tag', 'Fixture', 'Type', 'W', 'Lumens', 'CCT / CRI', 'Room', 'Circuit'], rows };
}

export function pointSchedule(f: Floor, kinds: MepPoint['kind'][], id: string, title: string, trade: string): Schedule {
  const e = designElectrical(f);
  const rows = f.points.filter((x) => kinds.includes(x.kind)).map((x, n) => [`${POINTS[x.kind].symbol}${n + 1}`, x.label ?? POINTS[x.kind].name, POINTS[x.kind].name, `${Math.round(x.height)} mm from FFL`, f.rooms.find((r) => r.id === x.roomId)?.name ?? '—', trade === 'electrical' ? e.assignments[x.id] ?? '—' : pipeSize(x)]);
  return { id, title, trade, head: ['Tag', 'Use', 'Type', 'Height', 'Room', trade === 'electrical' ? 'Circuit' : 'Pipe'], rows };
}

export function electricalSchedules(f: Floor): Schedule[] {
  const e = designElectrical(f);
  return [
    pointSchedule(f, ['switchboard', 'socket6', 'socket16', 'ac', 'tv', 'data', 'geyser', 'db', 'light', 'cove', 'fan', 'exhaust'], 'point-schedule', 'Electrical point schedule', 'electrical'),
    { id: 'load-schedule', title: 'Load schedule', trade: 'electrical', head: ['Circuit', 'Description', 'Rooms', 'Points', 'Connected load (W)', 'MCB', 'Cable', 'RCCB'],
      rows: [...e.circuits.map((c) => [c.id, c.label, c.rooms.join(', '), c.points.length, Math.round(c.load), `${c.mcb} A SP C`, c.cable, c.rccb]), ['', 'Total connected / demand (0.7 diversity)', '', '', `${Math.round(e.connectedLoad)} / ${e.demandLoad}`, '', '', '']] },
    { id: 'db-schedule', title: 'DB schedule (MCB / RCCB / earthing)', trade: 'electrical', head: ['Device', 'Rating', 'Serves'],
      rows: [['Main isolator', e.mainSwitch, 'Incoming supply'], ...e.rccbs.filter((r) => r.covers.length).map((r) => [r.id, r.rating, r.covers.join(', ')]), ...e.circuits.map((c) => [`MCB ${c.id}`, `${c.mcb} A SP C-curve, 10 kA`, c.label]), ...e.earthing.map((x) => [x.id, x.type, x.note])],
      note: `DB location: ${e.db ? `${f.rooms.find((r) => r.id === e.db!.roomId)?.name ?? 'as marked'} at ${e.db.height} mm` : 'not placed – add a DB point'}. All 3-pin points earthed; earth continuity conductor 2.5 mm² green.` },
  ];
}

function pipeSize(x: MepPoint): string {
  const l = (x.label ?? '').toLowerCase();
  if (x.kind === 'outlet') return /wc/.test(l) ? '110 mm uPVC SWR' : '40 mm uPVC';
  if (x.kind === 'floor-trap') return '75 mm uPVC';
  if (x.kind === 'inlet-hot') return '15 mm CPVC (insulated)';
  if (x.kind === 'inlet-cold') return /shower|cistern|mixer/.test(l) ? '20 mm CPVC' : '15 mm CPVC';
  if (x.kind === 'ac-drain') return '20 mm uPVC';
  return '—';
}

/** Pipe run estimate: Manhattan distance to the nearest external wall (riser) plus the vertical drop. */
export function plumbingSchedules(p: Project, f: Floor, cat: Catalog): Schedule[] {
  const ext = f.walls.filter((w) => w.exterior);
  const plumbing = f.points.filter((x) => ['inlet-cold', 'inlet-hot', 'outlet', 'floor-trap', 'ac-drain'].includes(x.kind));
  const sizes = new Map<string, number>();
  const rows = plumbing.map((x, n) => {
    let best = Infinity;
    for (const w of ext) { const d = distToSegment(x.pos, w.a, w.b); if (d < best) best = d; }
    const run = (isFinite(best) ? best * 1.4 : 3000) + x.height + 300;
    const s = pipeSize(x);
    sizes.set(s, (sizes.get(s) ?? 0) + run);
    return [`${POINTS[x.kind].symbol}${n + 1}`, x.label ?? POINTS[x.kind].name, `${Math.round(x.height)} mm from FFL`, s, (run / 1000).toFixed(1) + ' m', f.rooms.find((r) => r.id === x.roomId)?.name ?? '—'];
  });
  return [
    { id: 'plumbing-points', title: 'Plumbing point schedule (inlet / outlet heights)', trade: 'plumbing', head: ['Tag', 'Use', 'Height', 'Pipe', 'Est. run', 'Room'], rows },
    { id: 'pipe-lengths', title: 'Pipe sizes and lengths', trade: 'plumbing', head: ['Pipe', 'Total length (m, +10%)'], rows: [...sizes].map(([s, l]) => [s, ((l * 1.1) / 1000).toFixed(1)]) },
    sanitarySchedule(p, f, cat),
  ];
}

export function hvacSchedule(f: Floor, cat: Catalog): Schedule {
  const rows = f.items.filter((i) => itemById(cat, i.catalogId)?.category === 'ac').map((i, n) => {
    const r = f.rooms.find((r) => r.id === i.roomId);
    const sqft = r ? polygonArea(r.polygon) / MM2_PER_SQFT : 120;
    const tr = Math.min(2.5, Math.max(1, Math.ceil(sqft / 110 * 2) / 2));
    const drain = f.points.find((p) => p.kind === 'ac-drain' && p.roomId === i.roomId);
    const extWall = f.walls.filter((w) => w.exterior).reduce((b, w) => Math.min(b, distToSegment(i.pos, w.a, w.b)), Infinity);
    return [`AC${n + 1}`, r?.name ?? '—', `${tr.toFixed(1)} TR inverter split`, `${i.elev} mm to bottom`, drain ? `Drain at ${drain.height} mm` : 'Drain to be marked', `${(Math.max(3000, extWall + 1500) / 1000).toFixed(1)} m Cu piping (est.)`, '20 A point, dedicated circuit'];
  });
  return { id: 'hvac-schedule', title: 'HVAC equipment schedule', trade: 'hvac', head: ['Tag', 'Room', 'Equipment', 'Mounting', 'Drain', 'Piping', 'Electrical tie-in'], rows };
}

export function areaStatementSchedule(f: Floor, a: import('./measure').AreaStatement): Schedule {
  return {
    id: 'area-statement', title: 'Area statement', trade: 'all', head: ['Room / item', 'Type', 'm²', 'sq ft'],
    rows: [
      ...a.rows.map((r) => [r.room, r.type, fx(r.carpet / 1e6, 2), fx(r.carpet / MM2_PER_SQFT, 1)]),
      ['Carpet area (rooms, excl. balcony & shafts)', '', fx(a.carpet / 1e6, 2), fx(a.carpet / MM2_PER_SQFT, 1)],
      ['Internal partition walls', '', fx(a.internalWalls / 1e6, 2), fx(a.internalWalls / MM2_PER_SQFT, 1)],
      ['RERA carpet area', 'carpet + internal walls', fx(a.reraCarpet / 1e6, 2), fx(a.reraCarpet / MM2_PER_SQFT, 1)],
      ['Exclusive balcony', '', fx(a.balcony / 1e6, 2), fx(a.balcony / MM2_PER_SQFT, 1)],
      ['Built-up area', 'outer face of external walls', fx(a.builtUp / 1e6, 2), fx(a.builtUp / MM2_PER_SQFT, 1)],
    ],
    note: `${f.name}. RERA carpet area per the RERA Act 2016 definition (net usable floor area excl. external walls, service shafts, exclusive balcony; incl. internal partition walls).`,
  };
}

export function roomEdgesCount(f: Floor) { return f.rooms.reduce((s, r) => s + roomEdges(f, r).length, 0); }
export { dist };
