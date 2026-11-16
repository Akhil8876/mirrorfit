import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import type { Floor, Project, Revision, Room, Trade } from '../core/types';
import type { Catalog } from '../core/catalog';
import { POINTS, itemById, materialById } from '../core/catalog';
import { roomEdges, finishedCeiling, type RoomEdge } from '../core/measure';
import { footprint } from '../core/rules';
import { dot, sub, add, mul } from '../core/geom';
import type { Schedule } from '../core/schedules';
import type { JoineryUnit, Board } from '../core/joinery';
import { moduleWidths, shutterCount } from '../core/joinery';
import { PlanContent, planBounds, NorthArrow, type PlanOpts, TRADE_COLORS } from './Plan';

export const STD_SCALES = [20, 25, 50, 75, 100, 125, 150, 200, 250, 300];
export const pickScale = (worldW: number, worldH: number, paperW: number, paperH: number) => STD_SCALES.find((s) => worldW / s <= paperW && worldH / s <= paperH) ?? 500;

const HI: Record<string, string> = {
  'Furniture layout': 'फर्नीचर लेआउट', 'Electrical layout': 'विद्युत लेआउट', 'Plumbing layout': 'प्लंबिंग लेआउट', 'Reflected ceiling plan': 'छत योजना (RCP)', 'Flooring layout': 'फ़र्श लेआउट',
  'Demolition plan': 'तोड़फोड़ योजना', 'New construction plan': 'नई दीवार योजना', 'Cut list': 'कटिंग सूची', 'Hardware list': 'हार्डवेयर सूची', 'Joinery elevations': 'फर्नीचर एलिवेशन',
  'Wall elevations': 'दीवार एलिवेशन', 'Finish schedule': 'फिनिश सूची', 'HVAC layout': 'एसी लेआउट', 'Sections': 'सेक्शन',
};

export interface SheetMeta { project: Project; no: string; title: string; trade: Trade | 'all' | 'client' | 'handover'; revisions: Revision[]; ifc: boolean; scale?: string; legend?: { sym: string; label: string; color: string }[]; north?: number; qr?: string; lang?: 'en' | 'hi' }

export function useQr(text: string) {
  const [url, setUrl] = useState<string>('');
  useEffect(() => { QRCode.toDataURL(text, { margin: 0, width: 160 }).then(setUrl).catch(() => setUrl('')); }, [text]);
  return url;
}

