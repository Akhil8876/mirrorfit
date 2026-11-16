// Carpentry package: cut list (panel sizes, grain, edge banding), hardware, laminate per face,
// board estimate and simple guillotine nesting on 8×4 boards (EXP-35, 8.2 carpentry row).

import type { Item, Project, Floor } from './types';
import type { Catalog } from './catalog';
import { itemById, materialById } from './catalog';

export interface Panel {
  itemId: string;
  tag: string; // e.g. WR1-P03
  unit: string;
  name: string;
  l: number; // along grain
  w: number;
  t: number;
  qty: number;
  material: string;
  grain: 'L' | 'none';
  edge: string; // which edges are banded
  edgeLen: number; // mm of banding per piece
  faceOut: string; // laminate code, outer face
  faceIn: string; // inner face
}

export interface Hardware { itemId: string; unit: string; name: string; qty: number; spec: string }

const T = 18, BACK = 6, LINER = 'LINER-0.8';

function shelvesFor(cat: string): number {
  return ({ wardrobe: 3, 'kitchen-base': 1, 'kitchen-wall': 1, 'kitchen-tall': 4, bookshelf: 4, 'shoe-rack': 3, 'tv-unit': 1, 'tv-panel-bed': 0, dresser: 1, study: 1, pooja: 2, bar: 3, mirror: 1 } as Record<string, number>)[cat] ?? 1;
}

export function unitTag(cat: string, n: number) {
  const p = ({ wardrobe: 'WR', 'kitchen-base': 'KB', 'kitchen-wall': 'KW', 'kitchen-tall': 'KT', bookshelf: 'BS', 'shoe-rack': 'SR', 'tv-unit': 'TV', 'tv-panel-bed': 'TP', dresser: 'DR', study: 'ST', pooja: 'PJ', bar: 'BR', mirror: 'MC' } as Record<string, string>)[cat] ?? 'JN';
  return `${p}${n}`;
}

export function moduleWidths(it: Item, cat: string): number[] {
  const target = cat.startsWith('kitchen') ? 600 : cat === 'wardrobe' ? (it.joinery?.shutter === 'sliding' ? 1000 : 900) : 900;
  const n = Math.max(1, Math.round(it.w / target));
  return Array.from({ length: n }, () => it.w / n);
}

export function shutterCount(it: Item, cat: string): number {
  if (it.joinery?.shutter === 'open' || cat === 'tv-panel-bed') return 0;
  if (it.joinery?.shutter === 'sliding') return it.joinery.shutters ?? Math.max(2, Math.round(it.w / 1000));
  if (it.joinery?.shutters) return it.joinery.shutters;
  return Math.max(1, moduleWidths(it, cat).length * (cat.startsWith('kitchen') ? 1 : 2));
}

