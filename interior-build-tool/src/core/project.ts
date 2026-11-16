// Project lifecycle: creation, versions, approvals, change orders, tasks, revision gate (REL-06).

import type { Approval, Brief, Floor, Project, Revision, Settings, Task, Trade, Version, QuoteSettings } from './types';
import { DEFAULT_RULES, checkFloor } from './rules';
import { computeBoq, projectCatalog, snapshotLines } from './boq';
import { uid, nowIso, hashObject } from './util';
import { SAMPLE_WALLS } from './sample';

export const DEFAULT_SETTINGS: Settings = {
  user: 'Designer',
  role: 'designer',
  tradeView: 'carpentry',
  displayUnits: 'mm',
  gstPct: 18,
  marginPct: 12,
  siteTolerance: 10,
  firmName: 'Your Design Studio',
  layerStandard: {
    wall: 'A-WALL', door: 'A-DOOR', window: 'A-GLAZ', column: 'S-COLS', furniture: 'I-FURN', joinery: 'I-JOIN',
    electrical: 'E-POWR', lighting: 'E-LITE', plumbing: 'P-SANR', hvac: 'M-HVAC', text: 'A-ANNO-TEXT', dims: 'A-ANNO-DIMS', room: 'A-AREA', ceiling: 'A-CLNG', floor: 'A-FLOR',
  },
  drawingStandard: 'IS',
  rulePack: DEFAULT_RULES,
  projectStart: new Date().toISOString().slice(0, 10),
  defaultCeiling: 3000,
  sheetLanguage: 'en',
};

export const DEFAULT_BRIEF: Brief = {
  familySize: 4, members: '2 adults, 2 children (8, 12)', accessibility: false, mustHaves: ['study', 'pooja'], storage: 'high',
  budgetBand: 'standard', budget: 0, vastu: true, likes: 'warm wood, cane accents, lots of storage', dislikes: 'glossy finishes', version: 1,
};

export const DEFAULT_QUOTE: QuoteSettings = {
  model: 'itemised', turnkeyRate: 2200, feePct: 10, lumpSum: 0, designOnlyRate: 120,
  milestones: [
    { label: 'Booking / design sign-off', pct: 10 },
    { label: 'Material procurement & factory production', pct: 40 },
    { label: 'Installation complete', pct: 40 },
    { label: 'Handover after snag close-out (retention)', pct: 10 },
  ],
  inclusions: ['Civil changes shown on the demolition / construction plans', 'Electrical and plumbing points as per point schedules', 'Modular joinery as per elevations and cut lists', 'False ceiling, painting and flooring as per finish schedule', 'Site cleaning before handover'],
  exclusions: ['Air-conditioners (points and piping provision only)', 'Decorative light fixtures beyond the lighting schedule', 'Curtains and soft furnishing unless itemised', 'Appliances (fridge, washing machine, microwave)', 'Society deposits and permissions'],
  terms: 'Rates valid for 30 days. Any change after design approval is handled by a signed change order with its cost and time impact. Warranty as per manufacturer; workmanship warranty 1 year.',
};

export function emptyFloor(name = 'Ground floor'): Floor {
  return { id: uid('floor'), name, level: 0, walls: [], openings: [], columns: [], rooms: [], items: [], points: [], annotations: [], siteMeasures: [], dimChecks: [], northDeg: 90 };
}

export function createProject(name: string, user = 'Designer'): Project {
  const now = nowIso();
  return {
    id: uid('prj'), name, client: { name: '', phone: '', email: '' }, address: '', createdAt: now, updatedAt: now,
    floors: [], theme: 'japandi', brief: { ...DEFAULT_BRIEF }, prompt: 'warm wood, cane accents, lots of storage, no glossy finishes',
    refs: [], styleTags: [], generation: {}, versions: [], approvals: [], changeOrders: [], tasks: defaultTasks(), snags: [], submittals: [], rfis: [], progress: [],
    comments: [], revisions: [], flags: [], audit: [{ at: now, by: user, action: 'Project created' }], quote: structuredClone(DEFAULT_QUOTE),
    settings: { ...structuredClone(DEFAULT_SETTINGS), user }, catalogOverrides: {}, customCatalog: [],
  };
}

/** PM-02: standard residential sequence with trade dependencies. */
export function defaultTasks(): Task[] {
  const T = (id: string, name: string, trade: Task['trade'], duration: number, deps: string[] = []): Task => ({ id, name, trade, duration, deps, status: 'todo' });
  return [
    T('t1', 'Site re-measure & marking', 'site', 1),
    T('t2', 'Demolition & new partition walls', 'civil', 5, ['t1']),
    T('t3', 'Electrical conduiting & chasing', 'electrical', 4, ['t2']),
    T('t4', 'Plumbing lines & concealed fittings', 'plumbing', 3, ['t2']),
    T('t5', 'Waterproofing + 48-h ponding test', 'civil', 3, ['t4']),
    T('t6', 'Flooring & wall tiling', 'civil', 6, ['t3', 't5']),
    T('t7', 'False ceiling framing & boarding', 'civil', 4, ['t3']),
    T('t8', 'Joinery factory production', 'carpentry', 15, ['t1']),
    T('t9', 'Putty, primer & first coat', 'painting', 4, ['t6', 't7']),
    T('t10', 'Joinery installation', 'carpentry', 6, ['t8', 't9']),
    T('t11', 'Electrical fixtures, switches, DB dressing', 'electrical', 2, ['t10']),
    T('t12', 'AC installation', 'hvac', 1, ['t9']),
    T('t13', 'Sanitaryware & CP fittings', 'plumbing', 2, ['t6']),
    T('t14', 'Final paint coat & touch-up', 'painting', 2, ['t10', 't11']),
    T('t15', 'Snag list & handover', 'site', 2, ['t12', 't13', 't14']),
  ];
}

