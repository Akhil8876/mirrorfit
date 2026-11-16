import React, { useMemo, useRef, useState } from 'react';
import { useStore, mutate, activeFloor, jobEvent, clearJobs, toast, setView, getState } from '../store';
import { THEMES, themeById, BUDGET_BANDS } from '../core/themes';
import { generateRoomOptions, type GenInput } from '../core/generator';
import { runGraph, WorkerPool, type JobTask } from '../core/orchestrator';
import { extractStyle, parsePrompt } from '../core/style';
import { itemById, materialById, buildCatalog } from '../core/catalog';
import { polygonArea } from '../core/geom';
import { MM2_PER_SQFT } from '../core/units';
import type { Brief, Floor, GenOption, Project } from '../core/types';
import { uid, inr, nowIso } from '../core/util';
import { checkRoom } from '../core/rules';
import { Field, FilePick, NumInput, TextInput, shrinkImage, useCatalog } from './common';
import { PlanContent, planBounds } from './Plan';

const MUST = ['study', 'pooja', 'bar', 'tv', 'dining', 'dresser', 'shoe'];

let pool: WorkerPool<{ input: GenInput; count: number }, GenOption[]> | null = null;
function getPool() {
  if (!pool) {
    const n = Math.max(2, Math.min(6, (navigator.hardwareConcurrency || 4) - 1));
    pool = new WorkerPool(() => new Worker(new URL('../core/genWorker.ts', import.meta.url), { type: 'module' }), n, (i) => generateRoomOptions(i.input, i.count));
  }
  return pool;
}

export function buildInput(p: Project, f: Floor, roomId: string, seed: number): GenInput {
  const room = f.rooms.find((r) => r.id === roomId)!;
  const cat = useCatalogStatic(p);
  const carpet = f.rooms.filter((r) => r.type !== 'shaft').reduce((s, r) => s + polygonArea(r.polygon), 0);
  const share = p.brief.budget > 0 ? (p.brief.budget * polygonArea(room.polygon)) / Math.max(1, carpet) : undefined;
  const palette = p.refs.filter((r) => !r.roomId || r.roomId === roomId).flatMap((r) => r.palette.slice(0, 3));
  const parsed = parsePrompt(p.prompt);
  return {
    floor: f, room, theme: themeById(p.theme), brief: { ...p.brief, mustHaves: [...new Set([...p.brief.mustHaves, ...parsed.mustHaves])] },
    styleTags: [...p.styleTags, ...parsed.tags], palette, prompt: p.prompt, catalog: cat, rules: p.settings.rulePack, seed, budgetShare: share,
  };
}
function useCatalogStatic(p: Project) { return buildCatalog(p.catalogOverrides, p.customCatalog); }

