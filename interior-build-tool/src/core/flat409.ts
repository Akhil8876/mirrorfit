// Flat 409 – "Quiet Warmth", a Japandi 3-bedroom flat.
// Source: the Studio Craft design concept book v2 (Nov 2026) and the Flat 409 preliminary estimate.
// The book has no CAD file, so the plan below is rebuilt from its clear internal room sizes (p.2)
// and the furnished plan (p.7). Sizes match the book within ~100 mm, as the book itself notes.

import type { Floor, Item, Project, Room, StyleRef, Vec2 } from './types';
import { planWriter, drawWalls, type SampleWall, type SampleOpening } from './sample';
import { parseDxf } from './dxf';
import { importDxf } from './detect';
import { generateRoomOptions } from './generator';
import { themeById } from './themes';
import { buildCatalog } from './catalog';
import { checkRoom } from './rules';
import { createProject, makeVersion } from './project';
import { uid, nowIso } from './util';
import { centroid, polygonArea } from './geom';

const X1 = 3412.5, X2 = 4847.5, X3 = 6272.5, XE = 9640, XM = 4482.5, XK = 6647.5, XS3 = 11602.5;
const YU = 1482.5, YMB = 2002.5, YH1 = 3752.5, YH2 = 7427.5, YBB = 8717.5, YF = 11302.5, YN = 13405;

export const F409_WALLS: SampleWall[] = [
  { a: { x: 0, y: 0 }, b: { x: XE, y: 0 }, t: 230 }, // 0 south (master, bath, utility)
  { a: { x: XE, y: 0 }, b: { x: XE, y: YN }, t: 230 }, // 1 east
  { a: { x: XE, y: YN }, b: { x: 0, y: YN }, t: 230 }, // 2 north (sit-out parapet)
  { a: { x: 0, y: YN }, b: { x: 0, y: 0 }, t: 230 }, // 3 west (main door)
  { a: { x: 0, y: YF }, b: { x: XE, y: YF }, t: 230 }, // 4 front facade to sit-outs
  { a: { x: XE, y: YH1 }, b: { x: XS3, y: YH1 }, t: 230 }, // 5 side sit-out
  { a: { x: XS3, y: YH1 }, b: { x: XS3, y: YH2 }, t: 230 }, // 6
  { a: { x: XS3, y: YH2 }, b: { x: XE, y: YH2 }, t: 230 }, // 7
  { a: { x: 0, y: YH1 }, b: { x: XE, y: YH1 }, t: 115 }, // 8 hall / back band
  { a: { x: 0, y: YH2 }, b: { x: X1, y: YH2 }, t: 115 }, // 9 hall / bedroom 3
  { a: { x: X3, y: YH2 }, b: { x: XE, y: YH2 }, t: 115 }, // 10 hall / guest bedroom
  { a: { x: X1, y: YH2 }, b: { x: X1, y: YN }, t: 115 }, // 11
  { a: { x: X3, y: YH2 }, b: { x: X3, y: YN }, t: 115 }, // 12
  { a: { x: X1, y: YBB }, b: { x: X3, y: YBB }, t: 115 }, // 13 bath fronts
  { a: { x: X2, y: YBB }, b: { x: X2, y: YF }, t: 115 }, // 14 between baths
  { a: { x: XM, y: 0 }, b: { x: XM, y: YH1 }, t: 115 }, // 15 master / bath + passage
  { a: { x: XK, y: 0 }, b: { x: XK, y: YH1 }, t: 115 }, // 16 passage / kitchen
  { a: { x: XM, y: YMB }, b: { x: XK, y: YMB }, t: 115 }, // 17 master bath / passage
  { a: { x: XK, y: YU }, b: { x: XE, y: YU }, t: 115 }, // 18 utility / kitchen
];