/** A3 landscape frame with title block (EXP-02), revision table + IFC stamp (EXP-04) and QR (EXP-23). */
export function Sheet({ meta, children, html }: { meta: SheetMeta; children?: React.ReactNode; html?: React.ReactNode }) {
  const p = meta.project;
  const latest = meta.revisions[meta.revisions.length - 1];
  const title = meta.lang === 'hi' && HI[meta.title] ? `${meta.title} / ${HI[meta.title]}` : meta.title;
  return (
    <div className="sheet">
      <svg viewBox="0 0 420 297" style={{ position: 'absolute', inset: 0 }} fontFamily="Inter, Arial, sans-serif">
        <rect x={5} y={5} width={410} height={287} fill="none" stroke="#111" strokeWidth={0.5} />
        <rect x={322} y={5} width={93} height={287} fill="none" stroke="#111" strokeWidth={0.35} />
        {/* firm */}
        {p.settings.firmLogo ? <image href={p.settings.firmLogo} x={326} y={9} width={30} height={14} preserveAspectRatio="xMinYMid meet" /> : null}
        <text x={p.settings.firmLogo ? 358 : 326} y={18} fontSize={5} fontWeight={700}>{p.settings.firmName}</text>
        <line x1={322} y1={27} x2={415} y2={27} stroke="#111" strokeWidth={0.3} />
        <text x={326} y={33} fontSize={2.6} fill="#555">PROJECT</text>
        <text x={326} y={38} fontSize={3.6} fontWeight={600}>{p.name.slice(0, 36)}</text>
        <text x={326} y={43} fontSize={2.8}>{(p.client.name || '').slice(0, 40)}</text>
        <text x={326} y={47} fontSize={2.6} fill="#555">{(p.address || '').slice(0, 48)}</text>
        {/* legend */}
        {meta.legend && meta.legend.length > 0 && <g>
          <text x={326} y={56} fontSize={2.6} fill="#555">LEGEND</text>
          {meta.legend.slice(0, 18).map((l, i) => <g key={i} transform={`translate(${326 + (i % 2) * 45} ${60 + Math.floor(i / 2) * 5.2})`}><rect width={5.5} height={3.6} rx={0.6} fill="#fff" stroke={l.color} strokeWidth={0.35} /><text x={2.75} y={2.7} fontSize={2} textAnchor="middle" fill={l.color} fontWeight={700}>{l.sym}</text><text x={7.5} y={2.8} fontSize={2.3}>{l.label.slice(0, 24)}</text></g>)}
        </g>}
        {/* north */}
        {meta.north !== undefined && <g transform="translate(400 66) scale(1 -1)"><NorthArrow at={{ x: 0, y: 0 }} size={6} northDeg={meta.north} /></g>}
        {/* revision table */}
        <g transform="translate(322 178)">
          <line x1={0} y1={0} x2={93} y2={0} stroke="#111" strokeWidth={0.3} />
          <text x={4} y={5} fontSize={2.6} fill="#555">REV</text><text x={14} y={5} fontSize={2.6} fill="#555">DATE</text><text x={34} y={5} fontSize={2.6} fill="#555">DESCRIPTION</text><text x={80} y={5} fontSize={2.6} fill="#555">BY</text>
          {meta.revisions.slice(-5).map((r, i) => <g key={r.id} transform={`translate(0 ${10 + i * 4.4})`}><text x={4} fontSize={2.5}>R{r.no}</text><text x={14} fontSize={2.5}>{new Date(r.at).toLocaleDateString('en-IN')}</text><text x={34} fontSize={2.5}>{(r.ifc ? 'IFC – ' : 'Draft – ') + r.note.slice(0, 24)}</text><text x={80} fontSize={2.5}>{r.by.slice(0, 8)}</text></g>)}
          {!meta.revisions.length && <text x={4} y={11} fontSize={2.5} fill="#888">Not issued yet – working copy</text>}
        </g>
        {/* sheet info */}
        <line x1={322} y1={208} x2={415} y2={208} stroke="#111" strokeWidth={0.3} />
        <text x={326} y={215} fontSize={2.6} fill="#555">DRAWING</text>
        <text x={326} y={222} fontSize={4.2} fontWeight={700}>{title.slice(0, 34)}</text>
        <text x={326} y={232} fontSize={2.6} fill="#555">SHEET</text><text x={326} y={238} fontSize={4.4} fontWeight={700}>{meta.no}</text>
        <text x={352} y={232} fontSize={2.6} fill="#555">REV</text><text x={352} y={238} fontSize={4.4} fontWeight={700}>{latest ? `R${latest.no}` : '—'}</text>
        <text x={368} y={232} fontSize={2.6} fill="#555">SCALE (A3)</text><text x={368} y={238} fontSize={3.6} fontWeight={600}>{meta.scale ?? 'NTS'}</text>
        <text x={326} y={247} fontSize={2.6} fill="#555">DATE</text><text x={326} y={252} fontSize={3}>{new Date().toLocaleDateString('en-IN')}</text>
        <text x={352} y={247} fontSize={2.6} fill="#555">STANDARD</text><text x={352} y={252} fontSize={3}>{p.settings.drawingStandard} symbols · mm</text>
        {meta.qr && <image href={meta.qr} x={392} y={240} width={20} height={20} />}
        <text x={326} y={262} fontSize={2.3} fill="#555">All dimensions in mm; verify on site before fabrication.</text>
        <text x={326} y={266} fontSize={2.3} fill="#555">Heights from finished floor level (FFL).</text>
        {meta.ifc && latest?.ifc ? <g transform="translate(326 271)"><rect width={86} height={15} fill="none" stroke="#1d7a3c" strokeWidth={0.9} /><text x={43} y={10} fontSize={5} fill="#1d7a3c" fontWeight={800} textAnchor="middle">ISSUED FOR CONSTRUCTION</text></g>
          : <g transform="translate(326 271)"><rect width={86} height={15} fill="none" stroke="#b4412f" strokeWidth={0.6} strokeDasharray="2 1" /><text x={43} y={10} fontSize={4.2} fill="#b4412f" fontWeight={700} textAnchor="middle">NOT FOR CONSTRUCTION</text></g>}
        {children && <svg x={10} y={10} width={308} height={277}>{children}</svg>}
      </svg>
      {html && <div className="sheet-html">{html}</div>}
    </div>
  );
}

