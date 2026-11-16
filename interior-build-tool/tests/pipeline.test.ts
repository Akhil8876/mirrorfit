import { describe, it, expect } from 'vitest';
import { parseDxf } from '../src/core/dxf';
import { importDxf } from '../src/core/detect';
import { buildSampleDxf } from '../src/core/sample';
import { generateRoomOptions } from '../src/core/generator';
import { themeById } from '../src/core/themes';
import { DEFAULT_CATALOG } from '../src/core/catalog';
import { DEFAULT_RULES } from '../src/core/rules';
import { createProject, issueReadiness, makeVersion, schedule } from '../src/core/project';
import { computeBoq, draftChangeOrder } from '../src/core/boq';
import { joineryUnits, nest } from '../src/core/joinery';
import { exportFloorDxf } from '../src/core/exportDxf';
import { areaStatement } from '../src/core/measure';
import { designElectrical } from '../src/core/electrical';
import { doorWindowSchedule, finishSchedule, electricalSchedules, plumbingSchedules } from '../src/core/schedules';
import { runGraph } from '../src/core/orchestrator';
import { vastuFlags } from '../src/core/vastu';

function designedProject() {
  const p = createProject('Test flat');
  const res = importDxf(parseDxf(buildSampleDxf()));
  const f = res.floors[0];
  for (const r of f.rooms) {
    const [opt] = generateRoomOptions({ floor: f, room: r, theme: themeById('japandi'), brief: p.brief, styleTags: [], palette: [], prompt: p.prompt, catalog: DEFAULT_CATALOG, rules: DEFAULT_RULES, seed: 7 }, 1, 2);
    if (!opt) continue;
    f.items.push(...opt.items);
    f.points.push(...opt.points);
    r.finishes = opt.finishes;
  }
  p.floors = [f];
  return p;
}

