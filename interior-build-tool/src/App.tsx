import React, { useEffect, useMemo, useState } from 'react';
import { useStore, setView, undo, redo, closeProject, setUi, mutate, getState, type View } from './store';
import { Home } from './ui/Home';
import { ImportView } from './ui/ImportView';
import { BriefView } from './ui/BriefView';
import { DesignView } from './ui/DesignView';
import { BoqView } from './ui/BoqView';
import { ProjectView } from './ui/ProjectView';
import { ExportView } from './ui/ExportView';
import { CatalogView } from './ui/CatalogView';
import { SettingsView } from './ui/SettingsView';
import type { Role, Trade } from './core/types';
import { TRADES } from './core/types';

const NAV: { view: View; label: string; step?: number; roles?: Role[] }[] = [
  { view: 'import', label: 'Import & review', step: 1, roles: ['owner', 'admin', 'designer'] },
  { view: 'brief', label: 'Brief & generate', step: 2, roles: ['owner', 'admin', 'designer'] },
  { view: 'design', label: 'Design editor', step: 3, roles: ['owner', 'admin', 'designer', 'viewer', 'client'] },
  { view: 'boq', label: 'BOQ & quote', step: 4, roles: ['owner', 'admin', 'designer', 'client'] },
  { view: 'project', label: 'Project & site', step: 5, roles: ['owner', 'admin', 'designer', 'client', 'trade'] },
  { view: 'exports', label: 'Trade packages', step: 6, roles: ['owner', 'admin', 'designer', 'viewer', 'client', 'trade'] },
];

export function App() {
  const view = useStore((s) => s.ui.view);
  const project = useStore((s) => s.project);
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const toast = useStore((s) => s.ui.toast);
  const floorId = useStore((s) => s.ui.floorId);
  const palette = useStore((s) => s.ui.palette);
  const role = project?.settings.role ?? 'designer';

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const inField = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setUi({ palette: !getState().ui.palette }); return; }
      if (inField) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);

  if (!project) return (<div className="app"><TopBar /><div className="main"><Home /></div>{toast && <div className={'toast ' + toast.kind}>{toast.text}</div>}</div>);

  const allowed = NAV.filter((n) => !n.roles || n.roles.includes(role));
  const cur = allowed.some((n) => n.view === view) || view === 'catalog' || view === 'settings' ? view : allowed[allowed.length - 1].view;
  return (
    <div className="app">
      <TopBar>
        <span className="proj">{project.name}</span>
        {project.floors.length > 1 && (
          <select className="i" style={{ width: 'auto' }} value={floorId ?? project.floors[0].id} onChange={(e) => setUi({ floorId: e.target.value, selection: null })}>
            {project.floors.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        )}
        <span className="spacer" />
        <button className="btn sm ghost" disabled={!canUndo} onClick={undo} title="Undo (Ctrl+Z)">↶ Undo</button>
        <button className="btn sm ghost" disabled={!canRedo} onClick={redo} title="Redo (Ctrl+Y)">↷ Redo</button>
        <button className="btn sm" onClick={() => setUi({ palette: true })} title="Command search (Ctrl+K)">⌘K</button>
        <RoleSwitch />
      </TopBar>
      <div className={cur === 'design' ? 'body' : 'body'}>
        <nav className="nav">
          {allowed.map((n) => (
            <button key={n.view} className={cur === n.view ? 'on' : ''} onClick={() => setView(n.view)}>
              <span className="step">{n.step}</span>{n.label}
            </button>
          ))}
          {(role === 'owner' || role === 'admin' || role === 'designer') && <>
            <div className="sep" />
            <button className={cur === 'catalog' ? 'on' : ''} onClick={() => setView('catalog')}><span className="step">◫</span>Catalog & rates</button>
            <button className={cur === 'settings' ? 'on' : ''} onClick={() => setView('settings')}><span className="step">⚙</span>Settings</button>
          </>}
          <div className="sep" />
          <button onClick={closeProject}><span className="step">←</span>All projects</button>
          <div className="hint">Saved in this browser. Export the project file from Settings to back it up.</div>
        </nav>
        <main className="main">
          {cur === 'import' && <ImportView />}
          {cur === 'brief' && <BriefView />}
          {cur === 'design' && <DesignView />}
          {cur === 'boq' && <BoqView />}
          {cur === 'project' && <ProjectView />}
          {cur === 'exports' && <ExportView />}
          {cur === 'catalog' && <CatalogView />}
          {cur === 'settings' && <SettingsView />}
        </main>
      </div>
      {palette && <CommandPalette />}
      {toast && <div className={'toast ' + toast.kind}>{toast.text}</div>}
    </div>
  );
}