/** A plan drawn to a standard scale inside the sheet's drawing area. */
export function PlanDrawing({ floor, cat, opts, meta }: { floor: Floor; cat: Catalog; opts: PlanOpts; meta: SheetMeta }) {
  const b = planBounds(floor, 1400);
  const W = b.maxX - b.minX, H = b.maxY - b.minY;
  const s = pickScale(W, H, 308, 277);
  meta.scale = `1:${s}`;
  // centre the plan in the 308 × 277 mm drawing area at true scale
  const vw = 308 * s, vh = 277 * s;
  const x0 = b.minX - (vw - W) / 2, y0 = -b.maxY - (vh - H) / 2;
  return (
    <svg viewBox={`${x0} ${y0} ${vw} ${vh}`} width="100%" height="100%" style={{ color: '#111' }}>
      <g transform="scale(1 -1)"><PlanContent floor={floor} cat={cat} opts={{ ...opts, print: true, textScale: Math.max(0.8, s / 60) }} /></g>
    </svg>
  );
}

export function SheetWithPlan(props: { meta: SheetMeta; floor: Floor; cat: Catalog; opts: PlanOpts; note?: React.ReactNode }) {
  const b = planBounds(props.floor, 1400);
  const s = pickScale(b.maxX - b.minX, b.maxY - b.minY, 308, 277);
  const meta = { ...props.meta, scale: `1:${s}` };
  return <Sheet meta={meta}><PlanDrawing floor={props.floor} cat={props.cat} opts={props.opts} meta={meta} />{props.note}</Sheet>;
}

// ---------------------------------------------------------------------------
// Elevations (EXP-31): dimensioned wall elevations with mounting heights.

function onEdge(e: RoomEdge, p: { x: number; y: number }, tol: number) {
  const s = dot(sub(p, e.a), e.dir);
  const off = dot(sub(p, e.a), e.n);
  return s > -50 && s < e.len + 50 && off >= -50 && off < tol ? s : null;
}

