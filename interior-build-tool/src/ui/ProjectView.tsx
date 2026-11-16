import React, { useMemo, useState } from 'react';
import { useStore, mutate, activeFloor, toast, setUi, setView } from '../store';
import type { Approval, Project, Room, Snag, Submittal, Task, Trade, Floor } from '../core/types';
import { TRADES } from '../core/types';
import { schedule, approvalLink, modelHash } from '../core/project';
import { computeBoq } from '../core/boq';
import { inr, uid, nowIso } from '../core/util';
import { Field, FilePick, shrinkImage, TextInput, useCatalog, Modal } from './common';
import { PlanView, PlanContent, planBounds } from './Plan';

type Tab = 'rooms' | 'tasks' | 'approvals' | 'snags' | 'submittals' | 'rfis' | 'progress' | 'versions' | 'client' | 'audit';

export function ProjectView() {
  const project = useStore((s) => s.project)!;
  const role = project.settings.role;
  const [tab, setTab] = useState<Tab>(role === 'trade' ? 'rfis' : 'rooms');
  const tabs: [Tab, string][] = [['rooms', 'Rooms'], ['tasks', 'Tasks & timeline'], ['approvals', 'Approvals'], ['snags', `Snag list (${project.snags.filter((s) => s.status !== 'closed').length})`], ['submittals', 'Submittals'], ['rfis', `Site queries (${project.rfis.filter((r) => r.status === 'open').length})`], ['progress', 'Progress log'], ['versions', 'Versions'], ['client', 'Client & team'], ['audit', 'Audit log']];
  const visible = role === 'trade' ? tabs.filter(([t]) => ['tasks', 'snags', 'rfis', 'progress'].includes(t)) : role === 'client' ? tabs.filter(([t]) => ['rooms', 'approvals', 'versions', 'progress'].includes(t)) : tabs;
  return (
    <div className="page" style={{ maxWidth: 'none' }}>
      <h1>Project & site</h1>
      <p className="sub">Approvals, tasks, site queries and snags all link back to the same model, so drawings never drift from the design.</p>
      <div className="tabs">{visible.map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}</div>
      {tab === 'rooms' && <Rooms />}
      {tab === 'tasks' && <Tasks />}
      {tab === 'approvals' && <Approvals />}
      {tab === 'snags' && <Snags />}
      {tab === 'submittals' && <Submittals />}
      {tab === 'rfis' && <Rfis />}
      {tab === 'progress' && <Progress />}
      {tab === 'versions' && <Versions />}
      {tab === 'client' && <ClientTeam />}
      {tab === 'audit' && <div className="card"><div className="tablewrap"><table className="t"><tbody>{project.audit.slice().reverse().map((a, i) => <tr key={i}><td className="nowrap small muted">{new Date(a.at).toLocaleString()}</td><td className="small">{a.by}</td><td>{a.action}</td></tr>)}</tbody></table></div></div>}
    </div>
  );
}

function Rooms() {
  const project = useStore((s) => s.project)!;
  const boq = useMemo(() => computeBoq(project), [project]);
  return (
    <div className="card">
      <table className="t">
        <thead><tr><th>Floor</th><th>Room</th><th>Status</th><th className="num">Items</th><th className="num">Est. cost</th><th>Open snags</th></tr></thead>
        <tbody>{project.floors.flatMap((f) => f.rooms.filter((r) => r.type !== 'shaft').map((r) => (
          <tr key={r.id}><td>{f.name}</td><td><strong>{r.name}</strong></td>
            <td><select className="i" style={{ width: 140 }} value={r.status} onChange={(e) => mutate(`${r.name}: ${e.target.value}`, (p) => { p.floors.find((x) => x.id === f.id)!.rooms.find((x) => x.id === r.id)!.status = e.target.value as Room['status']; }, { audit: true })}>{['concept', 'design', 'approved', 'execution', 'done'].map((s) => <option key={s}>{s}</option>)}</select></td>
            <td className="num">{f.items.filter((i) => i.roomId === r.id).length}</td>
            <td className="num">{inr(boq.byRoom[r.name] ?? 0)}</td>
            <td>{project.snags.filter((s) => s.status !== 'closed' && s.floorId === f.id).length}</td></tr>
        )))}</tbody>
      </table>
    </div>
  );
}