/** Forward-pass schedule: earliest start of every task from its dependencies. */
export function schedule(tasks: Task[], start: string): Record<string, { start: Date; end: Date; es: number }> {
  const out: Record<string, { start: Date; end: Date; es: number }> = {};
  const day0 = new Date(start + 'T00:00:00');
  const es = (t: Task, seen = new Set<string>()): number => {
    if (out[t.id]) return out[t.id].es;
    if (seen.has(t.id)) return 0;
    seen.add(t.id);
    const s = Math.max(0, ...t.deps.map((d) => { const dt = tasks.find((x) => x.id === d); return dt ? es(dt, seen) + dt.duration : 0; }));
    const st = new Date(day0); st.setDate(st.getDate() + s);
    const en = new Date(st); en.setDate(en.getDate() + t.duration);
    out[t.id] = { start: st, end: en, es: s };
    return s;
  };
  for (const t of tasks) es(t);
  return out;
}

export function modelHash(p: Project): string {
  return hashObject(p.floors.map((f) => ({ ...f, source: undefined })));
}

export function makeVersion(p: Project, name: string): Version {
  const b = computeBoq(p);
  return { id: uid('ver'), name, at: nowIso(), by: p.settings.user, hash: modelHash(p), floors: structuredClone(p.floors), boqTotal: b.total, boqLines: snapshotLines(b) };
}

export function approvalLink(p: Project, a: Approval, subjectText: string): string {
  // PM-13: WhatsApp deep link carrying the exact revision being approved.
  const msg = `${p.settings.firmName}: please review and approve ${subjectText} for "${p.name}".\nRevision: ${a.revision}\nReply APPROVE ${a.id.slice(-6).toUpperCase()} to approve, or send your comments.`;
  const phone = p.client.phone.replace(/[^\d]/g, '');
  return `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`;
}

export interface Blocker { level: 'block' | 'warn'; msg: string }

/** REL-06 / IMP-41 / IMP-42 / GEN-20 / GEN-21 / IMP-40: what must be resolved before "Issued for construction". */
export function issueReadiness(p: Project, trade: Trade | 'all'): Blocker[] {
  const out: Blocker[] = [];
  const cat = projectCatalog(p);
  for (const f of p.floors) {
    const unconf = [...f.walls, ...f.openings, ...f.rooms, ...f.columns].filter((e) => e.det && !e.det.confirmed);
    if (unconf.length) out.push({ level: 'block', msg: `${f.name}: ${unconf.length} detected element(s) not yet confirmed in import review` });
    const drafts = f.items.filter((i) => i.draft).length + f.points.filter((pt) => pt.draft).length;
    if (drafts) out.push({ level: 'block', msg: `${f.name}: ${drafts} AI draft item(s)/point(s) not accepted by a designer` });
    const errs = checkFloor(f, { catalog: cat, rules: p.settings.rulePack, accessibility: p.brief.accessibility }).filter((i) => i.severity === 'error');
    if (errs.length) out.push({ level: 'block', msg: `${f.name}: ${errs.length} rule violation(s): ${errs.slice(0, 2).map((e) => e.msg).join('; ')}` });
    if (trade === 'carpentry' || trade === 'all') {
      const open = f.siteMeasures.filter((m) => !m.resolution && Math.abs(m.site - m.plan) > p.settings.siteTolerance);
      if (open.length) out.push({ level: 'block', msg: `${f.name}: ${open.length} site re-measure difference(s) above ${p.settings.siteTolerance} mm unresolved (cut lists blocked)` });
      if (!f.siteMeasures.length) out.push({ level: 'warn', msg: `${f.name}: no site re-measure recorded yet` });
    }
    const mism = f.dimChecks.filter((d) => !d.ok).length;
    if (mism) out.push({ level: 'warn', msg: `${f.name}: ${mism} written dimension(s) disagree with drawn geometry` });
  }
  const flags = p.flags.filter((x) => !x.reviewed);
  if (flags.length) out.push({ level: 'block', msg: `${flags.length} structural change(s) awaiting licensed engineer/architect review` });
  if (!p.approvals.some((a) => a.subject === 'design' && a.status === 'approved')) out.push({ level: 'warn', msg: 'Client has not approved the design yet' });
  return out;
}

export function elementSigs(p: Project): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of p.floors) for (const e of [...f.walls, ...f.openings, ...f.items, ...f.points, ...f.rooms] as { id: string }[]) {
    const { det, draft, prov, reason, ...rest } = e as Record<string, unknown> & { id: string };
    void det; void draft; void prov; void reason;
    out[e.id] = hashObject(rest);
  }
  return out;
}

/** Elements added or changed since the previous issued revision of this trade (revision clouds, EXP-04). */
export function changedSince(p: Project, trade: Trade | 'all'): Set<string> {
  const prev = [...p.revisions].filter((r) => r.trade === trade).pop();
  if (!prev) return new Set();
  const now = elementSigs(p);
  return new Set(Object.keys(now).filter((k) => prev.sigs[k] !== now[k]));
}

export function nextRevision(p: Project, trade: Trade | 'all', note: string, ifc: boolean): Revision {
  const no = p.revisions.filter((r) => r.trade === trade).length;
  return { id: uid('rev'), no, trade, at: nowIso(), by: p.settings.user, hash: modelHash(p), note, ifc, sigs: elementSigs(p), viewers: [], floors: structuredClone(p.floors) };
}

export function isSampleFloor(f: Floor) {
  return f.walls.length === SAMPLE_WALLS.length;
}