function TopBar({ children }: { children?: React.ReactNode }) {
  return (
    <header className="topbar">
      <div className="brand" onClick={() => getState().project && setView('design')}><span className="logo">◧</span>Interior Build Studio</div>
      {children}
    </header>
  );
}

/** PM-08: switch the active role to preview what each user type can see. */
function RoleSwitch() {
  const s = useStore((x) => x.project?.settings);
  if (!s) return null;
  return (
    <div className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
      <select className="i" style={{ width: 'auto' }} value={s.role} title="Viewing as" onChange={(e) => mutate('Switched role', (p) => { p.settings.role = e.target.value as Role; }, { history: false })}>
        {(['owner', 'admin', 'designer', 'viewer', 'client', 'trade'] as Role[]).map((r) => <option key={r} value={r}>{r[0].toUpperCase() + r.slice(1)}</option>)}
      </select>
      {s.role === 'trade' && (
        <select className="i" style={{ width: 'auto' }} value={s.tradeView} onChange={(e) => mutate('Switched trade', (p) => { p.settings.tradeView = e.target.value as Trade; }, { history: false })}>
          {TRADES.filter((t) => t !== 'decor' && t !== 'furniture').map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      )}
    </div>
  );
}

/** EDT-17: command search for power users. */
function CommandPalette() {
  const [q, setQ] = useState('');
  const [i, setI] = useState(0);
  const cmds = useMemo(() => [
    { label: 'Go to Import & review', run: () => setView('import') },
    { label: 'Go to Brief & generate', run: () => setView('brief') },
    { label: 'Go to Design editor', run: () => setView('design') },
    { label: 'Go to BOQ & quote', run: () => setView('boq') },
    { label: 'Go to Project & site', run: () => setView('project') },
    { label: 'Go to Trade packages', run: () => setView('exports') },
    { label: 'Go to Catalog & rates', run: () => setView('catalog') },
    { label: 'Go to Settings', run: () => setView('settings') },
    { label: 'Tool: select (V)', run: () => { setView('design'); setUi({ tool: 'select' }); } },
    { label: 'Tool: draw partition wall (W)', run: () => { setView('design'); setUi({ tool: 'wall' }); } },
    { label: 'Tool: tape measure (M)', run: () => { setView('design'); setUi({ tool: 'measure' }); } },
    { label: 'Tool: add light point', run: () => { setView('design'); setUi({ tool: 'point:light' }); } },
    { label: 'Tool: add 6 A socket', run: () => { setView('design'); setUi({ tool: 'point:socket6' }); } },
    { label: 'Tool: add switchboard', run: () => { setView('design'); setUi({ tool: 'point:switchboard' }); } },
    { label: 'Tool: add cold-water inlet', run: () => { setView('design'); setUi({ tool: 'point:inlet-cold' }); } },
    { label: 'Tool: pin a snag', run: () => { setView('design'); setUi({ tool: 'snag' }); } },
    { label: 'Tool: comment pin', run: () => { setView('design'); setUi({ tool: 'comment' }); } },
    { label: 'View: 2D only', run: () => setUi({ split: '2d' }) },
    { label: 'View: 3D only', run: () => setUi({ split: '3d' }) },
    { label: 'View: split 2D / 3D', run: () => setUi({ split: 'split' }) },
    { label: 'Undo', run: undo },
    { label: 'Redo', run: redo },
    { label: 'Close project', run: closeProject },
  ], []);
  const list = cmds.filter((c) => c.label.toLowerCase().includes(q.toLowerCase()));
  const close = () => setUi({ palette: false });
  return (
    <div className="modal-bg" style={{ background: 'rgba(0,0,0,.2)' }} onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="palette">
        <input autoFocus placeholder="Type a command…" value={q} onChange={(e) => { setQ(e.target.value); setI(0); }} onKeyDown={(e) => {
          if (e.key === 'Escape') close();
          if (e.key === 'ArrowDown') setI(Math.min(list.length - 1, i + 1));
          if (e.key === 'ArrowUp') setI(Math.max(0, i - 1));
          if (e.key === 'Enter' && list[i]) { list[i].run(); close(); }
        }} />
        <div style={{ maxHeight: 360, overflow: 'auto' }}>
          {list.map((c, k) => <div key={c.label} className={'opt' + (k === i ? ' on' : '')} onMouseEnter={() => setI(k)} onClick={() => { c.run(); close(); }}>{c.label}</div>)}
        </div>
      </div>
    </div>
  );
}