export const F409_OPENINGS: SampleOpening[] = [
  { wall: 3, at: YN - 6900, w: 1000, kind: 'door', hinge: 'a', side: 1 }, // main entrance into the foyer
  { wall: 3, at: YN - 5200, w: 1500, kind: 'window' }, // drawing room
  { wall: 3, at: YN - 9400, w: 1500, kind: 'window' }, // bedroom 3
  { wall: 3, at: YN - 1900, w: 1200, kind: 'window' }, // master
  { wall: 0, at: 2250, w: 1500, kind: 'window' }, // master
  { wall: 0, at: 5565, w: 600, kind: 'window' }, // master bath ventilator
  { wall: 0, at: 8140, w: 1200, kind: 'window' }, // utility
  { wall: 1, at: 2600, w: 1000, kind: 'window' }, // kitchen
  { wall: 1, at: 9400, w: 1500, kind: 'window' }, // guest
  { wall: 1, at: 5590, w: 1600, kind: 'door', hinge: 'a', side: 1 }, // sliding door to side sit-out
  { wall: 4, at: 1735, w: 1600, kind: 'door', hinge: 'a', side: 1 }, // bedroom 3 → sit-out 1
  { wall: 4, at: 7950, w: 1600, kind: 'door', hinge: 'b', side: 1 }, // guest → sit-out 2
  { wall: 4, at: 4130, w: 600, kind: 'window' }, // children's bath ventilator
  { wall: 4, at: 5560, w: 600, kind: 'window' }, // guest bath ventilator
  { wall: 8, at: 3700, w: 900, kind: 'door', hinge: 'b', side: -1 }, // master
  { wall: 8, at: 5565, w: 1400, kind: 'opening' }, // crockery passage
  { wall: 8, at: 8150, w: 1500, kind: 'opening' }, // kitchen over the raised granite counter
  { wall: 15, at: 1000, w: 750, kind: 'door', hinge: 'a', side: -1 }, // master bath
  { wall: 16, at: 2900, w: 800, kind: 'door', hinge: 'b', side: -1 }, // kitchen from passage
  { wall: 18, at: 1400, w: 750, kind: 'door', hinge: 'a', side: -1 }, // utility
  { wall: 9, at: 2900, w: 900, kind: 'door', hinge: 'b', side: 1 }, // bedroom 3
  { wall: 10, at: 600, w: 900, kind: 'door', hinge: 'a', side: 1 }, // guest
  { wall: 13, at: 700, w: 750, kind: 'door', hinge: 'a', side: 1 }, // children's bath
  { wall: 13, at: 2160, w: 750, kind: 'door', hinge: 'b', side: 1 }, // guest bath
];

export const F409_LABELS: { text: string; pos: Vec2 }[] = [
  { text: 'LIVING / DINING', pos: { x: 2500, y: 5600 } },
  { text: 'KITCHEN', pos: { x: 8100, y: 2600 } },
  { text: 'UTILITY', pos: { x: 8100, y: 800 } },
  { text: 'MASTER BEDROOM', pos: { x: 2250, y: 1900 } },
  { text: 'MASTER BATH', pos: { x: 5565, y: 1000 } },
  { text: 'CROCKERY PASSAGE', pos: { x: 5565, y: 2900 } },
  { text: 'BEDROOM 3', pos: { x: 1700, y: 9400 } },
  { text: "CHILDREN'S BATH", pos: { x: 4130, y: 10000 } },
  { text: 'GUEST BATH', pos: { x: 5560, y: 10000 } },
  { text: 'GUEST BEDROOM', pos: { x: 7950, y: 9400 } },
  { text: 'SIT-OUT 1', pos: { x: 1700, y: 12350 } },
  { text: 'SIT-OUT 2', pos: { x: 7950, y: 12350 } },
  { text: 'SIT-OUT 3', pos: { x: 10620, y: 5590 } },
  { text: 'SERVICE PLATFORM', pos: { x: 4840, y: 12350 } },
];

export function buildFlat409Dxf(): string {
  const w = planWriter();
  drawWalls(w, F409_WALLS, F409_OPENINGS);
  const cols: [number, number, number, number][] = [[-115, -115, 1, 1], [XE + 115, -115, -1, 1], [XE + 115, YN + 115, -1, -1], [-115, YN + 115, 1, -1]];
  for (const [x, y, sx, sy] of cols) w.poly('S-COLS', [{ x, y }, { x: x + sx * 380, y }, { x: x + sx * 380, y: y + sy * 380 }, { x, y: y + sy * 380 }], true);
  for (const l of F409_LABELS) w.text('A-ANNO-TEXT', l.pos, 180, l.text, 0, true);
  w.text('A-ANNO-TEXT', { x: XE / 2, y: -900 }, 220, 'FLAT 409 - OPTION 01 - 3 BEDROOM', 0, true);
  return w.toString();
}

// ---- design intent from the concept book --------------------------------

