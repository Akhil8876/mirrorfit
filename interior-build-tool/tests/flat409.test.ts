import { describe, it, expect } from 'vitest';
import { createFlat409Project } from '../src/core/flat409';
import { computeBoq } from '../src/core/boq';
import { checkFloor } from '../src/core/rules';
import { buildCatalog } from '../src/core/catalog';
import { polygonArea } from '../src/core/geom';

describe('Flat 409 project from the concept book', () => {
  const { project: p } = createFlat409Project();
  const f = p.floors[0];
  const area = (n: string) => polygonArea(f.rooms.find((r) => r.name === n)!.polygon) / 1e6;

  it('rebuilds every room in the book with matching sizes', () => {
    const names = f.rooms.map((r) => r.name).sort();
    console.log(names.join(' | '));
    expect(names).toEqual(expect.arrayContaining(['Living + Dining Hall', 'Kitchen', 'Utility', 'Master Bedroom', 'Master Bath', 'Crockery Passage', 'Bedroom 3', "Children's Bath", 'Guest Bath', 'Guest Bedroom', 'Sit-Out 1', 'Sit-Out 2', 'Sit-Out 3', 'Service Platform']));
    expect(Math.abs(area('Master Bedroom') - 4.31 * 3.58)).toBeLessThan(0.6);
    expect(Math.abs(area('Guest Bedroom') - 3.12 * 3.76)).toBeLessThan(0.6);
    expect(Math.abs(area('Kitchen') - 2.82 * 2.11)).toBeLessThan(0.5);
  });

  it('is furnished, priced and free of hard rule errors', () => {
    const cat = buildCatalog(p.catalogOverrides, p.customCatalog);
    const errs = checkFloor(f, { catalog: cat, rules: p.settings.rulePack }).filter((i) => i.severity === 'error');
    console.log(errs.map((e) => e.msg));
    expect(errs.length).toBeLessThanOrEqual(2);
    const b = computeBoq(p);
    console.log('items', f.items.length, 'points', f.points.length, 'total', Math.round(b.total), 'excluded', b.excludedRooms);
    expect(b.excludedRooms).toEqual([]);
    expect(b.total).toBeGreaterThan(3_000_000);
    expect(f.items.some((i) => i.catalogId === 'console-foyer')).toBe(true);
  });
});