export function cutList(it: Item, unit: string, cat: Catalog): { panels: Panel[]; hardware: Hardware[] } {
  const ci = itemById(cat, it.catalogId);
  const finish = materialById(cat, it.finish);
  const out = finish?.code ?? 'LM-STD';
  const c = ci?.category ?? 'joinery';
  const W = Math.round(it.w), H = Math.round(it.h), D = Math.round(it.d);
  const mods = moduleWidths(it, c);
  const panels: Panel[] = [];
  let k = 1;
  const P = (name: string, l: number, w: number, qty: number, edge: string, edgeLen: number, t = T, faceOut = LINER, material = 'BWP ply IS 710', grain: Panel['grain'] = 'L') => {
    panels.push({ itemId: it.id, tag: `${unit}-P${String(k++).padStart(2, '0')}`, unit, name, l: Math.round(l), w: Math.round(w), t, qty, material: t === BACK ? 'BWP ply 6 mm' : material, grain, edge, edgeLen: Math.round(edgeLen), faceOut, faceIn: LINER });
  };
  const exposedEnds = c === 'kitchen-base' || c === 'kitchen-wall' ? 0 : 2;
  P('Side panel', H, D, 2, 'front edge 0.8 mm', H, T, exposedEnds ? out : LINER);
  if (mods.length > 1) P('Vertical partition', H - 2 * T, D - BACK - 20, mods.length - 1, 'front edge 0.8 mm', H - 2 * T);
  P('Top', W - 2 * T, D, 1, 'front edge 0.8 mm', W - 2 * T);
  P('Bottom', W - 2 * T, D, 1, 'front edge 0.8 mm', W - 2 * T);
  const sh = shelvesFor(c);
  if (sh) P('Shelf', mods[0] - T, D - BACK - 30, sh * mods.length, 'front edge 0.8 mm', mods[0] - T);
  // back: split into pieces that fit a 2440 board
  const backPieces = Math.max(1, Math.ceil(Math.max(W, H) / 2400));
  P('Back panel', H > W ? H / backPieces : H, H > W ? W : W / backPieces, backPieces, '—', 0, BACK, LINER, 'BWP ply 6 mm', 'L');
  const nSh = shutterCount(it, c);
  const hardware: Hardware[] = [];
  const HW = (name: string, qty: number, spec: string) => { if (qty > 0) hardware.push({ itemId: it.id, unit, name, qty, spec }); };
  if (nSh) {
    if (it.joinery?.shutter === 'sliding') {
      const sw = W / nSh + 50;
      P('Sliding shutter', H - 60, sw, nSh, 'all 4 edges 2 mm', 2 * (H - 60 + sw), T, out, 'BWP ply IS 710', 'L');
      HW('Sliding track set (top + bottom)', 1, `${W} mm aluminium, soft-close`);
      HW('Sliding roller set', nSh, 'Top-hung, 60 kg rated');
      HW('Soft-close damper', nSh, 'Two-way');
    } else {
      const sw = W / nSh - 3;
      const sH = H - 3;
      P('Shutter', sH, sw, nSh, 'all 4 edges 2 mm', 2 * (sH + sw), T, out, 'BWP ply IS 710', 'L');
      const hingesPer = sH <= 900 ? 2 : sH <= 1500 ? 3 : sH <= 2100 ? 4 : 5;
      HW('Soft-close clip-on hinge 110°', nSh * hingesPer, `${hingesPer} per shutter (${sH} mm high)`);
      HW(/handle-less|minimal/i.test(it.joinery?.handle ?? '') ? 'G-profile handle' : 'Pull handle 160 mm', nSh, it.joinery?.handle ?? 'Matt black / SS brushed');
    }
  }
  const drawers = (it.joinery?.internal ?? []).some((x) => /drawer/i.test(x)) ? (c === 'kitchen-base' ? Math.max(1, Math.floor(mods.length / 2)) * 3 : 2) : 0;
  if (drawers) {
    P('Drawer front', mods[0] - 3, 200, drawers, 'all 4 edges 2 mm', 2 * (mods[0] + 200), T, out);
    P('Drawer side', D - 60, 150, drawers * 2, 'top edge 0.8 mm', D - 60, 12, LINER, 'BWP ply 12 mm');
    P('Drawer back', mods[0] - 2 * T - 60, 150, drawers, '—', 0, 12, LINER, 'BWP ply 12 mm');
    P('Drawer bottom', mods[0] - 2 * T - 40, D - 60, drawers, '—', 0, BACK);
    HW(c === 'kitchen-base' ? 'Tandem box drawer system' : 'Telescopic channel pair, soft-close', drawers, `${Math.round((D - 60) / 50) * 50} mm`);
  }
  if (c === 'wardrobe') HW('Hanging rail with supports', mods.length, `Oval SS, ${Math.round(mods[0])} mm`);
  if ((it.joinery?.internal ?? []).some((x) => /trouser/i.test(x))) HW('Trouser pull-out', 1, '450 mm module');
  if ((it.joinery?.internal ?? []).some((x) => /loft/i.test(x))) HW('Loft shutter hinge set', mods.length * 2, 'Lift-up stay');
  if (c === 'kitchen-base') { HW('Adjustable cabinet leg', mods.length * 4, '100–150 mm, PVC'); HW('Plinth / skirting board', 1, `${W} mm aluminium`); }
  if ((it.joinery?.internal ?? []).some((x) => /cutlery/i.test(x))) HW('Cutlery organiser', 1, '600 mm module');
  if ((it.joinery?.internal ?? []).some((x) => /bottle/i.test(x))) HW('Bottle pull-out', 1, '150/200 mm');
  if (c === 'kitchen-wall' || ci?.wallMounted) HW('Concealed wall-hanging bracket', mods.length * 2, '75 kg pair');
  HW('Confirmat / minifix screws', Math.ceil(panels.reduce((s, p) => s + p.qty, 0) * 4), 'Assorted');
  return { panels, hardware };
}

