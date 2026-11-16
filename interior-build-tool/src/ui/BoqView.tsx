import React, { useMemo, useState } from 'react';
import { useStore, mutate, toast } from '../store';
import { computeBoq, draftChangeOrder, quoteAmount, type BoqLine } from '../core/boq';
import { approvalLink, makeVersion, modelHash } from '../core/project';
import type { Approval, Project, QuoteSettings } from '../core/types';
import { inr, toCsv, uid, nowIso, groupBy } from '../core/util';
import { BUDGET_BANDS } from '../core/themes';
import { Field, NumInput, TextInput, download } from './common';

export function BoqView() {
  const project = useStore((s) => s.project)!;
  const [tab, setTab] = useState<'boq' | 'quote' | 'co'>('boq');
  const [by, setBy] = useState<'room' | 'trade' | 'group'>('room');
  const boq = useMemo(() => computeBoq(project), [project]);
  const q = quoteAmount(project, boq);
  const budget = project.brief.budget > 0 ? project.brief.budget : boq.carpetSqft * BUDGET_BANDS[project.brief.budgetBand].perSqft;
  const readOnly = project.settings.role === 'client' || project.settings.role === 'viewer';

  const exportCsv = () => {
    const rows: (string | number)[][] = [['Room', 'Trade', 'Group', 'Description', 'Brand', 'Series', 'Grade / IS standard', 'Thickness', 'Code / SKU', 'Unit', 'Qty', 'Rate', 'Amount']];
    for (const l of boq.lines) rows.push([l.room, l.trade, l.group, l.desc, l.spec.brand, l.spec.series, l.spec.grade, l.spec.thickness ?? '', l.code ?? '', l.unit, l.qty, l.rate, Math.round(l.amount)]);
    rows.push([], ['', '', '', 'Subtotal', '', '', '', '', '', '', '', '', Math.round(boq.subtotal)], ['', '', '', `Margin ${project.settings.marginPct}%`, '', '', '', '', '', '', '', '', Math.round(boq.margin)], ['', '', '', `GST ${project.settings.gstPct}%`, '', '', '', '', '', '', '', '', Math.round(boq.gst)], ['', '', '', 'Total', '', '', '', '', '', '', '', '', Math.round(boq.total)]);
    download(`${project.name} – BOQ.csv`, toCsv(rows), 'text/csv');
  };

  return (
    <div className="page" style={{ maxWidth: 'none' }}>
      <h1>BOQ & quotation</h1>
      <p className="sub">Quantities come straight from the model and every line carries a locked specification, so what is quoted is what gets built.</p>
      <div className="grid g4" style={{ marginBottom: 14 }}>
        <div className="card stat"><span className="v">{inr(boq.subtotal)}</span><span className="l">BOQ subtotal ({boq.lines.length} lines)</span></div>
        <div className="card stat"><span className="v">{inr(boq.total)}</span><span className="l">with {project.settings.marginPct}% margin + {project.settings.gstPct}% GST</span></div>
        <div className="card stat"><span className="v">{inr(boq.total / Math.max(1, boq.carpetSqft))}</span><span className="l">per sq ft of {boq.carpetSqft.toFixed(0)} sq ft carpet</span></div>
        <div className={'card stat'} style={{ borderColor: boq.total > budget ? 'var(--err)' : undefined }}><span className="v" style={{ color: boq.total > budget ? 'var(--err)' : 'var(--ok)' }}>{boq.total > budget ? '+' : ''}{inr(boq.total - budget)}</span><span className="l">vs budget {inr(budget)}</span></div>
      </div>
      {boq.excludedRooms.length > 0 && <div className="banner warn" style={{ marginBottom: 12 }}>Measured quantities for {boq.excludedRooms.join(', ')} are excluded until those rooms are confirmed in Import & review.</div>}
      <div className="tabs">
        <button className={tab === 'boq' ? 'on' : ''} onClick={() => setTab('boq')}>Bill of quantities</button>
        <button className={tab === 'quote' ? 'on' : ''} onClick={() => setTab('quote')}>Quotation</button>
        <button className={tab === 'co' ? 'on' : ''} onClick={() => setTab('co')}>Change orders ({project.changeOrders.length})</button>
      </div>
      {tab === 'boq' && (
        <div className="card">
          <div className="row" style={{ marginBottom: 10 }}>
            <div className="seg">{(['room', 'trade', 'group'] as const).map((b) => <button key={b} className={by === b ? 'on' : ''} onClick={() => setBy(b)}>By {b === 'group' ? 'item type' : b}</button>)}</div>
            <span className="grow" />
            <button className="btn sm" onClick={exportCsv}>Excel (CSV)</button>
          </div>
          <BoqTable lines={boq.lines} by={by} />
        </div>
      )}
      {tab === 'quote' && <Quote readOnly={readOnly} amount={q} boq={boq} />}
      {tab === 'co' && <ChangeOrders readOnly={readOnly} />}
    </div>
  );
}

