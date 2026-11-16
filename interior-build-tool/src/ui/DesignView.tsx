import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useStore, mutate, setUi, select, activeFloor, toast, getState, setUnderlay, LAYER_LABELS, type LayerKey, type Tool } from '../store';
import type { Floor, Item, MepPoint, PointKind, Project, Room, Vec2, Wall } from '../core/types';
import { POINTS, itemById, materialById, type Catalog } from '../core/catalog';
import { checkFloor, roomOf, type Issue } from '../core/rules';
import { computeBoq, itemLine, draftChangeOrder } from '../core/boq';
import { recomputeRooms, scaleFloor } from '../core/detect';
import { lightingFor } from '../core/lighting';
import { regenerateItem } from '../core/generator';
import { vastuFlags } from '../core/vastu';
import { makeVersion } from '../core/project';
import { designElectrical } from '../core/electrical';
import { roomEdges, measureRoom } from '../core/measure';
import { dist, centroid } from '../core/geom';
import { parseLength, fmtLen, fmtArea } from '../core/units';
import { uid, inr, nowIso } from '../core/util';
import { themeById, BUDGET_BANDS } from '../core/themes';
import { PlanView } from './Plan';
import { View3D } from './View3D';
import { Field, LenInput, NumInput, Modal, useCatalog, useUnits, TextInput } from './common';
import { buildInput } from './BriefView';

const POINT_TOOLS: PointKind[] = ['switchboard', 'socket6', 'socket16', 'light', 'fan', 'ac', 'tv', 'data', 'db', 'inlet-cold', 'inlet-hot', 'outlet', 'floor-trap'];
const DEFAULT_H: Partial<Record<PointKind, number>> = { switchboard: 1200, socket6: 300, socket16: 1100, ac: 2100, tv: 1100, data: 300, db: 1800, geyser: 2100, 'inlet-cold': 600, 'inlet-hot': 600, outlet: 300, 'floor-trap': 0, 'ac-drain': 2050, exhaust: 2200, earth: 0 };

