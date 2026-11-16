// A sample 2BHK apartment drawn the way an architect's DXF usually is:
// double-line walls with gaps at openings, door blocks with swing arcs,
// window blocks, column outlines, room labels as text and a couple of dimensions.

import { DxfWriter, arcPoint } from './dxf';
import type { Vec2 } from './types';
import { add, mul, norm, perp, sub, len } from './geom';

export interface SampleWall { a: Vec2; b: Vec2; t: number }
export interface SampleOpening { wall: number; at: number; w: number; kind: 'door' | 'window' | 'opening'; hinge?: 'a' | 'b'; side?: 1 | -1 }

export const SAMPLE_WALLS: SampleWall[] = [
  { a: { x: 0, y: 0 }, b: { x: 10000, y: 0 }, t: 230 },
  { a: { x: 10000, y: 0 }, b: { x: 10000, y: 8000 }, t: 230 },
  { a: { x: 10000, y: 8000 }, b: { x: 0, y: 8000 }, t: 230 },
  { a: { x: 0, y: 8000 }, b: { x: 0, y: 0 }, t: 230 },
  { a: { x: 6000, y: 0 }, b: { x: 6000, y: 8000 }, t: 115 },
  { a: { x: 6000, y: 3000 }, b: { x: 10000, y: 3000 }, t: 115 },
  { a: { x: 0, y: 4500 }, b: { x: 6000, y: 4500 }, t: 115 },
  { a: { x: 3500, y: 4500 }, b: { x: 3500, y: 8000 }, t: 115 },
  { a: { x: 3500, y: 6200 }, b: { x: 6000, y: 6200 }, t: 115 },
];

// `at` = distance of the opening centre from wall.a
export const SAMPLE_OPENINGS: SampleOpening[] = [
  { wall: 0, at: 1500, w: 1000, kind: 'door', hinge: 'a', side: 1 }, // main door
  { wall: 0, at: 4000, w: 1800, kind: 'window' },
  { wall: 0, at: 8000, w: 1200, kind: 'window' }, // kitchen
  { wall: 3, at: 5750, w: 1500, kind: 'window' }, // living, west
  { wall: 1, at: 5500, w: 1800, kind: 'window' }, // bedroom 2, east
  { wall: 2, at: 8250, w: 1500, kind: 'window' }, // bedroom 1, north
  { wall: 2, at: 5250, w: 600, kind: 'window' }, // toilet ventilator
  { wall: 4, at: 1800, w: 800, kind: 'door', hinge: 'a', side: -1 }, // kitchen
  { wall: 4, at: 3750, w: 900, kind: 'door', hinge: 'b', side: -1 }, // bedroom 2
  { wall: 6, at: 4750, w: 1000, kind: 'opening' }, // living → passage
  { wall: 7, at: 850, w: 900, kind: 'door', hinge: 'b', side: 1 }, // bedroom 1
  { wall: 8, at: 1250, w: 750, kind: 'door', hinge: 'a', side: 1 }, // toilet
];

export const SAMPLE_LABELS: { text: string; pos: Vec2 }[] = [
  { text: 'LIVING / DINING', pos: { x: 3000, y: 2200 } },
  { text: 'KITCHEN', pos: { x: 8000, y: 1500 } },
  { text: 'BEDROOM 2', pos: { x: 8000, y: 5500 } },
  { text: 'MASTER BEDROOM', pos: { x: 1750, y: 6250 } },
  { text: 'PASSAGE', pos: { x: 4750, y: 5350 } },
  { text: 'TOILET', pos: { x: 4750, y: 7100 } },
];

