// Minimal ASCII DXF reader / writer (IMP-01, IMP-10, EXP-33).
// DWG needs a licensed library (ODA); DXF is the open fallback the PRD calls for.

import type { Vec2 } from './types';
import { add, mul, rot } from './geom';

export type DxfEntity =
  | { type: 'LINE'; layer: string; a: Vec2; b: Vec2; group?: string }
  | { type: 'POLY'; layer: string; pts: Vec2[]; closed: boolean; group?: string }
  | { type: 'TEXT'; layer: string; pos: Vec2; text: string; h: number; group?: string }
  | { type: 'ARC'; layer: string; c: Vec2; r: number; start: number; end: number; group?: string }
  | { type: 'CIRCLE'; layer: string; c: Vec2; r: number; group?: string }
  | { type: 'INSERT'; layer: string; name: string; pos: Vec2; sx: number; sy: number; rot: number; group?: string }
  | { type: 'DIMENSION'; layer: string; p1: Vec2; p2: Vec2; measured?: number; text?: string; group?: string };

export interface DxfDoc {
  insUnits: number;
  layers: { name: string; color: number }[];
  entities: DxfEntity[]; // model space, INSERTs exploded (each insert's children share a `group`)
  inserts: Extract<DxfEntity, { type: 'INSERT' }>[];
  blocks: Record<string, DxfEntity[]>;
}

type Pair = [number, string];

function pairs(text: string): Pair[] {
  const lines = text.split(/\r?\n/);
  const out: Pair[] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = parseInt(lines[i].trim(), 10);
    if (Number.isNaN(code)) { i -= 1; continue; }
    out.push([code, lines[i + 1].replace(/\s+$/, '')]);
  }
  return out;
}

function readEntities(ps: Pair[], start: number, stopAt: (p: Pair) => boolean): { ents: DxfEntity[]; end: number } {
  const ents: DxfEntity[] = [];
  let i = start;
  while (i < ps.length && !stopAt(ps[i])) {
    if (ps[i][0] !== 0) { i++; continue; }
    const type = ps[i][1];
    const body: Pair[] = [];
    i++;
    while (i < ps.length && ps[i][0] !== 0) body.push(ps[i++]);
    const g = (c: number) => body.find((p) => p[0] === c)?.[1];
    const n = (c: number, d = 0) => { const s = g(c); return s === undefined ? d : parseFloat(s); };
    const layer = g(8) ?? '0';
    switch (type) {
      case 'LINE':
        ents.push({ type: 'LINE', layer, a: { x: n(10), y: n(20) }, b: { x: n(11), y: n(21) } });
        break;
      case 'LWPOLYLINE': {
        const pts: Vec2[] = [];
        let cur: Partial<Vec2> = {};
        for (const [c, val] of body) {
          if (c === 10) { if (cur.x !== undefined) pts.push({ x: cur.x, y: cur.y ?? 0 }); cur = { x: parseFloat(val) }; }
          if (c === 20) cur.y = parseFloat(val);
        }
        if (cur.x !== undefined) pts.push({ x: cur.x, y: cur.y ?? 0 });
        ents.push({ type: 'POLY', layer, pts, closed: (n(70) & 1) === 1 });
        break;
      }
      case 'POLYLINE': {
        const closed = (n(70) & 1) === 1;
        const pts: Vec2[] = [];
        while (i < ps.length && ps[i][0] === 0 && ps[i][1] === 'VERTEX') {
          i++;
          const vb: Pair[] = [];
          while (i < ps.length && ps[i][0] !== 0) vb.push(ps[i++]);
          const vx = parseFloat(vb.find((p) => p[0] === 10)?.[1] ?? '0');
          const vy = parseFloat(vb.find((p) => p[0] === 20)?.[1] ?? '0');
          pts.push({ x: vx, y: vy });
        }
        if (i < ps.length && ps[i][1] === 'SEQEND') { i++; while (i < ps.length && ps[i][0] !== 0) i++; }
        ents.push({ type: 'POLY', layer, pts, closed });
        break;
      }
      case 'TEXT':
      case 'MTEXT': {
        let text = body.filter((p) => p[0] === 1 || p[0] === 3).map((p) => p[1]).join('');
        text = text.replace(/\\P/g, ' ').replace(/\{\\[^;]*;|\}|\\[A-Za-z][^;]*;/g, '').trim();
        const hasAlign = type === 'TEXT' && (n(72) !== 0 || n(73) !== 0) && g(11) !== undefined;
        const pos = hasAlign ? { x: n(11), y: n(21) } : { x: n(10), y: n(20) };
        ents.push({ type: 'TEXT', layer, pos, text, h: n(40, 200) });
        break;
      }
      case 'ARC':
        ents.push({ type: 'ARC', layer, c: { x: n(10), y: n(20) }, r: n(40), start: n(50), end: n(51) });
        break;
      case 'CIRCLE':
        ents.push({ type: 'CIRCLE', layer, c: { x: n(10), y: n(20) }, r: n(40) });
        break;
      case 'INSERT':
        ents.push({ type: 'INSERT', layer, name: g(2) ?? '', pos: { x: n(10), y: n(20) }, sx: n(41, 1), sy: n(42, 1), rot: n(50) });
        break;
      case 'DIMENSION': {
        const t = g(1);
        ents.push({
          type: 'DIMENSION', layer,
          p1: { x: n(13), y: n(23) }, p2: { x: n(14), y: n(24) },
          measured: g(42) !== undefined ? n(42) : undefined,
          text: t && t !== '<>' ? t : undefined,
        });
        break;
      }
      default:
        break;
    }
  }
  return { ents, end: i };
}