/** GEN-10/16 + section 11: fan out one task per room, validate each patch, stream results as they land. */
export async function generateAll(roomIds?: string[]) {
  const s = getState();
  const p = s.project!;
  const f = activeFloor(s)!;
  const rooms = f.rooms.filter((r) => r.type !== 'shaft' && (!roomIds || roomIds.includes(r.id)));
  clearJobs();
  const seed = Math.floor(Math.random() * 1e6);
  const cat = useCatalogStatic(p);
  const t0 = performance.now();
  const tasks: JobTask[] = rooms.map((r) => ({
    id: `gen:${r.id}`, label: `Layout · ${r.name} (3 options)`, lane: 'generation', deps: [], retries: 2, timeoutMs: 20000,
    run: () => getPool().run({ input: buildInput(p, f, r.id, seed), count: 3 }),
    // REL-01/02: structured output check + deterministic validators before merge
    validate: (o) => {
      const opts = o as GenOption[];
      if (!Array.isArray(opts) || !opts.length) return 'no options returned';
      for (const op of opts) for (const it of op.items) {
        if (!itemById(cat, it.catalogId)) return `unknown catalog item ${it.catalogId}`;
        if (![it.pos.x, it.pos.y, it.w, it.d, it.h].every(Number.isFinite)) return 'non-finite geometry';
      }
      return null;
    },
  }));
  tasks.push({
    id: 'qa', label: 'QA reviewer · rule check across rooms', lane: 'export', deps: tasks.map((t) => t.id),
    run: (inputs) => {
      let errors = 0;
      for (const [k, v] of Object.entries(inputs)) {
        const r = f.rooms.find((x) => `gen:${x.id}` === k)!;
        const best = (v as GenOption[])[0];
        const view = { ...f, items: [...f.items.filter((i) => i.roomId !== r.id || i.existing), ...best.items], points: best.points };
        errors += checkRoom(view, r, { catalog: cat, rules: p.settings.rulePack }).filter((i) => i.severity === 'error').length;
      }
      return errors;
    },
  });
  const res = await runGraph(tasks, {
    concurrency: Math.max(2, getPool().parallel || 3),
    onEvent: jobEvent,
    onResult: (id, out) => {
      if (!id.startsWith('gen:')) return;
      const roomId = id.slice(4);
      mutate('Generated design options', (pp) => { pp.generation[roomId] = out as GenOption[]; }, { history: false });
    },
  });
  const ms = Math.round(performance.now() - t0);
  mutate(`Generated ${rooms.length} room(s) in ${ms} ms (seed ${seed}, ${getPool().parallel || 1} workers)`, () => {}, { history: false, audit: true });
  if (res.failed.length) toast(`${res.failed.length} task(s) failed – see the progress list`, 'warn');
  else toast(`3 options for ${rooms.length} room(s) in ${(ms / 1000).toFixed(1)} s`);
}

export function applyOption(roomId: string, opt: GenOption) {
  mutate(`Applied ${opt.label} to room`, (p) => {
    for (const f of p.floors) {
      const r = f.rooms.find((x) => x.id === roomId);
      if (!r) continue;
      f.items = [...f.items.filter((i) => i.roomId !== roomId || i.existing), ...opt.items.map((i) => ({ ...i, id: uid('item'), draft: true }))];
      f.points = [...f.points.filter((x) => x.roomId !== roomId), ...opt.points.map((x) => ({ ...x, id: uid('pt'), draft: true }))];
      r.finishes = { ...opt.finishes };
      r.falseCeiling = { ...opt.falseCeiling };
      if (r.status === 'concept') r.status = 'design';
    }
  }, { audit: true });
}