export function DesignView() {
  const project = useStore((s) => s.project)!;
  const floor = useStore((s) => activeFloor(s));
  const ui = useStore((s) => s.ui);
  const underlays = useStore((s) => s.underlays);
  const cat = useCatalog(project);
  const units = useUnits();
  const [guard, setGuard] = useState<null | { label: string; elementId: string; action: (f: Floor) => void }>(null);
  const api3d = useRef<{ snapshot: () => string; exportGlb: () => Promise<Blob> } | null>(null);
  const readOnly = ['viewer', 'client', 'trade'].includes(project.settings.role);

  const issues = useMemo(() => (floor ? checkFloor(floor, { catalog: cat, rules: project.settings.rulePack, accessibility: project.brief.accessibility }) : []), [floor, cat, project.settings.rulePack, project.brief.accessibility]);
  const circuits = useMemo(() => (floor && ui.layers.electrical ? designElectrical(floor).assignments : {}), [floor, ui.layers.electrical]);

  const upd = (label: string, fn: (f: Floor, p: Project) => void, audit = false) => mutate(label, (p) => fn(p.floors.find((x) => x.id === floor!.id)!, p), { audit });

  // keyboard shortcuts (EDT-17)
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      const sel = useStoreSel();
      if (e.key === 'Escape') { setUi({ tool: 'select' }); select(null); }
      if (readOnly) return;
      if (!e.ctrlKey && !e.metaKey) {
        if (e.key === 'v') setUi({ tool: 'select' });
        if (e.key === 'w') setUi({ tool: 'wall' });
        if (e.key === 'm') setUi({ tool: 'measure' });
      }
      if (!sel || !floor) return;
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeSel(sel.kind, sel.id); }
      if (e.key === 'r' && sel.kind === 'item') upd('Rotated item', (f) => { const it = f.items.find((i) => i.id === sel.id); if (it) it.rot = (it.rot + 90) % 360; });
      if ((e.ctrlKey || e.metaKey) && e.key === 'd' && sel.kind === 'item') { e.preventDefault(); const nid = uid('item'); upd('Duplicated item', (f) => { const it = f.items.find((i) => i.id === sel.id); if (it) f.items.push({ ...structuredClone(it), id: nid, pos: { x: it.pos.x + 300, y: it.pos.y - 300 }, existing: false }); }); select({ kind: 'item', id: nid }); }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  });
  const useStoreSel = () => ui.selection;

  if (!floor) return <div className="page"><div className="card">Import a drawing first.</div></div>;

  const structuralGuard = (label: string, elementId: string, action: (f: Floor) => void) => setGuard({ label, elementId, action });
  const removeSel = (kind: string, id: string) => {
    if (kind === 'item') upd('Deleted item', (f) => { f.items = f.items.filter((i) => i.id !== id); });
    if (kind === 'point') upd('Deleted point', (f) => { f.points = f.points.filter((i) => i.id !== id); });
    if (kind === 'annotation') upd('Deleted dimension', (f) => { f.annotations = f.annotations.filter((i) => i.id !== id); });
    if (kind === 'opening') upd('Deleted opening', (f) => { f.openings = f.openings.filter((i) => i.id !== id); });
    if (kind === 'wall') {
      const w = floor.walls.find((x) => x.id === id)!;
      const act = (f: Floor) => { const ww = f.walls.find((x) => x.id === id)!; if (ww.status === 'new') { f.walls = f.walls.filter((x) => x.id !== id); f.openings = f.openings.filter((o) => o.wallId !== id); } else ww.status = 'demolish'; };
      if (w.structural) structuralGuard('Demolish structural wall', id, act);
      else upd(w.status === 'new' ? 'Removed new wall' : 'Marked wall for demolition', (f) => { act(f); }, true);
    }
    if (kind === 'column') structuralGuard('Remove column', id, (f) => { f.columns = f.columns.filter((c) => c.id !== id); });
    select(null);
  };

  const onTwoPoint = (a: Vec2, b: Vec2) => {
    if (ui.tool === 'wall') {
      if (dist(a, b) < 200) return;
      mutate('Added partition wall', (p) => {
        const i = p.floors.findIndex((x) => x.id === floor.id);
        const f = p.floors[i];
        f.walls.push({ id: uid('wall'), a, b, thickness: 115, structural: false, exterior: false, status: 'new' });
        p.floors[i] = recomputeRooms(f);
      }, { audit: true });
    }
    if (ui.tool === 'measure') upd('Added dimension', (f) => { f.annotations.push({ id: uid('dim'), a, b }); });
    if (ui.tool === 'calibrate') {
      const ans = prompt(`Drawn distance is ${Math.round(dist(a, b))} mm. Enter the real distance:`);
      const mm = ans ? parseLength(ans, 'mm') : null;
      if (!mm) return;
      const k = mm / dist(a, b);
      mutate(`Calibrated scale ×${k.toFixed(4)}`, (p) => { const i = p.floors.findIndex((x) => x.id === floor.id); p.floors[i] = scaleFloor(p.floors[i], k); }, { audit: true });
      const u = underlays[floor.id];
      if (u?.image) setUnderlay(floor.id, { ...u, image: { ...u.image, x: u.image.x * k, y: u.image.y * k, w: u.image.w * k, h: u.image.h * k } });
      setUi({ tool: 'select' });
    }
  };
  const onToolClick = (p: Vec2) => {
    const room = roomOf(floor, p);
    if (ui.tool.startsWith('point:')) {
      const kind = ui.tool.slice(6) as PointKind;
      const ceil = ['light', 'cove', 'fan'].includes(kind);
      const nid = uid('pt');
      upd(`Added ${POINTS[kind].name}`, (f) => { f.points.push({ id: nid, roomId: room?.id, kind, pos: p, height: ceil ? (room ? room.ceilingHeight - (room.falseCeiling.enabled ? room.falseCeiling.drop : 0) : 2700) : DEFAULT_H[kind] ?? 1200 }); });
      select({ kind: 'point', id: nid });
    } else if (ui.tool.startsWith('item:')) {
      const ci = itemById(cat, ui.tool.slice(5));
      if (!ci) return;
      const nid = uid('item');
      upd(`Placed ${ci.name}`, (f) => { f.items.push({ id: nid, roomId: room?.id ?? '', catalogId: ci.id, pos: p, rot: 0, w: ci.w, d: ci.d, h: ci.h, elev: ci.elev ?? 0, finish: ci.joinery ? themeById(project.theme).laminate : undefined, reason: 'Placed by designer' }); });
      select({ kind: 'item', id: nid });
      setUi({ tool: 'select' });
    } else if (ui.tool === 'snag') {
      const title = prompt('Snag description');
      if (!title) return;
      mutate('Added snag', (pp) => { pp.snags.push({ id: uid('snag'), floorId: floor.id, pos: p, title, trade: 'civil', due: new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10), status: 'open', createdAt: nowIso() }); }, { audit: true });
    } else if (ui.tool === 'comment') {
      const text = prompt('Comment');
      if (!text) return;
      const target = ui.selection?.id;
      mutate('Added comment', (pp) => { pp.comments.push({ id: uid('cm'), floorId: floor.id, pos: p, targetId: target, author: pp.settings.user, text, at: nowIso() }); });
    }
  };
  const onMove = (kind: string, id: string, pos: Vec2) => {
    if (kind === 'item') upd('Moved item', (f) => { const it = f.items.find((i) => i.id === id)!; it.pos = pos; const r = roomOf(f, pos); if (r) it.roomId = r.id; });
    if (kind === 'point') upd('Moved point', (f) => { const pt = f.points.find((i) => i.id === id)!; pt.pos = pos; const r = roomOf(f, pos); if (r) pt.roomId = r.id; });
    if (kind === 'snag') mutate('Moved snag', (p) => { p.snags.find((s) => s.id === id)!.pos = pos; });
    if (kind === 'comment') mutate('Moved comment', (p) => { p.comments.find((s) => s.id === id)!.pos = pos; });
  };

  const drafts = floor.items.filter((i) => i.draft).length + floor.points.filter((p) => p.draft).length;
  const tools: [Tool, string, string][] = [['select', 'Select', 'V'], ['wall', 'Wall', 'W'], ['measure', 'Measure', 'M'], ['snag', 'Snag pin', ''], ['comment', 'Comment', ''], ['calibrate', 'Calibrate', '']];
  const opts = { layers: ui.layers, selection: ui.selection, issues, units, snags: project.snags, comments: project.comments, circuits, tags: true };
  return (
    <div className="editor">
      <aside className="side">
        <LeftPanel floor={floor} cat={cat} readOnly={readOnly} />
      </aside>
      <section className="center">
        <div className="toolbar">
          {!readOnly && tools.map(([t, l, k]) => <button key={t} className={'btn sm' + (ui.tool === t ? ' on' : '')} onClick={() => setUi({ tool: t })} title={k ? `Shortcut ${k}` : undefined}>{l}</button>)}
          {!readOnly && ui.tool.startsWith('point:') && <span className="tag accent">Click to place {POINTS[ui.tool.slice(6) as PointKind].name}</span>}
          {!readOnly && ui.tool.startsWith('item:') && <span className="tag accent">Click to place {itemById(cat, ui.tool.slice(5))?.name}</span>}
          <span style={{ flex: 1 }} />
          <div className="seg">{(['2d', 'split', '3d'] as const).map((v) => <button key={v} className={ui.split === v ? 'on' : ''} onClick={() => setUi({ split: v })}>{v === 'split' ? '2D | 3D' : v.toUpperCase()}</button>)}</div>
          {!readOnly && <button className="btn sm" disabled={!drafts} onClick={() => upd(`Accepted ${drafts} AI draft(s)`, (f, p) => { for (const i of f.items) i.draft = false; for (const x of f.points) x.draft = false; void p; }, true)} title="GEN-20: AI output stays a draft until a designer accepts it">Accept all drafts ({drafts})</button>}
          {!readOnly && <button className="btn sm" onClick={() => { const name = prompt('Version name', `Version ${project.versions.length + 1}`); if (name) mutate(`Saved version "${name}"`, (p) => { p.versions.push(makeVersion(p, name)); }, { audit: true }); }}>Save version</button>}
        </div>
        <div className={'views' + (ui.split === 'split' ? ' split' : '')}>
          {ui.split !== '3d' && (
            <div>
              <PlanView floor={floor} cat={cat} underlay={underlays[floor.id]} tool={readOnly ? 'select' : ui.tool} onSelect={select} onMove={readOnly ? undefined : onMove} onToolClick={onToolClick} onTwoPoint={onTwoPoint} readOnly={readOnly} opts={opts} />
              <div className="overlay no-print"><span className="chip">Scroll to zoom · drag empty space to pan · Shift while dragging disables snapping</span></div>
            </div>
          )}
          {ui.split !== '2d' && <div><View3D floor={floor} cat={cat} layers={ui.layers} selection={ui.selection} onSelect={select} register={(a) => { api3d.current = a; (window as unknown as { __ibt3d?: unknown }).__ibt3d = a; }} /></div>}
        </div>
      </section>
      <aside className="side r">
        <RightPanel floor={floor} cat={cat} issues={issues} readOnly={readOnly} structuralGuard={structuralGuard} removeSel={removeSel} />
      </aside>
      {guard && <StructuralModal guard={guard} floorId={floor.id} onClose={() => setGuard(null)} />}
    </div>
  );
}

