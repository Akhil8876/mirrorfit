import { describe, it, expect } from 'vitest';
import { parseDxf } from '../src/core/dxf';
import { importDxf } from '../src/core/detect';
import { buildSampleDxf, SAMPLE_WALLS, SAMPLE_OPENINGS } from '../src/core/sample';
import { dist, polygonArea } from '../src/core/geom';

describe('DXF import of the sample 2BHK', () => {
  const text = buildSampleDxf();
  const doc = parseDxf(text);
  const res = importDxf(doc, { fileName: 'sample.dxf', fileText: text });
  const f = res.floors[0];

  it('reads layers and units from the header', () => {
    expect(res.unitSource).toBe('header');
    expect(res.unitFactor).toBe(1);
    expect(res.layerMap['A-WALL']).toBe('wall');
    expect(res.layerMap['A-DOOR']).toBe('door');
    expect(res.layerMap['A-GLAZ']).toBe('window');
    expect(res.layerMap['S-COLS']).toBe('column');
  });

  it('finds every wall within ±5 mm, with thickness', () => {
    expect(res.floors).toHaveLength(1);
    expect(f.walls).toHaveLength(SAMPLE_WALLS.length);
    for (const sw of SAMPLE_WALLS) {
      const w = f.walls.find((w) => Math.min(dist(w.a, sw.a) + dist(w.b, sw.b), dist(w.a, sw.b) + dist(w.b, sw.a)) < 10);
      expect(w, JSON.stringify(sw)).toBeTruthy();
      expect(Math.abs(w!.thickness - sw.t)).toBeLessThanOrEqual(5);
    }
  });

  it('finds doors, windows and openings with sizes', () => {
    expect(f.openings).toHaveLength(SAMPLE_OPENINGS.length);
    for (const so of SAMPLE_OPENINGS) {
      const o = f.openings.find((o) => o.kind === so.kind && Math.abs(o.width - so.w) <= 5);
      expect(o, JSON.stringify(so)).toBeTruthy();
    }
    expect(f.openings.filter((o) => o.kind === 'door' && o.swing)).toHaveLength(5);
  });

  it('detects and names rooms with accurate areas', () => {
    const names = f.rooms.map((r) => r.name).sort();
    expect(names).toEqual(['Bedroom 2', 'Kitchen', 'Living / Dining', 'Master Bedroom', 'Passage', 'Toilet'].sort());
    const kitchen = f.rooms.find((r) => r.name === 'Kitchen')!;
    // 6057.5..9885 × 115..2942.5, minus the corner column notch (285-115) × (9885-9715)
    const expected = (9885 - 6057.5) * (2942.5 - 115) - 170 * 170;
    expect(Math.abs(polygonArea(kitchen.polygon) - expected) / expected).toBeLessThan(0.002);
    expect(kitchen.type).toBe('kitchen');
  });

  it('marks exterior walls, columns, existing fixtures and a dimension mismatch', () => {
    expect(f.walls.filter((w) => w.exterior)).toHaveLength(4);
    expect(f.columns).toHaveLength(5);
    expect(f.items.map((i) => i.catalogId).sort()).toEqual(['basin', 'wc']);
    expect(f.dimChecks.filter((d) => !d.ok)).toHaveLength(1);
  });
});