export function WallElevation({ floor, room, edge, cat, x, y, w, h, label }: { floor: Floor; room: Room; edge: RoomEdge; cat: Catalog; x: number; y: number; w: number; h: number; label: string }) {
  const H = finishedCeiling(room);
  const k = Math.min(w / edge.len, (h - 12) / H);
  const X = (s: number) => x + (edge.len - s) * k; // seen from inside the room
  const Y = (z: number) => y + h - 8 - z * k;
  const items = floor.items.filter((i) => i.roomId === room.id).map((it) => {
    const back = add(it.pos, mul({ x: Math.sin((it.rot * Math.PI) / 180), y: -Math.cos((it.rot * Math.PI) / 180) }, it.d / 2));
    const facing = dot({ x: -Math.sin((it.rot * Math.PI) / 180), y: Math.cos((it.rot * Math.PI) / 180) }, edge.n) > 0.95;
    const s = facing ? onEdge(edge, back, 120) : null;
    return s === null ? null : { it, s };
  }).filter(Boolean) as { it: typeof floor.items[number]; s: number }[];
  const pts = floor.points.filter((p) => p.roomId === room.id && !['light', 'cove', 'fan', 'floor-trap'].includes(p.kind)).map((p) => ({ p, s: onEdge(edge, p.pos, 120) })).filter((x) => x.s !== null) as { p: typeof floor.points[number]; s: number }[];
  const fs = 2.1;
  return (
    <g fontFamily="Inter, Arial, sans-serif">
      <rect x={X(edge.len)} y={Y(H)} width={edge.len * k} height={H * k} fill="#fafafa" stroke="#111" strokeWidth={0.35} />
      {edge.openings.map((o) => <rect key={o.id} x={X(o.e)} y={Y(Math.min(H, o.sill + o.height))} width={(o.e - o.s) * k} height={(Math.min(H, o.sill + o.height) - o.sill) * k} fill={o.kind === 'window' ? '#e6f1f6' : '#fff'} stroke="#333" strokeWidth={0.3} />)}
      {items.map(({ it, s }) => {
        const ci = itemById(cat, it.catalogId);
        const fin = materialById(cat, it.finish);
        const x0 = X(s + it.w / 2), wpx = it.w * k;
        const cat_ = ci?.category ?? '';
        const mods = ci?.joinery ? moduleWidths(it, cat_) : [];
        const nSh = ci?.joinery ? shutterCount(it, cat_) : 0;
        return (
          <g key={it.id}>
            <rect x={x0} y={Y(it.elev + it.h)} width={wpx} height={it.h * k} fill={ci?.joinery ? '#f3ebdd' : '#f1f1ef'} stroke="#222" strokeWidth={0.3} />
            {ci?.joinery && Array.from({ length: Math.max(0, nSh - 1) }, (_, i) => <line key={i} x1={x0 + (wpx / nSh) * (i + 1)} y1={Y(it.elev + it.h)} x2={x0 + (wpx / nSh) * (i + 1)} y2={Y(it.elev)} stroke="#666" strokeWidth={0.2} />)}
            {ci?.joinery && mods.length > 1 && null}
            <text x={x0 + wpx / 2} y={Y(it.elev + it.h / 2)} fontSize={fs} textAnchor="middle">{ci?.name.split('–')[0].slice(0, 22)}</text>
            {fin && <text x={x0 + wpx / 2} y={Y(it.elev + it.h / 2) + 2.6} fontSize={fs * 0.85} textAnchor="middle" fill="#555">{fin.code}</text>}
            <text x={x0 + wpx / 2} y={Y(it.elev + it.h) - 0.8} fontSize={fs * 0.85} textAnchor="middle" fill="#3a64a8">{Math.round(it.w)} × {Math.round(it.h)}{it.elev ? ` @ ${Math.round(it.elev)}` : ''}</text>
          </g>
        );
      })}
      {pts.map(({ p, s }) => (
        <g key={p.id}>
          <rect x={X(s) - 1.6} y={Y(p.height) - 1.2} width={3.2} height={2.4} fill="#fff" stroke={POINTS[p.kind].color} strokeWidth={0.3} />
          <text x={X(s)} y={Y(p.height) + 0.6} fontSize={1.3} textAnchor="middle" fill={POINTS[p.kind].color} fontWeight={700}>{POINTS[p.kind].symbol}</text>
          <line x1={X(s) + 2.2} y1={Y(p.height)} x2={X(s) + 2.2} y2={Y(0)} stroke="#c0392b" strokeWidth={0.15} strokeDasharray="0.6 0.6" />
          <text x={X(s) + 2.8} y={Y(p.height / 2)} fontSize={1.6} fill="#c0392b" transform={`rotate(-90 ${X(s) + 2.8} ${Y(p.height / 2)})`} textAnchor="middle">{Math.round(p.height)}</text>
        </g>
      ))}
      {/* dims */}
      <line x1={X(edge.len)} y1={Y(0) + 4} x2={X(0)} y2={Y(0) + 4} stroke="#3a64a8" strokeWidth={0.25} />
      <text x={(X(edge.len) + X(0)) / 2} y={Y(0) + 7} fontSize={2.3} textAnchor="middle" fill="#3a64a8">{Math.round(edge.len)}</text>
      <line x1={X(edge.len) - 3} y1={Y(0)} x2={X(edge.len) - 3} y2={Y(H)} stroke="#3a64a8" strokeWidth={0.25} />
      <text x={X(edge.len) - 4} y={(Y(0) + Y(H)) / 2} fontSize={2.3} textAnchor="middle" fill="#3a64a8" transform={`rotate(-90 ${X(edge.len) - 4} ${(Y(0) + Y(H)) / 2})`}>{Math.round(H)}</text>
      <line x1={X(edge.len) - 6} y1={Y(0)} x2={X(0) + 4} y2={Y(0)} stroke="#111" strokeWidth={0.5} />
      <text x={X(edge.len)} y={y + 3} fontSize={2.8} fontWeight={700}>{label}</text>
    </g>
  );
}

