import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { Floor, Item, MepPoint, Underlay, Vec2, Snag, CommentPin } from '../core/types';
import type { Catalog } from '../core/catalog';
import { POINTS, itemById, materialById } from '../core/catalog';
import type { Issue } from '../core/rules';
import { footprint } from '../core/rules';
import type { LayerKey, Sel, Tool } from '../store';
import { add, bbox, centroid, dist, mul, norm, perp, polygonArea, rectCorners, sub, dot, pointInPolygonTol } from '../core/geom';
import { openingEnds, roomEdges, clearDistances } from '../core/measure';
import { fmtLen, type DisplayUnits } from '../core/units';
import { ZONES, planCentre, rayAt } from '../core/vastu';
import { openingTags } from '../core/schedules';

export interface PlanOpts {
  layers: Partial<Record<LayerKey, boolean>>;
  selection?: Sel | null;
  highlight?: Set<string>;
  clouds?: Set<string>;
  issues?: Issue[];
  dims?: boolean;
  roomDims?: boolean;
  tiles?: boolean;
  rcp?: boolean;
  demo?: 'demolition' | 'construction';
  wallFinish?: boolean;
  units?: DisplayUnits;
  pointFilter?: (k: MepPoint['kind']) => boolean;
  itemFilter?: (trade: string, cat: string) => boolean;
  pointHeights?: boolean;
  circuits?: Record<string, string>;
  snags?: Snag[];
  comments?: CommentPin[];
  tags?: boolean;
  print?: boolean;
  textScale?: number;
}

const P = (v: Vec2) => `${v.x},${v.y}`;
const poly = (pts: Vec2[]) => pts.map(P).join(' ');

function Txt({ at, size, children, anchor = 'middle', fill, weight, rot = 0 }: { at: Vec2; size: number; children: React.ReactNode; anchor?: 'start' | 'middle' | 'end'; fill?: string; weight?: number; rot?: number }) {
  return <text transform={`translate(${at.x} ${at.y}) scale(1 -1) rotate(${-rot})`} fontSize={size} textAnchor={anchor} dominantBaseline="middle" fill={fill ?? 'currentColor'} fontWeight={weight} style={{ pointerEvents: 'none' }}>{children}</text>;
}

export const TRADE_COLORS: Record<string, string> = { electrical: '#c0392b', plumbing: '#1f6fb5', hvac: '#0f8f8f', civil: '#555', carpentry: '#8a5a2b', furniture: '#6b6457', decor: '#7a8b6a', painting: '#9b59b6' };

function shortName(name: string) { return name.replace(/\(.*\)/, '').replace(/ – .*/, '').split(' ').slice(0, 3).join(' '); }

export function planBounds(f: Floor, pad = 800) {
  const pts = [...f.walls.flatMap((w) => [w.a, w.b]), ...f.rooms.flatMap((r) => r.polygon)];
  if (!pts.length) return { minX: -pad, minY: -pad, maxX: 10000 + pad, maxY: 8000 + pad };
  const b = bbox(pts);
  return { minX: b.minX - pad, minY: b.minY - pad, maxX: b.maxX + pad, maxY: b.maxY + pad };
}