function transform(e: DxfEntity, ins: { pos: Vec2; sx: number; sy: number; rot: number; layer: string }, group: string): DxfEntity {
  const T = (p: Vec2) => add(ins.pos, rot({ x: p.x * ins.sx, y: p.y * ins.sy }, ins.rot));
  const layer = e.layer === '0' ? ins.layer : e.layer;
  const s = Math.abs(ins.sx);
  switch (e.type) {
    case 'LINE': return { ...e, layer, a: T(e.a), b: T(e.b), group };
    case 'POLY': return { ...e, layer, pts: e.pts.map(T), group };
    case 'TEXT': return { ...e, layer, pos: T(e.pos), h: e.h * s, group };
    case 'ARC': {
      let start = e.start + ins.rot, end = e.end + ins.rot;
      if (ins.sx * ins.sy < 0) {
        // A mirrored arc reverses direction: θ → −θ (mirror in y) or 180−θ (mirror in x).
        const base = ins.sy < 0 ? 0 : 180;
        start = ins.rot + base - e.end;
        end = ins.rot + base - e.start;
      }
      return { ...e, layer, c: T(e.c), r: e.r * s, start, end, group };
    }
    case 'CIRCLE': return { ...e, layer, c: T(e.c), r: e.r * s, group };
    case 'DIMENSION': return { ...e, layer, p1: T(e.p1), p2: T(e.p2), group };
    case 'INSERT': return { ...e, layer, pos: T(e.pos), group };
  }
}

