import { useSyncExternalStore } from 'react';
import type { Floor, Project, Underlay, PointKind, Trade } from './core/types';
import { createProject } from './core/project';
import { parseDxf } from './core/dxf';
import { importDxf } from './core/detect';
import { buildSampleDxf } from './core/sample';
import { createFlat409Project } from './core/flat409';
import { nowIso } from './core/util';
import type { JobEvent } from './core/orchestrator';

export type View = 'home' | 'import' | 'brief' | 'design' | 'boq' | 'project' | 'exports' | 'catalog' | 'settings';
export type Tool = 'select' | 'wall' | 'measure' | 'snag' | 'comment' | 'calibrate' | `point:${PointKind}` | `item:${string}`;
export type SelKind = 'item' | 'wall' | 'opening' | 'room' | 'point' | 'column' | 'annotation' | 'snag' | 'comment';
export interface Sel { kind: SelKind; id: string }

export type LayerKey = 'civil' | 'carpentry' | 'furniture' | 'electrical' | 'plumbing' | 'hvac' | 'decor' | 'annotation' | 'underlay' | 'vastu' | 'rooms';
export const LAYER_LABELS: Record<LayerKey, string> = {
  rooms: 'Rooms & areas', civil: 'Civil / structure', carpentry: 'Carpentry', furniture: 'Furniture', electrical: 'Electrical', plumbing: 'Plumbing', hvac: 'HVAC', decor: 'Decor', annotation: 'Dimensions & notes', underlay: 'Original drawing (underlay)', vastu: 'Vastu grid (advisory)',
};

export interface JobRow { id: string; label: string; status: 'queued' | 'running' | 'done' | 'retry' | 'failed'; ms?: number; note?: string }

export interface UiState {
  view: View;
  floorId?: string;
  selection: Sel | null;
  tool: Tool;
  layers: Record<LayerKey, boolean>;
  split: '2d' | '3d' | 'split';
  jobs: JobRow[];
  toast?: { text: string; kind: 'ok' | 'warn' | 'err'; at: number };
  palette: boolean;
  shareTrade?: Trade | 'all';
}

export interface AppState {
  index: { id: string; name: string; updatedAt: string }[];
  project: Project | null;
  past: Project[];
  future: Project[];
  underlays: Record<string, Underlay>;
  ui: UiState;
}

const LS = {
  get<T>(k: string, d: T): T { try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : d; } catch { return d; } },
  set(k: string, v: unknown) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
  del(k: string) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};

const defaultLayers: Record<LayerKey, boolean> = { rooms: true, civil: true, carpentry: true, furniture: true, electrical: true, plumbing: true, hvac: true, decor: true, annotation: true, underlay: false, vastu: false };

let state: AppState = {
  index: LS.get('ibt:index', []),
  project: null,
  past: [],
  future: [],
  underlays: {},
  ui: { view: 'home', selection: null, tool: 'select', layers: defaultLayers, split: 'split', jobs: [], palette: false },
};

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
function set(next: Partial<AppState>) { state = { ...state, ...next }; emit(); }

export function useStore<T>(sel: (s: AppState) => T): T {
  return useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb); }, () => sel(state), () => sel(state));
}
export const getState = () => state;

// ---- persistence -----------------------------------------------------------

let saveTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 400);
}
export function saveNow() {
  const p = state.project;
  if (!p) return;
  const ok = LS.set(`ibt:p:${p.id}`, p);
  if (!ok) toast('Browser storage is full – export the project to a file to keep it safe', 'warn');
  const index = [{ id: p.id, name: p.name, updatedAt: p.updatedAt }, ...state.index.filter((i) => i.id !== p.id)];
  LS.set('ibt:index', index);
  for (const f of p.floors) if (state.underlays[f.id]) LS.set(`ibt:u:${f.id}`, state.underlays[f.id]);
  state = { ...state, index };
}

// ---- project actions ---------------------------------------------------------

export function openProject(id: string) {
  const p = LS.get<Project | null>(`ibt:p:${id}`, null);
  if (!p) { toast('Project not found in this browser', 'err'); return; }
  const underlays: Record<string, Underlay> = {};
  for (const f of p.floors) { const u = LS.get<Underlay | null>(`ibt:u:${f.id}`, null); if (u) underlays[f.id] = u; }
  set({ project: migrate(p), past: [], future: [], underlays, ui: { ...state.ui, view: p.floors.length ? 'design' : 'import', floorId: p.floors[0]?.id, selection: null } });
}

function migrate(p: Project): Project {
  // fill fields added after a project was saved
  p.progress = p.progress ?? [];
  p.revisions = (p.revisions ?? []).map((r) => ({ ...r, sigs: r.sigs ?? {}, viewers: r.viewers ?? [] }));
  for (const [k, opts] of Object.entries(p.generation ?? {})) p.generation[k] = opts.map((o) => ({ ...o, falseCeiling: o.falseCeiling ?? { enabled: false, drop: 0, cove: false } }));
  return p;
}

export function newProject(name: string) {
  const p = createProject(name, state.ui ? state.project?.settings.user ?? 'Designer' : 'Designer');
  set({ project: p, past: [], future: [], underlays: {}, ui: { ...state.ui, view: 'import', floorId: undefined, selection: null } });
  saveNow();
}