export const PlanContent = React.memo(function PlanContent({ floor: f, cat, opts, underlay }: { floor: Floor; cat: Catalog; opts: PlanOpts; underlay?: Underlay }) {
  const L = (k: LayerKey) => (k === 'underlay' || k === 'vastu' ? opts.layers[k] === true : opts.layers[k] !== false);
  const sel = opts.selection;
  const ts = opts.textScale ?? 1;
  const ink = opts.print ? '#111' : 'var(--wall)';
  const units = opts.units ?? 'mm';
  const tags = useMemo(() => (opts.tags ? openingTags(f) : new Map<string, string>()), [f, opts.tags]);
  const issueIds = useMemo(() => {
    const m = new Map<string, string>();
    for (const i of opts.issues ?? []) for (const id of i.itemIds ?? []) if (i.severity !== 'info') m.set(id, i.severity);
    return m;
  }, [opts.issues]);
  const hl = opts.highlight ?? new Set<string>();
  const selStroke = '#2f9e88';

  return (
    <g>
      {underlay && L('underlay') && (
        <g opacity={0.5} stroke="#c58b2b" strokeWidth={1} vectorEffect="non-scaling-stroke">
          {underlay.image && <image href={underlay.image.dataUrl} x={underlay.image.x} y={underlay.image.y} width={underlay.image.w} height={underlay.image.h} transform={`translate(0 ${2 * underlay.image.y + underlay.image.h}) scale(1 -1)`} preserveAspectRatio="none" opacity={0.8} />}
          {underlay.lines.map((l, i) => <line key={i} x1={l.a.x} y1={l.a.y} x2={l.b.x} y2={l.b.y} vectorEffect="non-scaling-stroke" />)}
        </g>
      )}
      {/* rooms */}
      {f.rooms.map((r) => {
        const fm = materialById(cat, r.finishes.floor);
        const isSel = sel?.kind === 'room' && sel.id === r.id;
        const fill = opts.wallFinish ? 'none' : opts.tiles ? (fm?.color ?? '#eee') : r.type === 'shaft' ? '#d8d3c8' : opts.print ? '#fff' : 'color-mix(in srgb, var(--panel) 70%, transparent)';
        return (
          <g key={r.id}>
            <polygon points={poly(r.polygon)} fill={fill} fillOpacity={opts.tiles ? 0.35 : 1} stroke={hl.has(r.id) ? '#d9822b' : isSel ? selStroke : 'none'} strokeWidth={isSel || hl.has(r.id) ? 3 : 0} vectorEffect="non-scaling-stroke" data-kind="room" data-id={r.id} />
            {opts.tiles && fm?.tile && <TileGrid room={r} tile={fm.tile} />}
          </g>
        );
      })}
      {/* wall finishes (painter sheet) */}
      {opts.wallFinish && f.rooms.map((r) => roomEdges(f, r).map((e) => {
        const id = r.wallFinishOverrides[e.i] ?? (r.finishes.accentWall === e.i && r.finishes.accent ? r.finishes.accent : r.finishes.wall);
        const m = materialById(cat, id);
        const a = add(e.a, mul(e.n, 60)), b = add(e.b, mul(e.n, 60));
        return <g key={r.id + e.i}><line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={m?.color ?? '#999'} strokeWidth={90} /><Txt at={add(add(e.a, mul(e.dir, e.len / 2)), mul(e.n, 220))} size={90 * ts} rot={Math.abs(e.dir.x) < 0.5 ? 90 : 0}>{m?.code ?? ''}</Txt></g>;
      }))}
      {/* ceiling (RCP) */}
      {opts.rcp && f.rooms.filter((r) => r.falseCeiling.enabled).map((r) => {
        const c = centroid(r.polygon);
        const inner = r.polygon.map((p) => add(p, mul(norm(sub(c, p)), 450)));
        return <g key={'fc' + r.id}><polygon points={poly(inner)} fill="none" stroke="#777" strokeDasharray="60 40" strokeWidth={1.2} vectorEffect="non-scaling-stroke" />{r.falseCeiling.cove && <polygon points={poly(r.polygon.map((p) => add(p, mul(norm(sub(c, p)), 300))))} fill="none" stroke="#e0a800" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />}<Txt at={add(c, { x: 0, y: -420 })} size={110 * ts} fill="#555">{`FC +${r.ceilingHeight - r.falseCeiling.drop}${r.falseCeiling.cove ? ' · cove' : ''}`}</Txt></g>;
      })}
      {/* columns */}
      {L('civil') && f.columns.map((c) => {
        const pts = rectCorners(c.center, c.w, c.d, 0);
        return <g key={c.id} data-kind="column" data-id={c.id}><polygon points={poly(pts)} fill={ink} fillOpacity={0.85} stroke={hl.has(c.id) ? '#d9822b' : sel?.id === c.id ? selStroke : 'none'} strokeWidth={3} vectorEffect="non-scaling-stroke" /><line x1={pts[0].x} y1={pts[0].y} x2={pts[2].x} y2={pts[2].y} stroke="#fff" strokeWidth={1} vectorEffect="non-scaling-stroke" /><line x1={pts[1].x} y1={pts[1].y} x2={pts[3].x} y2={pts[3].y} stroke="#fff" strokeWidth={1} vectorEffect="non-scaling-stroke" /></g>;
      })}
      {/* walls */}
      {f.walls.map((w) => {
        const d = norm(sub(w.b, w.a)), n = perp(d);
        const L_ = dist(w.a, w.b);
        const ops = f.openings.filter((o) => o.wallId === w.id).map((o) => [o.offset - o.width / 2, o.offset + o.width / 2]).sort((a, b) => a[0] - b[0]);
        const pieces: [number, number][] = [];
        let s = -(w.exterior ? w.thickness / 2 : 0);
        for (const [a, b] of ops) { pieces.push([s, a]); s = b; }
        pieces.push([s, L_ + (w.exterior ? w.thickness / 2 : 0)]);
        const isSel = sel?.kind === 'wall' && sel.id === w.id;
        const demo = w.status === 'demolish', nu = w.status === 'new';
        if (opts.demo === 'construction' && demo) return null;
        const fill = demo ? (opts.demo === 'demolition' ? 'none' : '#e8a598') : nu ? (opts.demo ? '#4f8a5b' : '#7aa784') : w.structural ? '#5a3f3f' : ink;
        return (
          <g key={w.id} data-kind="wall" data-id={w.id}>
            {pieces.filter(([a, b]) => b - a > 1).map(([a, b], i) => {
              const pa = add(w.a, mul(d, a)), pb = add(w.a, mul(d, b));
              const q = [add(pa, mul(n, w.thickness / 2)), add(pb, mul(n, w.thickness / 2)), add(pb, mul(n, -w.thickness / 2)), add(pa, mul(n, -w.thickness / 2))];
              return <polygon key={i} points={poly(q)} fill={fill} stroke={isSel ? selStroke : hl.has(w.id) ? '#d9822b' : demo ? '#c0392b' : 'none'} strokeWidth={isSel || hl.has(w.id) ? 3 : demo ? 1.5 : 0} strokeDasharray={demo ? '6 4' : undefined} vectorEffect="non-scaling-stroke" />;
            })}
          </g>
        );
      })}
      {/* openings */}
      {f.openings.map((o) => {
        const w = f.walls.find((x) => x.id === o.wallId);
        if (!w) return null;
        const [p0, p1] = openingEnds(o, w);
        const d = norm(sub(w.b, w.a)), n = perp(d);
        const isSel = sel?.kind === 'opening' && sel.id === o.id;
        const col = isSel ? selStroke : hl.has(o.id) ? '#d9822b' : opts.print ? '#333' : 'var(--ink-2)';
        const mid = mul(add(p0, p1), 0.5);
        const hit = [add(p0, mul(n, w.thickness / 2 + 40)), add(p1, mul(n, w.thickness / 2 + 40)), add(p1, mul(n, -w.thickness / 2 - 40)), add(p0, mul(n, -w.thickness / 2 - 40))];
        return (
          <g key={o.id} data-kind="opening" data-id={o.id}>
            <polygon points={poly(hit)} fill="transparent" />
            {o.kind === 'window' && [-0.5, 0, 0.5].map((k) => <line key={k} x1={add(p0, mul(n, k * w.thickness)).x} y1={add(p0, mul(n, k * w.thickness)).y} x2={add(p1, mul(n, k * w.thickness)).x} y2={add(p1, mul(n, k * w.thickness)).y} stroke={col} strokeWidth={isSel ? 2.5 : 1.2} vectorEffect="non-scaling-stroke" />)}
            {o.kind === 'door' && (() => {
              const side = o.swing?.side ?? 1;
              const hingeEnd = o.swing?.hinge === 'b' ? p1 : p0;
              const other = o.swing?.hinge === 'b' ? p0 : p1;
              const hinge = add(hingeEnd, mul(n, (side * w.thickness) / 2));
              const leaf = add(hinge, mul(n, side * o.width));
              const closed = add(other, mul(n, (side * w.thickness) / 2));
              const sweep = (o.swing?.hinge === 'b' ? 1 : 0) ^ (side > 0 ? 0 : 1);
              return <g stroke={col} fill="none" strokeWidth={isSel ? 2.5 : 1.2}><line x1={hinge.x} y1={hinge.y} x2={leaf.x} y2={leaf.y} vectorEffect="non-scaling-stroke" /><path d={`M ${leaf.x} ${leaf.y} A ${o.width} ${o.width} 0 0 ${sweep ? 1 : 0} ${closed.x} ${closed.y}`} strokeDasharray="30 20" vectorEffect="non-scaling-stroke" /></g>;
            })()}
            {o.kind === 'opening' && <line x1={p0.x} y1={p0.y} x2={p1.x} y2={p1.y} stroke={col} strokeDasharray="40 30" strokeWidth={1} vectorEffect="non-scaling-stroke" />}
            {opts.tags && <Txt at={add(mid, mul(n, -(w.thickness / 2 + 180)))} size={100 * ts} fill="#555">{tags.get(o.id)}</Txt>}
          </g>
        );
      })}
      {/* items */}
      {!opts.rcp && f.items.map((it) => <ItemShape key={it.id} it={it} cat={cat} opts={opts} sel={sel?.kind === 'item' && sel.id === it.id} issue={issueIds.get(it.id)} hl={hl.has(it.id)} />)}
      {/* points */}
      {f.points.map((pt) => {
        const D = POINTS[pt.kind];
        const isCeil = ['light', 'cove', 'fan'].includes(pt.kind);
        if (opts.pointFilter && !opts.pointFilter(pt.kind)) return null;
        if (!opts.pointFilter) {
          if (D.trade === 'electrical' && !L('electrical')) return null;
          if (D.trade === 'plumbing' && !L('plumbing')) return null;
          if (D.trade === 'hvac' && !L('hvac')) return null;
        }
        if (opts.rcp && !isCeil && pt.kind !== 'exhaust') return null;
        const isSel = sel?.kind === 'point' && sel.id === pt.id;
        const r = opts.print ? 120 * ts : 70 * Math.min(ts, 1.7);
        return (
          <g key={pt.id} data-kind="point" data-id={pt.id} opacity={pt.draft && !opts.print ? 0.75 : 1}>
            {isCeil ? <circle cx={pt.pos.x} cy={pt.pos.y} r={r} fill="#fff" stroke={D.color} strokeWidth={isSel ? 3 : 1.5} vectorEffect="non-scaling-stroke" /> : <rect x={pt.pos.x - r} y={pt.pos.y - r} width={2 * r} height={2 * r} rx={20} fill="#fff" stroke={D.color} strokeWidth={isSel ? 3 : 1.5} vectorEffect="non-scaling-stroke" />}
            {pt.kind === 'fan' && <path d={`M ${pt.pos.x - r} ${pt.pos.y} L ${pt.pos.x + r} ${pt.pos.y} M ${pt.pos.x} ${pt.pos.y - r} L ${pt.pos.x} ${pt.pos.y + r}`} stroke={D.color} vectorEffect="non-scaling-stroke" />}
            <Txt at={pt.pos} size={(D.symbol.length > 2 ? 0.42 : 0.55) * r} fill={D.color} weight={700}>{pt.kind === 'fan' ? '' : D.symbol}</Txt>
            {opts.pointHeights && !isCeil && <Txt at={add(pt.pos, { x: 0, y: -170 * ts })} size={65 * ts} fill={D.color}>{`${Math.round(pt.height)}`}</Txt>}
            {opts.circuits?.[pt.id] && <Txt at={add(pt.pos, { x: 0, y: 165 * ts })} size={60 * ts} fill="#777">{opts.circuits[pt.id]}</Txt>}
            {isSel && <circle cx={pt.pos.x} cy={pt.pos.y} r={r * 1.8} fill="none" stroke={selStroke} strokeWidth={2} vectorEffect="non-scaling-stroke" />}
          </g>
        );
      })}
      {/* room labels */}
      {L('rooms') && f.rooms.map((r) => {
        const c = labelPoint(r.polygon);
        const A = polygonArea(r.polygon);
        const bb = bbox(r.polygon);
        return (
          <g key={'lbl' + r.id} opacity={0.95}>
            <Txt at={c} size={150 * ts} weight={650} fill={opts.print ? '#111' : 'var(--ink)'}>{r.name.toUpperCase()}</Txt>
            <Txt at={add(c, { x: 0, y: -190 * ts })} size={105 * ts} fill={opts.print ? '#444' : 'var(--ink-2)'}>{`${(A / 1e6).toFixed(2)} m² · ${(A / 92903.04).toFixed(0)} sq ft`}</Txt>
            {opts.roomDims && <Txt at={add(c, { x: 0, y: -340 * ts })} size={95 * ts} fill="#666">{`${fmtLen(bb.maxX - bb.minX, units)} × ${fmtLen(bb.maxY - bb.minY, units)}`}</Txt>}
            {r.det && !r.det.confirmed && !opts.print && <Txt at={add(c, { x: 0, y: 200 * ts })} size={90 * ts} fill="#d9822b">unconfirmed</Txt>}
          </g>
        );
      })}
      {/* annotations */}
      {L('annotation') && f.annotations.map((a) => <DimLine key={a.id} a={a.a} b={a.b} text={a.text ?? fmtLen(dist(a.a, a.b), units)} ts={ts} id={a.id} sel={sel?.id === a.id} />)}
      {opts.dims && <OverallDims f={f} ts={ts} units={units} />}
      {/* revision clouds */}
      {opts.clouds && [...opts.clouds].map((id) => {
        const it = f.items.find((i) => i.id === id) ?? f.points.find((p) => p.id === id);
        if (!it) return null;
        const pos = it.pos;
        const r = 'w' in it ? Math.max(it.w, it.d) / 2 + 200 : 260;
        const n = 14;
        const pts = Array.from({ length: n }, (_, k) => add(pos, mul({ x: Math.cos((k / n) * 2 * Math.PI), y: Math.sin((k / n) * 2 * Math.PI) }, r)));
        const d = pts.map((p, k) => { const q = pts[(k + 1) % n]; return `${k === 0 ? `M ${p.x} ${p.y}` : ''} A ${r / 5} ${r / 5} 0 0 1 ${q.x} ${q.y}`; }).join(' ');
        return <path key={'c' + id} d={d} fill="none" stroke="#d62d20" strokeWidth={1.6} vectorEffect="non-scaling-stroke" />;
      })}
      {/* issue markers */}
      {!opts.print && (opts.issues ?? []).filter((i) => i.pos && i.severity !== 'info').map((i) => <circle key={i.id} cx={i.pos!.x} cy={i.pos!.y} r={60} fill={i.severity === 'error' ? '#c0392b' : '#d9822b'} opacity={0.85} />)}
      {/* snags & comments */}
      {(opts.snags ?? []).filter((s) => s.floorId === f.id).map((s, i) => (
        <g key={s.id} data-kind="snag" data-id={s.id}><path d={`M ${s.pos.x} ${s.pos.y} l -110 220 a 110 110 0 1 1 220 0 z`} fill={s.status === 'closed' ? '#2e7d4f' : s.status === 'fixed' ? '#3a64a8' : '#c0392b'} stroke={sel?.id === s.id ? selStroke : '#fff'} strokeWidth={2} vectorEffect="non-scaling-stroke" /><Txt at={add(s.pos, { x: 0, y: 260 })} size={110} fill="#fff" weight={700}>{i + 1}</Txt></g>
      ))}
      {(opts.comments ?? []).filter((c) => c.floorId === f.id && !c.resolved).map((c) => (
        <g key={c.id} data-kind="comment" data-id={c.id}><rect x={c.pos.x - 120} y={c.pos.y} width={240} height={190} rx={50} fill="#3a64a8" stroke={sel?.id === c.id ? selStroke : '#fff'} strokeWidth={2} vectorEffect="non-scaling-stroke" /><Txt at={add(c.pos, { x: 0, y: 95 })} size={110} fill="#fff" weight={700}>“</Txt></g>
      ))}
      {L('vastu') && <VastuGrid f={f} />}
    </g>
  );
});