function Tasks() {
  const project = useStore((s) => s.project)!;
  const sch = useMemo(() => schedule(project.tasks, project.settings.projectStart), [project.tasks, project.settings.projectStart]);
  const end = Math.max(...Object.values(sch).map((s) => s.es), 0) + Math.max(...project.tasks.map((t) => t.duration), 1);
  const set = (id: string, patch: Partial<Task>) => mutate('Updated task', (p) => { Object.assign(p.tasks.find((t) => t.id === id)!, patch); }, { audit: !!patch.status });
  const role = project.settings.role;
  const tasks = role === 'trade' ? project.tasks.filter((t) => t.trade === project.settings.tradeView) : project.tasks;
  const blocked = (t: Task) => t.deps.some((d) => project.tasks.find((x) => x.id === d)?.status !== 'done');
  const shareLink = (t: Task) => `${location.origin}${location.pathname}#/package/${project.id}/${t.trade}`;
  const colors: Record<string, string> = { civil: '#8c867b', carpentry: '#b07a47', electrical: '#c0392b', plumbing: '#1f6fb5', hvac: '#0f8f8f', painting: '#9b59b6', site: '#2f6f62' };
  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="card col">
        <div className="row"><h2 className="grow" style={{ margin: 0 }}>Timeline</h2><Field label="Start date"><input className="i" type="date" value={project.settings.projectStart} onChange={(e) => mutate('Project start', (p) => { p.settings.projectStart = e.target.value; })} /></Field><span className="tag">{end} days</span></div>
        <div className="gantt">
          {project.tasks.map((t) => {
            const s = sch[t.id];
            return (
              <div key={t.id} className="gr">
                <div style={{ padding: '4px 8px' }}>{t.name} <span className="muted small">· {t.trade}</span></div>
                <div style={{ position: 'relative', height: 26 }}>
                  <div className="bar" style={{ left: `${(s.es / end) * 100}%`, width: `${(t.duration / end) * 100}%`, background: colors[t.trade] ?? '#999', opacity: t.status === 'done' ? 0.45 : 0.9 }} title={`${s.start.toLocaleDateString()} – ${s.end.toLocaleDateString()}`} />
                </div>
              </div>
            );
          })}
        </div>
        <div className="muted small">Sequence follows trade dependencies: civil → electrical conduit → false ceiling → painting → carpentry install.</div>
      </div>
      <div className="kanban">
        {(['todo', 'doing', 'blocked', 'done'] as const).map((col) => (
          <div key={col} className="colk">
            <strong style={{ textTransform: 'capitalize' }}>{col === 'doing' ? 'In progress' : col}</strong>
            {tasks.filter((t) => t.status === col).map((t) => (
              <div key={t.id} className="task">
                <strong>{t.name}</strong>
                <div className="row" style={{ gap: 4 }}><span className="tag" style={{ background: colors[t.trade], color: '#fff', borderColor: 'transparent' }}>{t.trade}</span><span className="muted">{t.duration} d · {sch[t.id].start.toLocaleDateString()}</span>{blocked(t) && t.status !== 'done' && <span className="tag warn">waiting on deps</span>}</div>
                <input className="i" placeholder="Vendor / contractor" defaultValue={t.vendor ?? ''} onBlur={(e) => set(t.id, { vendor: e.target.value })} />
                <div className="row" style={{ gap: 4 }}>
                  <select className="i" style={{ flex: 1 }} value={t.status} onChange={(e) => set(t.id, { status: e.target.value as Task['status'] })}>{['todo', 'doing', 'blocked', 'done'].map((s) => <option key={s}>{s}</option>)}</select>
                  {t.trade !== 'site' && <button className="btn sm" title="Share this trade's package link (PM-03)" onClick={() => { navigator.clipboard?.writeText(shareLink(t)); toast('Package link copied'); }}>Link</button>}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
      {role !== 'trade' && <button className="btn" style={{ alignSelf: 'flex-start' }} onClick={() => { const name = prompt('Task name'); if (!name) return; mutate('Added task', (p) => { p.tasks.push({ id: uid('t'), name, trade: 'civil', duration: 2, deps: [], status: 'todo' }); }); }}>Add task</button>}
    </div>
  );
}

function Approvals() {
  const project = useStore((s) => s.project)!;
  const [decide, setDecide] = useState<Approval | null>(null);
  const rev = modelHash(project);
  const request = (subject: Approval['subject'], text: string) => {
    const a: Approval = { id: uid('ap'), subject, refId: project.id, revision: rev, approver: project.client.name || 'Client', channel: 'whatsapp', status: 'requested', requestedAt: nowIso() };
    mutate(`Requested ${subject} approval (rev ${rev})`, (p) => { p.approvals.push(a); }, { audit: true });
    window.open(approvalLink(project, a, text), '_blank', 'noopener');
  };
  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="card col">
        <h2>Request approval</h2>
        <div className="muted small">Opens WhatsApp with a deep link carrying the exact revision (<span className="mono">{rev}</span>). Record the reply here: approver, time and revision go into the project record.</div>
        {!project.client.phone && <div className="banner warn small">Add the client's WhatsApp number in Client & team so the link opens their chat directly.</div>}
        <div className="row">
          <button className="btn primary" onClick={() => request('design', 'the interior design')}>Design approval</button>
          <button className="btn" onClick={() => request('quote', 'the quotation')}>Quotation approval</button>
          <button className="btn" onClick={() => request('drawing', 'the issued drawings')}>Drawing approval</button>
        </div>
      </div>
      <div className="card">
        <table className="t">
          <thead><tr><th>Subject</th><th>Revision</th><th>Approver</th><th>Channel</th><th>Requested</th><th>Status</th><th /></tr></thead>
          <tbody>{project.approvals.slice().reverse().map((a) => (
            <tr key={a.id}><td style={{ textTransform: 'capitalize' }}>{a.subject.replace('-', ' ')}</td><td className="mono">{a.revision}{a.revision !== rev && a.status === 'approved' ? <span className="tag warn" style={{ marginLeft: 4 }}>model changed since</span> : null}</td><td>{a.approver}</td><td>{a.channel}</td><td className="small">{new Date(a.requestedAt).toLocaleString()}</td>
              <td><span className={'tag ' + (a.status === 'approved' ? 'ok' : a.status === 'rejected' ? 'err' : 'warn')}>{a.status}</span>{a.decidedAt && <div className="muted small">{new Date(a.decidedAt).toLocaleString()}</div>}</td>
              <td>{a.status === 'requested' && <button className="btn sm" onClick={() => setDecide(a)}>Record reply</button>}</td></tr>
          ))}</tbody>
        </table>
        {!project.approvals.length && <div className="muted small">No approvals yet.</div>}
      </div>
      {decide && <DecideModal a={decide} onClose={() => setDecide(null)} />}
    </div>
  );
}

function DecideModal({ a, onClose }: { a: Approval; onClose: () => void }) {
  const [approver, setApprover] = useState(a.approver);
  const [channel, setChannel] = useState<Approval['channel']>(a.channel);
  const [note, setNote] = useState('');
  const save = (status: 'approved' | 'rejected') => {
    mutate(`${a.subject} ${status} by ${approver} via ${channel} (rev ${a.revision})`, (p) => {
      const x = p.approvals.find((y) => y.id === a.id)!;
      Object.assign(x, { status, approver, channel, note, decidedAt: nowIso() });
      if (status === 'approved' && a.subject === 'design') for (const f of p.floors) for (const r of f.rooms) if (r.status !== 'execution' && r.status !== 'done') r.status = 'approved';
    }, { audit: true });
    onClose();
  };
  return (
    <Modal title="Record approval reply" onClose={onClose}>
      <div className="col">
        <div className="fields"><Field label="Approver"><input className="i" value={approver} onChange={(e) => setApprover(e.target.value)} /></Field>
          <Field label="Channel"><select className="i" value={channel} onChange={(e) => setChannel(e.target.value as Approval['channel'])}>{['whatsapp', 'in-app', 'email', 'in-person'].map((c) => <option key={c}>{c}</option>)}</select></Field></div>
        <Field label="Note / message text"><textarea className="i" rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <div className="row"><span className="grow mono small">Revision {a.revision}</span><button className="btn danger" onClick={() => save('rejected')}>Rejected</button><button className="btn primary" onClick={() => save('approved')}>Approved</button></div>
      </div>
    </Modal>
  );
}

function Snags() {
  const project = useStore((s) => s.project)!;
  const floor = useStore((s) => activeFloor(s));
  const sel = useStore((s) => s.ui.selection);
  const cat = useCatalog(project);
  const [adding, setAdding] = useState(false);
  if (!floor) return null;
  const set = (id: string, patch: Partial<Snag>) => mutate('Updated snag', (p) => { Object.assign(p.snags.find((s) => s.id === id)!, patch); }, { audit: !!patch.status });
  const list = project.settings.role === 'trade' ? project.snags.filter((s) => s.trade === project.settings.tradeView) : project.snags;
  return (
    <div className="grid" style={{ gridTemplateColumns: '1fr minmax(360px, 480px)', alignItems: 'start' }}>
      <div className="card" style={{ padding: 0, height: 560, overflow: 'hidden', position: 'relative' }}>
        <PlanView floor={floor} cat={cat} tool={adding ? 'snag' : 'select'} onSelect={(s) => setUi({ selection: s })} onToolClick={(pos) => { const title = prompt('What is wrong?'); if (title) mutate('Added snag', (p) => { p.snags.push({ id: uid('snag'), floorId: floor.id, pos, title, trade: 'civil', due: new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10), status: 'open', createdAt: nowIso() }); }, { audit: true }); setAdding(false); }} onMove={(k, id, pos) => k === 'snag' && mutate('Moved snag', (p) => { p.snags.find((s) => s.id === id)!.pos = pos; })} opts={{ layers: { electrical: false, plumbing: false }, snags: list, selection: sel }} />
        <div className="overlay-tr"><button className={'btn sm' + (adding ? ' on' : ' primary')} onClick={() => setAdding(!adding)}>{adding ? 'Click on the plan…' : 'Pin a snag'}</button></div>
      </div>
      <div className="col">
        {list.map((s, i) => (
          <div key={s.id} className="card col" style={{ borderColor: sel?.id === s.id ? 'var(--accent)' : undefined }}>
            <div className="row"><strong className="grow">{i + 1}. {s.title}</strong><span className={'tag ' + (s.status === 'closed' ? 'ok' : s.status === 'fixed' ? 'info' : 'err')}>{s.status}</span></div>
            <div className="fields">
              <Field label="Trade"><select className="i" value={s.trade} onChange={(e) => set(s.id, { trade: e.target.value as Trade })}>{TRADES.map((t) => <option key={t}>{t}</option>)}</select></Field>
              <Field label="Due"><input className="i" type="date" value={s.due} onChange={(e) => set(s.id, { due: e.target.value })} /></Field>
              <Field label="Status"><select className="i" value={s.status} onChange={(e) => { if (e.target.value === 'closed' && !s.closePhoto) { toast('Add a close-out photo before closing', 'warn'); return; } set(s.id, { status: e.target.value as Snag['status'] }); }}>{['open', 'fixed', 'closed'].map((x) => <option key={x}>{x}</option>)}</select></Field>
            </div>
            <div className="row">
              {s.photo ? <img src={s.photo} style={{ width: 90, height: 68, objectFit: 'cover', borderRadius: 4 }} alt="Snag" /> : <FilePick accept="image/*" className="btn sm" onFile={async ([f]) => set(s.id, { photo: (await shrinkImage(f, 900)).url })}>Add photo</FilePick>}
              {s.closePhoto ? <img src={s.closePhoto} style={{ width: 90, height: 68, objectFit: 'cover', borderRadius: 4, outline: '2px solid var(--ok)' }} alt="Close-out" /> : <FilePick accept="image/*" className="btn sm" onFile={async ([f]) => set(s.id, { closePhoto: (await shrinkImage(f, 900)).url, status: 'fixed' })}>Close-out photo</FilePick>}
              {new Date(s.due) < new Date() && s.status !== 'closed' && <span className="tag err">overdue</span>}
            </div>
          </div>
        ))}
        {!list.length && <div className="card muted">No snags. Pin one on the plan during the site walk.</div>}
      </div>
    </div>
  );
}

function Submittals() {
  const project = useStore((s) => s.project)!;
  const [title, setTitle] = useState('');
  const [type, setType] = useState<Submittal['type']>('shop-drawing');
  const [trade, setTrade] = useState<Trade>('carpentry');
  const move = (id: string, status: Submittal['status']) => {
    const note = status === 'approved' ? '' : prompt('Comment for the vendor') ?? '';
    mutate(`Submittal ${status}`, (p) => { const s = p.submittals.find((x) => x.id === id)!; s.status = status; s.trail.push({ at: nowIso(), by: p.settings.user, status, note }); }, { audit: true });
  };
  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="card row">
        <input className="i grow" placeholder="e.g. Kitchen shop drawings from factory, rev A" value={title} onChange={(e) => setTitle(e.target.value)} />
        <select className="i" style={{ width: 170 }} value={type} onChange={(e) => setType(e.target.value as Submittal['type'])}>{['shop-drawing', 'factory-drawing', 'sample', 'substitution'].map((t) => <option key={t}>{t}</option>)}</select>
        <select className="i" style={{ width: 140 }} value={trade} onChange={(e) => setTrade(e.target.value as Trade)}>{TRADES.map((t) => <option key={t}>{t}</option>)}</select>
        <button className="btn primary" disabled={!title.trim()} onClick={() => { mutate('Logged submittal', (p) => { p.submittals.push({ id: uid('sub'), type, title: title.trim(), trade, status: 'submitted', trail: [{ at: nowIso(), by: p.settings.user, status: 'submitted' }] }); }, { audit: true }); setTitle(''); }}>Log submittal</button>
      </div>
      <div className="card">
        <table className="t">
          <thead><tr><th>Submittal</th><th>Type</th><th>Trade</th><th>Status</th><th>Audit trail</th><th /></tr></thead>
          <tbody>{project.submittals.map((s) => (
            <tr key={s.id}><td><strong>{s.title}</strong></td><td>{s.type}</td><td>{s.trade}</td><td><span className={'tag ' + (s.status === 'approved' ? 'ok' : s.status === 'rejected' ? 'err' : 'warn')}>{s.status}</span></td>
              <td className="small">{s.trail.map((t, i) => <div key={i}>{new Date(t.at).toLocaleDateString()} · {t.status} · {t.by}{t.note ? ` – ${t.note}` : ''}</div>)}</td>
              <td className="nowrap"><button className="btn sm" onClick={() => move(s.id, 'approved')}>Approve</button> <button className="btn sm" onClick={() => move(s.id, 'resubmit')}>Revise & resubmit</button> <button className="btn sm danger" onClick={() => move(s.id, 'rejected')}>Reject</button></td></tr>
          ))}</tbody>
        </table>
        {!project.submittals.length && <div className="muted small">Track factory drawings, samples and substitutions here.</div>}
      </div>
    </div>
  );
}

function Rfis() {
  const project = useStore((s) => s.project)!;
  const floor = useStore((s) => activeFloor(s));
  const [q, setQ] = useState({ title: '', question: '', trade: (project.settings.role === 'trade' ? project.settings.tradeView : 'carpentry') as Trade, photo: '' as string | undefined, roomId: '' });
  const list = project.settings.role === 'trade' ? project.rfis.filter((r) => r.trade === project.settings.tradeView) : project.rfis;
  return (
    <div className="grid g2" style={{ alignItems: 'start' }}>
      <div className="card col">
        <h2>Raise a site query</h2>
        <Field label="Title"><input className="i" value={q.title} onChange={(e) => setQ({ ...q, title: e.target.value })} placeholder="e.g. Beam lower than drawn above wardrobe" /></Field>
        <Field label="Question"><textarea className="i" rows={3} value={q.question} onChange={(e) => setQ({ ...q, question: e.target.value })} /></Field>
        <div className="fields">
          <Field label="Trade"><select className="i" value={q.trade} onChange={(e) => setQ({ ...q, trade: e.target.value as Trade })}>{TRADES.map((t) => <option key={t}>{t}</option>)}</select></Field>
          <Field label="Room"><select className="i" value={q.roomId} onChange={(e) => setQ({ ...q, roomId: e.target.value })}><option value="">—</option>{floor?.rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></Field>
        </div>
        <div className="row">{q.photo ? <img src={q.photo} style={{ width: 120, borderRadius: 4 }} alt="Site" /> : <FilePick accept="image/*" onFile={async ([f]) => setQ({ ...q, photo: (await shrinkImage(f, 1000)).url })}>Attach photo</FilePick>}
          <span className="grow" />
          <button className="btn primary" disabled={!q.title.trim()} onClick={() => { mutate('Raised site query', (p) => { p.rfis.push({ id: uid('rfi'), title: q.title, question: q.question, trade: q.trade, raisedBy: p.settings.user, photo: q.photo, status: 'open', at: nowIso(), roomId: q.roomId || undefined }); }, { audit: true }); setQ({ ...q, title: '', question: '', photo: undefined }); }}>Send to designer</button></div>
      </div>
      <div className="col">
        {list.slice().reverse().map((r) => (
          <div key={r.id} className="card col">
            <div className="row"><strong className="grow">{r.title}</strong><span className="tag">{r.trade}</span><span className={'tag ' + (r.status === 'open' ? 'warn' : 'ok')}>{r.status}</span></div>
            <div className="small">{r.question}</div>
            {r.photo && <img src={r.photo} style={{ maxWidth: 220, borderRadius: 4 }} alt="Site query" />}
            <div className="muted small">{r.raisedBy} · {new Date(r.at).toLocaleString()}</div>
            {r.answer ? <div className="banner ok small">Answer: {r.answer}</div> : project.settings.role !== 'trade' && (
              <div className="row"><input className="i grow" placeholder="Answer, or say a revised drawing is being issued" id={'ans' + r.id} /><button className="btn sm" onClick={() => { const v = (document.getElementById('ans' + r.id) as HTMLInputElement).value; if (v) mutate('Answered site query', (p) => { const x = p.rfis.find((y) => y.id === r.id)!; x.answer = v; x.status = 'answered'; }, { audit: true }); }}>Answer</button><button className="btn sm" onClick={() => setView('exports')}>Issue revised drawing →</button></div>
            )}
          </div>
        ))}
        {!list.length && <div className="card muted">No site queries.</div>}
      </div>
    </div>
  );
}

function Progress() {
  const project = useStore((s) => s.project)!;
  const floor = useStore((s) => activeFloor(s));
  const [note, setNote] = useState('');
  const [photo, setPhoto] = useState<string | undefined>();
  const [roomId, setRoomId] = useState('');
  const [taskId, setTaskId] = useState('');
  const readOnly = project.settings.role === 'client' || project.settings.role === 'viewer';
  return (
    <div className="grid g2" style={{ alignItems: 'start' }}>
      {!readOnly && <div className="card col">
        <h2>Daily site log</h2>
        <textarea className="i" rows={3} placeholder="What was done today" value={note} onChange={(e) => setNote(e.target.value)} />
        <div className="fields">
          <Field label="Room"><select className="i" value={roomId} onChange={(e) => setRoomId(e.target.value)}><option value="">—</option>{floor?.rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></Field>
          <Field label="Task"><select className="i" value={taskId} onChange={(e) => setTaskId(e.target.value)}><option value="">—</option>{project.tasks.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></Field>
        </div>
        <div className="row">{photo ? <img src={photo} style={{ width: 120, borderRadius: 4 }} alt="Progress" /> : <FilePick accept="image/*" onFile={async ([f]) => setPhoto((await shrinkImage(f, 1000)).url)}>Add photo</FilePick>}<span className="grow" />
          <button className="btn primary" disabled={!note.trim()} onClick={() => { mutate('Site progress logged', (p) => { p.progress.push({ id: uid('log'), at: nowIso(), by: p.settings.user, roomId: roomId || undefined, taskId: taskId || undefined, note: note.trim(), photo }); }, { audit: true }); setNote(''); setPhoto(undefined); }}>Post</button></div>
      </div>}
      <div className="col">
        {project.progress.slice().reverse().map((l) => (
          <div key={l.id} className="card col">
            <div className="muted small">{new Date(l.at).toLocaleString()} · {l.by}{l.roomId ? ` · ${floor?.rooms.find((r) => r.id === l.roomId)?.name}` : ''}{l.taskId ? ` · ${project.tasks.find((t) => t.id === l.taskId)?.name}` : ''}</div>
            <div>{l.note}</div>
            {l.photo && <img src={l.photo} style={{ maxWidth: 260, borderRadius: 4 }} alt="Progress" />}
          </div>
        ))}
        {!project.progress.length && <div className="card muted">No entries yet.</div>}
      </div>
    </div>
  );
}

function Versions() {
  const project = useStore((s) => s.project)!;
  const cat = useCatalog(project);
  const [a, setA] = useState(project.versions[project.versions.length - 2]?.id ?? '');
  const [b, setB] = useState(project.versions[project.versions.length - 1]?.id ?? '');
  const va = project.versions.find((v) => v.id === a), vb = project.versions.find((v) => v.id === b);
  const restore = (id: string) => { const v = project.versions.find((x) => x.id === id)!; if (confirm(`Restore "${v.name}"? The current model can be undone with Ctrl+Z.`)) mutate(`Restored version "${v.name}"`, (p) => { p.floors = structuredClone(v.floors); }, { audit: true }); };
  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="card">
        <table className="t"><thead><tr><th>Version</th><th>Saved</th><th>By</th><th className="num">BOQ total</th><th>Hash</th><th /></tr></thead>
          <tbody>{project.versions.slice().reverse().map((v) => <tr key={v.id}><td><strong>{v.name}</strong>{v.id === project.approvedVersionId && <span className="tag ok" style={{ marginLeft: 6 }}>approved baseline</span>}</td><td className="small">{new Date(v.at).toLocaleString()}</td><td>{v.by}</td><td className="num">{inr(v.boqTotal)}</td><td className="mono">{v.hash}</td><td>{project.settings.role !== 'client' && <button className="btn sm" onClick={() => restore(v.id)}>Restore</button>}</td></tr>)}</tbody></table>
        {!project.versions.length && <div className="muted small">Save named versions from the design editor toolbar.</div>}
      </div>
      {project.versions.length >= 2 && (
        <div className="card col">
          <div className="row"><h2 className="grow" style={{ margin: 0 }}>Compare side by side</h2>
            <select className="i" style={{ width: 220 }} value={a} onChange={(e) => setA(e.target.value)}>{project.versions.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select>
            <select className="i" style={{ width: 220 }} value={b} onChange={(e) => setB(e.target.value)}>{project.versions.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select></div>
          {va && vb && (
            <>
              <div className="banner info small">Cost {inr(va.boqTotal)} → {inr(vb.boqTotal)} ({vb.boqTotal - va.boqTotal >= 0 ? '+' : ''}{inr(vb.boqTotal - va.boqTotal)}) · items {va.floors.reduce((s, f) => s + f.items.length, 0)} → {vb.floors.reduce((s, f) => s + f.items.length, 0)}</div>
              <div className="grid g2">{[va, vb].map((v) => <MiniPlan key={v.id} floor={v.floors[0]} cat={cat} title={v.name} />)}</div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function MiniPlan({ floor, cat, title }: { floor: Floor; cat: ReturnType<typeof useCatalog>; title: string }) {
  if (!floor) return null;
  const b = planBounds(floor, 300);
  return <div className="col"><strong>{title}</strong><svg viewBox={`${b.minX} ${-b.maxY} ${b.maxX - b.minX} ${b.maxY - b.minY}`} style={{ width: '100%', height: 320, background: 'var(--plan-bg)', borderRadius: 6, color: 'var(--ink)' }}><g transform="scale(1 -1)"><PlanContent floor={floor} cat={cat} opts={{ layers: { electrical: false, plumbing: false } }} /></g></svg></div>;
}

function ClientTeam() {
  const project = useStore((s) => s.project)!;
  const set = (fn: (p: Project) => void) => mutate('Client details', fn);
  return (
    <div className="grid g2" style={{ alignItems: 'start' }}>
      <div className="card col">
        <h2>Client</h2>
        <div className="fields" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <Field label="Project name"><TextInput value={project.name} onChange={(v) => set((p) => { p.name = v; })} /></Field>
          <Field label="Client name"><TextInput value={project.client.name} onChange={(v) => set((p) => { p.client.name = v; })} /></Field>
          <Field label="WhatsApp number" hint="with country code"><TextInput value={project.client.phone} placeholder="+91…" onChange={(v) => set((p) => { p.client.phone = v; })} /></Field>
          <Field label="Email"><TextInput value={project.client.email} onChange={(v) => set((p) => { p.client.email = v; })} /></Field>
        </div>
        <Field label="Site address"><TextInput value={project.address} onChange={(v) => set((p) => { p.address = v; })} /></Field>
      </div>
      <div className="card col">
        <h2>Roles & permissions</h2>
        <table className="t small"><tbody>
          {[['Owner / Admin', 'Everything, including catalog, rates and settings'], ['Designer', 'Import, generate, edit, BOQ, issue drawings'], ['Viewer', 'Read-only editor and packages'], ['Client', 'Designs, 3D, quotation, approvals, progress; can comment'], ['Trade', 'Only their own package, tasks, snags and site queries']].map(([r, d]) => <tr key={r}><td><strong>{r}</strong></td><td>{d}</td></tr>)}
        </tbody></table>
        <div className="muted small">Switch “Viewing as” in the top bar to see each role's view. Multi-user sign-in needs the hosted back end.</div>
      </div>
    </div>
  );
}
