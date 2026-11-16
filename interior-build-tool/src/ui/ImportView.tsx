import React, { useMemo, useState } from 'react';
import { useStore, mutate, setUi, activeFloor, select, setUnderlay, toast, setView, getState } from '../store';
import { parseDxf, type DxfDoc } from '../core/dxf';
import { importDxf, diffWalls, scaleFloor, recomputeRooms, roomTypeFromName, type ImportResult } from '../core/detect';
import type { Floor, LayerRole, RoomType, SiteMeasure, Vec2 } from '../core/types';
import { UNIT_NAMES, fmtLen, fmtArea, sqft, parseLength } from '../core/units';
import { measureRoom, areaStatement, roomEdges } from '../core/measure';
import { areaStatementSchedule } from '../core/schedules';
import { PlanView } from './Plan';
import { Conf, Field, FilePick, LenInput, readFile, useCatalog, useUnits, download, shrinkImage, NumInput } from './common';
import { emptyFloor } from '../core/project';
import { dist, centroid } from '../core/geom';
import { uid, nowIso, toCsv } from '../core/util';

const ROLES: LayerRole[] = ['wall', 'door', 'window', 'column', 'room', 'furniture', 'plumbing', 'electrical', 'annotation', 'ignore'];
const ROOM_TYPES: RoomType[] = ['living', 'dining', 'bedroom', 'kitchen', 'toilet', 'passage', 'foyer', 'balcony', 'utility', 'study', 'pooja', 'shaft', 'other'];

export function ImportView() {
  const project = useStore((s) => s.project)!;
  const [tab, setTab] = useState<'upload' | 'review' | 'measure' | 'site'>(project.floors.length ? 'review' : 'upload');
  return (
    <div className="page" style={{ maxWidth: 'none' }}>
      <h1>Import & review</h1>
      <p className="sub">Turn the architect's drawing into a dimensioned room model. Detected elements must be confirmed before their measurements feed the BOQ, cut lists or trade sheets.</p>
      <div className="tabs">
        {([['upload', '1 · Upload drawing'], ['review', '2 · Review detection'], ['measure', '3 · Measurements & areas'], ['site', '4 · Site re-measure']] as const).map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}
      </div>
      {tab === 'upload' && <Upload onDone={() => setTab('review')} />}
      {tab === 'review' && <Review />}
      {tab === 'measure' && <Measurements />}
      {tab === 'site' && <SiteRemeasure />}
    </div>
  );
}