function labelPoint(poly: Vec2[]): Vec2 {
  const c = centroid(poly);
  if (pointInPolygonTol(c, poly, 0)) return c;
  const b = bbox(poly);
  for (let k = 1; k < 10; k++) for (const t of [0.5 - k * 0.05, 0.5 + k * 0.05]) {
    const p = { x: b.minX + (b.maxX - b.minX) * t, y: c.y };
    if (pointInPolygonTol(p, poly, 0)) return p;
  }
  return c;
}

function TileGrid({ room, tile }: { room: { polygon: Vec2[]; id: string }; tile: { w: number; h: number } }) {
  const b = bbox(room.polygon);
  const lines: React.ReactNode[] = [];
  const id = 'clip-' + room.id;
  // start point: lower-left corner of the room (pattern start point noted on the civil sheet)
  for (let x = b.minX; x <= b.maxX; x += tile.w) lines.push(<line key={'x' + x} x1={x} y1={b.minY} x2={x} y2={b.maxY} />);
  for (let y = b.minY; y <= b.maxY; y += tile.h) lines.push(<line key={'y' + y} x1={b.minX} y1={y} x2={b.maxX} y2={y} />);
  return (
    <g>
      <clipPath id={id}><polygon points={poly(room.polygon)} /></clipPath>
      <g clipPath={`url(#${id})`} stroke="#8a8478" strokeWidth={0.6} vectorEffect="non-scaling-stroke">{lines}</g>
      <circle cx={b.minX + 60} cy={b.minY + 60} r={45} fill="#c0392b" />
    </g>
  );
}

