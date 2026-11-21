import React, { useState } from 'react';
import { useStore, newProject, openProject, openSample, openFlat409, deleteProject, importProjectJson, toast } from '../store';
import { FilePick, readFile } from './common';

export function Home() {
  const index = useStore((s) => s.index);
  const [name, setName] = useState('');
  return (
    <div className="page" style={{ maxWidth: 1000 }}>
      <h1>Projects</h1>
      <p className="sub">One model per project: the imported drawing drives the 3D design, the BOQ and every trade drawing.</p>
      <div className="card row" style={{ marginBottom: 14, borderColor: 'var(--accent)' }}>
        <div className="grow col" style={{ gap: 4 }}>
          <h2 style={{ margin: 0 }}>Flat 409 – Quiet Warmth (Japandi)</h2>
          <div className="muted small">Mr. Akhil Katkam · 3 bedrooms, 3 baths, 3 sit-outs. Built from the Studio Craft concept book v2 and the Flat 409 estimate: plan rebuilt from the CAD room sizes, Japandi palette, finish schedule and estimate rates.</div>
        </div>
        <button className="btn primary" onClick={openFlat409}>Open Flat 409 project</button>
      </div>
      <div className="grid g2" style={{ marginBottom: 18 }}>
        <div className="card col">
          <h2>New project</h2>
          <div className="row">
            <input className="i grow" placeholder="e.g. Sharma residence, 3BHK" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && name.trim() && newProject(name.trim())} />
            <button className="btn primary" disabled={!name.trim()} onClick={() => newProject(name.trim())}>Create</button>
          </div>
          <div className="muted small">Next you import the architect's DXF (or a plan image to trace over).</div>
        </div>
        <div className="card col">
          <h2>Try the sample</h2>
          <div className="muted small">A 2BHK apartment drawn as a typical architect's DXF: double-line walls, door and window blocks, columns, room labels and one deliberately wrong dimension.</div>
          <div className="row">
            <button className="btn primary" onClick={openSample}>Open sample 2BHK</button>
            <FilePick accept=".json" onFile={async ([f]) => { try { importProjectJson(await readFile(f, 'text')); toast('Project imported'); } catch (e) { toast('Not a project file: ' + (e as Error).message, 'err'); } }}>Open project file…</FilePick>
          </div>
        </div>
      </div>
      <div className="card">
        <h2>In this browser</h2>
        {!index.length && <div className="muted">No projects yet.</div>}
        <table className="t">
          <tbody>
            {index.map((p) => (
              <tr key={p.id} className="click" onClick={() => openProject(p.id)}>
                <td><strong>{p.name}</strong></td>
                <td className="muted small">Updated {new Date(p.updatedAt).toLocaleString()}</td>
                <td className="right"><button className="btn sm danger" onClick={(e) => { e.stopPropagation(); if (confirm(`Delete "${p.name}" from this browser?`)) deleteProject(p.id); }}>Delete</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