export function ElevationsSheet({ meta, floor, room, cat, filter }: { meta: SheetMeta; floor: Floor; room: Room; cat: Catalog; filter?: (e: RoomEdge) => boolean }) {
  const edges = roomEdges(floor, room).filter((e) => e.len > 400).filter(filter ?? (() => true)).slice(0, 4);
  const cells = edges.length <= 2 ? [[0, 0, 308, 138], [0, 139, 308, 138]] : [[0, 0, 153, 138], [155, 0, 153, 138], [0, 139, 153, 138], [155, 139, 153, 138]];
  return (
    <Sheet meta={{ ...meta, scale: 'As shown' }}>
      {edges.map((e, i) => <WallElevation key={e.i} floor={floor} room={room} edge={e} cat={cat} x={cells[i][0] + 6} y={cells[i][1] + 4} w={cells[i][2] - 12} h={cells[i][3] - 8} label={`${room.name} – wall ${e.i + 1}`} />)}
    </Sheet>
  );
}

/** EXP-31: generic cut sections through ceiling and floor build-ups for each room. */
export function SectionsSheet({ meta, floor }: { meta: SheetMeta; floor: Floor }) {
  const rooms = floor.rooms.filter((r) => r.type !== 'shaft').slice(0, 6);
  return (
    <Sheet meta={{ ...meta, scale: 'NTS (diagrammatic)' }}>
      {rooms.map((r, i) => {
        const cx = (i % 3) * 103 + 4, cy = Math.floor(i / 3) * 138 + 4;
        const k = 0.03;
        const H = r.ceilingHeight;
        const Y = (z: number) => cy + 118 - z * k;
        const wet = ['toilet', 'balcony', 'utility'].includes(r.type);
        return (
          <g key={r.id} fontFamily="Inter, Arial, sans-serif">
            <text x={cx} y={cy + 4} fontSize={3} fontWeight={700}>{r.name}</text>
            <rect x={cx + 6} y={Y(H + 150)} width={58} height={150 * k} fill="#cfcac0" stroke="#111" strokeWidth={0.3} />
            <text x={cx + 66} y={Y(H + 75)} fontSize={1.7}>RCC slab 150</text>
            {r.falseCeiling.enabled && <>
              <line x1={cx + 6} y1={Y(H - r.falseCeiling.drop)} x2={cx + 64} y2={Y(H - r.falseCeiling.drop)} stroke="#111" strokeWidth={0.6} />
              {[20, 40, 60].map((d) => <line key={d} x1={cx + 6 + d} y1={Y(H)} x2={cx + 6 + d} y2={Y(H - r.falseCeiling.drop)} stroke="#777" strokeWidth={0.2} />)}
              <text x={cx + 66} y={Y(H - r.falseCeiling.drop)} fontSize={1.7}>12.5 gypsum on GI frame</text>
              {r.falseCeiling.cove && <path d={`M ${cx + 6} ${Y(H - r.falseCeiling.drop)} h 6 v -${150 * k} h 3`} fill="none" stroke="#e0a800" strokeWidth={0.5} />}
              <text x={cx + 66} y={Y(H - r.falseCeiling.drop) + 3} fontSize={1.7} fill="#3a64a8">FC +{H - r.falseCeiling.drop}</text>
            </>}
            <rect x={cx + 6} y={Y(0)} width={58} height={10 * k * 3} fill="#e8e3d8" stroke="#111" strokeWidth={0.3} />
            <rect x={cx + 6} y={Y(0) + 0.9} width={58} height={50 * k} fill="#d6d0c4" stroke="#111" strokeWidth={0.2} />
            {wet && <line x1={cx + 6} y1={Y(0) + 0.9 + 50 * k} x2={cx + 64} y2={Y(0) + 0.9 + 50 * k} stroke="#1f6fb5" strokeWidth={0.6} />}
            <text x={cx + 66} y={Y(0) + 1} fontSize={1.7}>Finish 10 + bed 40 + screed 50</text>
            {wet && <text x={cx + 66} y={Y(0) + 4} fontSize={1.7} fill="#1f6fb5">Waterproofing, 300 upturn</text>}{wet && <text x={cx + 66} y={Y(0) + 7} fontSize={1.7} fill="#1f6fb5">1:100 fall to trap</text>}
            <line x1={cx + 3} y1={Y(0)} x2={cx + 3} y2={Y(H)} stroke="#3a64a8" strokeWidth={0.25} />
            <text x={cx + 2} y={Y(H / 2)} fontSize={2} fill="#3a64a8" textAnchor="middle" transform={`rotate(-90 ${cx + 2} ${Y(H / 2)})`}>FFL to slab {H}</text>
          </g>
        );
      })}
    </Sheet>
  );
}