function ItemShape({ it, cat, opts, sel, issue, hl }: { it: Item; cat: Catalog; opts: PlanOpts; sel: boolean; issue?: string; hl: boolean }) {
  const ci = itemById(cat, it.catalogId);
  if (!ci) return null;
  const layerKey = (ci.trade === 'decor' ? 'decor' : ci.trade === 'carpentry' ? 'carpentry' : ci.trade === 'plumbing' ? 'plumbing' : ci.trade === 'hvac' ? 'hvac' : ci.trade === 'electrical' ? 'electrical' : 'furniture') as LayerKey;
  if (opts.layers[layerKey] === false) return null;
  if (opts.itemFilter && !opts.itemFilter(ci.trade, ci.category)) return null;
  const fp = footprint(it);
  const fin = materialById(cat, it.finish);
  const fill = fin?.color ?? ci.color;
  const ts = opts.textScale ?? 1;
  const front = mul({ x: -Math.sin((it.rot * Math.PI) / 180), y: Math.cos((it.rot * Math.PI) / 180) }, it.d / 2 - 40);
  const stroke = sel ? '#2f9e88' : issue === 'error' ? '#c0392b' : issue === 'warning' ? '#d9822b' : hl ? '#d9822b' : opts.print ? '#222' : '#6b6457';
  const wallUnit = ci.wallMounted && it.elev > 1000;
  return (
    <g data-kind="item" data-id={it.id} opacity={it.draft && !opts.print ? 0.82 : 1}>
      <polygon points={poly(fp)} fill={opts.print ? (ci.joinery ? '#f1e9dc' : '#f6f6f4') : fill} fillOpacity={ci.category === 'rug' ? 0.35 : opts.print ? 1 : 0.55} stroke={stroke} strokeWidth={sel ? 3 : 1.1} strokeDasharray={wallUnit || it.draft ? '50 30' : undefined} vectorEffect="non-scaling-stroke" />
      {ci.joinery && !wallUnit && <line x1={add(add(it.pos, front), mul(norm(sub(fp[2], fp[3])), -it.w / 2 + 40)).x} y1={add(add(it.pos, front), mul(norm(sub(fp[2], fp[3])), -it.w / 2 + 40)).y} x2={add(add(it.pos, front), mul(norm(sub(fp[2], fp[3])), it.w / 2 - 40)).x} y2={add(add(it.pos, front), mul(norm(sub(fp[2], fp[3])), it.w / 2 - 40)).y} stroke={stroke} strokeWidth={0.8} vectorEffect="non-scaling-stroke" />}
      {ci.category === 'bed' && <polygon points={poly(rectCorners(add(it.pos, mul(front, -0.85)), it.w - 80, 260, it.rot))} fill="#fff" fillOpacity={0.7} stroke={stroke} strokeWidth={0.6} vectorEffect="non-scaling-stroke" />}
      {Math.min(it.w, it.d) > 380 && ci.category !== 'curtain' && <Txt at={it.pos} size={Math.min(110, Math.min(it.w, it.d) / 4) * ts} fill={opts.print ? '#333' : 'var(--ink)'} rot={it.w < it.d ? (((it.rot % 180) + 180) % 180 === 90 ? 0 : 90) : (((it.rot % 180) + 180) % 180 === 90 ? 90 : 0)}>{shortName(ci.name)}</Txt>}
    </g>
  );
}

