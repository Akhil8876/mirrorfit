import React, { useEffect, useMemo, useRef, useState } from 'react';
import { parseLength, fmtLen, type DisplayUnits } from '../core/units';
import { useStore } from '../store';
import { buildCatalog } from '../core/catalog';
import type { Project } from '../core/types';

export function download(name: string, content: string | Blob, type = 'text/plain') {
  const blob = typeof content === 'string' ? new Blob([content], { type }) : content;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function readFile(file: File, as: 'text' | 'dataUrl'): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = () => rej(r.error);
    if (as === 'text') r.readAsText(file); else r.readAsDataURL(file);
  });
}

/** Downscale an image file to a data URL (photos for snags/RFIs, reference thumbs). */
export async function shrinkImage(file: File, max = 900, quality = 0.8): Promise<{ url: string; data: ImageData }> {
  const src = await readFile(file, 'dataUrl');
  const img = new Image();
  await new Promise((r, j) => { img.onload = r; img.onerror = j; img.src = src; });
  const k = Math.min(1, max / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(img.width * k)); c.height = Math.max(1, Math.round(img.height * k));
  const ctx = c.getContext('2d')!;
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return { url: c.toDataURL('image/jpeg', quality), data: ctx.getImageData(0, 0, c.width, c.height) };
}

export function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return <label className="f"><span>{label}{hint && <span className="muted"> · {hint}</span>}</span>{children}</label>;
}

/** Length input in the user's display units; accepts 3200, 3.2m, 10'6" (IMP-24). */
export function LenInput({ value, onChange, units, disabled, min }: { value: number; onChange: (mm: number) => void; units?: DisplayUnits; disabled?: boolean; min?: number }) {
  const u = units ?? 'mm';
  const show = (v: number) => (u === 'mm' ? String(Math.round(v)) : fmtLen(v, u).replace(' m', '').replace(' mm', ''));
  const [text, setText] = useState(show(value));
  const [bad, setBad] = useState(false);
  useEffect(() => { setText(show(value)); setBad(false); }, [value, u]);
  const commit = () => {
    const v = parseLength(text, u);
    if (v === null || !isFinite(v) || (min !== undefined && v < min)) { setBad(true); return; }
    setBad(false);
    if (Math.abs(v - value) > 0.01) onChange(v);
  };
  return <input className={'i' + (bad ? ' bad' : '')} value={text} disabled={disabled} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />;
}

export function NumInput({ value, onChange, step, disabled }: { value: number; onChange: (v: number) => void; step?: number; disabled?: boolean }) {
  const [t, setT] = useState(String(value));
  useEffect(() => setT(String(value)), [value]);
  return <input className="i" type="number" step={step} value={t} disabled={disabled} onChange={(e) => setT(e.target.value)} onBlur={() => { const v = parseFloat(t); if (isFinite(v) && v !== value) onChange(v); }} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />;
}

export function TextInput({ value, onChange, placeholder, area }: { value: string; onChange: (v: string) => void; placeholder?: string; area?: boolean }) {
  const [t, setT] = useState(value);
  useEffect(() => setT(value), [value]);
  if (area) return <textarea className="i" rows={3} value={t} placeholder={placeholder} onChange={(e) => setT(e.target.value)} onBlur={() => t !== value && onChange(t)} />;
  return <input className="i" value={t} placeholder={placeholder} onChange={(e) => setT(e.target.value)} onBlur={() => t !== value && onChange(t)} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />;
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={wide ? { width: 'min(980px, 100%)' } : undefined} role="dialog" aria-label={title}>
        <div className="row" style={{ marginBottom: 12 }}><h2 className="grow" style={{ margin: 0 }}>{title}</h2><button className="btn ghost" onClick={onClose} aria-label="Close">✕</button></div>
        {children}
      </div>
    </div>
  );
}

export function FilePick({ accept, onFile, children, multiple, className }: { accept: string; onFile: (f: File[]) => void; children: React.ReactNode; multiple?: boolean; className?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <button className={className ?? 'btn'} onClick={() => ref.current?.click()}>{children}</button>
      <input ref={ref} type="file" accept={accept} multiple={multiple} style={{ display: 'none' }} onChange={(e) => { const f = [...(e.target.files ?? [])]; if (f.length) onFile(f); e.target.value = ''; }} />
    </>
  );
}

export function Conf({ v }: { v?: number }) {
  if (v === undefined) return <span className="tag">manual</span>;
  const pct = Math.round(v * 100);
  return <span className={'tag ' + (v >= 0.85 ? 'ok' : v >= 0.7 ? 'warn' : 'err')} title="Detection confidence">{pct}%</span>;
}

export function Empty({ title, children }: { title: string; children?: React.ReactNode }) {
  return <div className="card" style={{ textAlign: 'center', padding: 32 }}><h2>{title}</h2><div className="muted">{children}</div></div>;
}

export function useCatalog(p: Project | null) {
  return useMemo(() => buildCatalog(p?.catalogOverrides ?? {}, p?.customCatalog ?? []), [p?.catalogOverrides, p?.customCatalog]);
}

export function useUnits(): DisplayUnits {
  return useStore((s) => s.project?.settings.displayUnits ?? 'mm');
}

export function Table({ head, rows, num = [] }: { head: string[]; rows: (string | number | React.ReactNode)[][]; num?: number[] }) {
  return (
    <table className="t">
      <thead><tr>{head.map((h, i) => <th key={i} className={num.includes(i) ? 'num' : ''}>{h}</th>)}</tr></thead>
      <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className={num.includes(j) ? 'num' : ''}>{c}</td>)}</tr>)}</tbody>
    </table>
  );
}
