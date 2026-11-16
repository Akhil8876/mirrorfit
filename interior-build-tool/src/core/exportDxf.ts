// EXP-01 / EXP-33: layered DXF export that keeps blocks, units and scale, mapped to the firm's layer standard.

import type { Floor, Project, Trade } from './types';
import { DxfWriter } from './dxf';
import { itemById, POINTS } from './catalog';
import { projectCatalog } from './boq';
import { add, centroid, mul, norm, perp, sub, dist, polygonArea, rectCorners } from './geom';
import { openingEnds } from './measure';
import { openingTags } from './schedules';
import type { Board } from './joinery';

export function exportFloorDxf(p: Project, f: Floor, trade: Trade | 'all' = 'all'): string {
  const L = p.settings.layerStandard;
  const cat = projectCatalog(p);
  const w = new DxfWriter(4);
  const lay = (k: string, color = 7, suffix = '') => w.layer((L[k] ?? k.toUpperCase()) + suffix, color);
  const show = (t: Trade) => trade === 'all' || trade === t;

  // walls (faces), split by status so demolition / new construction read as separate layers (EXP-32)
  for (const wall of f.walls) {
    const d = norm(sub(wall.b, wall.a));
    const n = perp(d);
    const L_ = dist(wall.a, wall.b);
    const ops = f.openings.filter((o) => o.wallId === wall.id).map((o) => [o.offset - o.width / 2, o.offset + o.width / 2]).sort((a, b) => a[0] - b[0]);
    const pieces: [number, number][] = [];
    let s = 0;
    for (const [a, b] of ops) { pieces.push([s, a]); s = b; }
    pieces.push([s, L_]);
    const layer = lay('wall', wall.status === 'demolish' ? 1 : wall.status === 'new' ? 3 : 7, wall.status === 'demolish' ? '-DEMO' : wall.status === 'new' ? '-NEW' : '');
    for (const [a, b] of pieces) {
      if (b - a < 1) continue;
      const pa = add(wall.a, mul(d, a)), pb = add(wall.a, mul(d, b));
      w.poly(layer, [add(pa, mul(n, wall.thickness / 2)), add(pb, mul(n, wall.thickness / 2)), add(pb, mul(n, -wall.thickness / 2)), add(pa, mul(n, -wall.thickness / 2))], true);
    }
  }
  const tags = openingTags(f);
  for (const o of f.openings) {
    const wall = f.walls.find((x) => x.id === o.wallId);
    if (!wall) continue;
    const [p0, p1] = openingEnds(o, wall);
    const d = norm(sub(wall.b, wall.a)), n = perp(d);
    const mid = mul(add(p0, p1), 0.5);
    if (o.kind === 'door') {
      const side = o.swing?.side ?? 1;
      const hinge = add(o.swing?.hinge === 'b' ? p1 : p0, mul(n, (side * wall.thickness) / 2));
      const toward = o.swing?.hinge === 'b' ? mul(d, -1) : d;
      const leafEnd = add(hinge, mul(n, side * o.width));
      w.line(lay('door', 3), hinge, leafEnd);
      const a0 = (Math.atan2(toward.y, toward.x) * 180) / Math.PI;
      const a1 = (Math.atan2(n.y * side, n.x * side) * 180) / Math.PI;
      const [st, en] = ((a1 - a0 + 360) % 360) <= 180 ? [a0, a1] : [a1, a0];
      w.arc(lay('door', 3), hinge, o.width, st, en);
    } else if (o.kind === 'window') {
      for (const k of [-0.5, 0, 0.5]) w.line(lay('window', 4), add(p0, mul(n, k * wall.thickness)), add(p1, mul(n, k * wall.thickness)));
    }
    w.text(lay('text', 2), add(mid, mul(n, wall.thickness / 2 + 200)), 120, tags.get(o.id) ?? '', 0, true);
  }
  for (const c of f.columns) {
    const pts = rectCorners(c.center, c.w, c.d, 0);
    w.poly(lay('column', 1), pts, true);
    w.line(lay('column', 1), pts[0], pts[2]); w.line(lay('column', 1), pts[1], pts[3]);
  }
  for (const r of f.rooms) {
    w.poly(lay('room', 8), r.polygon, true);
    const c = centroid(r.polygon);
    w.text(lay('text', 2), c, 180, r.name.toUpperCase(), 0, true);
    w.text(lay('text', 2), add(c, { x: 0, y: -260 }), 120, `${(polygonArea(r.polygon) / 1e6).toFixed(2)} m²`, 0, true);
  }
  // furniture & joinery as blocks: one unit-square block per catalog item, scaled by W×D (keeps blocks, EXP-33)
  for (const it of f.items) {
    const ci = itemById(cat, it.catalogId);
    if (!ci || !show(ci.trade === 'decor' ? 'furniture' : ci.trade)) continue;
    const name = `IBT_${ci.id.replace(/[^A-Za-z0-9]/g, '_').toUpperCase()}`;
    w.block(name, (t) => {
      w.poly('0', [{ x: -0.5, y: -0.5 }, { x: 0.5, y: -0.5 }, { x: 0.5, y: 0.5 }, { x: -0.5, y: 0.5 }], true, t);
      w.line('0', { x: -0.4, y: 0.4 }, { x: 0.4, y: 0.4 }, t); // front marker
    });
    const layer = ci.joinery ? lay('joinery', 30) : ['plumbing'].includes(ci.trade) ? lay('plumbing', 5) : ci.trade === 'hvac' ? lay('hvac', 140) : lay('furniture', 8);
    w.insert(layer, name, it.pos, it.w, it.d, it.rot);
  }
  // MEP points as symbol blocks
  for (const pt of f.points) {
    const P = POINTS[pt.kind];
    if (!show(P.trade)) continue;
    const name = `IBT_PT_${P.symbol}`;
    w.block(name, (t) => { w.circle('0', { x: 0, y: 0 }, 90, t); w.text('0', { x: 0, y: -40 }, 80, P.symbol, 0, true, t); });
    const layer = P.trade === 'plumbing' ? lay('plumbing', 5) : P.trade === 'hvac' ? lay('hvac', 140) : ['light', 'cove', 'fan', 'exhaust'].includes(pt.kind) ? lay('lighting', 2) : lay('electrical', 1);
    w.insert(layer, name, pt.pos);
    if (!['light', 'cove', 'fan'].includes(pt.kind)) w.text(layer, add(pt.pos, { x: 120, y: 120 }), 70, `${pt.height}`, 0, false);
  }
  for (const a of f.annotations) {
    w.line(lay('dims', 6), a.a, a.b);
    w.text(lay('dims', 6), add(mul(add(a.a, a.b), 0.5), { x: 0, y: 120 }), 100, a.text ?? `${Math.round(dist(a.a, a.b))}`, 0, true);
  }
  return w.toString();
}

/** EXP-35: nesting output for CNC — one rectangle per board, panels labelled with their barcode tag. */
export function exportNestingDxf(boards: Board[]): string {
  const w = new DxfWriter(4);
  boards.forEach((b, i) => {
    const ox = 0, oy = -i * 1500;
    w.poly('CNC-BOARD', [{ x: ox, y: oy }, { x: ox + 2440, y: oy }, { x: ox + 2440, y: oy + 1220 }, { x: ox, y: oy + 1220 }], true);
    w.text('CNC-TEXT', { x: ox, y: oy + 1260 }, 60, `Board ${i + 1} – ${b.material} ${b.t} mm`);
    for (const pl of b.placements) {
      w.poly('CNC-CUT', [{ x: ox + pl.x, y: oy + pl.y }, { x: ox + pl.x + pl.l, y: oy + pl.y }, { x: ox + pl.x + pl.l, y: oy + pl.y + pl.w }, { x: ox + pl.x, y: oy + pl.y + pl.w }], true);
      w.text('CNC-LABEL', { x: ox + pl.x + pl.l / 2, y: oy + pl.y + pl.w / 2 }, Math.min(50, pl.w / 4), pl.tag, 0, true);
    }
  });
  return w.toString();
}