function DimLine({ a, b, text, ts = 1, id, sel, off = 0 }: { a: Vec2; b: Vec2; text: string; ts?: number; id?: string; sel?: boolean; off?: number }) {
  const d = norm(sub(b, a)), n = perp(d);
  const A = add(a, mul(n, off)), B = add(b, mul(n, off));
  const ang = (Math.atan2(d.y, d.x) * 180) / Math.PI;
  const rot = ang > 90 || ang < -90 ? ang + 180 : ang;
  const col = sel ? '#2f9e88' : '#3a64a8';
  return (
    <g data-kind={id ? 'annotation' : undefined} data-id={id} stroke={col} strokeWidth={1} fill={col}>
      <line x1={A.x} y1={A.y} x2={B.x} y2={B.y} vectorEffect="non-scaling-stroke" />
      {[A, B].map((p, i) => <line key={i} x1={add(p, mul(add(d, n), 60)).x} y1={add(p, mul(add(d, n), 60)).y} x2={add(p, mul(add(d, n), -60)).x} y2={add(p, mul(add(d, n), -60)).y} vectorEffect="non-scaling-stroke" />)}
      {off !== 0 && [[a, A], [b, B]].map(([p, q], i) => <line key={'e' + i} x1={p.x} y1={p.y} x2={q.x} y2={q.y} strokeWidth={0.5} vectorEffect="non-scaling-stroke" />)}
      <Txt at={add(mul(add(A, B), 0.5), mul(n, 110 * ts))} size={100 * ts} fill={col} rot={rot}>{text}</Txt>
    </g>
  );
}

