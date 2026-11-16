import { describe, it, expect } from 'vitest';
import { parseDxf } from '../src/core/dxf';
import { importDxf } from '../src/core/detect';
import { buildSampleDxf } from '../src/core/sample';
import { generateRoomOptions } from '../src/core/generator';
import { THEMES } from '../src/core/themes';
import { DEFAULT_CATALOG, itemById } from '../src/core/catalog';
import { DEFAULT_RULES, checkRoom } from '../src/core/rules';
import { DEFAULT_BRIEF } from '../src/core/project';

const f = importDxf(parseDxf(buildSampleDxf())).floors[0];

describe('design generation', () => {
  for (const theme of [THEMES[0], THEMES[4], THEMES[7]]) {
    for (const room of f.rooms.filter((r) => r.type !== 'shaft')) {
      it(`${theme.name}: ${room.name} gets 3 buildable options with no hard errors`, () => {
        const opts = generateRoomOptions({ floor: f, room, theme, brief: DEFAULT_BRIEF, styleTags: [], palette: [], prompt: 'no glossy finishes', catalog: DEFAULT_CATALOG, rules: DEFAULT_RULES, seed: 42 });
        expect(opts).toHaveLength(3);
        for (const o of opts) {
          for (const it of o.items) expect(itemById(DEFAULT_CATALOG, it.catalogId)).toBeTruthy();
          const view = { ...f, items: [...f.items.filter((i) => i.roomId !== room.id || i.existing), ...o.items], points: o.points };
          const errs = checkRoom(view, { ...room, finishes: o.finishes }, { catalog: DEFAULT_CATALOG, rules: DEFAULT_RULES }).filter((i) => i.severity === 'error');
          expect(errs.map((e) => e.msg), `${o.label}: ${o.summary}`).toEqual([]);
          expect(o.cost).toBeGreaterThan(0);
        }
        const cats = opts[0].items.map((i) => itemById(DEFAULT_CATALOG, i.catalogId)!.category);
        if (room.type === 'bedroom') expect(cats).toContain('bed');
        if (room.type === 'bedroom') expect(cats).toContain('wardrobe');
        if (room.type === 'kitchen') expect(cats).toEqual(expect.arrayContaining(['kitchen-base', 'sink', 'hob']));
        if (room.type === 'living') expect(cats).toContain('sofa');
        if (room.type === 'toilet') expect(cats).toContain('shower');
      });
    }
  }
});
