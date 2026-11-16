import React, { useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { useStore, mutate, activeFloor, toast, setUi } from '../store';
import type { Floor, Project, Trade } from '../core/types';
import { computeBoq, quoteAmount } from '../core/boq';
import { issueReadiness, nextRevision, changedSince, modelHash } from '../core/project';
import { joineryUnits, nest } from '../core/joinery';
import { exportFloorDxf, exportNestingDxf } from '../core/exportDxf';
import { areaStatement } from '../core/measure';
import { designElectrical } from '../core/electrical';
import * as SCH from '../core/schedules';
import { itemById, materialById, POINTS } from '../core/catalog';
import { inr, toCsv } from '../core/util';
import { buildScene } from './View3D';
import { Modal, download, useCatalog, useUnits } from './common';
import { Sheet, SheetWithPlan, ElevationsSheet, SectionsSheet, JoineryElevations, NestingSheet, ScheduleSheet, legendFor, useQr, type SheetMeta } from './Sheets';
import type { PlanOpts } from './Plan';

type Pkg = Trade | 'all' | 'client' | 'handover';
const PKGS: { id: Pkg; label: string }[] = [
  { id: 'all', label: 'Full drawing set' }, { id: 'civil', label: 'Civil / masonry' }, { id: 'carpentry', label: 'Carpenter / modular' }, { id: 'electrical', label: 'Electrician' },
  { id: 'plumbing', label: 'Plumber' }, { id: 'hvac', label: 'HVAC' }, { id: 'painting', label: 'Painter / finishes' }, { id: 'client', label: 'Client' }, { id: 'handover', label: 'Handover pack' },
];
const ELEC = ['switchboard', 'socket6', 'socket16', 'ac', 'tv', 'data', 'db', 'geyser', 'light', 'cove', 'fan', 'exhaust'];
const PLUMB = ['inlet-cold', 'inlet-hot', 'outlet', 'floor-trap'];

interface SheetDef { no: string; title: string; render: (meta: SheetMeta) => React.ReactNode }

export function ExportView() {
  const project = useStore((s) => s.project)!;
  const liveFloor = useStore((s) => activeFloor(s));
  const shareTrade = useStore((s) => s.ui.shareTrade);
  const role = project.settings.role;
  const [pkg, setPkg] = useState<Pkg>(role === 'trade' ? project.settings.tradeView : role === 'client' ? 'client' : shareTrade ?? 'all');
  useEffect(() => { if (role === 'trade') setPkg(project.settings.tradeView); }, [role, project.settings.tradeView]);
  const [issue, setIssue] = useState(false);
  const [renders, setRenders] = useState<string[]>([]);
  const cat = useCatalog(project);
  const units = useUnits();
  const revs = project.revisions.filter((r) => r.trade === (pkg === 'client' || pkg === 'handover' ? 'all' : pkg));
  const latest = revs[revs.length - 1];
  // EXP-04: trades always see the latest issued revision, not the designer's working copy
  const tradeView = role === 'trade' || role === 'client';
  const floor: Floor | undefined = tradeView && latest?.floors ? latest.floors.find((f) => f.id === liveFloor?.id) ?? latest.floors[0] : liveFloor;
  const shareUrl = `${location.origin}${location.pathname}#/package/${project.id}/${pkg}`;
  const qr = useQr(shareUrl + (latest ? `?rev=${latest.no}` : ''));
  const clouds = useMemo(() => (tradeView ? new Set<string>() : changedSince(project, pkg === 'client' || pkg === 'handover' ? 'all' : pkg)), [project, pkg, tradeView]);
  const stale = latest && latest.hash !== modelHash(project);

  useEffect(() => {
    // EXP-05: record who viewed which revision
    if (tradeView && latest && !latest.viewers.some((v) => v.by === project.settings.user)) mutate(`${project.settings.user} viewed ${pkg} R${latest.no}`, (p) => { p.revisions.find((r) => r.id === latest.id)!.viewers.push({ by: p.settings.user, at: new Date().toISOString() }); }, { history: false, audit: true });
  }, [tradeView, latest?.id]);

  const sheets = useMemo<SheetDef[]>(() => (floor ? buildSheets(project, floor, cat, pkg, units, clouds, renders) : []), [project, floor, cat, pkg, units, clouds, renders]);
  if (!floor) return <div className="page"><div className="card">Import a drawing first.</div></div>;

  const metaBase = (no: string, title: string): SheetMeta => ({ project, no, title, trade: pkg, revisions: revs, ifc: true, qr, lang: project.settings.sheetLanguage, north: floor.northDeg });
  const captureRenders = () => {
    const shots: string[] = [];
    try {
      const r = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
      r.setSize(1400, 800); r.shadowMap.enabled = true; r.toneMapping = THREE.ACESFilmicToneMapping;
      const { scene, center, extent } = buildScene(floor, cat, {});
      const cam = new THREE.PerspectiveCamera(45, 1400 / 800, 0.05, 500);
      for (const [dx, dz] of [[0.6, 0.8], [-0.7, 0.6], [0.1, -0.9]]) { cam.position.set(center.x + extent * dx, extent * 0.8, center.z + extent * dz); cam.lookAt(center); r.render(scene, cam); shots.push(r.domElement.toDataURL('image/jpeg', 0.85)); }
      const live = (window as unknown as { __ibt3d?: { snapshot: () => string } }).__ibt3d;
      if (live) shots.push(live.snapshot());
      r.dispose();
    } catch { toast('WebGL is not available for renders in this browser', 'warn'); }
    setRenders(shots);
  };
  const glb = () => {
    const { scene } = buildScene(floor, cat, {});
    new GLTFExporter().parse(scene, (g) => download(`${project.name} – ${floor.name}.glb`, new Blob([g as ArrayBuffer], { type: 'model/gltf-binary' })), () => toast('GLB export failed', 'err'), { binary: true });
  };
  const schedulesFor = (): SCH.Schedule[] => scheduleList(project, floor, cat, pkg);
  const csv = () => { const list = schedulesFor(); for (const s of list) download(`${project.name} – ${s.title}.csv`, toCsv([s.head, ...s.rows]), 'text/csv'); };
  const units_ = pkg === 'carpentry' || pkg === 'all' ? joineryUnits({ floors: [floor] }, cat) : [];

  return (
    <div className="page" style={{ maxWidth: 'none' }}>
      <h1>Trade packages</h1>
      <p className="sub">One click builds a complete, dimensioned set; each trade gets only the sheets, schedules and specs it builds from.</p>
      <div className="grid" style={{ gridTemplateColumns: '260px 1fr', alignItems: 'start' }}>
        <div className="col no-print" style={{ position: 'sticky', top: 0 }}>
          <div className="card col">
            <h3>Package</h3>
            <div className="list">{PKGS.filter((p) => role !== 'trade' || p.id === project.settings.tradeView).filter((p) => role !== 'client' || p.id === 'client' || p.id === 'handover').map((p) => <div key={p.id} className={'li' + (pkg === p.id ? ' on' : '')} onClick={() => { setPkg(p.id); setUi({ shareTrade: p.id === 'client' || p.id === 'handover' ? undefined : p.id }); }}>{p.label}</div>)}</div>
          </div>
          <div className="card col">
            <h3>Revision</h3>
            {latest ? <div className="small">R{latest.no} · {latest.ifc ? <span className="tag ok">IFC</span> : <span className="tag warn">draft</span>} · {new Date(latest.at).toLocaleDateString()} by {latest.by}{latest.viewers.length > 0 && <div className="muted">Viewed by {latest.viewers.map((v) => v.by).join(', ')}</div>}</div> : <div className="muted small">Not issued yet.</div>}
            {stale && !tradeView && <div className="banner warn small">Model changed since R{latest!.no}{clouds.size ? ` – ${clouds.size} change(s) clouded on sheets` : ''}. Re-issue so trades get the update.</div>}
            {tradeView && latest && stale && <div className="banner info small">You are viewing the latest issued revision R{latest.no}.</div>}
            {!tradeView && <button className="btn primary" onClick={() => setIssue(true)}>Issue revision…</button>}
          </div>
          <div className="card col">
            <h3>Downloads</h3>
            <button className="btn" onClick={() => window.print()}>Print / save PDF ({sheets.length} sheets, A3)</button>
            <button className="btn" onClick={() => download(`${project.name} – ${floor.name} – ${pkg}.dxf`, exportFloorDxf(project, floor, pkg === 'client' || pkg === 'handover' ? 'all' : pkg), 'application/dxf')}>DWG-ready DXF (layered)</button>
            <button className="btn" onClick={csv}>Schedules – Excel (CSV)</button>
            {(pkg === 'carpentry' || pkg === 'all') && <button className="btn" onClick={() => download(`${project.name} – CNC nesting.dxf`, exportNestingDxf(nest(units_.flatMap((u) => u.panels).filter((p) => p.t === 18)).boards), 'application/dxf')}>CNC nesting DXF</button>}
            {(pkg === 'carpentry' || pkg === 'all') && <button className="btn" onClick={() => download(`${project.name} – cut list.csv`, toCsv([['Tag', 'Unit', 'Room', 'Part', 'Length', 'Width', 'Thk', 'Qty', 'Material', 'Grain', 'Edge band', 'Outer face', 'Inner face'], ...units_.flatMap((u) => u.panels.map((p) => [p.tag, u.unit, u.room, p.name, p.l, p.w, p.t, p.qty, p.material, p.grain, p.edge, p.faceOut, p.faceIn]))]), 'text/csv')}>Cut list – CSV</button>}
            <button className="btn" onClick={glb}>3D model (GLB)</button>
            {pkg === 'client' && <button className="btn" onClick={captureRenders}>Capture renders</button>}
            <button className="btn" onClick={() => { navigator.clipboard?.writeText(shareUrl); toast('Share link copied – trades open it without the editor'); }}>Copy share link</button>
            <div className="muted small">The DXF keeps blocks, units (mm) and your firm's layer standard. Convert to DWG with the ODA converter or AutoCAD.</div>
          </div>
          <div className="card col">
            <h3>Sheets</h3>
            <div className="sheet-list small">{sheets.map((s) => <a key={s.no} href={'#sheet-' + s.no}>{s.no} · {s.title}</a>)}</div>
          </div>
        </div>
        <div className="sheets print-area">
          {sheets.map((s) => <div key={s.no} id={'sheet-' + s.no} style={{ width: '100%' }}>{s.render(metaBase(s.no, s.title))}</div>)}
        </div>
      </div>
      {issue && <IssueModal pkg={pkg} onClose={() => setIssue(false)} />}
    </div>
  );
}

function IssueModal({ pkg, onClose }: { pkg: Pkg; onClose: () => void }) {
  const project = useStore((s) => s.project)!;
  const trade = pkg === 'client' || pkg === 'handover' ? 'all' : pkg;
  const blockers = issueReadiness(project, trade);
  const blocked = blockers.some((b) => b.level === 'block');
  const [note, setNote] = useState(project.revisions.some((r) => r.trade === trade) ? 'Revised per site query / client change' : 'First issue');
  const go = (ifc: boolean) => {
    mutate(`Issued ${trade} R${project.revisions.filter((r) => r.trade === trade).length}${ifc ? ' for construction' : ' (draft)'}`, (p) => { p.revisions.push(nextRevision(p, trade, note, ifc)); }, { audit: true });
    toast(ifc ? 'Issued for construction' : 'Issued as a draft (not for construction)');
    onClose();
  };
  return (
    <Modal title={`Issue ${pkg} package`} onClose={onClose}>
      <div className="col">
        <div className="muted small">Nothing reaches a trade as “Issued for construction” until detection is confirmed, AI drafts are accepted, rules pass, site re-measure is resolved and structural flags are signed off.</div>
        {blockers.map((b, i) => <div key={i} className={'banner small ' + (b.level === 'block' ? 'err' : 'warn')}>{b.level === 'block' ? '⛔' : '⚠'} {b.msg}</div>)}
        {!blockers.length && <div className="banner ok small">All checks pass.</div>}
        {project.flags.filter((f) => !f.reviewed).map((f) => (
          <div key={f.id} className="row small"><span className="grow">Structural: {f.action} – “{f.sourceNote}” ({f.raisedBy})</span><button className="btn sm" onClick={() => { const by = prompt('Reviewed by (licensed engineer / architect, reg. no.)'); if (by) mutate('Structural change reviewed', (p) => { p.flags.find((x) => x.id === f.id)!.reviewed = { by, at: new Date().toISOString() }; }, { audit: true }); }}>Record sign-off</button></div>
        ))}
        <label className="f"><span>Revision note</span><input className="i" value={note} onChange={(e) => setNote(e.target.value)} /></label>
        <div className="row"><span className="grow" /><button className="btn" onClick={() => go(false)}>Issue as draft</button><button className="btn primary" disabled={blocked} onClick={() => go(true)}>Issue for construction</button></div>
      </div>
    </Modal>
  );
}

function scheduleList(p: Project, f: Floor, cat: ReturnType<typeof useCatalog>, pkg: Pkg): SCH.Schedule[] {
  const [doors, windows] = SCH.doorWindowSchedule(f);
  const fin = SCH.finishSchedule(f, cat);
  const area = SCH.areaStatementSchedule(f, areaStatement(f));
  switch (pkg) {
    case 'civil': return [windows, doors, area];
    case 'carpentry': return [SCH.furnitureSchedule(p, f, cat), doors];
    case 'electrical': return [...SCH.electricalSchedules(f), SCH.lightingSchedule(p, f), SCH.applianceSchedule(p, f, cat)];
    case 'plumbing': return SCH.plumbingSchedules(p, f, cat);
    case 'hvac': return [SCH.hvacSchedule(f, cat)];
    case 'painting': return [fin];
    default: return [area, doors, windows, fin, SCH.furnitureSchedule(p, f, cat), SCH.sanitarySchedule(p, f, cat), SCH.lightingSchedule(p, f), SCH.applianceSchedule(p, f, cat), ...SCH.electricalSchedules(f), ...SCH.plumbingSchedules(p, f, cat).slice(0, 2), SCH.hvacSchedule(f, cat)];
  }
}

function buildSheets(p: Project, f: Floor, cat: ReturnType<typeof useCatalog>, pkg: Pkg, units: ReturnType<typeof useUnits>, clouds: Set<string>, renders: string[]): SheetDef[] {
  const base: PlanOpts = { layers: { underlay: false, vastu: false }, units, clouds, tags: true };
  const S: SheetDef[] = [];
  const prefix = { all: 'A', civil: 'C', carpentry: 'J', electrical: 'E', plumbing: 'P', hvac: 'M', painting: 'F', client: 'CL', handover: 'H', furniture: 'J', decor: 'D' }[pkg];
  const add = (title: string, render: SheetDef['render']) => S.push({ no: `${prefix}-${String(S.length + 1).padStart(2, '0')}`, title, render });
  const plan = (title: string, opts: PlanOpts, legend?: SheetMeta['legend'], note?: React.ReactNode) => add(title, (m) => <SheetWithPlan meta={{ ...m, legend }} floor={f} cat={cat} opts={{ ...base, ...opts }} note={note} />);
  const elevRooms = (filter: (r: typeof f.rooms[number]) => boolean, title: string) => { for (const r of f.rooms.filter(filter)) add(`${title} – ${r.name}`, (m) => <ElevationsSheet meta={m} floor={f} room={r} cat={cat} />); };
  const units_ = joineryUnits({ floors: [f] }, cat);
  const sch = scheduleList(p, f, cat, pkg);
  const elecLegend = legendFor(ELEC), plumbLegend = legendFor(PLUMB);
  const noFurn = { furniture: false, decor: false, carpentry: false };
  const noMep = { electrical: false, plumbing: false, hvac: false };

  if (pkg === 'all') {
    add('Drawing set index & transmittal', (m) => <Sheet meta={m} html={<IndexHtml p={p} />} />);
    plan('Floor plan (dimensioned)', { layers: { ...base.layers, ...noFurn, ...noMep }, dims: true, roomDims: true });
    plan('Furniture layout', { layers: { ...base.layers, ...noMep } });
    plan('Electrical layout', { layers: { ...base.layers, ...noFurn, plumbing: false }, pointFilter: (k) => ELEC.includes(k), pointHeights: true, circuits: designElectrical(f).assignments }, elecLegend);
    plan('Plumbing layout', { layers: { ...base.layers, ...noFurn, electrical: false }, pointFilter: (k) => PLUMB.includes(k), pointHeights: true, itemFilter: (t) => t === 'plumbing' }, plumbLegend);
    plan('Reflected ceiling plan', { layers: { ...base.layers, ...noFurn }, rcp: true, pointFilter: (k) => ['light', 'cove', 'fan', 'exhaust'].includes(k) }, legendFor(['light', 'cove', 'fan', 'exhaust']));
    add('Sections', (m) => <SectionsSheet meta={m} floor={f} />);
    add('Schedules', (m) => <ScheduleSheet meta={m} schedules={sch.slice(0, 4)} />);
    add('Schedules (continued)', (m) => <ScheduleSheet meta={m} schedules={sch.slice(4, 8)} />);
    add('Schedules (MEP)', (m) => <ScheduleSheet meta={m} schedules={sch.slice(8)} />);
    return S;
  }
  if (pkg === 'civil') {
    plan('Demolition plan', { layers: { ...base.layers, ...noFurn, ...noMep }, demo: 'demolition', dims: true }, [{ sym: '- -', label: 'Wall to demolish', color: '#c0392b' }]);
    plan('New construction plan', { layers: { ...base.layers, ...noFurn, ...noMep }, demo: 'construction', dims: true, roomDims: true }, [{ sym: '▮', label: 'New wall (AAC, 115)', color: '#4f8a5b' }]);
    plan('Flooring layout', { layers: { ...base.layers, ...noFurn, ...noMep }, tiles: true, roomDims: true }, [{ sym: '●', label: 'Tile start point', color: '#c0392b' }]);
    plan('Reflected ceiling plan', { layers: { ...base.layers, ...noFurn }, rcp: true, pointFilter: (k) => ['light', 'cove', 'fan', 'exhaust'].includes(k) }, legendFor(['light', 'cove', 'fan']));
    add('Sections', (m) => <SectionsSheet meta={m} floor={f} />);
    const boq = computeBoq(p, [f]);
    const qty = boq.lines.filter((l) => l.trade === 'civil');
    add('Material quantities & specifications', (m) => <ScheduleSheet meta={m} schedules={[{ id: 'civil-qty', title: 'Civil material quantities (incl. wastage)', trade: 'civil', head: ['Room', 'Item', 'Specification', 'Qty', 'Unit'], rows: qty.map((l) => [l.room, l.desc, `${l.spec.series} · ${l.spec.grade}`, l.qty, l.unit]) }, ...sch]} intro={<div style={{ marginBottom: 6 }}><h4>Waterproofing</h4>Polymer-modified cementitious coating (IS 2645 admixture), 2 coats on toilet, balcony and utility floors with 300 mm upturn and 1800 mm in shower zones; 48-hour ponding test before tiling. <h4>Anti-termite</h4>Pre-flooring chemical barrier treatment to IS 6313 Part 2 over the whole floor area; 10-year service warranty.</div>} />);
    return S;
  }
  if (pkg === 'carpentry') {
    plan('Furniture layout', { layers: { ...base.layers, ...noMep }, itemFilter: (t) => t === 'carpentry' || t === 'furniture' });
    for (let i = 0; i < units_.length; i += 6) add('Joinery elevations', (m) => <JoineryElevations meta={m} units={units_.slice(i, i + 6)} cat={cat} />);
    elevRooms((r) => f.items.some((it) => it.roomId === r.id && itemById(cat, it.catalogId)?.joinery), 'Wall elevations');
    const rows = units_.flatMap((u) => u.panels.map((pn) => [pn.tag, u.unit, pn.name, pn.l, pn.w, pn.t, pn.qty, pn.grain, pn.edge, pn.faceOut, pn.faceIn]));
    for (let i = 0; i < rows.length || i === 0; i += 55) add('Cut list', (m) => <ScheduleSheet meta={m} schedules={[{ id: 'cut' + i, title: 'Cut list (panel sizes, grain, edge banding, laminate per face)', trade: 'carpentry', head: ['Tag', 'Unit', 'Part', 'L', 'W', 'T', 'Qty', 'Grain', 'Edge band', 'Outer face', 'Inner face'], rows: rows.slice(i, i + 55) }]} />);
    const hw = units_.flatMap((u) => u.hardware.map((h) => [u.unit, h.name, h.qty, h.spec]));
    add('Hardware list & board estimate', (m) => {
      const n = nest(units_.flatMap((u) => u.panels).filter((x) => x.t === 18));
      return <ScheduleSheet meta={m} schedules={[{ id: 'hw', title: 'Hardware list', trade: 'carpentry', head: ['Unit', 'Hardware', 'Qty', 'Spec'], rows: hw }, { id: 'boards', title: 'Board estimate', trade: 'carpentry', head: ['Material', 'Boards (8×4)'], rows: Object.entries(n.boards.reduce((a, b) => ({ ...a, [`${b.material} ${b.t} mm`]: (a[`${b.material} ${b.t} mm`] ?? 0) + 1 }), {} as Record<string, number>)) }, { id: 'lam', title: 'Laminate / veneer by face', trade: 'carpentry', head: ['Unit', 'Room', 'Outer finish', 'Code'], rows: units_.map((u) => [u.unit, u.room, u.finish, u.code]) }]} />;
    });
    add('CNC nesting', (m) => { const n = nest(units_.flatMap((u) => u.panels).filter((x) => x.t === 18)); return <NestingSheet meta={m} boards={n.boards} utilisation={n.utilisation} />; });
    return S;
  }
  if (pkg === 'electrical') {
    plan('Electrical layout', { layers: { ...base.layers, ...noFurn, plumbing: false }, pointFilter: (k) => ELEC.includes(k) && !['light', 'cove', 'fan'].includes(k), pointHeights: true, circuits: designElectrical(f).assignments }, elecLegend);
    plan('Lighting layout', { layers: { ...base.layers, ...noFurn }, rcp: true, pointFilter: (k) => ['light', 'cove', 'fan', 'exhaust'].includes(k), circuits: designElectrical(f).assignments }, legendFor(['light', 'cove', 'fan', 'exhaust']), undefined);
    plan('Conduit route hints & DB location', { layers: { ...base.layers, ...noFurn, plumbing: false }, pointFilter: (k) => ['db', 'switchboard', 'ac', 'geyser', 'socket16'].includes(k), pointHeights: true }, legendFor(['db', 'switchboard', 'ac', 'geyser', 'socket16']));
    elevRooms((r) => f.points.some((x) => x.roomId === r.id && ['switchboard', 'socket6', 'socket16', 'tv', 'ac'].includes(x.kind)), 'Switchboard & point elevations');
    add('Point, load & DB schedules', (m) => <ScheduleSheet meta={m} schedules={sch.slice(0, 3)} />);
    add('Fixture & appliance schedules', (m) => <ScheduleSheet meta={m} schedules={sch.slice(3)} />);
    return S;
  }
  if (pkg === 'plumbing') {
    plan('Water supply & drainage layout', { layers: { ...base.layers, ...noFurn, electrical: false }, pointFilter: (k) => PLUMB.includes(k), pointHeights: true, itemFilter: (t) => t === 'plumbing' }, plumbLegend);
    elevRooms((r) => ['toilet', 'kitchen', 'utility'].includes(r.type), 'Wet-area wall elevations');
    plan('Floor slopes & trap positions', { layers: { ...base.layers, ...noFurn, electrical: false }, pointFilter: (k) => k === 'floor-trap' || k === 'outlet', itemFilter: (t) => t === 'plumbing' }, legendFor(['floor-trap', 'outlet']), undefined);
    add('Fixture, pipe & point schedules', (m) => <ScheduleSheet meta={m} schedules={sch} intro={<div>Wet floors laid to 1:100 fall towards floor traps; trap top 10 mm below finished floor. CPVC SDR 11 for supply, uPVC SWR for drainage; pressure test at 1.5× working pressure for 2 h before concealing.</div>} />);
    return S;
  }
  if (pkg === 'hvac') {
    plan('HVAC layout (indoor units, drain routes)', { layers: { ...base.layers, carpentry: false, decor: false, plumbing: false }, itemFilter: (t) => t === 'hvac', pointFilter: (k) => k === 'ac' || k === 'ac-drain', pointHeights: true }, legendFor(['ac', 'ac-drain']));
    add('Equipment schedule & electrical tie-ins', (m) => <ScheduleSheet meta={m} schedules={sch} />);
    return S;
  }
  if (pkg === 'painting') {
    plan('Wall-wise finish plan', { layers: { ...base.layers, ...noFurn, ...noMep }, wallFinish: true });
    plan('Ceiling finish plan', { layers: { ...base.layers, ...noFurn, ...noMep }, rcp: true, pointFilter: () => false });
    elevRooms((r) => r.finishes.accentWall !== undefined, 'Finish elevations');
    add('Finish schedule (areas per wall)', (m) => <ScheduleSheet meta={m} schedules={sch} />);
    return S;
  }
  if (pkg === 'client') {
    add('Renders', (m) => <Sheet meta={{ ...m, scale: 'NTS' }} html={renders.length ? <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>{renders.map((r, i) => <img key={i} src={r} style={{ width: '100%', borderRadius: 3 }} alt={`Render ${i + 1}`} />)}</div> : <div style={{ padding: 20 }}>Click “Capture renders” to add views of the 3D model to this sheet. 360° panoramas and photoreal renders come from the cloud render queue.</div>} />);
    add('Mood board', (m) => <Sheet meta={{ ...m, scale: 'NTS' }} html={<MoodBoard p={p} f={f} cat={cat} />} />);
    plan('Furniture layout', { layers: { ...base.layers, ...noMep } });
    add('Quotation summary', (m) => <Sheet meta={{ ...m, scale: 'NTS' }} html={<QuoteHtml p={p} />} />);
    return S;
  }
  // handover (PM-12)
  plan('As-built plan', { layers: { ...base.layers }, dims: true, pointHeights: true });
  add('Warranties & care guide', (m) => <Sheet meta={{ ...m, scale: 'NTS' }} html={<Warranties p={p} f={f} cat={cat} />} />);
  add('Final BOQ summary', (m) => <Sheet meta={{ ...m, scale: 'NTS' }} html={<QuoteHtml p={p} final />} />);
  add('Snag close-out', (m) => <Sheet meta={{ ...m, scale: 'NTS' }} html={<SnagHtml p={p} />} />);
  return S;
}

function IndexHtml({ p }: { p: Project }) {
  const pk = PKGS.filter((x) => !['client', 'handover', 'all'].includes(x.id));
  return (
    <div>
      <h4>Drawing set index</h4>
      <table className="t"><thead><tr><th>Package</th><th>Latest revision</th><th>Status</th><th>Issued</th><th>Viewed by</th></tr></thead>
        <tbody>{pk.map((x) => { const r = p.revisions.filter((y) => y.trade === x.id).pop(); return <tr key={x.id}><td>{x.label}</td><td>{r ? `R${r.no}` : '—'}</td><td>{r ? (r.ifc ? 'Issued for construction' : 'Draft') : 'Not issued'}</td><td>{r ? new Date(r.at).toLocaleDateString('en-IN') : ''}</td><td>{r?.viewers.map((v) => v.by).join(', ')}</td></tr>; })}</tbody></table>
      <h4 style={{ marginTop: 10 }}>Transmittal</h4>
      <table className="t"><thead><tr><th>To (trade / vendor)</th><th>Package</th><th>Revision</th><th>Purpose</th><th>Received (sign)</th></tr></thead>
        <tbody>{pk.map((x) => { const t = p.tasks.find((y) => y.trade === x.id && y.vendor); const r = p.revisions.filter((y) => y.trade === x.id).pop(); return <tr key={x.id}><td>{t?.vendor ?? '—'}</td><td>{x.label}</td><td>{r ? `R${r.no}` : '—'}</td><td>{r?.ifc ? 'Construction' : 'Information'}</td><td style={{ width: 120 }} /></tr>; })}</tbody></table>
    </div>
  );
}

function MoodBoard({ p, f, cat }: { p: Project; f: Floor; cat: ReturnType<typeof useCatalog> }) {
  const mats = [...new Set(f.rooms.flatMap((r) => [r.finishes.floor, r.finishes.wall, r.finishes.accent]).concat(f.items.map((i) => i.finish)).filter(Boolean) as string[])].map((id) => materialById(cat, id)).filter(Boolean);
  return (
    <div>
      <h4>References</h4>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 4 }}>{p.refs.slice(0, 10).map((r) => <img key={r.id} src={r.thumb} style={{ width: '100%', aspectRatio: '4/3', objectFit: 'cover' }} alt={r.name} />)}</div>
      <h4 style={{ marginTop: 8 }}>Materials & finishes</h4>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>{mats.map((m) => <div key={m!.id} style={{ display: 'flex', gap: 6, alignItems: 'center' }}><span style={{ width: 34, height: 34, background: m!.color, border: '1px solid #ccc', borderRadius: 3, flex: 'none' }} /><div><strong>{m!.name}</strong><br />{m!.code}</div></div>)}</div>
      <div style={{ marginTop: 8, color: '#555' }}>Approved items lock into the BOQ when the client signs this board off.</div>
    </div>
  );
}

