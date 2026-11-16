import React, { useState } from 'react';
import { useStore, mutate, toast } from '../store';
import { catalogFromCsv, CATALOG_VERSION } from '../core/catalog';
import { parseCsv, inr } from '../core/util';
import { FilePick, NumInput, readFile, useCatalog, download } from './common';

export function CatalogView() {
  const project = useStore((s) => s.project)!;
  const cat = useCatalog(project);
  const [tab, setTab] = useState<'items' | 'materials'>('items');
  const [q, setQ] = useState('');
  const setRate = (id: string, rate: number) => mutate('Rate updated', (p) => { p.catalogOverrides[id] = { ...(p.catalogOverrides[id] ?? {}), rate }; }, { audit: true });
  const setBrand = (id: string, brand: string) => mutate('Brand updated', (p) => { p.catalogOverrides[id] = { ...(p.catalogOverrides[id] ?? {}), brand }; });
  const importCsv = async (f: File) => {
    try {
      const items = catalogFromCsv(parseCsv(await readFile(f, 'text')));
      mutate(`Imported ${items.length} firm catalog item(s)`, (p) => { p.customCatalog = [...p.customCatalog.filter((c) => !items.some((i) => i.id === c.id)), ...items]; }, { audit: true });
      toast(`${items.length} item(s) added to the firm catalog`);
    } catch (e) { toast((e as Error).message, 'err'); }
  };
  const match = (s: string) => !q || s.toLowerCase().includes(q.toLowerCase());
  return (
    <div className="page" style={{ maxWidth: 'none' }}>
      <h1>Catalog & rate library</h1>
      <p className="sub">Every item the generator may place is buildable: a real SKU or custom joinery with a locked spec. Rates here drive the BOQ (catalog {CATALOG_VERSION}).</p>
      <div className="row" style={{ marginBottom: 12 }}>
        <div className="seg"><button className={tab === 'items' ? 'on' : ''} onClick={() => setTab('items')}>Items ({cat.items.length})</button><button className={tab === 'materials' ? 'on' : ''} onClick={() => setTab('materials')}>Materials & finishes ({cat.materials.length})</button></div>
        <input className="i" style={{ width: 240 }} placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="grow" />
        <FilePick accept=".csv" onFile={([f]) => importCsv(f)}>Import firm items (CSV)…</FilePick>
        <button className="btn" onClick={() => download('catalog-template.csv', 'id,name,category,trade,w,d,h,rate,unit,brand,series,grade,sku\nbed-k2,King bed walnut,bed,furniture,1950,2150,450,61000,each,Your vendor,Series X,Solid wood,SKU-123\n', 'text/csv')}>CSV template</button>
      </div>
      <div className="card">
        <div className="tablewrap" style={{ maxHeight: 'calc(100vh - 260px)' }}>
          {tab === 'items' ? (
            <table className="t">
              <thead><tr><th>Item</th><th>Category</th><th>Type</th><th>Size (W×D×H)</th><th>Brand</th><th>Specification</th><th className="num">Rate (₹)</th><th>Unit</th></tr></thead>
              <tbody>{cat.items.filter((i) => match(i.name + i.category)).map((i) => (
                <tr key={i.id}><td><span className="swatch" style={{ background: i.color, width: 12, height: 12, marginRight: 6 }} />{i.name}{i.id.startsWith('firm-') && <span className="tag accent" style={{ marginLeft: 4 }}>firm</span>}</td><td>{i.category}</td><td><span className="tag">{i.kind === 'sku' ? `SKU ${i.sku ?? ''}` : 'custom joinery'}</span></td>
                  <td className="mono">{i.w}×{i.d}×{i.h}{i.minW ? ` (${i.minW}–${i.maxW}, ${i.module} mod)` : ''}</td>
                  <td><input className="i" style={{ width: 140 }} defaultValue={i.spec.brand} onBlur={(e) => e.target.value !== i.spec.brand && setBrand(i.id, e.target.value)} /></td>
                  <td className="small">{i.spec.series} · {i.spec.grade}</td>
                  <td style={{ width: 110 }}><NumInput value={i.rate} onChange={(v) => setRate(i.id, v)} /></td><td>{i.unit}</td></tr>
              ))}</tbody>
            </table>
          ) : (
            <table className="t">
              <thead><tr><th>Material</th><th>Kind</th><th>Code</th><th>Spec</th><th className="num">Wastage</th><th className="num">Rate (₹/sq ft)</th></tr></thead>
              <tbody>{cat.materials.filter((m) => match(m.name + m.kind)).map((m) => (
                <tr key={m.id}><td><span className="swatch" style={{ background: m.color, width: 12, height: 12, marginRight: 6 }} />{m.name}</td><td>{m.kind}</td><td className="mono">{m.code}</td><td className="small">{m.spec.series} · {m.spec.grade}</td><td className="num">{Math.round(m.wastage * 100)}%</td>
                  <td style={{ width: 110 }}>{m.kind === 'laminate' || m.kind === 'veneer' ? <span className="muted small">in joinery rate</span> : <NumInput value={m.rate} onChange={(v) => setRate(m.id, v)} />}</td></tr>
              ))}</tbody>
            </table>
          )}
        </div>
      </div>
      <div className="muted small" style={{ marginTop: 8 }}>Indicative placeholder rates ({inr(1650)}/sq ft wardrobe front etc.) — replace them with your firm's rate analysis before quoting.</div>
    </div>
  );
}