export function buildSampleDxf(): string {
  const w = new DxfWriter(4);
  w.layer('A-WALL', 7); w.layer('A-DOOR', 3); w.layer('A-GLAZ', 4); w.layer('S-COLS', 1);
  w.layer('A-ANNO-TEXT', 2); w.layer('A-ANNO-DIMS', 6); w.layer('P-SANR', 5); w.layer('A-FURN', 8);

  // Door block: 1 unit wide leaf + swing arc, hinge at origin, opening along +x, swinging +y.
  w.block('DOOR_1', (t) => {
    w.line('0', { x: 0, y: 0 }, { x: 0, y: 1 }, t);
    w.arc('0', { x: 0, y: 0 }, 1, 0, 90, t);
  });
  // Window block: 1 unit long, unit thickness, three lines.
  w.block('WIN_1', (t) => {
    w.line('0', { x: 0, y: -0.5 }, { x: 1, y: -0.5 }, t);
    w.line('0', { x: 0, y: 0 }, { x: 1, y: 0 }, t);
    w.line('0', { x: 0, y: 0.5 }, { x: 1, y: 0.5 }, t);
  });
  w.block('WC', (t) => {
    w.poly('0', [{ x: -190, y: 0 }, { x: 190, y: 0 }, { x: 190, y: 200 }, { x: -190, y: 200 }], true, t);
    w.circle('0', { x: 0, y: 450 }, 190, t);
  });
  w.block('BASIN', (t) => {
    w.poly('0', [{ x: -275, y: 0 }, { x: 275, y: 0 }, { x: 275, y: 450 }, { x: -275, y: 450 }], true, t);
    w.circle('0', { x: 0, y: 225 }, 150, t);
  });

  SAMPLE_WALLS.forEach((wall, wi) => {
    const d = norm(sub(wall.b, wall.a));
    const n = perp(d);
    const L = len(sub(wall.b, wall.a));
    const ext = wall.t >= 200 ? wall.t / 2 : 0; // exterior faces run to the outer corner
    const cuts = SAMPLE_OPENINGS.filter((o) => o.wall === wi).map((o) => [o.at - o.w / 2, o.at + o.w / 2]).sort((a, b) => a[0] - b[0]);
    const pieces: [number, number][] = [];
    let s = -ext;
    for (const [c0, c1] of cuts) { pieces.push([s, c0]); s = c1; }
    pieces.push([s, L + ext]);
    for (const side of [1, -1]) {
      const off = mul(n, (side * wall.t) / 2);
      for (const [p0, p1] of pieces) if (p1 - p0 > 1) w.line('A-WALL', add(add(wall.a, mul(d, p0)), off), add(add(wall.a, mul(d, p1)), off));
    }
    // jambs
    for (const [c0, c1] of cuts) for (const c of [c0, c1]) w.line('A-WALL', add(add(wall.a, mul(d, c)), mul(n, wall.t / 2)), add(add(wall.a, mul(d, c)), mul(n, -wall.t / 2)));
  });

  for (const o of SAMPLE_OPENINGS) {
    const wall = SAMPLE_WALLS[o.wall];
    const d = norm(sub(wall.b, wall.a));
    const n = perp(d);
    const ang = (Math.atan2(d.y, d.x) * 180) / Math.PI;
    if (o.kind === 'door') {
      const side = o.side ?? 1;
      const hingeAt = o.hinge === 'b' ? o.at + o.w / 2 : o.at - o.w / 2;
      const hinge = add(add(wall.a, mul(d, hingeAt)), mul(n, (side * wall.t) / 2));
      // Rotate/mirror the unit block so its +x points from the hinge across the opening and +y into the swing side.
      const toward = o.hinge === 'b' ? ang + 180 : ang;
      const mirror = (o.hinge === 'b' ? -1 : 1) * side;
      w.insert('A-DOOR', 'DOOR_1', hinge, o.w, o.w * mirror, toward);
    } else if (o.kind === 'window') {
      w.insert('A-GLAZ', 'WIN_1', add(wall.a, mul(d, o.at - o.w / 2)), o.w, wall.t, ang);
    }
  }

  // Columns at the frame corners and where the spine wall meets the north facade.
  const cols: [number, number, number, number][] = [[-115, -115, 1, 1], [10115, -115, -1, 1], [10115, 8115, -1, -1], [-115, 8115, 1, -1]];
  for (const [x, y, sx, sy] of cols) {
    const x2 = x + sx * 400, y2 = y + sy * 400;
    w.poly('S-COLS', [{ x, y }, { x: x2, y }, { x: x2, y: y2 }, { x, y: y2 }], true);
  }
  w.poly('S-COLS', [{ x: 5800, y: 7715 }, { x: 6200, y: 7715 }, { x: 6200, y: 8115 }, { x: 5800, y: 8115 }], true);

  for (const l of SAMPLE_LABELS) w.text('A-ANNO-TEXT', l.pos, 180, l.text, 0, true);

  // Existing sanitaryware in the toilet (IMP-13).
  w.insert('P-SANR', 'WC', { x: 5500, y: 8000 - 115 }, 1, 1, 180);
  w.insert('P-SANR', 'BASIN', { x: 4000, y: 6200 + 57.5 }, 1, 1, 0);

  // Dimensions: one correct, one whose written text disagrees with the geometry (IMP-22).
  w.dimension('A-ANNO-DIMS', { x: 0, y: -600 }, { x: 10000, y: -600 }, 10000);
  w.dimension('A-ANNO-DIMS', { x: 6000, y: 8600 }, { x: 10000, y: 8600 }, 4000, '4100');
  return w.toString();
}

export { arcPoint };