export function JoineryElevations({ meta, units, cat }: { meta: SheetMeta; units: JoineryUnit[]; cat: Catalog }) {
  return (
    <Sheet meta={{ ...meta, scale: 'As shown' }}>
      {units.slice(0, 6).map((u, i) => {
        const cx = (i % 3) * 103 + 4, cy = Math.floor(i / 3) * 138 + 6;
        const it = u.item;
        const k = Math.min(90 / it.w, 100 / it.h);
        const ci = itemById(cat, it.catalogId);
        const nSh = shutterCount(it, ci?.category ?? '');
        const mods = moduleWidths(it, ci?.category ?? '');
        const shelves = u.panels.find((p) => p.name === 'Shelf')?.qty ?? 0;
        const W = it.w * k, H = it.h * k, x0 = cx + (95 - W) / 2, y0 = cy + 10;
        return (
          <g key={u.unit} fontFamily="Inter, Arial, sans-serif">
            <text x={cx} y={cy + 2} fontSize={3} fontWeight={700}>{u.unit} · {u.name.slice(0, 26)}</text>
            <text x={cx} y={cy + 6} fontSize={2} fill="#555">{u.room} · {u.finish} ({u.code})</text>
            <rect x={x0} y={y0} width={W} height={H} fill="#f3ebdd" stroke="#111" strokeWidth={0.4} />
            {mods.slice(1).map((_, m) => <line key={'m' + m} x1={x0 + (W / mods.length) * (m + 1)} y1={y0} x2={x0 + (W / mods.length) * (m + 1)} y2={y0 + H} stroke="#999" strokeWidth={0.2} strokeDasharray="1 0.8" />)}
            {Array.from({ length: Math.max(0, Math.round(shelves / Math.max(1, mods.length))) }, (_, s) => <line key={'s' + s} x1={x0} y1={y0 + (H / (Math.round(shelves / mods.length) + 1)) * (s + 1)} x2={x0 + W} y2={y0 + (H / (Math.round(shelves / mods.length) + 1)) * (s + 1)} stroke="#bbb" strokeWidth={0.2} strokeDasharray="1 0.8" />)}
            {Array.from({ length: Math.max(0, nSh - 1) }, (_, s) => <line key={'h' + s} x1={x0 + (W / nSh) * (s + 1)} y1={y0} x2={x0 + (W / nSh) * (s + 1)} y2={y0 + H} stroke="#222" strokeWidth={0.35} />)}
            {it.joinery?.shutter === 'hinged' && Array.from({ length: nSh }, (_, s) => { const sx = x0 + (W / nSh) * s; const left = s % 2 === 0; return <path key={'sw' + s} d={`M ${left ? sx + W / nSh : sx} ${y0} L ${left ? sx : sx + W / nSh} ${y0 + H / 2} L ${left ? sx + W / nSh : sx} ${y0 + H}`} fill="none" stroke="#999" strokeWidth={0.15} />; })}
            <line x1={x0} y1={y0 + H + 4} x2={x0 + W} y2={y0 + H + 4} stroke="#3a64a8" strokeWidth={0.25} />
            <text x={x0 + W / 2} y={y0 + H + 7.5} fontSize={2.4} fill="#3a64a8" textAnchor="middle">{Math.round(it.w)}</text>
            <line x1={x0 - 4} y1={y0} x2={x0 - 4} y2={y0 + H} stroke="#3a64a8" strokeWidth={0.25} />
            <text x={x0 - 5} y={y0 + H / 2} fontSize={2.4} fill="#3a64a8" textAnchor="middle" transform={`rotate(-90 ${x0 - 5} ${y0 + H / 2})`}>{Math.round(it.h)}</text>
            <text x={cx} y={y0 + H + 12} fontSize={2} fill="#555">D {Math.round(it.d)} · {nSh} {it.joinery?.shutter ?? ''} shutter(s) · {mods.length} module(s){it.elev ? ` · mounted @ ${Math.round(it.elev)} FFL` : ''}</text>
            <text x={cx} y={y0 + H + 15} fontSize={2} fill="#555">{(it.joinery?.internal ?? []).join(', ').slice(0, 60)}</text>
          </g>
        );
      })}
    </Sheet>
  );
}