/** EXP-03: automatic overall dimension strings on all four sides, chained at wall/room breaks. */
function OverallDims({ f, ts, units }: { f: Floor; ts: number; units: DisplayUnits }) {
  const b = bbox([...f.walls.flatMap((w) => { const d = norm(sub(w.b, w.a)), n = perp(d); return [add(w.a, mul(n, w.thickness / 2)), add(w.b, mul(n, -w.thickness / 2)), add(w.a, mul(n, -w.thickness / 2)), add(w.b, mul(n, w.thickness / 2))]; })]);
  if (!isFinite(b.minX)) return null;
  const xs = [...new Set(f.walls.filter((w) => Math.abs(w.a.x - w.b.x) < 1).map((w) => Math.round(w.a.x)))].sort((p, q) => p - q);
  const ys = [...new Set(f.walls.filter((w) => Math.abs(w.a.y - w.b.y) < 1).map((w) => Math.round(w.a.y)))].sort((p, q) => p - q);
  const out: React.ReactNode[] = [];
  out.push(<DimLine key="ox" a={{ x: b.minX, y: b.minY }} b={{ x: b.maxX, y: b.minY }} text={fmtLen(b.maxX - b.minX, units)} ts={ts} off={-900} />);
  out.push(<DimLine key="oy" a={{ x: b.minX, y: b.maxY }} b={{ x: b.minX, y: b.minY }} text={fmtLen(b.maxY - b.minY, units)} ts={ts} off={-900} />);
  for (let i = 0; i + 1 < xs.length; i++) out.push(<DimLine key={'cx' + i} a={{ x: xs[i], y: b.minY }} b={{ x: xs[i + 1], y: b.minY }} text={fmtLen(xs[i + 1] - xs[i], units)} ts={ts * 0.85} off={-500} />);
  for (let i = 0; i + 1 < ys.length; i++) out.push(<DimLine key={'cy' + i} a={{ x: b.minX, y: ys[i + 1] }} b={{ x: b.minX, y: ys[i] }} text={fmtLen(ys[i + 1] - ys[i], units)} ts={ts * 0.85} off={-500} />);
  return <g>{out}</g>;
}

function VastuGrid({ f }: { f: Floor }) {
  const c = planCentre(f);
  const b = planBounds(f, 0);
  const R = Math.hypot(b.maxX - b.minX, b.maxY - b.minY) / 2;
  return (
    <g style={{ pointerEvents: 'none' }}>
      {ZONES.map((z, i) => { const e = rayAt(f, c, i * 22.5 + 11.25, R); const lp = rayAt(f, c, i * 22.5, R * 0.62); return <g key={z}><line x1={c.x} y1={c.y} x2={e.x} y2={e.y} stroke="#b7791f" strokeDasharray="80 60" strokeWidth={0.8} vectorEffect="non-scaling-stroke" /><Txt at={lp} size={150} fill="#b7791f" weight={700}>{z}</Txt></g>; })}
      <circle cx={c.x} cy={c.y} r={120} fill="none" stroke="#b7791f" vectorEffect="non-scaling-stroke" />
    </g>
  );
}

export function NorthArrow({ at, size, northDeg }: { at: Vec2; size: number; northDeg: number }) {
  return (
    <g transform={`translate(${at.x} ${at.y}) rotate(${northDeg - 90})`}>
      <circle r={size} fill="none" stroke="#333" strokeWidth={1} vectorEffect="non-scaling-stroke" />
      <path d={`M 0 ${size * 0.9} L ${size * 0.35} ${-size * 0.6} L 0 ${-size * 0.3} L ${-size * 0.35} ${-size * 0.6} Z`} fill="#333" />
      <Txt at={{ x: 0, y: size * 1.35 }} size={size * 0.55} weight={700} fill="#333">N</Txt>
    </g>
  );
}

// ---------------------------------------------------------------------------

export interface PlanViewProps {
  floor: Floor;
  cat: Catalog;
  opts: PlanOpts;
  underlay?: Underlay;
  tool?: Tool;
  onSelect?: (s: Sel | null) => void;
  onMove?: (kind: 'item' | 'point' | 'snag' | 'comment', id: string, pos: Vec2) => void;
  onToolClick?: (p: Vec2) => void;
  onTwoPoint?: (a: Vec2, b: Vec2) => void;
  readOnly?: boolean;
  fitKey?: string;
  children?: React.ReactNode;
}