function Upload({ onDone }: { onDone: () => void }) {
  const project = useStore((s) => s.project)!;
  const floor = useStore((s) => activeFloor(s));
  const [file, setFile] = useState<{ name: string; text: string; doc: DxfDoc } | null>(null);
  const [layerMap, setLayerMap] = useState<Record<string, LayerRole>>({});
  const [unit, setUnit] = useState<string>('auto');
  const [mode, setMode] = useState<'new' | 'replace' | 'revise'>(project.floors.length ? 'revise' : 'new');
  const cat = useCatalog(project);
  const units = useUnits();

  const result: ImportResult | null = useMemo(() => {
    if (!file) return null;
    try { return importDxf(file.doc, { layerMap, unitFactor: unit === 'auto' ? undefined : UNIT_NAMES[unit], fileName: file.name, fileText: file.text, defaultCeiling: project.settings.defaultCeiling, user: project.settings.user }); }
    catch (e) { toast('Could not read the drawing: ' + (e as Error).message, 'err'); return null; }
  }, [file, layerMap, unit]);
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    if (file) for (const e of file.doc.entities) c[e.layer] = (c[e.layer] ?? 0) + 1;
    return c;
  }, [file]);
  const diff = useMemo(() => (result && floor && mode === 'revise' ? diffWalls(floor.walls, result.floors[0]?.walls ?? []) : null), [result, floor, mode]);

  const load = async (f: File) => {
    if (/\.dwg$/i.test(f.name)) { toast('DWG needs the licensed ODA converter on the server. Save as DXF from AutoCAD (DXFOUT) and import that.', 'warn'); return; }
    const text = await readFile(f, 'text');
    const doc = parseDxf(text);
    if (!doc.entities.length) { toast('No drawing entities found in that file', 'err'); return; }
    setFile({ name: f.name, text, doc });
    setLayerMap({});
  };

  const apply = () => {
    if (!result) return;
    const fl = result.floors;
    mutate(`Imported ${file!.name}`, (p) => {
      if (mode === 'new' || !p.floors.length) {
        p.floors.push(...fl.map((f, i) => ({ ...f, name: p.floors.length || fl.length > 1 ? f.name : f.name, level: (p.floors.length + i) * 3000 })));
      } else {
        const idx = p.floors.findIndex((f) => f.id === floor?.id);
        const old = p.floors[idx];
        const nf = fl[0];
        if (mode === 'replace') p.floors[idx] = { ...nf, id: old.id, name: old.name, level: old.level };
        else {
          // IMP-31: keep design work — remap items/points to new rooms by name, keep everything else
          const map = new Map<string, string>();
          for (const r of old.rooms) { const m = nf.rooms.find((n) => n.name.toLowerCase() === r.name.toLowerCase()); if (m) { map.set(r.id, m.id); m.finishes = r.finishes; m.falseCeiling = r.falseCeiling; m.status = r.status; } }
          p.floors[idx] = { ...nf, id: old.id, name: old.name, level: old.level, items: old.items.filter((i) => !i.existing).map((i) => ({ ...i, roomId: map.get(i.roomId) ?? i.roomId })).concat(nf.items), points: old.points.map((x) => ({ ...x, roomId: x.roomId ? map.get(x.roomId) ?? x.roomId : x.roomId })), annotations: old.annotations, siteMeasures: [], northDeg: old.northDeg };
        }
      }
      p.audit.push({ at: nowIso(), by: p.settings.user, action: `Imported ${file!.name} (${mode}): ${result.stats.walls} walls, ${result.stats.openings} openings, ${result.stats.rooms} rooms` });
    });
    for (const f of fl) setUnderlay(mode === 'new' ? f.id : floor?.id ?? f.id, result.underlays[f.id]);
    if (mode === 'new') setUi({ floorId: fl[0]?.id });
    toast(`Imported ${result.stats.walls} walls, ${result.stats.openings} openings, ${result.stats.rooms} rooms – now review them`);
    onDone();
  };

  const traceImage = async (f: File) => {
    const { url } = await shrinkImage(f, 2400, 0.85);
    const img = new Image();
    await new Promise((r) => { img.onload = r; img.src = url; });
    // assume the image is roughly 12 m wide until calibrated
    const w = 12000, h = (12000 * img.height) / img.width;
    let fid = floor?.id;
    if (!floor) {
      const nf = emptyFloor('Ground floor');
      fid = nf.id;
      mutate('Added floor for image tracing', (p) => { p.floors.push(nf); });
      setUi({ floorId: nf.id });
    }
    setUnderlay(fid!, { lines: [], texts: [], image: { dataUrl: url, x: 0, y: 0, w, h } });
    setUi({ layers: { ...getState().ui.layers, underlay: true }, tool: 'calibrate' });
    toast('Image placed as underlay. Use Calibrate: click two points a known distance apart, then trace walls with the wall tool.', 'ok');
    setView('design');
  };

  return (
    <div className="grid" style={{ gridTemplateColumns: 'minmax(320px, 420px) 1fr' }}>
      <div className="col">
        <div className="card col">
          <h2>Drawing file</h2>
          <div className="row">
            <FilePick className="btn primary" accept=".dxf,.dwg" onFile={([f]) => load(f)}>Choose DXF…</FilePick>
            <FilePick accept="image/*" onFile={([f]) => traceImage(f)}>Plan image to trace…</FilePick>
          </div>
          <div className="muted small">AutoCAD DXF (R12–current). DWG files need the licensed ODA converter, so export DXF from CAD. Scans and phone photos go in as a calibrated underlay to trace over.</div>
          {file && <div className="tag accent">{file.name} · {file.doc.entities.length} entities · {file.doc.layers.length} layers</div>}
        </div>
        {file && result && (
          <>
            <div className="card col">
              <h2>Units & scale</h2>
              <div className="row">
                <select className="i" style={{ width: 160 }} value={unit} onChange={(e) => setUnit(e.target.value)}>
                  <option value="auto">Auto ({result.unitSource === 'header' ? 'from file header' : 'guessed'})</option>
                  {Object.keys(UNIT_NAMES).map((u) => <option key={u} value={u}>{u}</option>)}
                </select>
                <span className="tag">{result.unitFactor} mm per drawing unit</span>
              </div>
              {result.unitSource === 'guess' && unit === 'auto' && <div className="banner warn small">The file does not say its units. The guess is based on the plan size — please confirm, or calibrate after import.</div>}
            </div>
            <div className="card col">
              <h2>Layer mapping</h2>
              <div className="tablewrap" style={{ maxHeight: 300 }}>
                <table className="t"><thead><tr><th>Layer</th><th className="num">Entities</th><th>Treat as</th></tr></thead>
                  <tbody>{file.doc.layers.map((l) => (
                    <tr key={l.name}><td className="mono">{l.name}</td><td className="num">{counts[l.name] ?? 0}</td>
                      <td><select className="i" value={result.layerMap[l.name]} onChange={(e) => setLayerMap({ ...result.layerMap, [l.name]: e.target.value as LayerRole })}>{ROLES.map((r) => <option key={r}>{r}</option>)}</select></td></tr>
                  ))}</tbody></table>
              </div>
            </div>
            <div className="card col">
              <h2>Result</h2>
              <div className="grid g3">
                <div className="stat"><span className="v">{result.stats.walls}</span><span className="l">walls</span></div>
                <div className="stat"><span className="v">{result.stats.openings}</span><span className="l">doors / windows</span></div>
                <div className="stat"><span className="v">{result.stats.rooms}</span><span className="l">rooms</span></div>
                <div className="stat"><span className="v">{result.stats.columns}</span><span className="l">columns</span></div>
                <div className="stat"><span className="v">{result.stats.lowConfidence}</span><span className="l">need review</span></div>
                <div className="stat"><span className="v">{result.stats.dimMismatches}</span><span className="l">dimension mismatches</span></div>
              </div>
              {result.floors.length > 1 && <div className="banner info small">{result.floors.length} separate plans found in this file; each becomes a floor.</div>}
              {project.floors.length > 0 && (
                <div className="seg">
                  {(['revise', 'replace', 'new'] as const).map((m) => <button key={m} className={mode === m ? 'on' : ''} onClick={() => setMode(m)}>{m === 'revise' ? 'Revised drawing (keep design)' : m === 'replace' ? 'Replace floor' : 'Add as new floor'}</button>)}
                </div>
              )}
              {diff && <div className="banner info small">Compared with “{floor?.name}”: {diff.same} walls unchanged, {diff.moved.length} moved, {diff.added.length} added, {diff.removed.length} removed. Furniture and points are kept and re-linked by room name.</div>}
              <button className="btn primary" onClick={apply}>Use this model</button>
            </div>
          </>
        )}
      </div>
      <div className="card" style={{ padding: 0, minHeight: 520, overflow: 'hidden' }}>
        {result?.floors[0] ? <PlanView floor={result.floors[0]} cat={cat} underlay={result.underlays[result.floors[0].id]} opts={{ layers: { underlay: true }, highlight: new Set([...result.floors[0].walls, ...result.floors[0].openings, ...result.floors[0].rooms].filter((e) => (e.det?.confidence ?? 1) < 0.75).map((e) => e.id)), units, tags: true }} readOnly fitKey={file?.name} />
          : <div className="muted" style={{ padding: 40, textAlign: 'center' }}>Choose a DXF to preview detection here.</div>}
      </div>
    </div>
  );
}


