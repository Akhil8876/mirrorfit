import type { Vec2 } from './types';

export const v = (x: number, y: number): Vec2 => ({ x, y });
export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const mul = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, y: a.y * s });
export const dot = (a: Vec2, b: Vec2) => a.x * b.x + a.y * b.y;
export const cross = (a: Vec2, b: Vec2) => a.x * b.y - a.y * b.x;
export const len = (a: Vec2) => Math.hypot(a.x, a.y);
export const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);
export const norm = (a: Vec2): Vec2 => { const l = len(a) || 1; return { x: a.x / l, y: a.y / l }; };
export const perp = (a: Vec2): Vec2 => ({ x: -a.y, y: a.x }); // left normal
export const lerp = (a: Vec2, b: Vec2, t: number): Vec2 => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
export const rot = (p: Vec2, deg: number): Vec2 => {
  const r = (deg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
};

export function signedArea(poly: Vec2[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}
export const polygonArea = (poly: Vec2[]) => Math.abs(signedArea(poly));

export function perimeter(poly: Vec2[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) s += dist(poly[i], poly[(i + 1) % poly.length]);
  return s;
}

export function centroid(poly: Vec2[]): Vec2 {
  const A = signedArea(poly);
  if (Math.abs(A) < 1e-9) {
    const s = poly.reduce((acc, p) => add(acc, p), v(0, 0));
    return mul(s, 1 / poly.length);
  }
  let cx = 0, cy = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const f = a.x * b.y - b.x * a.y;
    cx += (a.x + b.x) * f;
    cy += (a.y + b.y) * f;
  }
  return v(cx / (6 * A), cy / (6 * A));
}

export function ensureCCW(poly: Vec2[]): Vec2[] {
  return signedArea(poly) < 0 ? poly.slice().reverse() : poly;
}

export function pointInPolygon(p: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Inside or within tol of the boundary. */
export function pointInPolygonTol(p: Vec2, poly: Vec2[], tol = 1): boolean {
  if (pointInPolygon(p, poly)) return true;
  for (let i = 0; i < poly.length; i++) if (distToSegment(p, poly[i], poly[(i + 1) % poly.length]) <= tol) return true;
  return false;
}

export function projectParam(p: Vec2, a: Vec2, b: Vec2): number {
  const ab = sub(b, a);
  const l2 = dot(ab, ab) || 1;
  return dot(sub(p, a), ab) / l2;
}

export function distToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const t = Math.max(0, Math.min(1, projectParam(p, a, b)));
  return dist(p, lerp(a, b, t));
}

export function distToLine(p: Vec2, a: Vec2, b: Vec2): number {
  const d = norm(sub(b, a));
  return Math.abs(cross(d, sub(p, a)));
}

export interface BBox { minX: number; minY: number; maxX: number; maxY: number }
export function bbox(pts: Vec2[]): BBox {
  const b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const p of pts) {
    if (p.x < b.minX) b.minX = p.x; if (p.y < b.minY) b.minY = p.y;
    if (p.x > b.maxX) b.maxX = p.x; if (p.y > b.maxY) b.maxY = p.y;
  }
  return b;
}
export const bboxOverlap = (a: BBox, b: BBox, pad = 0) =>
  a.minX - pad <= b.maxX && b.minX - pad <= a.maxX && a.minY - pad <= b.maxY && b.minY - pad <= a.maxY;

/** Corners of an oriented rectangle centred at c, size w × d, rotated deg. Order: back-left, back-right, front-right, front-left. */
export function rectCorners(c: Vec2, w: number, d: number, deg: number): Vec2[] {
  const hw = w / 2, hd = d / 2;
  return [v(-hw, -hd), v(hw, -hd), v(hw, hd), v(-hw, hd)].map((p) => add(c, rot(p, deg)));
}

/** Separating-axis test for two convex polygons. Touching edges (within eps) do not count as overlap. */
export function convexOverlap(A: Vec2[], B: Vec2[], eps = 1): boolean {
  for (const poly of [A, B]) {
    for (let i = 0; i < poly.length; i++) {
      const e = sub(poly[(i + 1) % poly.length], poly[i]);
      const axis = norm(perp(e));
      let aMin = Infinity, aMax = -Infinity, bMin = Infinity, bMax = -Infinity;
      for (const p of A) { const s = dot(p, axis); aMin = Math.min(aMin, s); aMax = Math.max(aMax, s); }
      for (const p of B) { const s = dot(p, axis); bMin = Math.min(bMin, s); bMax = Math.max(bMax, s); }
      if (aMax <= bMin + eps || bMax <= aMin + eps) return false;
    }
  }
  return true;
}

/** Douglas–Peucker simplification of a closed polygon. */
export function simplifyClosed(poly: Vec2[], tol: number): Vec2[] {
  if (poly.length < 4) return poly;
  // start from the point farthest from the first so the split is stable
  let far = 0, fd = -1;
  for (let i = 0; i < poly.length; i++) { const d = dist(poly[0], poly[i]); if (d > fd) { fd = d; far = i; } }
  const ring = [...poly.slice(far), ...poly.slice(0, far)];
  const half = Math.floor(ring.length / 2);
  const p1 = dp([...ring.slice(0, half + 1)], tol);
  const p2 = dp([...ring.slice(half), ring[0]], tol);
  return [...p1.slice(0, -1), ...p2.slice(0, -1)];
}
function dp(pts: Vec2[], tol: number): Vec2[] {
  if (pts.length < 3) return pts;
  let idx = 0, md = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = distToSegment(pts[i], pts[0], pts[pts.length - 1]);
    if (d > md) { md = d; idx = i; }
  }
  if (md <= tol) return [pts[0], pts[pts.length - 1]];
  const l = dp(pts.slice(0, idx + 1), tol);
  const r = dp(pts.slice(idx), tol);
  return [...l.slice(0, -1), ...r];
}

/** Remove consecutive collinear / duplicate points. */
export function cleanPolygon(poly: Vec2[], tol = 0.5): Vec2[] {
  let out = poly.slice();
  let changed = true;
  while (changed && out.length > 3) {
    changed = false;
    for (let i = 0; i < out.length; i++) {
      const a = out[(i - 1 + out.length) % out.length], b = out[i], c = out[(i + 1) % out.length];
      if (dist(a, b) < tol || distToLine(b, a, c) < tol) { out.splice(i, 1); changed = true; break; }
    }
  }
  return out;
}

export const deg = (rad: number) => (rad * 180) / Math.PI;
export const angleOf = (a: Vec2) => deg(Math.atan2(a.y, a.x));
export const normAngle = (d: number) => ((d % 360) + 360) % 360;