export function openSample() {
  const p = createProject('Sample 2BHK – Japandi');
  p.client = { name: 'Sample client', phone: '', email: '' };
  p.address = 'Flat 402, Sample Residency';
  const text = buildSampleDxf();
  const res = importDxf(parseDxf(text), { fileName: 'sample-2bhk.dxf', fileText: text, user: p.settings.user });
  p.floors = res.floors;
  p.audit.push({ at: nowIso(), by: p.settings.user, action: `Imported sample-2bhk.dxf: ${res.stats.walls} walls, ${res.stats.openings} openings, ${res.stats.rooms} rooms` });
  set({ project: p, past: [], future: [], underlays: res.underlays, ui: { ...state.ui, view: 'import', floorId: p.floors[0]?.id, selection: null } });
  saveNow();
}

/** Flat 409 – built from the "Quiet Warmth" concept book and the Flat 409 estimate. */
export function openFlat409() {
  const { project, underlays } = createFlat409Project(state.project?.settings.user ?? 'Designer');
  set({ project, past: [], future: [], underlays, ui: { ...state.ui, view: 'design', floorId: project.floors[0]?.id, selection: null } });
  saveNow();
  toast('Flat 409 project created from the concept book');
}

export function closeProject() { saveNow(); set({ project: null, ui: { ...state.ui, view: 'home', selection: null } }); }

export function deleteProject(id: string) {
  const p = LS.get<Project | null>(`ibt:p:${id}`, null);
  if (p) for (const f of p.floors) LS.del(`ibt:u:${f.id}`);
  LS.del(`ibt:p:${id}`);
  const index = state.index.filter((i) => i.id !== id);
  LS.set('ibt:index', index);
  set({ index, project: state.project?.id === id ? null : state.project });
}

export function importProjectJson(text: string) {
  const data = JSON.parse(text) as { project: Project; underlays?: Record<string, Underlay> };
  const p = migrate(data.project ?? (data as unknown as Project));
  set({ project: p, past: [], future: [], underlays: data.underlays ?? {}, ui: { ...state.ui, view: 'design', floorId: p.floors[0]?.id } });
  saveNow();
}

/** Apply a change to the project with undo history (EDT-14). */
export function mutate(label: string, fn: (p: Project) => void, opts: { history?: boolean; audit?: boolean } = {}) {
  const cur = state.project;
  if (!cur) return;
  const next = structuredClone(cur);
  fn(next);
  next.updatedAt = nowIso();
  if (opts.audit) next.audit.push({ at: next.updatedAt, by: next.settings.user, action: label });
  const history = opts.history ?? true;
  set({ project: next, past: history ? [...state.past.slice(-150), cur] : state.past, future: history ? [] : state.future });
  scheduleSave();
}

export function undo() {
  const prev = state.past[state.past.length - 1];
  if (!prev || !state.project) return;
  set({ project: prev, past: state.past.slice(0, -1), future: [state.project, ...state.future] });
  scheduleSave();
}
export function redo() {
  const nx = state.future[0];
  if (!nx || !state.project) return;
  set({ project: nx, past: [...state.past, state.project], future: state.future.slice(1) });
  scheduleSave();
}

export function setUnderlay(floorId: string, u: Underlay) { set({ underlays: { ...state.underlays, [floorId]: u } }); scheduleSave(); }

export function setUi(p: Partial<UiState>) { set({ ui: { ...state.ui, ...p } }); }
export function setView(view: View) { setUi({ view, selection: null, tool: 'select' }); }
export function select(selection: Sel | null) { setUi({ selection }); }

export function toast(text: string, kind: 'ok' | 'warn' | 'err' = 'ok') {
  setUi({ toast: { text, kind, at: Date.now() } });
  setTimeout(() => { if (state.ui.toast && Date.now() - state.ui.toast.at >= 3900) setUi({ toast: undefined }); }, 4000);
}

export function jobEvent(e: JobEvent) {
  const jobs = state.ui.jobs.slice();
  const i = jobs.findIndex((j) => j.id === e.id);
  const row: JobRow = i >= 0 ? { ...jobs[i] } : { id: e.id, label: e.type === 'queued' ? e.label : e.id, status: 'queued' };
  if (e.type === 'start') { row.status = 'running'; row.note = e.attempt > 1 ? `attempt ${e.attempt}` : undefined; }
  if (e.type === 'done') { row.status = 'done'; row.ms = e.ms; if (e.cached) row.note = 'from checkpoint'; }
  if (e.type === 'retry') { row.status = 'retry'; row.note = e.error; }
  if (e.type === 'fail') { row.status = 'failed'; row.note = e.error; }
  if (i >= 0) jobs[i] = row; else jobs.push(row);
  setUi({ jobs });
}
export function clearJobs() { setUi({ jobs: [] }); }

export function activeFloor(s: AppState = state): Floor | undefined {
  const p = s.project;
  if (!p) return undefined;
  return p.floors.find((f) => f.id === s.ui.floorId) ?? p.floors[0];
}

export function exportProjectFile(): string {
  const p = state.project!;
  const underlays: Record<string, Underlay> = {};
  for (const f of p.floors) if (state.underlays[f.id]) underlays[f.id] = state.underlays[f.id];
  return JSON.stringify({ format: 'interior-build-tool/1', project: p, underlays });
}