/** IMP-40: structural changes need a source and raise a licensed engineer/architect review flag. */
function StructuralModal({ guard, floorId, onClose }: { guard: { label: string; elementId: string; action: (f: Floor) => void }; floorId: string; onClose: () => void }) {
  const [note, setNote] = useState('');
  return (
    <Modal title={`${guard.label}: structural element`} onClose={onClose}>
      <div className="col">
        <div className="banner err small">Columns, beams and shear walls are read-only. Cutting or removing them needs a source (structural drawing reference or engineer's note) and raises a review flag that blocks “Issued for construction” until a licensed engineer or architect signs it off.</div>
        <Field label="Source: structural drawing ref. or engineer's note"><textarea className="i" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. STR-04 rev B, beam B12 transfer by Er. …" /></Field>
        <div className="row"><span className="grow" /><button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn danger" disabled={note.trim().length < 6} onClick={() => { mutate(`${guard.label} (structural, flagged for review)`, (p) => { const f = p.floors.find((x) => x.id === floorId)!; guard.action(f); p.flags.push({ id: uid('flag'), elementId: guard.elementId, action: guard.label, sourceNote: note.trim(), raisedBy: p.settings.user, at: nowIso() }); }, { audit: true }); toast('Change recorded and flagged for licensed engineer/architect review', 'warn'); onClose(); }}>Record change & raise review flag</button>
        </div>
      </div>
    </Modal>
  );
}

function LeftPanel({ floor, cat, readOnly }: { floor: Floor; cat: Catalog; readOnly: boolean }) {
  const ui = useStore((s) => s.ui);
  const [catFilter, setCatFilter] = useState('');
  const groups = useMemo(() => {
    const g: Record<string, typeof cat.items> = {};
    for (const i of cat.items) (g[i.category] ||= []).push(i);
    return g;
  }, [cat]);
  return (
    <div className="col" style={{ gap: 0 }}>
      <h3>Rooms</h3>
      <div className="list">
        {floor.rooms.map((r) => (
          <div key={r.id} className={'li' + (ui.selection?.id === r.id ? ' on' : '')} onClick={() => select({ kind: 'room', id: r.id })}>
            <span className="grow">{r.name}</span><span className="tag">{r.status}</span>
          </div>
        ))}
      </div>
      <div className="sect">
        <h3>Layers by trade</h3>
        {(Object.keys(LAYER_LABELS) as LayerKey[]).map((k) => (
          <label key={k} className="row small" style={{ padding: '2px 0' }}><input type="checkbox" checked={ui.layers[k]} onChange={(e) => setUi({ layers: { ...ui.layers, [k]: e.target.checked } })} /> {LAYER_LABELS[k]}</label>
        ))}
      </div>
      {!readOnly && (
        <>
          <div className="sect">
            <h3>Add points</h3>
            <div className="row" style={{ gap: 4 }}>
              {POINT_TOOLS.map((k) => <button key={k} className={'btn sm' + (ui.tool === `point:${k}` ? ' on' : '')} title={POINTS[k].name} onClick={() => setUi({ tool: `point:${k}` })}><span style={{ color: POINTS[k].color, fontWeight: 700 }}>{POINTS[k].symbol}</span></button>)}
            </div>
          </div>
          <div className="sect">
            <h3>Catalog</h3>
            <input className="i" placeholder="Search items…" value={catFilter} onChange={(e) => setCatFilter(e.target.value)} />
            <div className="list" style={{ marginTop: 6 }}>
              {Object.entries(groups).map(([g, items]) => {
                const list = items.filter((i) => !catFilter || i.name.toLowerCase().includes(catFilter.toLowerCase()));
                if (!list.length) return null;
                return <div key={g}><div className="muted small" style={{ padding: '4px 8px', textTransform: 'capitalize' }}>{g.replace('-', ' ')}</div>
                  {list.map((i) => <div key={i.id} className={'li small' + (ui.tool === `item:${i.id}` ? ' on' : '')} onClick={() => setUi({ tool: `item:${i.id}` })} title={`${i.spec.series} · ${i.spec.grade}`}><span className="swatch" style={{ background: i.color, width: 12, height: 12 }} /><span className="grow">{i.name}</span><span className="muted">{i.kind === 'sku' ? 'SKU' : 'custom'}</span></div>)}
                </div>;
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function RightPanel({ floor, cat, issues, readOnly, structuralGuard, removeSel }: { floor: Floor; cat: Catalog; issues: Issue[]; readOnly: boolean; structuralGuard: (l: string, id: string, a: (f: Floor) => void) => void; removeSel: (k: string, id: string) => void }) {
  const project = useStore((s) => s.project)!;
  const sel = useStore((s) => s.ui.selection);
  const boq = useMemo(() => computeBoq(project), [project]);
  const approved = project.versions.find((v) => v.id === project.approvedVersionId);
  const co = useMemo(() => (approved ? draftChangeOrder(project, approved) : null), [project, approved]);
  const budget = project.brief.budget > 0 ? project.brief.budget : boq.carpetSqft * BUDGET_BANDS[project.brief.budgetBand].perSqft;
  const showIssues = issues.filter((i) => i.severity !== 'info' || !sel);
  return (
    <div className="col" style={{ gap: 0 }}>
      {sel ? <Props floor={floor} cat={cat} readOnly={readOnly} structuralGuard={structuralGuard} removeSel={removeSel} /> : <div className="muted small">Select anything on the plan or in 3D to edit it. Type exact values, or drag on the plan.</div>}
      <div className="sect">
        <h3>Live cost</h3>
        <div className="row"><div className="stat grow"><span className="v">{inr(boq.total)}</span><span className="l">incl. margin & {project.settings.gstPct}% GST</span></div></div>
        <div className="small" style={{ marginTop: 6 }}>
          {Object.entries(boq.byTrade).sort((a, b) => b[1] - a[1]).map(([t, v]) => <div key={t} className="row"><span className="grow" style={{ textTransform: 'capitalize' }}>{t}</span><span className="mono">{inr(v)}</span></div>)}
        </div>
        <div className={'banner small ' + (boq.total > budget ? 'err' : 'ok')} style={{ marginTop: 6 }}>{boq.total > budget ? `Over budget by ${inr(boq.total - budget)}` : `Within budget (${inr(budget)})`}</div>
        {boq.excludedRooms.length > 0 && <div className="banner warn small" style={{ marginTop: 6 }}>{boq.excludedRooms.length} unconfirmed room(s) excluded from measured quantities.</div>}
        {co && <div className="banner info small" style={{ marginTop: 6 }}>{co.lines.length} BOQ line(s) changed since approval ({inr(co.costDelta)}). Draft a change order in Project → Change orders.</div>}
      </div>
      <div className="sect">
        <h3>Rule checks ({issues.filter((i) => i.severity !== 'info').length})</h3>
        {!showIssues.length && <div className="banner ok small">No violations.</div>}
        <div className="col" style={{ gap: 0, maxHeight: 280, overflow: 'auto' }}>
          {showIssues.slice(0, 60).map((i) => <div key={i.id} className="issue" onClick={() => i.itemIds?.[0] && select({ kind: floor.points.some((p) => p.id === i.itemIds![0]) ? 'point' : 'item', id: i.itemIds[0] })}><span className={'dot ' + i.severity} /><span>{i.msg}</span></div>)}
        </div>
      </div>
      {project.brief.vastu && (
        <div className="sect">
          <h3>Vastu (advisory)</h3>
          {vastuFlags(floor).map((v, i) => <div key={i} className="issue"><span className={'dot ' + (v.status === 'avoid' ? 'warning' : v.status === 'favourable' ? 'info' : 'info')} style={v.status === 'favourable' ? { background: 'var(--ok)' } : undefined} /><span><strong>{v.subject}</strong> · {v.zone}: {v.note}</span></div>)}
        </div>
      )}
    </div>
  );
}

function Props({ floor, cat, readOnly, structuralGuard, removeSel }: { floor: Floor; cat: Catalog; readOnly: boolean; structuralGuard: (l: string, id: string, a: (f: Floor) => void) => void; removeSel: (k: string, id: string) => void }) {
  const project = useStore((s) => s.project)!;
  const sel = useStore((s) => s.ui.selection)!;
  const units = useUnits();
  const upd = (label: string, fn: (f: Floor, p: Project) => void) => mutate(label, (p) => fn(p.floors.find((x) => x.id === floor.id)!, p));
  const dis = readOnly;
  const comments = project.comments.filter((c) => c.targetId === sel.id);

  if (sel.kind === 'item') {
    const it = floor.items.find((i) => i.id === sel.id);
    if (!it) return null;
    const ci = itemById(cat, it.catalogId);
    const room = floor.rooms.find((r) => r.id === it.roomId);
    const line = itemLine(it, room, cat);
    const set = (label: string, fn: (i: Item) => void) => upd(label, (f) => fn(f.items.find((i) => i.id === it.id)!));
    const finishes = cat.materials.filter((m) => m.kind === 'laminate' || m.kind === 'veneer');
    const alts = cat.items.filter((c) => c.category === ci?.category);
    return (
      <div className="col">
        <div className="row"><h2 className="grow" style={{ margin: 0 }}>{ci?.name}</h2>{it.draft && <span className="tag warn">AI draft</span>}{it.existing && <span className="tag">existing</span>}</div>
        <div className="row small" style={{ gap: 4 }}><span className="tag">{ci?.kind === 'sku' ? `SKU ${ci.sku}` : 'Custom joinery'}</span><span className="tag" style={{ textTransform: 'capitalize' }}>{ci?.trade}</span><span className="tag">{room?.name ?? 'no room'}</span></div>
        {it.reason && <div className="banner info small" title={it.prov ? `${it.prov.engine} · seed ${it.prov.seed} · ${it.prov.catalogVersion} · ${it.prov.rulePack}` : undefined}>Why here: {it.reason}{it.prov && <><br /><span className="mono">{it.prov.engine} · seed {it.prov.seed} · {it.prov.catalogVersion}</span></>}</div>}
        <Field label="Catalog item"><select className="i" disabled={dis} value={it.catalogId} onChange={(e) => set('Swapped catalog item', (i) => { const n = itemById(cat, e.target.value)!; i.catalogId = n.id; if (!n.joinery) { i.w = n.w; i.d = n.d; i.h = n.h; } })}>{alts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
        <div className="fields" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
          <Field label="W"><LenInput units={units} disabled={dis} value={it.w} min={1} onChange={(v) => set('Resized item', (i) => { i.w = v; })} /></Field>
          <Field label="D"><LenInput units={units} disabled={dis} value={it.d} min={1} onChange={(v) => set('Resized item', (i) => { i.d = v; })} /></Field>
          <Field label="H"><LenInput units={units} disabled={dis} value={it.h} min={1} onChange={(v) => set('Resized item', (i) => { i.h = v; })} /></Field>
          <Field label="X"><LenInput units={units} disabled={dis} value={it.pos.x} onChange={(v) => set('Moved item', (i) => { i.pos.x = v; })} /></Field>
          <Field label="Y"><LenInput units={units} disabled={dis} value={it.pos.y} onChange={(v) => set('Moved item', (i) => { i.pos.y = v; })} /></Field>
          <Field label="Elevation"><LenInput units={units} disabled={dis} value={it.elev} onChange={(v) => set('Item elevation', (i) => { i.elev = v; })} /></Field>
          <Field label="Rotation °"><NumInput disabled={dis} value={it.rot} onChange={(v) => set('Rotated item', (i) => { i.rot = ((v % 360) + 360) % 360; })} /></Field>
        </div>
        {ci?.joinery && (
          <>
            <Field label="Laminate / veneer (outer faces)"><select className="i" disabled={dis} value={it.finish ?? ''} onChange={(e) => set('Changed finish', (i) => { i.finish = e.target.value; })}>{finishes.map((m) => <option key={m.id} value={m.id}>{m.name} · {m.code}</option>)}</select></Field>
            <div className="fields" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <Field label="Shutters"><select className="i" disabled={dis} value={it.joinery?.shutter ?? 'hinged'} onChange={(e) => set('Shutter type', (i) => { i.joinery = { ...(i.joinery ?? { shutter: 'hinged' }), shutter: e.target.value as 'hinged' }; })}>{['hinged', 'sliding', 'open', 'drawer'].map((s) => <option key={s}>{s}</option>)}</select></Field>
              <Field label="No. of shutters"><NumInput disabled={dis} value={it.joinery?.shutters ?? 0} onChange={(v) => set('Shutter count', (i) => { i.joinery = { ...(i.joinery ?? { shutter: 'hinged' }), shutters: v || undefined }; })} /></Field>
            </div>
            <Field label="Handle"><TextInput value={it.joinery?.handle ?? ''} placeholder="e.g. G-profile, handle-less" onChange={(v) => set('Handle', (i) => { i.joinery = { ...(i.joinery ?? { shutter: 'hinged' }), handle: v }; })} /></Field>
            {!dis && <div className="row"><button className="btn sm" onClick={() => upd('Bulk finish (room)', (f) => { for (const i of f.items) if (i.roomId === it.roomId && itemById(cat, i.catalogId)?.joinery) i.finish = it.finish; })}>Apply finish to room</button><button className="btn sm" onClick={() => mutate('Bulk finish (project)', (p) => { for (const f of p.floors) for (const i of f.items) if (itemById(cat, i.catalogId)?.joinery) i.finish = it.finish; })}>…to whole project</button></div>}
          </>
        )}
        {line && <div className="row small"><span className="grow">{line.qty} {line.unit} × {inr(line.rate)}</span><strong>{inr(line.amount)}</strong></div>}
        {ci && <div className="muted small">{ci.spec.brand} · {ci.spec.series} · {ci.spec.grade}{ci.spec.thickness ? ` · ${ci.spec.thickness}` : ''}</div>}
        {!dis && (
          <div className="row">
            {it.draft && <button className="btn sm primary" onClick={() => set('Accepted draft', (i) => { i.draft = false; })}>Accept</button>}
            {room && <button className="btn sm" title="GEN-15: regenerate just this element" onClick={() => {
              const inp = buildInput(project, floor, room.id, Math.floor(Math.random() * 1e6));
              const n = regenerateItem(inp, it, Math.floor(Math.random() * 1e6));
              if (!n) { toast('No other position or variant fits here', 'warn'); return; }
              set('Tried another variant', (i) => { Object.assign(i, { ...n, id: i.id, draft: true }); });
            }}>Try another</button>}
            <button className="btn sm" onClick={() => set('Rotated item', (i) => { i.rot = (i.rot + 90) % 360; })}>Rotate 90°</button>
            <button className="btn sm danger" onClick={() => removeSel('item', it.id)}>Delete</button>
          </div>
        )}
        <Comments targetId={it.id} comments={comments} />
      </div>
    );
  }
  if (sel.kind === 'point') {
    const pt = floor.points.find((i) => i.id === sel.id);
    if (!pt) return null;
    const set = (label: string, fn: (i: MepPoint) => void) => upd(label, (f) => fn(f.points.find((i) => i.id === pt.id)!));
    const e = designElectrical(floor);
    return (
      <div className="col">
        <div className="row"><h2 className="grow" style={{ margin: 0 }}>{POINTS[pt.kind].name}</h2>{pt.draft && <span className="tag warn">AI draft</span>}</div>
        <div className="fields">
          <Field label="Type"><select className="i" disabled={dis} value={pt.kind} onChange={(ev) => set('Point type', (i) => { i.kind = ev.target.value as PointKind; })}>{(Object.keys(POINTS) as PointKind[]).map((k) => <option key={k} value={k}>{POINTS[k].name}</option>)}</select></Field>
          <Field label="Height from FFL"><LenInput units={units} disabled={dis} value={pt.height} onChange={(v) => set('Point height', (i) => { i.height = v; })} /></Field>
          <Field label="Watts"><NumInput disabled={dis} value={pt.watts ?? POINTS[pt.kind].watts} onChange={(v) => set('Point watts', (i) => { i.watts = v; })} /></Field>
          <Field label="Label"><TextInput value={pt.label ?? ''} onChange={(v) => set('Point label', (i) => { i.label = v; })} /></Field>
        </div>
        {POINTS[pt.kind].trade === 'electrical' && (
          <Field label="Circuit" hint={`auto: ${e.assignments[pt.id] ?? '—'}`}><select className="i" disabled={dis} value={pt.circuitManual ? pt.circuit : ''} onChange={(ev) => set('Circuit assignment', (i) => { i.circuit = ev.target.value || undefined; i.circuitManual = !!ev.target.value; })}><option value="">Automatic</option>{e.circuits.map((c) => <option key={c.id} value={c.id}>{c.id} – {c.label}</option>)}<option value="P9">New power circuit P9</option></select></Field>
        )}
        <div className="muted small">{POINTS[pt.kind].spec.series} · {POINTS[pt.kind].spec.grade}</div>
        {!dis && <div className="row">{pt.draft && <button className="btn sm primary" onClick={() => set('Accepted point', (i) => { i.draft = false; })}>Accept</button>}<button className="btn sm danger" onClick={() => removeSel('point', pt.id)}>Delete</button></div>}
      </div>
    );
  }
  if (sel.kind === 'room') {
    const r = floor.rooms.find((x) => x.id === sel.id);
    if (!r) return null;
    return <RoomProps floor={floor} room={r} cat={cat} readOnly={readOnly} />;
  }
  if (sel.kind === 'wall') {
    const w = floor.walls.find((x) => x.id === sel.id);
    if (!w) return null;
    const set = (label: string, fn: (x: Wall) => void) => { if (w.structural) structuralGuard(label, w.id, (f) => fn(f.walls.find((x) => x.id === w.id)!)); else upd(label, (f) => fn(f.walls.find((x) => x.id === w.id)!)); };
    return (
      <div className="col">
        <div className="row"><h2 className="grow" style={{ margin: 0 }}>Wall</h2>{w.structural && <span className="tag err">structural</span>}<span className="tag">{w.status}</span></div>
        <div className="muted small">{fmtLen(dist(w.a, w.b), units)} long · {w.exterior ? 'external' : 'internal'}</div>
        <div className="fields">
          <Field label="Thickness"><LenInput units={units} disabled={dis || w.structural} value={w.thickness} onChange={(v) => set('Wall thickness', (x) => { x.thickness = v; })} /></Field>
          <Field label="Status"><select className="i" disabled={dis} value={w.status} onChange={(e) => set('Wall status', (x) => { x.status = e.target.value as Wall['status']; })}><option value="existing">existing</option><option value="new">new construction</option><option value="demolish">demolish</option></select></Field>
        </div>
        {!dis && <div className="row">
          <button className="btn sm" onClick={() => upd('Added door', (f) => { f.openings.push({ id: uid('op'), wallId: w.id, kind: 'door', offset: dist(w.a, w.b) / 2, width: 900, height: 2100, sill: 0, swing: { hinge: 'a', side: 1 } }); })}>Add door</button>
          <button className="btn sm" onClick={() => upd('Added window', (f) => { f.openings.push({ id: uid('op'), wallId: w.id, kind: 'window', offset: dist(w.a, w.b) / 2, width: 1200, height: 1200, sill: 900 }); })}>Add window</button>
          <button className="btn sm danger" onClick={() => removeSel('wall', w.id)}>{w.status === 'new' ? 'Delete' : 'Demolish'}</button>
        </div>}
      </div>
    );
  }
  if (sel.kind === 'opening') {
    const o = floor.openings.find((x) => x.id === sel.id);
    if (!o) return null;
    type Op = NonNullable<typeof o>;
    const set = (label: string, fn: (x: Op) => void) => upd(label, (f) => fn(f.openings.find((x) => x.id === o.id)!));
    return (
      <div className="col">
        <h2>{o.kind[0].toUpperCase() + o.kind.slice(1)}</h2>
        <div className="fields">
          <Field label="Width"><LenInput units={units} disabled={dis} value={o.width} onChange={(v) => set('Opening width', (x) => { x.width = v; })} /></Field>
          <Field label="Height"><LenInput units={units} disabled={dis} value={o.height} onChange={(v) => set('Opening height', (x) => { x.height = v; })} /></Field>
          <Field label="Sill"><LenInput units={units} disabled={dis} value={o.sill} onChange={(v) => set('Sill height', (x) => { x.sill = v; })} /></Field>
          <Field label="Position on wall"><LenInput units={units} disabled={dis} value={o.offset} onChange={(v) => set('Moved opening', (x) => { x.offset = v; })} /></Field>
        </div>
        {o.kind === 'door' && !dis && <div className="row"><button className="btn sm" onClick={() => set('Flipped hinge', (x) => { x.swing = { hinge: x.swing?.hinge === 'a' ? 'b' : 'a', side: x.swing?.side ?? 1 }; })}>Flip hinge</button><button className="btn sm" onClick={() => set('Flipped swing', (x) => { x.swing = { hinge: x.swing?.hinge ?? 'a', side: (x.swing?.side ?? 1) === 1 ? -1 : 1 }; })}>Swing other side</button></div>}
        {!dis && <button className="btn sm danger" onClick={() => removeSel('opening', o.id)}>Delete opening</button>}
      </div>
    );
  }
  if (sel.kind === 'column') {
    const c = floor.columns.find((x) => x.id === sel.id);
    if (!c) return null;
    return <div className="col"><div className="row"><h2 className="grow" style={{ margin: 0 }}>{c.kind}</h2><span className="tag err">structural, read-only</span></div><div className="small">{Math.round(c.w)} × {Math.round(c.d)} mm</div>{!dis && <button className="btn sm danger" onClick={() => removeSel('column', c.id)}>Remove (needs engineer note)</button>}</div>;
  }
  if (sel.kind === 'annotation') {
    const a = floor.annotations.find((x) => x.id === sel.id);
    if (!a) return null;
    return <div className="col"><h2>Dimension</h2><div>{fmtLen(dist(a.a, a.b), units)}</div><Field label="Text override"><TextInput value={a.text ?? ''} onChange={(v) => upd('Dimension text', (f) => { f.annotations.find((x) => x.id === a.id)!.text = v || undefined; })} /></Field>{!dis && <button className="btn sm danger" onClick={() => removeSel('annotation', a.id)}>Delete</button>}</div>;
  }
  if (sel.kind === 'snag') {
    const s = project.snags.find((x) => x.id === sel.id);
    if (!s) return null;
    return <div className="col"><h2>Snag</h2><div>{s.title}</div><div className="row small"><span className="tag">{s.trade}</span><span className="tag">{s.status}</span><span className="muted">due {s.due}</span></div><div className="muted small">Manage snags in Project & site → Snag list.</div></div>;
  }
  if (sel.kind === 'comment') {
    const c = project.comments.find((x) => x.id === sel.id);
    if (!c) return null;
    return <div className="col"><h2>Comment</h2><div><strong>{c.author}</strong>: {c.text}</div><button className="btn sm" onClick={() => mutate('Resolved comment', (p) => { p.comments.find((x) => x.id === c.id)!.resolved = true; })}>Resolve</button></div>;
  }
  return null;
}

function Comments({ targetId, comments }: { targetId: string; comments: { id: string; author: string; text: string; at: string; resolved?: boolean }[] }) {
  const [t, setT] = useState('');
  return (
    <div className="sect col">
      <h3>Comments</h3>
      {comments.map((c) => <div key={c.id} className="small"><strong>{c.author}</strong>: {c.text} {c.resolved && <span className="tag ok">resolved</span>}</div>)}
      <div className="row"><input className="i grow" placeholder="Add a comment for client / trade…" value={t} onChange={(e) => setT(e.target.value)} />
        <button className="btn sm" disabled={!t.trim()} onClick={() => { const s = useStoreGet(); const it = s.floor?.items.find((i) => i.id === targetId) ?? s.floor?.points.find((p) => p.id === targetId); mutate('Added comment', (p) => { p.comments.push({ id: uid('cm'), floorId: s.floor!.id, pos: it?.pos ?? { x: 0, y: 0 }, targetId, author: p.settings.user, text: t.trim(), at: nowIso() }); }); setT(''); }}>Post</button></div>
    </div>
  );
}
function useStoreGet() { return { floor: activeFloor(getState()) }; }

function RoomProps({ floor, room: r, cat, readOnly }: { floor: Floor; room: Room; cat: Catalog; readOnly: boolean }) {
  const project = useStore((s) => s.project)!;
  const units = useUnits();
  const dis = readOnly;
  const set = (label: string, fn: (x: Room) => void) => mutate(label, (p) => { const x = p.floors.find((f) => f.id === floor.id)!.rooms.find((q) => q.id === r.id); if (x) fn(x); });
  const m = measureRoom(floor, r);
  const L = lightingFor(floor, r, themeById(project.theme).cct);
  const edges = roomEdges(floor, r);
  const mats = (k: string[]) => cat.materials.filter((x) => k.includes(x.kind));
  const opts = project.generation[r.id] ?? [];
  return (
    <div className="col">
      <div className="row"><h2 className="grow" style={{ margin: 0 }}>{r.name}</h2>{r.det && !r.det.confirmed && <span className="tag warn">unconfirmed</span>}</div>
      <div className="muted small">{fmtArea(m.floorArea, units)} · {fmtLen(m.width, units)} × {fmtLen(m.depth, units)} · finished ceiling {fmtLen(m.ceilingHeight, units)}</div>
      <div className="fields">
        <Field label="Status"><select className="i" disabled={dis && project.settings.role !== 'client'} value={r.status} onChange={(e) => set('Room status', (x) => { x.status = e.target.value as Room['status']; })}>{['concept', 'design', 'approved', 'execution', 'done'].map((s) => <option key={s}>{s}</option>)}</select></Field>
        <Field label="Slab height"><LenInput units={units} disabled={dis} value={r.ceilingHeight} onChange={(v) => set('Ceiling height', (x) => { x.ceilingHeight = v; })} /></Field>
      </div>
      <label className="row small"><input type="checkbox" disabled={dis} checked={r.falseCeiling.enabled} onChange={(e) => set('False ceiling', (x) => { x.falseCeiling.enabled = e.target.checked; })} /> False ceiling</label>
      {r.falseCeiling.enabled && <div className="fields"><Field label="Drop"><LenInput units={units} disabled={dis} value={r.falseCeiling.drop} onChange={(v) => set('Ceiling drop', (x) => { x.falseCeiling.drop = v; })} /></Field><label className="row small"><input type="checkbox" disabled={dis} checked={r.falseCeiling.cove} onChange={(e) => set('Cove', (x) => { x.falseCeiling.cove = e.target.checked; })} /> Cove light</label></div>}
      <h3 style={{ marginTop: 6 }}>Finishes</h3>
      <Field label="Floor"><select className="i" disabled={dis} value={r.finishes.floor} onChange={(e) => set('Floor finish', (x) => { x.finishes.floor = e.target.value; })}>{mats(['floor', 'stone']).map((x) => <option key={x.id} value={x.id}>{x.name} · ₹{x.rate}/sq ft</option>)}</select></Field>
      <Field label="Walls"><select className="i" disabled={dis} value={r.finishes.wall} onChange={(e) => set('Wall finish', (x) => { x.finishes.wall = e.target.value; })}>{mats(['paint', 'wallpaper', 'tile']).map((x) => <option key={x.id} value={x.id}>{x.name} · {x.code}</option>)}</select></Field>
      <div className="fields" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <Field label="Accent wall"><select className="i" disabled={dis} value={r.finishes.accentWall ?? ''} onChange={(e) => set('Accent wall', (x) => { x.finishes.accentWall = e.target.value === '' ? undefined : +e.target.value; })}><option value="">none</option>{edges.map((e) => <option key={e.i} value={e.i}>Wall {e.i + 1} ({(e.len / 1000).toFixed(2)} m)</option>)}</select></Field>
        <Field label="Accent finish"><select className="i" disabled={dis} value={r.finishes.accent ?? ''} onChange={(e) => set('Accent finish', (x) => { x.finishes.accent = e.target.value || undefined; })}><option value="">—</option>{mats(['paint', 'wallpaper']).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
      </div>
      <Field label="Skirting"><select className="i" disabled={dis} value={r.finishes.skirting} onChange={(e) => set('Skirting', (x) => { x.finishes.skirting = e.target.value; })}><option value="">none</option>{mats(['skirting']).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
      {!dis && <div className="row">
        <button className="btn sm" onClick={() => mutate('Bulk floor finish', (p) => { for (const f of p.floors) for (const x of f.rooms) if (!['toilet', 'balcony', 'utility'].includes(x.type)) x.finishes.floor = r.finishes.floor; })}>Floor → all dry rooms</button>
        {opts.length > 1 && <button className="btn sm" title="GEN-15: change only the finishes" onClick={() => { const cur = opts.findIndex((o) => o.finishes.floor === r.finishes.floor && o.finishes.wall === r.finishes.wall); const nx = opts[(cur + 1) % opts.length]; set('Changed only finishes', (x) => { x.finishes = { ...nx.finishes }; }); }}>Try other finishes</button>}
      </div>}
      <h3 style={{ marginTop: 6 }}>Lighting (lumen method)</h3>
      <div className={'banner small ' + (L.achieved >= L.target * 0.9 ? 'ok' : 'warn')}>Target {L.target} lux · achieved ≈ {L.achieved} lux with {L.fixtures} downlight(s){L.achieved < L.target * 0.9 ? ` – add ~${Math.max(1, L.needed - L.fixtures)}` : ''} · {L.cct} K · load {Math.round(L.connectedLoad)} W</div>
      <h3 style={{ marginTop: 6 }}>Walls</h3>
      <table className="t small"><tbody>{m.edges.map((e) => <tr key={e.i}><td>Wall {e.i + 1}</td><td className="num">{fmtLen(e.len, units)}{e.site ? ` (site ${Math.round(e.site)})` : ''}</td><td className="num">{(e.net / 1e6).toFixed(2)} m² net</td></tr>)}</tbody></table>
      <div className="muted small">{centroid(r.polygon).x.toFixed(0)}, {centroid(r.polygon).y.toFixed(0)}</div>
    </div>
  );
}