export function NestingSheet({ meta, boards, utilisation }: { meta: SheetMeta; boards: Board[]; utilisation: number }) {
  const show = boards.slice(0, 8);
  return (
    <Sheet meta={{ ...meta, scale: '1:20 (boards 2440 × 1220)' }}>
      <text x={4} y={5} fontSize={3} fontWeight={700} fontFamily="Inter, Arial">{boards.length} board(s) · utilisation {(utilisation * 100).toFixed(0)}% · grain along 2440</text>
      {show.map((b, i) => {
        const k = 145 / 2440;
        const ox = (i % 2) * 152 + 4, oy = Math.floor(i / 2) * 66 + 10;
        return (
          <g key={i} fontFamily="Inter, Arial">
            <rect x={ox} y={oy} width={2440 * k} height={1220 * k} fill="#fbf6ec" stroke="#111" strokeWidth={0.3} />
            {b.placements.map((pl) => <g key={pl.tag}><rect x={ox + pl.x * k} y={oy + pl.y * k} width={pl.l * k} height={pl.w * k} fill="#e9dcc4" stroke="#8a5a2b" strokeWidth={0.2} /><text x={ox + (pl.x + pl.l / 2) * k} y={oy + (pl.y + pl.w / 2) * k + 0.6} fontSize={Math.min(1.8, (pl.w * k) / 2.4)} textAnchor="middle">{pl.tag}</text></g>)}
            <text x={ox} y={oy + 1220 * k + 3} fontSize={2}>Board {i + 1} · {b.material} {b.t} mm · {b.placements.length} parts</text>
          </g>
        );
      })}
      {boards.length > show.length && <text x={4} y={274} fontSize={2.4}>+ {boards.length - show.length} more board(s) in the DXF nesting export</text>}
    </Sheet>
  );
}

export function ScheduleSheet({ meta, schedules, intro }: { meta: SheetMeta; schedules: Schedule[]; intro?: React.ReactNode }) {
  return (
    <Sheet meta={{ ...meta, scale: 'NTS' }} html={
      <div>
        {intro}
        {schedules.map((s) => (
          <div key={s.id} style={{ marginBottom: 8 }}>
            <h4>{s.title}</h4>
            <table className="t"><thead><tr>{s.head.map((h) => <th key={h}>{h}</th>)}</tr></thead>
              <tbody>{s.rows.slice(0, 60).map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody></table>
            {s.rows.length > 60 && <div>+ {s.rows.length - 60} more rows in the Excel export</div>}
            {s.note && <div style={{ color: '#555', marginTop: 2 }}>{s.note}</div>}
          </div>
        ))}
      </div>
    } />
  );
}

export function legendFor(kinds: string[]): SheetMeta['legend'] {
  return kinds.map((k) => { const P = POINTS[k as keyof typeof POINTS]; return { sym: P.symbol, label: P.name.split('(')[0].split('+')[0].trim(), color: P.color }; });
}

export { TRADE_COLORS, footprint };