const PALETTES: { name: string; colors: [string, string][]; tags: string[] }[] = [
  { name: 'Base – walls, ceilings, large surfaces (≈70 %)', colors: [['Washi White', '#F3EFE8'], ['Rice Paper', '#E9E2D6'], ['Oat Greige', '#D6C9B9'], ['Sand Linen', '#C2B29A'], ['Stone Grey', '#CFC8BC']], tags: ['light & airy', 'matte', 'white walls'] },
  { name: 'Wood – joinery, furniture, doors (≈20 %)', colors: [['Natural Oak', '#C49A6C'], ['Smoked Walnut', '#6B4A33']], tags: ['warm wood', 'walnut'] },
  { name: 'Anchor & accent – sparingly (≈10 %)', colors: [['Sumi Charcoal', '#34312D'], ['Moss', '#7C8466'], ['Sage Mist', '#A9AD91'], ['Kiln Clay', '#B07A5A'], ['Aged Bronze', '#A8865A']], tags: ['sage velvet', 'brushed bronze', 'greenery'] },
];

function swatchThumb(colors: [string, string][]): string {
  const w = 260 / colors.length;
  const rects = colors.map(([, c], i) => `<rect x="${i * w}" y="0" width="${w + 1}" height="195" fill="${c}"/>`).join('');
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="260" height="195">${rects}</svg>`);
}

/** Finish schedule (book p.15) mapped to catalog finishes. */
const FINISH: Record<string, { floor: string; wall: string; accent?: string; skirting: string; cove: boolean; joinery?: string }> = {
  living: { floor: 'fl-marble-porcelain', wall: 'pt-washi', accent: 'wp-fluted-white', skirting: 'sk-tile', cove: true, joinery: 'ven-walnut' },
  kitchen: { floor: 'fl-marble-porcelain', wall: 'pt-washi', skirting: '', cove: false, joinery: 'ven-walnut' },
  'master bedroom': { floor: 'fl-marble-porcelain', wall: 'pt-washi', accent: 'wp-wave-fluted', skirting: 'sk-tile', cove: true, joinery: 'ven-walnut' },
  'guest bedroom': { floor: 'fl-marble-porcelain', wall: 'pt-washi', accent: 'wp-grid-greige', skirting: 'sk-tile', cove: true, joinery: 'lam-greige' },
  'bedroom 3': { floor: 'fl-marble-porcelain', wall: 'pt-washi', accent: 'wp-limewash-grey', skirting: 'sk-tile', cove: true, joinery: 'lam-greige' },
  passage: { floor: 'fl-marble-porcelain', wall: 'pt-washi', skirting: 'sk-tile', cove: true, joinery: 'ven-walnut' },
  toilet: { floor: 'fl-dark-stone', wall: 'wt-stone-1200', skirting: '', cove: false, joinery: 'ven-walnut' },
  utility: { floor: 'fl-dark-stone', wall: 'pt-washi', skirting: '', cove: false, joinery: 'lam-greige' },
  balcony: { floor: 'fl-wpc-teak', wall: 'pt-washi', skirting: '', cove: false },
};

function finishKey(r: Room): string {
  const n = r.name.toLowerCase();
  if (FINISH[n]) return n;
  return r.type === 'living' || r.type === 'dining' ? 'living' : r.type in FINISH ? r.type : 'passage';
}

/** Rates from the Flat 409 estimate workbook (indicative, to be replaced with vendor quotes). */
const RATES: Record<string, number> = {
  'kitchen-base': 2400, 'kitchen-wall': 1900, 'tall-unit': 2600, 'wardrobe-hinged': 1900, 'wardrobe-sliding': 2400,
  'sofa-l': 165000, armchair: 42000, 'bed-king': 95000, 'bed-queen': 78000, 'tv-unit': 4400, 'tv-panel-bed': 2000,
  'pooja-unit': 4500, 'bar-unit': 2700, wc: 32000, basin: 35000, shower: 26000, sink: 36000, 'side-table': 16000, curtains: 33000,
  'sk-tile': 70, 'cl-gypsum': 120, 'cl-paint': 26,
};

export function createFlat409Project(user = 'Designer'): { project: Project; underlays: Record<string, import('./types').Underlay> } {
  const p = createProject('Flat 409 – Quiet Warmth (Japandi)', user);
  p.client = { name: 'Mr. Akhil Katkam', phone: '', email: '' };
  p.address = 'Flat 409 · Option 01 · 3 bedroom';
  p.theme = 'japandi';
  p.prompt = 'Japandi, quiet warmth: walnut and greige joinery, handle-less grooved shutters, sage velvet and bouclé, travertine and white marble tops, olive kit-kat tile, cove light on every ceiling, lit niches, matt finishes everywhere, no gloss, one tall storage wall per room';
  p.brief = { ...p.brief, familySize: 4, members: 'Family of four (to confirm with client)', mustHaves: ['pooja', 'bar', 'tv', 'study', 'dining', 'dresser', 'shoe'], storage: 'high', budgetBand: 'premium', budget: 7000000, vastu: false, likes: 'Walnut, sage, bouclé, travertine, cove light, textured feature walls', dislikes: 'Glossy finishes, clutter, centre-only lighting', version: 1 };
  p.styleTags = ['matte', 'warm wood', 'cane', 'sage velvet'];
  p.refs = PALETTES.map((pl): StyleRef => ({ id: uid('ref'), name: pl.name, thumb: swatchThumb(pl.colors), palette: pl.colors.map(([, c]) => c.toLowerCase()), tags: [...pl.tags, ...pl.colors.map(([n]) => n)] }));
  p.catalogOverrides = Object.fromEntries(Object.entries(RATES).map(([k, rate]) => [k, { rate }]));
  p.quote.model = 'itemised';
  p.quote.inclusions = [
    'Porcelain 800×1600 marble-look flooring through hall, kitchen, bedrooms and passage',
    'False ceiling perimeter drop with 2700 K cove in every room; MR boards in baths',
    'Feature walls: fluted living wall, microcement TV wall, wave relief (dining), wave-fluted master bed wall, grid mouldings (guest), limewash (bedroom 3)',
    'Walnut handle-less L-kitchen with granite worktop and raised breakfast ledge; utility units',
    'Wardrobes to ceiling in all bedrooms with lit niches; dresser, study, TV consoles, puja and bar niches, crockery unit',
    'Full-height flush walnut veneer doors with slim bronze pulls',
    'Electrical points per drawing FLAT-409, modular plates, cove & niche circuits, downlights, fans',
    'Three bathrooms: wall-hung WCs, floating walnut vanities, backlit mirrors, glass partitions, CP fittings',
    'Teak-tone WPC decks on three sit-outs',
  ];
  p.quote.exclusions = [
    'Split AC units and outdoor units (copper piping and drains included)',
    'Refrigerator, washing machine, dryer, TV, microwave',
    'Smart-home, digital lock, CCTV, Wi-Fi',
    'Society deposits, permissions and structural changes',
    'Bath and sit-out renders are pending; their scope follows page 14 of the concept book',
  ];
  p.quote.terms = 'Preliminary estimate at concept stage (±15 %), based on the "Quiet Warmth" concept book v2 and the Flat 409 estimate workbook. Rates are indicative until vendor quotes are received. Approve physical samples under 2700 K light before ordering.';

  const text = buildFlat409Dxf();
  const res = importDxf(parseDxf(text), { fileName: 'flat-409-rebuilt-from-concept-book.dxf', fileText: text, user, defaultCeiling: 3000 });
  const f = res.floors[0];
  f.name = 'Flat 409';
  const at = nowIso();
  for (const e of [...f.walls, ...f.openings, ...f.rooms, ...f.columns]) if (e.det) e.det.confirmed = { by: `${user} (from concept book)`, at };
  for (const r of f.rooms) {
    if (r.type === 'living') r.name = 'Living + Dining Hall';
    if (/service/i.test(r.name)) r.name = 'Service Platform';
  }
  p.floors = [f];

  // Lay out every room with the generator (Japandi theme + the book's brief), then apply the book's finishes.
  const cat = buildCatalog(p.catalogOverrides, p.customCatalog);
  const theme = themeById('japandi');
  const palette = p.refs.flatMap((r) => r.palette.slice(0, 2));
  for (const r of f.rooms) {
    if (r.type === 'shaft' || /service/i.test(r.name)) continue;
    const [opt] = generateRoomOptions({ floor: f, room: r, theme, brief: p.brief, styleTags: p.styleTags, palette, prompt: p.prompt, catalog: cat, rules: p.settings.rulePack, seed: 409 }, 1, 4);
    if (!opt) continue;
    const k = finishKey(r);
    const fin = FINISH[k];
    f.items.push(...opt.items.map((i) => ({ ...i, draft: false, finish: i.finish ? fin?.joinery ?? i.finish : i.finish })));
    f.points.push(...opt.points.map((x) => ({ ...x, draft: false })));
    r.finishes = { floor: fin.floor, wall: fin.wall, ceiling: fin.cove ? 'cl-gypsum' : 'cl-paint', skirting: fin.skirting, accentWall: fin.accent ? opt.finishes.accentWall : undefined, accent: fin.accent };
    r.falseCeiling = fin.cove ? { enabled: true, drop: 250, cove: true } : r.type === 'toilet' ? { enabled: true, drop: 600, cove: false } : { enabled: false, drop: 0, cove: false };
    r.status = 'design';
  }

  // Book p.11: king bed, woven upholstered, in the master.
  const master = f.rooms.find((r) => /master bed/i.test(r.name));
  const mbed = master && f.items.find((i) => i.roomId === master.id && i.catalogId.startsWith('bed-'));
  if (master && mbed) {
    const before = { ...mbed };
    const errs = () => checkRoom(f, master, { catalog: cat, rules: p.settings.rulePack }).filter((i) => i.severity === 'error').length;
    const e0 = errs();
    Object.assign(mbed, { catalogId: 'bed-king', w: 1950, d: 2150, reason: 'Concept book p.11: king bed, woven upholstered, under a bronze frame line' });
    if (errs() > e0) Object.assign(mbed, before);
  }

  const hall = f.rooms.find((r) => r.type === 'living');
  if (hall) {
    // Book: round travertine dining for six, walnut TV wall in microcement, wave relief behind dining.
    for (const it of f.items) if (it.roomId === hall.id && it.catalogId.startsWith('dining')) it.catalogId = 'dining-round-6';
    const edges = hall.polygon.map((a, i) => ({ i, a, b: hall.polygon[(i + 1) % hall.polygon.length] }));
    const len = (e: { a: Vec2; b: Vec2 }) => Math.hypot(e.b.x - e.a.x, e.b.y - e.a.y);
    const sofaEdge = hall.finishes.accentWall;
    const others = edges.filter((e) => e.i !== sofaEdge && len(e) > 2500).sort((a, b) => len(b) - len(a));
    if (others[0]) hall.wallFinishOverrides[others[0].i] = 'wp-microcement';
    const west = edges.filter((e) => Math.abs(e.a.x - e.b.x) < 1 && e.a.x < 500 && len(e) > 1500)[0];
    if (west && west.i !== sofaEdge) hall.wallFinishOverrides[west.i] = 'wp-wave-relief';
    // foyer console by the entrance and three bar stools at the kitchen counter
    tryAdd(f, hall, cat, p, { catalogId: 'console-foyer', pos: { x: 2300, y: YH2 - 57.5 - 210 }, rot: 180, w: 1800, d: 400, h: 800, elev: 0, finish: 'lam-charcoal', reason: 'Concept book p.9: charcoal console with bronze dots under the backlit wavy mirror at the entry' });
    for (let k = 0; k < 3; k++) tryAdd(f, hall, cat, p, { catalogId: 'bar-stool', pos: { x: 7550 + k * 550, y: YH1 + 57.5 + 260 }, rot: 180, w: 450, d: 450, h: 750, elev: 0, reason: 'Concept book p.7: bar stools at the raised granite counter' });
  }

  p.audit.push({ at, by: user, action: 'Project created from the "Quiet Warmth" concept book v2 (17 pages) and the Flat 409 estimate: plan rebuilt from CAD room sizes, Japandi palette, finish schedule and estimate rates applied' });
  p.versions.push(makeVersion(p, 'Concept v2 (from concept book)'));
  return { project: p, underlays: res.underlays };
}

function tryAdd(f: Floor, room: Room, cat: ReturnType<typeof buildCatalog>, p: Project, it: Omit<Item, 'id' | 'roomId'>) {
  const item: Item = { ...it, id: uid('item'), roomId: room.id };
  const before = checkRoom(f, room, { catalog: cat, rules: p.settings.rulePack }).filter((i) => i.severity === 'error').length;
  f.items.push(item);
  const after = checkRoom(f, room, { catalog: cat, rules: p.settings.rulePack }).filter((i) => i.severity === 'error').length;
  if (after > before) f.items.pop();
}

export function flat409Summary(f: Floor) {
  return f.rooms.map((r) => ({ name: r.name, type: r.type, m2: polygonArea(r.polygon) / 1e6, c: centroid(r.polygon) }));
}