export function parseDxf(text: string): DxfDoc {
  const ps = pairs(text);
  const doc: DxfDoc = { insUnits: 0, layers: [], entities: [], inserts: [], blocks: {} };
  let i = 0;
  while (i < ps.length) {
    if (ps[i][0] === 0 && ps[i][1] === 'SECTION' && ps[i + 1]?.[0] === 2) {
      const name = ps[i + 1][1];
      i += 2;
      if (name === 'HEADER') {
        while (i < ps.length && !(ps[i][0] === 0 && ps[i][1] === 'ENDSEC')) {
          if (ps[i][0] === 9 && ps[i][1] === '$INSUNITS') doc.insUnits = parseInt(ps[i + 1]?.[1] ?? '0', 10);
          i++;
        }
      } else if (name === 'TABLES') {
        while (i < ps.length && !(ps[i][0] === 0 && ps[i][1] === 'ENDSEC')) {
          if (ps[i][0] === 0 && ps[i][1] === 'LAYER') {
            i++;
            let lname = '', color = 7;
            while (i < ps.length && ps[i][0] !== 0) {
              if (ps[i][0] === 2) lname = ps[i][1];
              if (ps[i][0] === 62) color = parseInt(ps[i][1], 10);
              i++;
            }
            if (lname) doc.layers.push({ name: lname, color });
          } else i++;
        }
      } else if (name === 'BLOCKS') {
        while (i < ps.length && !(ps[i][0] === 0 && ps[i][1] === 'ENDSEC')) {
          if (ps[i][0] === 0 && ps[i][1] === 'BLOCK') {
            i++;
            let bname = '';
            while (i < ps.length && ps[i][0] !== 0) { if (ps[i][0] === 2) bname = ps[i][1]; i++; }
            const r = readEntities(ps, i, (p) => p[0] === 0 && p[1] === 'ENDBLK');
            doc.blocks[bname] = r.ents;
            i = r.end + 1;
          } else i++;
        }
      } else if (name === 'ENTITIES') {
        const r = readEntities(ps, i, (p) => p[0] === 0 && p[1] === 'ENDSEC');
        let gi = 0;
        const explode = (ents: DxfEntity[], depth: number, parentGroup?: string) => {
          for (const e of ents) {
            if (e.type === 'INSERT') {
              const group = parentGroup ?? `g${gi++}`;
              if (depth === 0) doc.inserts.push({ ...e, group });
              const blk = doc.blocks[e.name];
              if (blk && depth < 4) explode(blk.map((b) => transform(b, e, group)), depth + 1, group);
            } else doc.entities.push(parentGroup ? { ...e, group: parentGroup } : e);
          }
        };
        explode(r.ents, 0);
        i = r.end;
      }
    }
    i++;
  }
  // Layers referenced by entities but missing from the table still need to show in the layer list.
  const known = new Set(doc.layers.map((l) => l.name));
  for (const e of [...doc.entities, ...doc.inserts]) if (!known.has(e.layer)) { known.add(e.layer); doc.layers.push({ name: e.layer, color: 7 }); }
  return doc;
}

// ---------------------------------------------------------------------------
// Writer: AutoCAD R12 ASCII DXF, which every CAD package opens without needing
// handles or an OBJECTS section. Blocks are kept as BLOCK/INSERT, units in $INSUNITS.

const f = (n: number) => (Math.round(n * 1000) / 1000).toString();

export class DxfWriter {
  private layers = new Map<string, number>();
  private blocks: { name: string; body: string[] }[] = [];
  private body: string[] = [];

  constructor(public insUnits = 4) {}

  layer(name: string, color = 7) { if (!this.layers.has(name)) this.layers.set(name, color); return name; }

  private ent(target: string[], type: string, layer: string, codes: [number, string | number][]) {
    this.layer(layer);
    target.push('0', type, '8', layer);
    for (const [c, val] of codes) target.push(String(c), typeof val === 'number' ? f(val) : val);
  }