function Review() {
  const project = useStore((s) => s.project)!;
  const floor = useStore((s) => activeFloor(s));
  const selection = useStore((s) => s.ui.selection);
  const tool = useStore((s) => s.ui.tool);
  const underlays = useStore((s) => s.underlays);
  const cat = useCatalog(project);
  const units = useUnits();
  const user = project.settings.user;
  if (!floor) return <div className="card">Import a drawing first.</div>;
  const items = [
    ...floor.rooms.map((e) => ({ kind: 'room' as const, id: e.id, label: e.name, det: e.det, extra: fmtArea(measureRoom(floor, e).floorArea, units) })),
    ...floor.walls.map((e) => ({ kind: 'wall' as const, id: e.id, label: `Wall ${Math.round(dist(e.a, e.b))} × ${Math.round(e.thickness)}${e.exterior ? ' · ext' : ''}${e.structural ? ' · structural' : ''}`, det: e.det, extra: '' })),
    ...floor.openings.map((e) => ({ kind: 'opening' as const, id: e.id, label: `${e.kind[0].toUpperCase() + e.kind.slice(1)} ${Math.round(e.width)} mm`, det: e.det, extra: '' })),
    ...floor.columns.map((e) => ({ kind: 'column' as const, id: e.id, label: `${e.kind} ${Math.round(e.w)} × ${Math.round(e.d)}`, det: e.det, extra: '' })),
  ];
  const pending = items.filter((i) => i.det && !i.det.confirmed);
  const low = new Set(items.filter((i) => (i.det?.confidence ?? 1) < 0.75 && !i.det?.confirmed).map((i) => i.id));
  const confirm = (ids: string[]) => mutate(`Confirmed ${ids.length} detected element(s)`, (p) => {
    const f = p.floors.find((x) => x.id === floor.id)!;
    const at = nowIso();
    for (const e of [...f.rooms, ...f.walls, ...f.openings, ...f.columns]) if (ids.includes(e.id) && e.det) e.det.confirmed = { by: user, at };
  }, { audit: true });
  const sel = selection ? items.find((i) => i.id === selection.id) : undefined;
  const onTwo = (a: Vec2, b: Vec2) => {
    if (tool !== 'calibrate') return;
    const cur = dist(a, b);
    const ans = prompt(`Drawn distance is ${Math.round(cur)} mm. Enter the real distance (e.g. 3600, 3.6m, 11'10"):`);
    if (!ans) return;
    const mm = parseLength(ans, 'mm');
    if (mm === null || !isFinite(mm) || mm <= 0) { toast('Could not read that distance', 'err'); return; }
    const k = mm / cur;
    mutate(`Calibrated drawing scale ×${k.toFixed(4)}`, (p) => { const i = p.floors.findIndex((x) => x.id === floor.id); p.floors[i] = scaleFloor(p.floors[i], k); }, { audit: true });
    const u = underlays[floor.id];
    if (u) setUnderlay(floor.id, { ...u, lines: u.lines.map((l) => ({ ...l, a: { x: l.a.x * k, y: l.a.y * k }, b: { x: l.b.x * k, y: l.b.y * k } })), texts: u.texts.map((t) => ({ ...t, pos: { x: t.pos.x * k, y: t.pos.y * k } })), image: u.image ? { ...u.image, x: u.image.x * k, y: u.image.y * k, w: u.image.w * k, h: u.image.h * k } : undefined });
    setUi({ tool: 'select' });
    toast('Scale calibrated');
  };
  return (
    <div className="grid" style={{ gridTemplateColumns: '1fr 360px', alignItems: 'start' }}>
      <div className="card col" style={{ padding: 0, overflow: 'hidden' }}>
        <div className="toolbar">
          <button className={'btn sm' + (tool === 'select' ? ' on' : '')} onClick={() => setUi({ tool: 'select' })}>Select</button>
          <button className={'btn sm' + (tool === 'calibrate' ? ' on' : '')} onClick={() => setUi({ tool: 'calibrate' })} title="Pick two points a known distance apart">Calibrate scale</button>
          <span className="muted small">Orange = low confidence, needs a look. Drag to pan, scroll to zoom.</span>
        </div>
        <div style={{ height: 560 }}>
          <PlanView floor={floor} cat={cat} underlay={underlays[floor.id]} tool={tool} onSelect={select} onTwoPoint={onTwo} readOnly opts={{ layers: { underlay: true, furniture: true }, selection, highlight: low, units, tags: true }} />
        </div>
      </div>
      <div className="col">
        <div className="card col">
          <div className="row"><h2 className="grow" style={{ margin: 0 }}>Detected elements</h2><span className={'tag ' + (pending.length ? 'warn' : 'ok')}>{pending.length ? `${pending.length} to confirm` : 'all confirmed'}</span></div>
          <div className="row">
            <button className="btn sm primary" disabled={!pending.length} onClick={() => confirm(pending.filter((p) => (p.det?.confidence ?? 0) >= 0.85).map((p) => p.id))}>Confirm all ≥ 85%</button>
            <button className="btn sm" disabled={!pending.length} onClick={() => { if (confirm_(`Confirm all ${pending.length} remaining elements, including low-confidence ones?`)) confirm(pending.map((p) => p.id)); }}>Confirm all</button>
          </div>
          <div className="tablewrap" style={{ maxHeight: 330 }}>
            <table className="t"><tbody>
              {items.map((i) => (
                <tr key={i.id} className={'click' + (selection?.id === i.id ? ' sel' : '')} onClick={() => select({ kind: i.kind, id: i.id })}>
                  <td>{i.label}<div className="muted small">{i.extra}</div></td>
                  <td><Conf v={i.det?.confidence} /></td>
                  <td className="right">{i.det?.confirmed ? <span className="tag ok" title={`by ${i.det.confirmed.by}`}>✓</span> : i.det ? <button className="btn sm" onClick={(e) => { e.stopPropagation(); confirm([i.id]); }}>Confirm</button> : null}</td>
                </tr>
              ))}
            </tbody></table>
          </div>
        </div>
        {sel && <ElementEditor floor={floor} kind={sel.kind} id={sel.id} />}
        {floor.dimChecks.some((d) => !d.ok) && (
          <div className="card col">
            <h2>Dimension mismatches</h2>
            {floor.dimChecks.filter((d) => !d.ok).map((d) => <div key={d.id} className="banner warn small">Written {Math.round(d.written)} mm, drawn {Math.round(d.drawn)} mm (Δ {Math.round(d.written - d.drawn)} mm). Verify on site.</div>)}
          </div>
        )}
        <div className="card col">
          <h2>North & floor</h2>
          <div className="fields">
            <Field label="Floor name"><input className="i" defaultValue={floor.name} onBlur={(e) => mutate('Renamed floor', (p) => { p.floors.find((f) => f.id === floor.id)!.name = e.target.value; })} /></Field>
            <Field label="True north (° from +x)" hint="90 = up"><NumInput value={floor.northDeg} onChange={(v) => mutate('Set true north', (p) => { p.floors.find((f) => f.id === floor.id)!.northDeg = v; })} /></Field>
          </div>
        </div>
      </div>
    </div>
  );
}
const confirm_ = (m: string) => window.confirm(m);