function BoqTable({ lines, by }: { lines: BoqLine[]; by: 'room' | 'trade' | 'group' }) {
  const groups = groupBy(lines, (l) => (by === 'room' ? l.room : by === 'trade' ? l.trade : l.group));
  return (
    <div className="tablewrap" style={{ maxHeight: 640 }}>
      <table className="t">
        <thead><tr><th>Description</th><th>Specification (locked)</th><th>Code</th><th className="num">Qty</th><th>Unit</th><th className="num">Rate</th><th className="num">Amount</th></tr></thead>
        <tbody>
          {Object.entries(groups).map(([g, ls]) => (
            <React.Fragment key={g}>
              <tr className="group"><td colSpan={6} style={{ textTransform: by === 'trade' ? 'capitalize' : undefined }}>{g}</td><td className="num">{inr(ls.reduce((s, l) => s + l.amount, 0))}</td></tr>
              {ls.map((l) => (
                <tr key={l.key}>
                  <td>{l.desc}{by !== 'room' && <div className="muted small">{l.room}</div>}{l.kind === 'custom-joinery' && <span className="tag" style={{ marginLeft: 4 }}>custom</span>}{l.wastage ? <span className="muted small"> · incl. {Math.round(l.wastage * 100)}% wastage</span> : null}</td>
                  <td className="small">{l.spec.brand} · {l.spec.series} · {l.spec.grade}{l.spec.thickness ? ` · ${l.spec.thickness}` : ''}</td>
                  <td className="mono">{l.code ?? '—'}</td>
                  <td className="num">{l.qty}</td><td>{l.unit}</td><td className="num">{inr(l.rate)}</td><td className="num">{inr(l.amount)}</td>
                </tr>
              ))}
            </React.Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Quote({ readOnly, amount, boq }: { readOnly: boolean; amount: { label: string; amount: number; note: string }; boq: ReturnType<typeof computeBoq> }) {
  const project = useStore((s) => s.project)!;
  const q = project.quote;
  const set = (patch: Partial<QuoteSettings>) => mutate('Quotation settings', (p) => { p.quote = { ...p.quote, ...patch }; });
  const total = q.milestones.reduce((s, m) => s + m.pct, 0);
  const incAppr = project.approvals.filter((a) => a.subject === 'inclusions');
  const request = (subject: Approval['subject'], text: string) => {
    const a: Approval = { id: uid('ap'), subject, refId: project.id, revision: modelHash(project), approver: project.client.name || 'Client', channel: 'whatsapp', status: 'requested', requestedAt: nowIso() };
    mutate(`Requested ${subject} approval`, (p) => { p.approvals.push(a); }, { audit: true });
    window.open(approvalLink(project, a, text), '_blank', 'noopener');
  };
  return (
    <div className="grid g2" style={{ alignItems: 'start' }}>
      <div className="card col">
        <h2>Pricing model</h2>
        <div className="seg" style={{ flexWrap: 'wrap' }}>{([['itemised', 'Itemised BOQ'], ['turnkey-sqft', 'Turnkey per sq ft'], ['design-fee-pct', 'Fit-out + design fee %'], ['lump-sum', 'Lump sum'], ['design-only', 'Design only']] as const).map(([k, l]) => <button key={k} disabled={readOnly} className={q.model === k ? 'on' : ''} onClick={() => set({ model: k })}>{l}</button>)}</div>
        <div className="fields">
          {q.model === 'turnkey-sqft' && <Field label="₹ per sq ft carpet"><NumInput value={q.turnkeyRate} onChange={(v) => set({ turnkeyRate: v })} /></Field>}
          {q.model === 'design-fee-pct' && <Field label="Design fee %"><NumInput value={q.feePct} onChange={(v) => set({ feePct: v })} /></Field>}
          {q.model === 'lump-sum' && <Field label="Lump sum ₹"><NumInput value={q.lumpSum} onChange={(v) => set({ lumpSum: v })} /></Field>}
          {q.model === 'design-only' && <Field label="Design fee ₹/sq ft"><NumInput value={q.designOnlyRate} onChange={(v) => set({ designOnlyRate: v })} /></Field>}
        </div>
        <div className="stat"><span className="v">{inr(amount.amount)}</span><span className="l">{amount.label} · {amount.note} · incl. GST</span></div>
        <h3 style={{ marginTop: 8 }}>Payment milestones</h3>
        {q.milestones.map((m, i) => (
          <div key={i} className="row">
            <input className="i grow" disabled={readOnly} defaultValue={m.label} onBlur={(e) => set({ milestones: q.milestones.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} />
            <div style={{ width: 80 }}><NumInput disabled={readOnly} value={m.pct} onChange={(v) => set({ milestones: q.milestones.map((x, j) => (j === i ? { ...x, pct: v } : x)) })} /></div>
            <span className="mono" style={{ width: 110, textAlign: 'right' }}>{inr((amount.amount * m.pct) / 100)}</span>
          </div>
        ))}
        {total !== 100 && <div className="banner warn small">Milestones add up to {total}%.</div>}
        <Field label="Terms"><TextInput area value={q.terms} onChange={(v) => set({ terms: v })} /></Field>
        <div className="row">
          <button className="btn" onClick={() => printQuote(project, amount, boq)}>Print / PDF quotation</button>
          {!readOnly && <button className="btn primary" onClick={() => request('quote', `the quotation (${inr(amount.amount)})`)}>Send for approval on WhatsApp</button>}
        </div>
      </div>
      <div className="card col">
        <h2>Inclusions & exclusions</h2>
        <div className="muted small">Signed with the quotation; this is what avoids “I assumed the AC was included”.</div>
        <ListEditor label="Included" items={q.inclusions} readOnly={readOnly} onChange={(inclusions) => set({ inclusions })} />
        <ListEditor label="Not included" items={q.exclusions} readOnly={readOnly} onChange={(exclusions) => set({ exclusions })} />
        <div className="row">
          {!readOnly && <button className="btn" onClick={() => request('inclusions', 'the inclusion / exclusion list')}>Get client sign-off</button>}
          {incAppr.map((a) => <span key={a.id} className={'tag ' + (a.status === 'approved' ? 'ok' : 'warn')}>{a.status} · rev {a.revision}</span>)}
        </div>
      </div>
    </div>
  );
}

function ListEditor({ label, items, onChange, readOnly }: { label: string; items: string[]; onChange: (v: string[]) => void; readOnly: boolean }) {
  const [t, setT] = useState('');
  return (
    <div className="col" style={{ gap: 4 }}>
      <h3>{label}</h3>
      {items.map((x, i) => <div key={i} className="row small"><span className="grow">• {x}</span>{!readOnly && <button className="btn sm ghost" onClick={() => onChange(items.filter((_, j) => j !== i))}>✕</button>}</div>)}
      {!readOnly && <div className="row"><input className="i grow" value={t} onChange={(e) => setT(e.target.value)} placeholder="Add…" onKeyDown={(e) => { if (e.key === 'Enter' && t.trim()) { onChange([...items, t.trim()]); setT(''); } }} /><button className="btn sm" onClick={() => { if (t.trim()) { onChange([...items, t.trim()]); setT(''); } }}>Add</button></div>}
    </div>
  );
}

function ChangeOrders({ readOnly }: { readOnly: boolean }) {
  const project = useStore((s) => s.project)!;
  const approved = project.versions.find((v) => v.id === project.approvedVersionId);
  const draft = useMemo(() => (approved ? draftChangeOrder(project, approved) : null), [project, approved]);
  const request = (coId: string) => {
    const co = project.changeOrders.find((c) => c.id === coId)!;
    const a: Approval = { id: uid('ap'), subject: 'change-order', refId: co.id, revision: modelHash(project), approver: project.client.name || 'Client', channel: 'whatsapp', status: 'requested', requestedAt: nowIso() };
    mutate(`Sent change order #${co.no} for approval`, (p) => { p.approvals.push(a); p.changeOrders.find((c) => c.id === coId)!.status = 'sent'; }, { audit: true });
    window.open(approvalLink(project, a, `change order #${co.no} (${co.costDelta >= 0 ? '+' : ''}${inr(co.costDelta)}, ${co.timeImpactDays} day(s))`), '_blank', 'noopener');
  };
  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="card col">
        <h2>Approved baseline</h2>
        {approved ? <div className="small">“{approved.name}” · {new Date(approved.at).toLocaleString()} · {inr(approved.boqTotal)} · hash <span className="mono">{approved.hash}</span></div>
          : <div className="banner info small">No approved version yet. When the client approves the design, every later change produces a cost delta here.</div>}
        {!readOnly && <div className="row"><button className="btn" onClick={() => { const name = prompt('Name for the approved baseline', 'Client-approved design'); if (!name) return; mutate(`Set approved baseline "${name}"`, (p) => { const v = makeVersion(p, name); p.versions.push(v); p.approvedVersionId = v.id; for (const f of p.floors) for (const r of f.rooms) if (r.status === 'design' || r.status === 'concept') r.status = 'approved'; }, { audit: true }); toast('Baseline locked; changes from here draft change orders'); }}>Lock current design as approved baseline</button></div>}
      </div>
      {draft && (
        <div className="card col">
          <div className="row"><h2 className="grow" style={{ margin: 0 }}>Draft change order</h2><span className={'tag ' + (draft.costDelta > 0 ? 'err' : 'ok')}>{draft.costDelta >= 0 ? '+' : ''}{inr(draft.costDelta)}</span><span className="tag">+{draft.timeImpactDays} day(s)</span></div>
          <ChangeLines lines={draft.lines} />
          {!readOnly && <button className="btn primary" onClick={() => mutate(`Raised change order #${draft.no}`, (p) => { p.changeOrders.push(draft); const v = makeVersion(p, `After CO #${draft.no}`); p.versions.push(v); p.approvedVersionId = v.id; }, { audit: true })}>Raise change order #{draft.no}</button>}
        </div>
      )}
      {project.changeOrders.slice().reverse().map((co) => (
        <div key={co.id} className="card col">
          <div className="row"><h2 className="grow" style={{ margin: 0 }}>#{co.no} · {co.title}</h2><span className={'tag ' + (co.status === 'approved' ? 'ok' : co.status === 'rejected' ? 'err' : 'warn')}>{co.status}</span><strong>{co.costDelta >= 0 ? '+' : ''}{inr(co.costDelta)}</strong><span className="tag">+{co.timeImpactDays} d</span></div>
          <ChangeLines lines={co.lines} />
          {!readOnly && co.status !== 'approved' && <div className="row"><button className="btn sm" onClick={() => request(co.id)}>Send on WhatsApp</button><button className="btn sm primary" onClick={() => mutate(`Change order #${co.no} approved`, (p) => { p.changeOrders.find((c) => c.id === co.id)!.status = 'approved'; p.approvals.push({ id: uid('ap'), subject: 'change-order', refId: co.id, revision: modelHash(p), approver: p.client.name || 'Client', channel: 'in-app', status: 'approved', requestedAt: nowIso(), decidedAt: nowIso() }); }, { audit: true })}>Record client approval</button><button className="btn sm danger" onClick={() => mutate(`Change order #${co.no} rejected`, (p) => { p.changeOrders.find((c) => c.id === co.id)!.status = 'rejected'; }, { audit: true })}>Rejected</button></div>}
        </div>
      ))}
    </div>
  );
}

function ChangeLines({ lines }: { lines: { key: string; desc: string; before: number; after: number; delta: number; change: string }[] }) {
  return (
    <div className="tablewrap" style={{ maxHeight: 260 }}>
      <table className="t"><thead><tr><th>Change</th><th>Line</th><th className="num">Before</th><th className="num">After</th><th className="num">Δ</th></tr></thead>
        <tbody>{lines.map((l) => <tr key={l.key}><td><span className={'tag ' + (l.change === 'added' ? 'info' : l.change === 'removed' ? 'err' : 'warn')}>{l.change}</span></td><td>{l.desc}</td><td className="num">{inr(l.before)}</td><td className="num">{inr(l.after)}</td><td className="num">{l.delta >= 0 ? '+' : ''}{inr(l.delta)}</td></tr>)}</tbody></table>
    </div>
  );
}

function printQuote(project: Project, amount: { label: string; amount: number; note: string }, boq: ReturnType<typeof computeBoq>) {
  const w = window.open('', '_blank');
  if (!w) { toast('Allow pop-ups to print the quotation', 'warn'); return; }
  const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!));
  const byRoom = groupBy(boq.lines, (l) => l.room);
  const q = project.quote;
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Quotation – ${esc(project.name)}</title><style>
    body{font-family:system-ui,Segoe UI,Roboto,sans-serif;color:#111;margin:28px;font-size:12px} h1{font-size:20px;margin:0} table{width:100%;border-collapse:collapse;margin:8px 0} th,td{border-bottom:1px solid #ddd;padding:4px 6px;text-align:left;vertical-align:top} td.n,th.n{text-align:right;white-space:nowrap} .g td{background:#f3f1ec;font-weight:600} .muted{color:#666} .tot td{font-weight:700}
    @page{size:A4;margin:14mm}</style></head><body>
    <div style="display:flex;justify-content:space-between;align-items:flex-start">${project.settings.firmLogo ? `<img src="${project.settings.firmLogo}" style="height:46px">` : ''}<div><h1>${esc(project.settings.firmName)}</h1><div class="muted">Quotation · ${new Date().toLocaleDateString('en-IN')} · rev ${modelHash(project)}</div></div></div>
    <p><strong>${esc(project.name)}</strong><br>${esc(project.client.name || '')} ${esc(project.address || '')}</p>
    <table><thead><tr><th>Description</th><th>Specification</th><th class="n">Qty</th><th>Unit</th><th class="n">Rate</th><th class="n">Amount</th></tr></thead><tbody>
    ${Object.entries(byRoom).map(([r, ls]) => `<tr class="g"><td colspan="5">${esc(r)}</td><td class="n">${inr(ls.reduce((s, l) => s + l.amount, 0))}</td></tr>` + ls.map((l) => `<tr><td>${esc(l.desc)}</td><td class="muted">${esc(`${l.spec.brand} · ${l.spec.series} · ${l.spec.grade}`)}</td><td class="n">${l.qty}</td><td>${l.unit}</td><td class="n">${inr(l.rate)}</td><td class="n">${inr(l.amount)}</td></tr>`).join('')).join('')}
    <tr class="tot"><td colspan="5">Subtotal</td><td class="n">${inr(boq.subtotal)}</td></tr><tr><td colspan="5">Margin / overheads (${project.settings.marginPct}%)</td><td class="n">${inr(boq.margin)}</td></tr><tr><td colspan="5">GST (${project.settings.gstPct}%)</td><td class="n">${inr(boq.gst)}</td></tr>
    <tr class="tot"><td colspan="5">${esc(amount.label)} – ${esc(amount.note)}</td><td class="n">${inr(amount.amount)}</td></tr></tbody></table>
    <h3>Payment milestones</h3><table>${q.milestones.map((m) => `<tr><td>${esc(m.label)}</td><td class="n">${m.pct}%</td><td class="n">${inr((amount.amount * m.pct) / 100)}</td></tr>`).join('')}</table>
    <div style="display:flex;gap:24px"><div style="flex:1"><h3>Included</h3><ul>${q.inclusions.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div><div style="flex:1"><h3>Not included</h3><ul>${q.exclusions.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div></div>
    <p class="muted">${esc(q.terms)}</p><br><br><table><tr><td>For ${esc(project.settings.firmName)}</td><td>Client acceptance: ${esc(project.client.name || '')}</td></tr></table>
    <script>setTimeout(()=>print(),300)</script></body></html>`);
  w.document.close();
}