export function BriefView() {
  const project = useStore((s) => s.project)!;
  const floor = useStore((s) => activeFloor(s));
  const jobs = useStore((s) => s.ui.jobs);
  const cat = useCatalog(project);
  const [busy, setBusy] = useState(false);
  const b = project.brief;
  const setB = (patch: Partial<Brief>) => mutate('Updated brief', (p) => { p.brief = { ...p.brief, ...patch, version: p.brief.version + 1 }; });
  const carpet = floor ? floor.rooms.filter((r) => r.type !== 'shaft').reduce((s, r) => s + polygonArea(r.polygon), 0) / MM2_PER_SQFT : 0;
  const band = BUDGET_BANDS[b.budgetBand];
  const run = async (ids?: string[]) => { setBusy(true); try { await generateAll(ids); } finally { setBusy(false); } };

  const addRefs = async (files: File[]) => {
    const refs: Project['refs'] = [];
    for (const f of files) {
      const { url, data } = await shrinkImage(f, 260, 0.75);
      const st = extractStyle(data.data, data.width, data.height);
      refs.push({ id: uid('ref'), name: f.name, thumb: url, palette: st.palette, tags: st.tags });
    }
    mutate(`Added ${refs.length} reference image(s)`, (p) => { p.refs.push(...refs); });
  };
  const allTags = [...new Set(project.refs.flatMap((r) => r.tags))];
  const suggested = useMemo(() => {
    if (!project.refs.length) return null;
    const counts: Record<string, number> = {};
    for (const r of project.refs) { const t = extractTheme(r.palette); counts[t] = (counts[t] ?? 0) + 1; }
    return Object.entries(counts).sort((a, c) => c[1] - a[1])[0][0];
  }, [project.refs]);

  if (!floor) return <div className="page"><div className="card">Import a drawing first, then come back to generate designs.</div></div>;
  return (
    <div className="page" style={{ maxWidth: 'none' }}>
      <h1>Brief & generate</h1>
      <p className="sub">Pick a theme, add reference images and the family's brief. The generator places real catalog items, sized to the actual walls, and checks every option against the rules.</p>
      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', alignItems: 'start' }}>
        <div className="col" style={{ gap: 14 }}>
          <div className="card col">
            <h2>Theme</h2>
            <div className="grid g3">
              {THEMES.map((t) => (
                <button key={t.id} className={'theme' + (project.theme === t.id ? ' on' : '')} onClick={() => mutate('Changed theme', (p) => { p.theme = t.id; })}>
                  <div className="row" style={{ gap: 3 }}>{t.palette.map((c) => <span key={c} className="swatch" style={{ background: c }} />)}</div>
                  <strong>{t.name}{suggested === t.id && <span className="tag accent" style={{ marginLeft: 6 }}>matches refs</span>}</strong>
                  <span className="muted small">{t.description}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="card col">
            <div className="row"><h2 className="grow" style={{ margin: 0 }}>Reference images & mood board</h2><FilePick accept="image/*" multiple onFile={addRefs}>Add images…</FilePick></div>
            <div className="muted small">Style is extracted in your browser; images stay in this workspace and are never used to train shared models.</div>
            {project.refs.length > 0 && (
              <div className="refs">
                {project.refs.map((r) => (
                  <div key={r.id} className="col" style={{ gap: 4 }}>
                    <img src={r.thumb} alt={r.name} />
                    <div className="row" style={{ gap: 2 }}>{r.palette.map((c) => <span key={c} className="swatch" style={{ background: c, width: 14, height: 14 }} title={c} />)}</div>
                    <div className="row" style={{ gap: 3 }}>{r.tags.slice(0, 4).map((t) => <span key={t} className="tag">{t}</span>)}</div>
                    <div className="row">
                      <select className="i" style={{ fontSize: 11, padding: 2 }} value={r.roomId ?? ''} onChange={(e) => mutate('Reference room', (p) => { p.refs.find((x) => x.id === r.id)!.roomId = e.target.value || undefined; })}><option value="">Whole home</option>{floor.rooms.map((rm) => <option key={rm.id} value={rm.id}>{rm.name}</option>)}</select>
                      <button className="btn sm ghost" onClick={() => mutate('Removed reference', (p) => { p.refs = p.refs.filter((x) => x.id !== r.id); })}>✕</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {allTags.length > 0 && (
              <div className="col" style={{ gap: 4 }}>
                <span className="small muted">Style tags (click to toggle — selected tags steer generation)</span>
                <div className="row" style={{ gap: 4 }}>{allTags.map((t) => <button key={t} className={'tag' + (project.styleTags.includes(t) ? ' accent' : '')} onClick={() => mutate('Style tags', (p) => { p.styleTags = p.styleTags.includes(t) ? p.styleTags.filter((x) => x !== t) : [...p.styleTags, t]; })}>{t}</button>)}</div>
              </div>
            )}
          </div>
          <div className="card col">
            <h2>Design brief</h2>
            <div className="fields" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))' }}>
              <Field label="Family size"><NumInput value={b.familySize} onChange={(v) => setB({ familySize: v })} /></Field>
              <Field label="Members"><TextInput value={b.members} onChange={(v) => setB({ members: v })} /></Field>
              <Field label="Storage need"><select className="i" value={b.storage} onChange={(e) => setB({ storage: e.target.value as Brief['storage'] })}>{['low', 'medium', 'high'].map((x) => <option key={x}>{x}</option>)}</select></Field>
              <Field label="Budget band"><select className="i" value={b.budgetBand} onChange={(e) => setB({ budgetBand: e.target.value as Brief['budgetBand'] })}>{Object.entries(BUDGET_BANDS).map(([k, v]) => <option key={k} value={k}>{v.label} (~₹{v.perSqft}/sq ft)</option>)}</select></Field>
              <Field label="Total budget (₹)" hint="0 = use band"><NumInput value={b.budget} onChange={(v) => setB({ budget: v })} /></Field>
            </div>
            <div className="muted small">Band estimate for {carpet.toFixed(0)} sq ft carpet: {inr(carpet * band.perSqft)}</div>
            <div className="row" style={{ gap: 4 }}>
              <span className="small muted">Must-haves:</span>
              {MUST.map((m) => <button key={m} className={'tag' + (b.mustHaves.includes(m) ? ' accent' : '')} onClick={() => setB({ mustHaves: b.mustHaves.includes(m) ? b.mustHaves.filter((x) => x !== m) : [...b.mustHaves, m] })}>{m}</button>)}
            </div>
            <div className="row">
              <label className="row small"><input type="checkbox" checked={b.vastu} onChange={(e) => setB({ vastu: e.target.checked })} /> Vastu preference (advisory)</label>
              <label className="row small"><input type="checkbox" checked={b.accessibility} onChange={(e) => setB({ accessibility: e.target.checked })} /> Accessibility / ageing-in-place</label>
            </div>
            <div className="fields" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <Field label="Likes"><TextInput value={b.likes} onChange={(v) => setB({ likes: v })} /></Field>
              <Field label="Dislikes"><TextInput value={b.dislikes} onChange={(v) => setB({ dislikes: v })} /></Field>
            </div>
            <Field label="Free-text prompt" hint="e.g. warm wood, cane accents, lots of storage, no glossy finishes"><TextInput area value={project.prompt} onChange={(v) => mutate('Prompt', (p) => { p.prompt = v; })} /></Field>
            <div className="muted small">Brief version {b.version}</div>
          </div>
        </div>
        <div className="col" style={{ gap: 14 }}>
          <div className="card col">
            <div className="row">
              <h2 className="grow" style={{ margin: 0 }}>Generate</h2>
              <button className="btn primary" disabled={busy} onClick={() => run()}>{busy ? 'Generating…' : 'Generate whole home'}</button>
            </div>
            <div className="muted small">One task per room runs in parallel on {getPoolSize()} worker(s); each result is validated before it reaches the model, then a QA pass checks the rules.</div>
            {jobs.length > 0 && (
              <div className="progress">
                {jobs.map((j) => (
                  <div key={j.id} className="job">
                    {j.status === 'running' ? <span className="spin" /> : <span>{j.status === 'done' ? '✓' : j.status === 'failed' ? '✕' : j.status === 'retry' ? '↻' : '·'}</span>}
                    <span>{j.label}{j.note && <span className="muted"> – {j.note}</span>}</span>
                    <span className="muted mono">{j.ms !== undefined ? `${j.ms} ms` : j.status}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          {floor.rooms.filter((r) => r.type !== 'shaft').map((r) => {
            const opts = project.generation[r.id];
            return (
              <div key={r.id} className="card col">
                <div className="row"><h2 className="grow" style={{ margin: 0 }}>{r.name}</h2>
                  <button className="btn sm" disabled={busy} onClick={() => run([r.id])}>{opts ? 'Regenerate' : 'Generate'}</button>
                </div>
                {!opts && <div className="muted small">No options yet.</div>}
                {opts && (
                  <div className="grid g3">
                    {opts.map((o) => <OptionCard key={o.id} floor={floor} roomId={r.id} opt={o} cat={cat} />)}
                  </div>
                )}
              </div>
            );
          })}
          {Object.keys(project.generation).length > 0 && (
            <div className="card row">
              <div className="grow small">Apply the best-scoring option in every room (whole-home consistency), then fine-tune in the editor.</div>
              <button className="btn primary" onClick={() => { for (const r of floor.rooms) { const o = project.generation[r.id]; if (o?.length) applyOption(r.id, [...o].sort((a, c) => c.score - a.score)[0]); } setView('design'); }}>Apply best to all rooms →</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function getPoolSize() { return pool?.parallel || Math.max(2, Math.min(6, (navigator.hardwareConcurrency || 4) - 1)); }
function extractTheme(palette: string[]) { return THEMES.reduce((best, t) => (score(t.palette, palette) < score(best.palette, palette) ? t : best), THEMES[0]).id; }
function score(a: string[], b: string[]) {
  const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  return b.slice(0, 4).reduce((s, c) => { const [r, g, bb] = rgb(c); return s + Math.min(...a.map((x) => { const [R, G, B] = rgb(x); return (R - r) ** 2 + (G - g) ** 2 + (B - bb) ** 2; })); }, 0);
}

function OptionCard({ floor, roomId, opt, cat }: { floor: Floor; roomId: string; opt: GenOption; cat: ReturnType<typeof useCatalog> }) {
  const room = floor.rooms.find((r) => r.id === roomId)!;
  const view: Floor = { ...floor, items: [...floor.items.filter((i) => i.roomId !== roomId || i.existing), ...opt.items], points: [...floor.points.filter((p) => p.roomId !== roomId), ...opt.points], rooms: floor.rooms.map((r) => (r.id === roomId ? { ...r, finishes: opt.finishes } : r)) };
  const pts = room.polygon;
  const b = { minX: Math.min(...pts.map((p) => p.x)) - 300, maxX: Math.max(...pts.map((p) => p.x)) + 300, minY: Math.min(...pts.map((p) => p.y)) - 300, maxY: Math.max(...pts.map((p) => p.y)) + 300 };
  void planBounds;
  const fl = materialById(cat, opt.finishes.floor), wl = materialById(cat, opt.finishes.wall), lam = materialById(cat, opt.items.find((i) => i.finish)?.finish);
  const applied = floor.items.some((i) => i.roomId === roomId && !i.existing) && opt.items.every((o) => floor.items.some((i) => i.catalogId === o.catalogId && Math.abs(i.pos.x - o.pos.x) < 1 && Math.abs(i.pos.y - o.pos.y) < 1));
  return (
    <div className="optcard">
      <svg className="thumb" viewBox={`${b.minX} ${-b.maxY} ${b.maxX - b.minX} ${b.maxY - b.minY}`} style={{ color: 'var(--ink)' }}>
        <g transform="scale(1 -1)"><PlanContent floor={view} cat={cat} opts={{ layers: { rooms: false, electrical: false, plumbing: false, hvac: false }, textScale: 1.2 }} /></g>
      </svg>
      <div className="row"><strong className="grow">{opt.label}</strong><span className={'tag ' + (opt.issues ? 'warn' : 'ok')}>{opt.issues ? `${opt.issues} warning(s)` : 'rules pass'}</span></div>
      <div className="row small"><strong>{inr(opt.cost)}</strong><span className="muted">score {opt.score}</span><span className="tag">{opt.skuCount} SKUs</span><span className="tag">{opt.customCount} custom joinery</span></div>
      <div className="row" style={{ gap: 4 }}>{[fl, wl, lam].filter(Boolean).map((m) => <span key={m!.id} className="tag" title={m!.code}><span className="swatch" style={{ background: m!.color, width: 10, height: 10 }} />{m!.name.split(',')[0]}</span>)}</div>
      <div className="muted small">{opt.summary}</div>
      <button className={'btn sm' + (applied ? ' on' : ' primary')} onClick={() => applyOption(roomId, opt)}>{applied ? 'Applied' : 'Apply to room'}</button>
    </div>
  );
}