function ElementEditor({ floor, kind, id }: { floor: Floor; kind: string; id: string }) {
  const units = useUnits();
  const user = useStore((s) => s.project!.settings.user);
  const upd = (label: string, fn: (f: Floor) => void) => mutate(label, (p) => fn(p.floors.find((x) => x.id === floor.id)!));
  if (kind === 'room') {
    const r = floor.rooms.find((x) => x.id === id);
    if (!r) return null;
    const others = floor.rooms.filter((x) => x.id !== id);
    return (
      <div className="card col">
        <h2>Room</h2>
        <div className="muted small">{r.det?.reason}</div>
        <div className="fields">
          <Field label="Name"><input className="i" defaultValue={r.name} key={r.id} onBlur={(e) => e.target.value !== r.name && upd('Renamed room', (f) => { const x = f.rooms.find((q) => q.id === id)!; x.name = e.target.value; x.type = roomTypeFromName(e.target.value) === 'other' ? x.type : roomTypeFromName(e.target.value); })} /></Field>
          <Field label="Type"><select className="i" value={r.type} onChange={(e) => upd('Changed room type', (f) => { f.rooms.find((q) => q.id === id)!.type = e.target.value as RoomType; })}>{ROOM_TYPES.map((t) => <option key={t}>{t}</option>)}</select></Field>
          <Field label="Ceiling (slab)"><LenInput value={r.ceilingHeight} units={units} onChange={(v) => upd('Ceiling height', (f) => { f.rooms.find((q) => q.id === id)!.ceilingHeight = v; })} /></Field>
        </div>
        {others.length > 0 && (
          <div className="row"><select className="i grow" id="mergeSel">{others.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select>
            <button className="btn sm" onClick={() => { const other = (document.getElementById('mergeSel') as HTMLSelectElement).value; upd('Merged rooms', (f) => { const a = f.rooms.find((q) => q.id === id)!, b = f.rooms.find((q) => q.id === other)!; a.name = `${a.name} / ${b.name}`; for (const it of f.items) if (it.roomId === b.id) it.roomId = a.id; for (const pt of f.points) if (pt.roomId === b.id) pt.roomId = a.id; const wallBetween = f.walls.filter((w) => !w.exterior && !w.structural); void wallBetween; f.rooms = f.rooms.filter((q) => q.id !== b.id); a.polygon = mergeHull(a.polygon, b.polygon); }); }}>Merge into this</button></div>
        )}
      </div>
    );
  }
  if (kind === 'wall') {
    const w = floor.walls.find((x) => x.id === id);
    if (!w) return null;
    return (
      <div className="card col">
        <h2>Wall</h2>
        <div className="muted small">{w.det?.reason} · {fmtLen(dist(w.a, w.b), units)} long</div>
        <div className="fields">
          <Field label="Thickness"><LenInput value={w.thickness} units={units} onChange={(v) => upd('Wall thickness', (f) => { f.walls.find((q) => q.id === id)!.thickness = v; })} /></Field>
        </div>
        <label className="row small"><input type="checkbox" checked={w.structural} onChange={(e) => upd(e.target.checked ? 'Marked wall structural' : 'Unmarked structural wall', (f) => { f.walls.find((q) => q.id === id)!.structural = e.target.checked; })} /> Structural (RCC / shear wall) – read-only in the editor</label>
        <label className="row small"><input type="checkbox" checked={w.exterior} onChange={(e) => upd('Exterior flag', (f) => { f.walls.find((q) => q.id === id)!.exterior = e.target.checked; })} /> External wall</label>
        <button className="btn sm" onClick={() => mutate('Recomputed rooms', (p) => { const i = p.floors.findIndex((x) => x.id === floor.id); p.floors[i] = recomputeRooms(p.floors[i]); })}>Recompute rooms from walls</button>
        <span className="muted small">{user}</span>
      </div>
    );
  }
  if (kind === 'opening') {
    const o = floor.openings.find((x) => x.id === id);
    if (!o) return null;
    return (
      <div className="card col">
        <h2>Opening</h2>
        <div className="muted small">{o.det?.reason}</div>
        <div className="fields">
          <Field label="Kind"><select className="i" value={o.kind} onChange={(e) => upd('Opening kind', (f) => { const x = f.openings.find((q) => q.id === id)!; x.kind = e.target.value as typeof o.kind; if (x.kind === 'window') { x.sill = 900; x.height = 1200; } else { x.sill = 0; x.height = 2100; } })}>{['door', 'window', 'opening'].map((k) => <option key={k}>{k}</option>)}</select></Field>
          <Field label="Width"><LenInput value={o.width} units={units} onChange={(v) => upd('Opening width', (f) => { f.openings.find((q) => q.id === id)!.width = v; })} /></Field>
          <Field label="Height"><LenInput value={o.height} units={units} onChange={(v) => upd('Opening height', (f) => { f.openings.find((q) => q.id === id)!.height = v; })} /></Field>
          <Field label="Sill"><LenInput value={o.sill} units={units} onChange={(v) => upd('Sill', (f) => { f.openings.find((q) => q.id === id)!.sill = v; })} /></Field>
        </div>
      </div>
    );
  }
  return null;
}

function mergeHull(a: Vec2[], b: Vec2[]): Vec2[] {
  // bounding outline of two adjacent rooms (orthogonal plans): union of their boxes when they share an edge
  const pts = [...a, ...b];
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  return [{ x: Math.min(...xs), y: Math.min(...ys) }, { x: Math.max(...xs), y: Math.min(...ys) }, { x: Math.max(...xs), y: Math.max(...ys) }, { x: Math.min(...xs), y: Math.max(...ys) }];
}

function Measurements() {
  const project = useStore((s) => s.project)!;
  const floor = useStore((s) => activeFloor(s));
  const units = useUnits();
  if (!floor) return <div className="card">Import a drawing first.</div>;
  const rows = floor.rooms.filter((r) => r.type !== 'shaft').map((r) => ({ r, m: measureRoom(floor, r) }));
  const a = areaStatement(floor);
  const sch = areaStatementSchedule(floor, a);
  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="card">
        <div className="row" style={{ marginBottom: 8 }}><h2 className="grow" style={{ margin: 0 }}>Room measurements</h2></div>
        <div className="tablewrap">
          <table className="t">
            <thead><tr><th>Room</th><th className="num">W × D</th><th className="num">Carpet</th><th className="num">Perimeter</th><th className="num">Ceiling (finished)</th><th className="num">Wall area net</th><th className="num">Openings</th><th className="num">Skirting</th><th className="num">Ceiling area</th></tr></thead>
            <tbody>{rows.map(({ r, m }) => (
              <tr key={r.id}><td><strong>{r.name}</strong> {r.det && !r.det.confirmed && <span className="tag warn">unconfirmed</span>}</td>
                <td className="num">{fmtLen(m.width, units)} × {fmtLen(m.depth, units)}</td>
                <td className="num">{(m.floorArea / 1e6).toFixed(2)} m² / {sqft(m.floorArea).toFixed(0)} sq ft</td>
                <td className="num">{fmtLen(m.perimeter, units)}</td>
                <td className="num">{fmtLen(m.ceilingHeight, units)}</td>
                <td className="num">{(m.netWallArea / 1e6).toFixed(2)} m²</td>
                <td className="num">{(m.openingArea / 1e6).toFixed(2)} m²</td>
                <td className="num">{fmtLen(m.skirting, units)}</td>
                <td className="num">{(m.ceilingArea / 1e6).toFixed(2)} m²</td></tr>
            ))}</tbody>
          </table>
        </div>
      </div>
      <div className="card">
        <div className="row" style={{ marginBottom: 8 }}><h2 className="grow" style={{ margin: 0 }}>Area statement</h2>
          <button className="btn sm" onClick={() => download(`${project.name} – area statement.csv`, toCsv([sch.head, ...sch.rows]), 'text/csv')}>Excel (CSV)</button>
          <button className="btn sm" onClick={() => { setView('exports'); setUi({ shareTrade: 'all' }); }}>PDF sheet →</button>
        </div>
        <table className="t"><thead><tr>{sch.head.map((h, i) => <th key={h} className={i > 1 ? 'num' : ''}>{h}</th>)}</tr></thead>
          <tbody>{sch.rows.map((r, i) => <tr key={i} className={i >= a.rows.length ? 'group' : ''}>{r.map((c, j) => <td key={j} className={j > 1 ? 'num' : ''}>{c}</td>)}</tr>)}</tbody></table>
        <div className="muted small" style={{ marginTop: 6 }}>{sch.note}</div>
      </div>
    </div>
  );
}