function QuoteHtml({ p, final }: { p: Project; final?: boolean }) {
  const b = computeBoq(p);
  const q = quoteAmount(p, b);
  return (
    <div>
      <h4>{final ? 'Final BOQ summary' : 'Quotation summary'}</h4>
      <table className="t"><thead><tr><th>Trade</th><th style={{ textAlign: 'right' }}>Amount</th></tr></thead>
        <tbody>{Object.entries(b.byTrade).map(([t, v]) => <tr key={t}><td style={{ textTransform: 'capitalize' }}>{t}</td><td style={{ textAlign: 'right' }}>{inr(v)}</td></tr>)}
          <tr><td>Margin ({p.settings.marginPct}%)</td><td style={{ textAlign: 'right' }}>{inr(b.margin)}</td></tr><tr><td>GST ({p.settings.gstPct}%)</td><td style={{ textAlign: 'right' }}>{inr(b.gst)}</td></tr>
          <tr><td><strong>{q.label}</strong></td><td style={{ textAlign: 'right' }}><strong>{inr(q.amount)}</strong></td></tr></tbody></table>
      {!final && <><h4>Payment milestones</h4><table className="t"><tbody>{p.quote.milestones.map((m) => <tr key={m.label}><td>{m.label}</td><td>{m.pct}%</td><td style={{ textAlign: 'right' }}>{inr((q.amount * m.pct) / 100)}</td></tr>)}</tbody></table>
        <div style={{ display: 'flex', gap: 20 }}><div><h4>Included</h4>{p.quote.inclusions.map((x) => <div key={x}>• {x}</div>)}</div><div><h4>Not included</h4>{p.quote.exclusions.map((x) => <div key={x}>• {x}</div>)}</div></div></>}
      {final && <div>{p.changeOrders.filter((c) => c.status === 'approved').map((c) => <div key={c.id}>Change order #{c.no}: {inr(c.costDelta)} (approved)</div>)}</div>}
    </div>
  );
}

function Warranties({ p, f, cat }: { p: Project; f: Floor; cat: ReturnType<typeof useCatalog> }) {
  const items = f.items.map((i) => itemById(cat, i.catalogId)).filter((c, i, a) => c && a.findIndex((x) => x?.id === c.id) === i);
  const mats = [...new Set(f.rooms.flatMap((r) => [r.finishes.floor, r.finishes.wall]).concat(f.items.map((i) => i.finish ?? '')))].map((id) => materialById(cat, id)).filter(Boolean);
  void p;
  return (
    <div>
      <h4>Warranties</h4>
      <table className="t"><thead><tr><th>Item</th><th>Make / series</th><th>Warranty</th><th>Care</th></tr></thead>
        <tbody>{items.map((c) => <tr key={c!.id}><td>{c!.name}</td><td>{c!.spec.brand} · {c!.spec.series}</td><td>{c!.spec.warranty ?? 'As per manufacturer'}</td><td>{c!.spec.care ?? '—'}</td></tr>)}
          {mats.map((m) => <tr key={m!.id}><td>{m!.name}</td><td>{m!.code}</td><td>{m!.spec.warranty ?? 'As per manufacturer'}</td><td>{m!.spec.care ?? '—'}</td></tr>)}
          {Object.values(POINTS).slice(0, 3).map((x) => <tr key={x.name}><td>{x.name}</td><td>{x.spec.series}</td><td>Workmanship 1 year</td><td>Do not overload circuits; test RCCB monthly.</td></tr>)}</tbody></table>
    </div>
  );
}

function SnagHtml({ p }: { p: Project }) {
  return (
    <div>
      <h4>Snag close-out ({p.snags.filter((s) => s.status === 'closed').length} of {p.snags.length} closed)</h4>
      <table className="t"><thead><tr><th>#</th><th>Snag</th><th>Trade</th><th>Status</th><th>Before</th><th>After</th></tr></thead>
        <tbody>{p.snags.map((s, i) => <tr key={s.id}><td>{i + 1}</td><td>{s.title}</td><td>{s.trade}</td><td>{s.status}</td><td>{s.photo && <img src={s.photo} style={{ width: 60 }} alt="" />}</td><td>{s.closePhoto && <img src={s.closePhoto} style={{ width: 60 }} alt="" />}</td></tr>)}</tbody></table>
    </div>
  );
}