export interface JoineryUnit { item: Item; unit: string; name: string; room: string; finish: string; code: string; panels: Panel[]; hardware: Hardware[] }

export function joineryUnits(p: Project | { floors: Floor[] }, cat: Catalog): JoineryUnit[] {
  const out: JoineryUnit[] = [];
  const counters: Record<string, number> = {};
  for (const f of p.floors) for (const it of f.items) {
    const ci = itemById(cat, it.catalogId);
    if (!ci?.joinery || it.existing) continue;
    counters[ci.category] = (counters[ci.category] ?? 0) + 1;
    const unit = unitTag(ci.category, counters[ci.category]);
    const { panels, hardware } = cutList(it, unit, cat);
    const m = materialById(cat, it.finish);
    out.push({ item: it, unit, name: ci.name, room: f.rooms.find((r) => r.id === it.roomId)?.name ?? '—', finish: m?.name ?? 'Standard laminate', code: m?.code ?? '—', panels, hardware });
  }
  return out;
}

// ---- nesting ---------------------------------------------------------------

export interface Placement { tag: string; x: number; y: number; l: number; w: number; name: string }
export interface Board { material: string; t: number; placements: Placement[]; used: number }

export const BOARD_L = 2440, BOARD_W = 1220, KERF = 4;

/** Shelf-based guillotine nesting; grain runs along the 2440 mm board length. */
export function nest(panels: Panel[]): { boards: Board[]; utilisation: number } {
  const byMat = new Map<string, Panel[]>();
  for (const p of panels) { const k = `${p.material}|${p.t}`; byMat.set(k, [...(byMat.get(k) ?? []), p]); }
  const boards: Board[] = [];
  for (const [k, ps] of byMat) {
    const [material, t] = k.split('|');
    const pieces: Placement[] = [];
    for (const p of ps) for (let i = 0; i < p.qty; i++) {
      let l = p.l, w = p.w;
      if (l > BOARD_L && w <= BOARD_L) [l, w] = [w, l]; // rotate (grain compromise) if it cannot fit otherwise
      pieces.push({ tag: p.qty > 1 ? `${p.tag}.${i + 1}` : p.tag, x: 0, y: 0, l: Math.min(l, BOARD_L), w: Math.min(w, BOARD_W), name: p.name });
    }
    pieces.sort((a, b) => b.w - a.w || b.l - a.l);
    type Sheet = { board: Board; shelves: { y: number; h: number; x: number }[] };
    const sheets: Sheet[] = [];
    const tryPlace = (c: Sheet, pc: Placement): boolean => {
      for (const sh of c.shelves) {
        if (pc.w <= sh.h && sh.x + pc.l <= BOARD_L) { c.board.placements.push({ ...pc, x: sh.x, y: sh.y }); sh.x += pc.l + KERF; return true; }
      }
      const top = c.shelves.reduce((s, x) => Math.max(s, x.y + x.h + KERF), 0);
      if (top + pc.w <= BOARD_W) { c.shelves.push({ y: top, h: pc.w, x: pc.l + KERF }); c.board.placements.push({ ...pc, x: 0, y: top }); return true; }
      return false;
    };
    for (const pc of pieces) {
      let sheet = sheets.find((sh) => tryPlace(sh, pc));
      if (!sheet) {
        sheet = { board: { material, t: +t, placements: [], used: 0 }, shelves: [] };
        sheets.push(sheet);
        boards.push(sheet.board);
        tryPlace(sheet, pc);
      }
      sheet.board.used += pc.l * pc.w;
    }
  }
  const total = boards.length * BOARD_L * BOARD_W;
  const used = boards.reduce((s, b) => s + b.used, 0);
  return { boards, utilisation: total ? used / total : 0 };
}