  line(layer: string, a: Vec2, b: Vec2, t = this.body) {
    this.ent(t, 'LINE', layer, [[10, a.x], [20, a.y], [30, 0], [11, b.x], [21, b.y], [31, 0]]);
  }
  poly(layer: string, pts: Vec2[], closed = false, t = this.body) {
    this.ent(t, 'POLYLINE', layer, [[66, 1], [10, 0], [20, 0], [30, 0], [70, closed ? 1 : 0]]);
    for (const p of pts) this.ent(t, 'VERTEX', layer, [[10, p.x], [20, p.y], [30, 0]]);
    t.push('0', 'SEQEND', '8', layer);
  }
  text(layer: string, pos: Vec2, h: number, s: string, rotation = 0, centred = false, t = this.body) {
    const codes: [number, string | number][] = [[10, pos.x], [20, pos.y], [30, 0], [40, h], [1, s.replace(/\n/g, ' ')]];
    if (rotation) codes.push([50, rotation]);
    if (centred) codes.push([72, 1], [73, 2], [11, pos.x], [21, pos.y], [31, 0]);
    this.ent(t, 'TEXT', layer, codes);
  }
  arc(layer: string, c: Vec2, r: number, start: number, end: number, t = this.body) {
    this.ent(t, 'ARC', layer, [[10, c.x], [20, c.y], [30, 0], [40, r], [50, start], [51, end]]);
  }
  circle(layer: string, c: Vec2, r: number, t = this.body) {
    this.ent(t, 'CIRCLE', layer, [[10, c.x], [20, c.y], [30, 0], [40, r]]);
  }
  dimension(layer: string, p1: Vec2, p2: Vec2, measured: number, text?: string) {
    this.ent(this.body, 'DIMENSION', layer, [[10, p1.x], [20, p1.y + 300], [13, p1.x], [23, p1.y], [14, p2.x], [24, p2.y], [70, 1], [42, measured], [1, text ?? '<>']]);
  }
  /** Define a block; `draw` receives a target array to pass to the primitives. */
  block(name: string, draw: (t: string[]) => void) {
    if (this.blocks.some((b) => b.name === name)) return;
    const body: string[] = [];
    draw(body);
    this.blocks.push({ name, body });
  }
  insert(layer: string, name: string, pos: Vec2, sx = 1, sy = 1, rotation = 0) {
    this.ent(this.body, 'INSERT', layer, [[2, name], [10, pos.x], [20, pos.y], [30, 0], [41, sx], [42, sy], [43, 1], [50, rotation]]);
  }

  toString(): string {
    const out: string[] = [];
    out.push('0', 'SECTION', '2', 'HEADER', '9', '$ACADVER', '1', 'AC1009', '9', '$INSUNITS', '70', String(this.insUnits), '9', '$MEASUREMENT', '70', '1', '0', 'ENDSEC');
    out.push('0', 'SECTION', '2', 'TABLES');
    out.push('0', 'TABLE', '2', 'LTYPE', '70', '1', '0', 'LTYPE', '2', 'CONTINUOUS', '70', '0', '3', 'Solid line', '72', '65', '73', '0', '40', '0.0', '0', 'ENDTAB');
    out.push('0', 'TABLE', '2', 'LAYER', '70', String(this.layers.size + 1));
    out.push('0', 'LAYER', '2', '0', '70', '0', '62', '7', '6', 'CONTINUOUS');
    for (const [name, color] of this.layers) if (name !== '0') out.push('0', 'LAYER', '2', name, '70', '0', '62', String(color), '6', 'CONTINUOUS');
    out.push('0', 'ENDTAB', '0', 'ENDSEC');
    out.push('0', 'SECTION', '2', 'BLOCKS');
    for (const b of this.blocks) {
      out.push('0', 'BLOCK', '8', '0', '2', b.name, '70', '0', '10', '0', '20', '0', '30', '0', '3', b.name);
      out.push(...b.body);
      out.push('0', 'ENDBLK', '8', '0');
    }
    out.push('0', 'ENDSEC');
    out.push('0', 'SECTION', '2', 'ENTITIES', ...this.body, '0', 'ENDSEC', '0', 'EOF');
    return out.join('\n') + '\n';
  }
}

export const arcPoint = (c: Vec2, r: number, degA: number): Vec2 => add(c, mul({ x: Math.cos((degA * Math.PI) / 180), y: Math.sin((degA * Math.PI) / 180) }, r));