function SiteRemeasure() {
  const project = useStore((s) => s.project)!;
  const floor = useStore((s) => activeFloor(s));
  const units = useUnits();
  const [roomId, setRoomId] = useState<string>('');
  if (!floor) return <div className="card">Import a drawing first.</div>;
  const room = floor.rooms.find((r) => r.id === roomId) ?? floor.rooms.find((r) => r.type !== 'shaft');
  if (!room) return null;
  const edges = roomEdges(floor, room);
  const tol = project.settings.siteTolerance;
  const open = floor.siteMeasures.filter((m) => !m.resolution && Math.abs(m.site - m.plan) > tol);
  const record = (edge: number, plan: number, site: number) => mutate('Recorded site measurement', (p) => {
    const f = p.floors.find((x) => x.id === floor.id)!;
    f.siteMeasures = f.siteMeasures.filter((m) => !(m.roomId === room.id && m.edge === edge));
    const m: SiteMeasure = { id: uid('sm'), roomId: room.id, edge, plan, site, by: p.settings.user, at: nowIso() };
    if (Math.abs(site - plan) <= p.settings.siteTolerance) m.resolution = 'keep-plan';
    f.siteMeasures.push(m);
  }, { audit: true });
  const resolve = (id: string, r: SiteMeasure['resolution']) => mutate(r === 'accept-site' ? 'Accepted site dimension' : 'Kept plan dimension', (p) => {
    const f = p.floors.find((x) => x.id === floor.id)!;
    const m = f.siteMeasures.find((x) => x.id === id)!;
    m.resolution = r;
    if (r === 'accept-site') {
      // re-fit joinery standing on that wall to the measured length
      const e = roomEdges(f, f.rooms.find((x) => x.id === m.roomId)!).find((x) => x.i === m.edge);
      const short = m.plan - m.site;
      if (e && short > 0) for (const it of f.items.filter((i) => i.roomId === m.roomId)) {
        const back = { x: Math.sin((it.rot * Math.PI) / 180), y: -Math.cos((it.rot * Math.PI) / 180) };
        if (back.x * -e.n.x + back.y * -e.n.y > 0.95 && it.w > 600) it.w = Math.max(450, it.w - short);
      }
    }
  }, { audit: true });
  return (
    <div className="grid" style={{ gridTemplateColumns: 'minmax(320px, 1fr) 1fr', alignItems: 'start' }}>
      <div className="card col">
        <h2>Measure on site</h2>
        <div className="muted small">Enter tape or laser-meter readings per wall. Differences above {tol} mm block carpentry cut lists until resolved.</div>
        <Field label="Room"><select className="i" value={room.id} onChange={(e) => setRoomId(e.target.value)}>{floor.rooms.filter((r) => r.type !== 'shaft').map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></Field>
        <table className="t"><thead><tr><th>Wall</th><th className="num">Plan</th><th>Site reading</th><th>Δ</th></tr></thead>
          <tbody>{edges.map((e) => {
            const m = floor.siteMeasures.find((x) => x.roomId === room.id && x.edge === e.i);
            const d = m ? m.site - m.plan : 0;
            return <tr key={e.i}><td>Wall {e.i + 1}</td><td className="num">{fmtLen(e.len, units)}</td>
              <td><LenInput value={m?.site ?? Math.round(e.len)} units={units} onChange={(v) => record(e.i, e.len, v)} /></td>
              <td>{m ? <span className={'tag ' + (Math.abs(d) > tol ? 'err' : 'ok')}>{d > 0 ? '+' : ''}{Math.round(d)} mm</span> : <span className="muted small">—</span>}</td></tr>;
          })}</tbody></table>
      </div>
      <div className="card col">
        <h2>Differences to resolve</h2>
        {!open.length && <div className="banner ok small">No unresolved differences.</div>}
        {open.map((m) => {
          const r = floor.rooms.find((x) => x.id === m.roomId);
          return (
            <div key={m.id} className="banner err small" style={{ flexDirection: 'column' }}>
              <div><strong>{r?.name} · wall {m.edge + 1}</strong>: plan {Math.round(m.plan)} mm, site {Math.round(m.site)} mm (Δ {Math.round(m.site - m.plan)} mm) – by {m.by}</div>
              <div className="row"><button className="btn sm" onClick={() => resolve(m.id, 'accept-site')}>Use site value (re-fit joinery)</button><button className="btn sm" onClick={() => resolve(m.id, 'keep-plan')}>Keep plan value</button></div>
            </div>
          );
        })}
        <div className="muted small">Resolved: {floor.siteMeasures.filter((m) => m.resolution).length} · Room centre {(() => { const c = centroid(room.polygon); return `${Math.round(c.x)}, ${Math.round(c.y)}`; })()}</div>
      </div>
    </div>
  );
}