function snapToWalls(f: Floor, p: Vec2, tol = 150): Vec2 {
  let best = p, bd = tol;
  for (const r of f.rooms) for (let i = 0; i < r.polygon.length; i++) {
    const a = r.polygon[i], b = r.polygon[(i + 1) % r.polygon.length];
    const d = norm(sub(b, a));
    const t = Math.max(0, Math.min(dist(a, b), dot(sub(p, a), d)));
    const q = add(a, mul(d, t));
    const dd = dist(p, q);
    if (dd < bd) { bd = dd; best = add(q, mul(perp(d), 20)); }
  }
  return best;
}

export function PlanView({ floor, cat, opts, underlay, tool = 'select', onSelect, onMove, onToolClick, onTwoPoint, readOnly, fitKey, children }: PlanViewProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const gRef = useRef<SVGGElement>(null);
  const fit = () => { const b = planBounds(floor); return { x: b.minX, y: -b.maxY, w: b.maxX - b.minX, h: b.maxY - b.minY }; };
  const [vb, setVb] = useState(fit);
  useEffect(() => setVb(fit()), [floor.id, fitKey]);
  const [drag, setDrag] = useState<{ kind: 'item' | 'point' | 'snag' | 'comment'; id: string; start: Vec2; orig: Vec2; pos: Vec2 } | null>(null);
  const [pan, setPan] = useState<{ sx: number; sy: number; vb: typeof vb } | null>(null);
  const [first, setFirst] = useState<Vec2 | null>(null);
  const [hover, setHover] = useState<Vec2 | null>(null);
  useEffect(() => { setFirst(null); }, [tool]);

  const toPlan = (cx: number, cy: number): Vec2 => {
    const svg = svgRef.current!, g = gRef.current!;
    const pt = svg.createSVGPoint(); pt.x = cx; pt.y = cy;
    const m = g.getScreenCTM();
    if (!m) return { x: 0, y: 0 };
    const r = pt.matrixTransform(m.inverse());
    return { x: r.x, y: r.y };
  };
  const snap = (p: Vec2, step = 10): Vec2 => {
    // snap to wall endpoints first (wall tool), then grid
    for (const w of floor.walls) for (const e of [w.a, w.b]) if (dist(e, p) < 150) return e;
    return { x: Math.round(p.x / step) * step, y: Math.round(p.y / step) * step };
  };

  const onWheel = (e: React.WheelEvent) => {
    const svg = svgRef.current!;
    const rect = svg.getBoundingClientRect();
    const k = Math.exp(e.deltaY * 0.0015);
    const mx = vb.x + ((e.clientX - rect.left) / rect.width) * vb.w;
    const my = vb.y + ((e.clientY - rect.top) / rect.height) * vb.h;
    const w = Math.max(600, Math.min(200000, vb.w * k)), h = vb.h * (w / vb.w);
    setVb({ x: mx - ((mx - vb.x) * w) / vb.w, y: my - ((my - vb.y) * h) / vb.h, w, h });
  };

  const view = useMemo(() => {
    if (!drag) return floor;
    if (drag.kind === 'item') return { ...floor, items: floor.items.map((i) => (i.id === drag.id ? { ...i, pos: drag.pos } : i)) };
    if (drag.kind === 'point') return { ...floor, points: floor.points.map((p) => (p.id === drag.id ? { ...p, pos: drag.pos } : p)) };
    return floor;
  }, [floor, drag]);
  const viewOpts = useMemo(() => {
    if (!drag || (drag.kind !== 'snag' && drag.kind !== 'comment')) return opts;
    return { ...opts, snags: opts.snags?.map((s) => (s.id === drag.id ? { ...s, pos: drag.pos } : s)), comments: opts.comments?.map((c) => (c.id === drag.id ? { ...c, pos: drag.pos } : c)) };
  }, [opts, drag]);

  const down = (e: React.PointerEvent) => {
    const p = toPlan(e.clientX, e.clientY);
    if (e.button === 1 || e.button === 2 || (e.button === 0 && e.altKey)) { setPan({ sx: e.clientX, sy: e.clientY, vb }); (e.target as Element).setPointerCapture?.(e.pointerId); return; }
    if (tool === 'wall' || tool === 'measure' || tool === 'calibrate') {
      const q = tool === 'wall' ? snap(p, 50) : snap(p, 5);
      if (!first) setFirst(q);
      else { let b = q; if (tool === 'wall' && !e.shiftKey) { b = Math.abs(q.x - first.x) > Math.abs(q.y - first.y) ? { x: q.x, y: first.y } : { x: first.x, y: q.y }; } onTwoPoint?.(first, b); setFirst(null); }
      return;
    }
    if (tool !== 'select') { onToolClick?.(tool.startsWith('point:') ? snapToWalls(floor, p) : p); return; }
    const hit = (e.target as Element).closest('[data-id]') as SVGElement | null;
    if (hit) {
      const kind = hit.dataset.kind as Sel['kind'];
      const id = hit.dataset.id!;
      onSelect?.({ kind, id });
      if (!readOnly && (kind === 'item' || kind === 'point' || kind === 'snag' || kind === 'comment')) {
        const src = kind === 'item' ? floor.items.find((i) => i.id === id) : kind === 'point' ? floor.points.find((x) => x.id === id) : kind === 'snag' ? opts.snags?.find((s) => s.id === id) : opts.comments?.find((c) => c.id === id);
        const orig = src && 'pos' in src ? src.pos : p;
        setDrag({ kind, id, start: p, orig, pos: orig });
        (e.target as Element).setPointerCapture?.(e.pointerId);
      }
    } else {
      onSelect?.(null);
      setPan({ sx: e.clientX, sy: e.clientY, vb });
      (e.target as Element).setPointerCapture?.(e.pointerId);
    }
  };
  const move = (e: React.PointerEvent) => {
    const p = toPlan(e.clientX, e.clientY);
    setHover(p);
    if (pan) {
      const rect = svgRef.current!.getBoundingClientRect();
      setVb({ ...pan.vb, x: pan.vb.x - ((e.clientX - pan.sx) / rect.width) * pan.vb.w, y: pan.vb.y - ((e.clientY - pan.sy) / rect.height) * pan.vb.h });
      return;
    }
    if (drag) {
      let pos = add(drag.orig, sub(p, drag.start));
      pos = { x: Math.round(pos.x / 10) * 10, y: Math.round(pos.y / 10) * 10 };
      if (drag.kind === 'item' && !e.shiftKey) {
        const it = floor.items.find((i) => i.id === drag.id)!;
        // snap the item's back to the nearest wall face it is parallel to (EDT-04)
        const room = floor.rooms.find((r) => r.id === it.roomId) ?? floor.rooms.find((r) => pointInPolygonTol(pos, r.polygon, 0));
        if (room) {
          const back = { x: Math.sin((it.rot * Math.PI) / 180), y: -Math.cos((it.rot * Math.PI) / 180) };
          for (const ed of roomEdges(floor, room)) {
            if (dot(ed.n, back) > -0.95) continue;
            const bp = add(pos, mul(back, it.d / 2));
            const off = dot(sub(bp, ed.a), ed.n);
            if (Math.abs(off) < 150) { pos = add(pos, mul(ed.n, -off + 2)); break; }
          }
        }
      }
      if (drag.kind === 'point' && !e.shiftKey) {
        const pt = floor.points.find((x) => x.id === drag.id);
        if (pt && !['light', 'cove', 'fan', 'floor-trap'].includes(pt.kind)) pos = snapToWalls(floor, pos);
      }
      setDrag({ ...drag, pos });
    }
  };
  const up = () => {
    if (drag && dist(drag.pos, drag.orig) > 1) onMove?.(drag.kind, drag.id, drag.pos);
    setDrag(null);
    setPan(null);
  };

  // live distances while dragging an item (EDT-11)
  let live: React.ReactNode = null;
  if (drag?.kind === 'item') {
    const it = view.items.find((i) => i.id === drag.id)!;
    const room = floor.rooms.find((r) => pointInPolygonTol(it.pos, r.polygon, 0));
    if (room && Math.abs(Math.round(it.rot / 90) * 90 - it.rot) < 0.5) {
      const rotd = ((Math.round(it.rot / 90) % 2) + 2) % 2;
      const hw = rotd ? it.d / 2 : it.w / 2, hh = rotd ? it.w / 2 : it.d / 2;
      const cd = clearDistances(room.polygon, it.pos);
      const segs: [Vec2, Vec2, number][] = [
        [{ x: it.pos.x - hw, y: it.pos.y }, { x: it.pos.x - cd.left, y: it.pos.y }, cd.left - hw],
        [{ x: it.pos.x + hw, y: it.pos.y }, { x: it.pos.x + cd.right, y: it.pos.y }, cd.right - hw],
        [{ x: it.pos.x, y: it.pos.y + hh }, { x: it.pos.x, y: it.pos.y + cd.up }, cd.up - hh],
        [{ x: it.pos.x, y: it.pos.y - hh }, { x: it.pos.x, y: it.pos.y - cd.down }, cd.down - hh],
      ];
      live = <g>{segs.filter((s) => isFinite(s[2]) && s[2] > 0).map(([a, b, d], i) => <DimLine key={i} a={a} b={b} text={fmtLen(d, opts.units ?? 'mm')} />)}</g>;
    }
  }
  const scale = vb.w / Math.max(1, svgRef.current?.clientWidth ?? 1000);
  return (
    <svg ref={svgRef} className="plan" viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} onWheel={onWheel} onPointerDown={down} onPointerMove={move} onPointerUp={up} onContextMenu={(e) => e.preventDefault()} style={{ cursor: pan ? 'grabbing' : tool === 'select' ? 'default' : 'crosshair', color: 'var(--ink)' }}>
      <g ref={gRef} transform="scale(1 -1)">
        <PlanContent floor={view} cat={cat} opts={{ ...viewOpts, textScale: Math.max(0.6, Math.min(2.2, scale * 0.9)) * (opts.textScale ?? 1) }} underlay={underlay} />
        {live}
        {first && hover && <g><line x1={first.x} y1={first.y} x2={hover.x} y2={hover.y} stroke="#2f9e88" strokeWidth={2} strokeDasharray="8 6" vectorEffect="non-scaling-stroke" /><Txt at={mul(add(first, hover), 0.5)} size={130 * Math.max(0.6, scale)} fill="#2f9e88" weight={700}>{fmtLen(dist(first, hover), opts.units ?? 'mm')}</Txt></g>}
        {children}
      </g>
    </svg>
  );
}

export { Txt, DimLine };