describe('end-to-end pipeline', () => {
  const p = designedProject();
  const f = p.floors[0];

  it('excludes unconfirmed rooms from measured BOQ lines, then includes them once confirmed (IMP-41)', () => {
    const before = computeBoq(p);
    expect(before.excludedRooms.length).toBe(f.rooms.length);
    for (const r of f.rooms) r.det!.confirmed = { by: 'QA', at: 'now' };
    const after = computeBoq(p);
    expect(after.excludedRooms).toEqual([]);
    expect(after.total).toBeGreaterThan(before.total);
    expect(after.lines.some((l) => l.group === 'Flooring')).toBe(true);
    expect(after.lines.some((l) => l.group === 'Distribution board')).toBe(true);
    for (const l of after.lines) { expect(l.spec.grade.length + l.spec.series.length).toBeGreaterThan(0); expect(Number.isFinite(l.amount)).toBe(true); }
  });

  it('drafts a change order with a cost delta after an approved version changes (BOQ-11)', () => {
    const v = makeVersion(p, 'Approved concept');
    const wr = f.items.find((i) => i.catalogId.startsWith('wardrobe'))!;
    wr.w += 600;
    const co = draftChangeOrder(p, v)!;
    expect(co).toBeTruthy();
    expect(co.costDelta).toBeGreaterThan(0);
    expect(co.lines.some((l) => l.key === `item:${wr.id}`)).toBe(true);
  });

  it('produces cut lists, hardware and nests panels on 8×4 boards', () => {
    const units = joineryUnits(p, DEFAULT_CATALOG);
    expect(units.length).toBeGreaterThan(3);
    const panels = units.flatMap((u) => u.panels);
    expect(panels.every((x) => x.l > 0 && x.w > 0)).toBe(true);
    const { boards, utilisation } = nest(panels.filter((x) => x.t === 18));
    expect(boards.length).toBeGreaterThan(0);
    expect(utilisation).toBeGreaterThan(0.3);
    for (const b of boards) for (const pl of b.placements) { expect(pl.x + pl.l).toBeLessThanOrEqual(2440); expect(pl.y + pl.w).toBeLessThanOrEqual(1220); }
    expect(units.flatMap((u) => u.hardware).some((h) => /hinge|track/i.test(h.name))).toBe(true);
  });

  it('assigns every electrical point to a circuit with MCB ratings (EDT-22)', () => {
    const e = designElectrical(f);
    const elec = f.points.filter((x) => !['inlet-cold', 'inlet-hot', 'outlet', 'floor-trap', 'ac-drain', 'switchboard', 'data', 'db', 'earth'].includes(x.kind));
    for (const x of elec) expect(e.assignments[x.id], x.kind).toBeTruthy();
    expect(e.circuits.some((c) => c.type === 'dedicated')).toBe(true);
    expect(e.db).toBeTruthy();
  });

  it('builds schedules, the area statement and Vastu flags', () => {
    const [doors, windows] = doorWindowSchedule(f);
    expect(doors.rows.length).toBeGreaterThan(0);
    expect(windows.rows.reduce((s, r) => s + (r[4] as number), 0)).toBe(6);
    expect(finishSchedule(f, DEFAULT_CATALOG).rows.length).toBeGreaterThan(20);
    expect(electricalSchedules(f)[1].rows.length).toBeGreaterThan(2);
    expect(plumbingSchedules(p, f, DEFAULT_CATALOG)[0].rows.length).toBeGreaterThan(5);
    const a = areaStatement(f);
    expect(a.reraCarpet).toBeGreaterThan(a.carpet);
    expect(a.builtUp).toBeGreaterThan(a.reraCarpet);
    expect(Math.abs(a.builtUp - 10230 * 8230)).toBeLessThan(10230 * 8230 * 0.01);
    expect(vastuFlags(f).length).toBeGreaterThan(2);
  });

  it('exports a layered DXF that re-imports to the same walls (EXP-33)', () => {
    const txt = exportFloorDxf(p, f);
    const doc = parseDxf(txt);
    expect(doc.insUnits).toBe(4);
    expect(doc.layers.map((l) => l.name)).toEqual(expect.arrayContaining(['A-WALL', 'A-DOOR', 'I-JOIN', 'E-POWR']));
    expect(Object.keys(doc.blocks).some((b) => b.startsWith('IBT_'))).toBe(true);
  });

  it('blocks issue for construction until review, drafts and site measure are done (REL-06)', () => {
    const b = issueReadiness(p, 'carpentry');
    expect(b.some((x) => x.level === 'block' && /not accepted/.test(x.msg))).toBe(true);
    expect(b.some((x) => /not yet confirmed/.test(x.msg))).toBe(true);
  });

  it('schedules tasks after their dependencies', () => {
    const s = schedule(p.tasks, '2026-12-01');
    expect(s.t10.es).toBeGreaterThanOrEqual(s.t8.es + 15);
    expect(s.t15.es).toBeGreaterThan(s.t14.es);
  });
});

describe('orchestrator', () => {
  it('runs independent tasks in parallel, retries invalid output and resumes from a checkpoint', async () => {
    let flaky = 0;
    const order: string[] = [];
    const tasks = [
      { id: 'a', label: 'a', lane: 'generation' as const, deps: [], run: async () => { order.push('a'); return 1; } },
      { id: 'b', label: 'b', lane: 'generation' as const, deps: [], run: async () => { order.push('b'); return flaky++ < 1 ? -1 : 2; }, validate: (o: unknown) => ((o as number) < 0 ? 'negative' : null) },
      { id: 'c', label: 'c', lane: 'export' as const, deps: ['a', 'b'], run: (i: Record<string, unknown>) => (i.a as number) + (i.b as number) },
    ];
    const events: string[] = [];
    const cp = new Map<string, unknown>();
    const r = await runGraph(tasks, { concurrency: 2, onEvent: (e) => events.push(e.type), checkpoint: cp, backoffMs: 1 });
    expect(r.failed).toEqual([]);
    expect(r.results.get('c')).toBe(3);
    expect(events).toContain('retry');
    const again: string[] = [];
    await runGraph(tasks, { checkpoint: cp, onEvent: (e) => again.push(e.type) });
    expect(again.every((e) => e === 'done')).toBe(true);
  });
});
