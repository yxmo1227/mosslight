import assert from 'node:assert/strict';
import test from 'node:test';
import { BOTTLE_SHAPES, TERRAIN_COLUMNS, TERRAIN_MAX_HEIGHT } from '../shared/catalog';
import type { GlassForm, MaterialKind, Terrain } from '../shared/types';
import { aboveTerrain2D, alignedRuns2D, DEFAULT_FORM, FLOOR_Y, inVessel2D, mossStripOffset2D, normalizedX2D, root2D, rowPoint2D, sculptPoint2D, sculptValue2D, smoothGrains2D, soilBands2D, surfaceXs2D, surfaceY2D, vessel2D } from './scene-2d-geometry';

const terrain = (height: (column: number) => number): Terrain => ({ columns: Array.from({ length: TERRAIN_COLUMNS }, (_, column) => Array(height(column)).fill('soil')) });
const fixtures = [terrain(() => 0), terrain(() => 40), terrain(() => TERRAIN_MAX_HEIGHT), terrain(column => column % 2 ? TERRAIN_MAX_HEIGHT : 0), terrain(column => column < 24 ? 40 : 112), terrain(column => Math.round(8 + Math.abs(column - 24) * 2.8))];
for (const shape of BOTTLE_SHAPES) {
  test(`${shape}: warm 2D soil continues beyond the old half-bottle ceiling and stops only at its opening`, () => {
    const vessel = vessel2D(shape), old = surfaceY2D(vessel, terrain(() => 40), .5), fuller = surfaceY2D(vessel, terrain(() => 72), .5), full = surfaceY2D(vessel, terrain(() => 112), .5);
    assert.equal(FLOOR_Y - old, 200); assert.equal(FLOOR_Y - fuller, 360); assert(full >= vessel.top + 4); assert(full < fuller);
    assert(inVessel2D(vessel, root2D(vessel, terrain(() => 112), .5)));
  });
  test(`${shape}: every 2D root, visible surface and inverse placement use the identical painted contour`, () => {
    const vessel = vessel2D(shape);
    for (const state of fixtures) for (let i = 1; i < 128; i++) {
      const x = i / 128, root = root2D(vessel, state, x);
      assert.equal(root.y, surfaceY2D(vessel, state, x)); assert(Math.abs(normalizedX2D(vessel, state, root.x) - x) < .000001);
      assert(aboveTerrain2D(vessel, state, { x: root.x, y: root.y - .1 }));
      assert(!aboveTerrain2D(vessel, state, { x: root.x, y: root.y + .2 }));
    }
  });
  test(`${shape}: dense and alternating-height grain rows do not fold left-to-right`, () => {
    const vessel = vessel2D(shape);
    for (const state of fixtures) for (const level of [0, 1, 20, 40, 60, 80, 112]) {
      let previous = -Infinity;
      for (let i = 0; i <= 192; i++) {
        const point = rowPoint2D(vessel, state, i / 192, level);
        assert(Number.isFinite(point.x) && Number.isFinite(point.y)); assert(point.x >= previous - 1e-8); previous = point.x;
        assert(point.y >= vessel.top + 4 && point.y <= FLOOR_Y);
      }
    }
  });
}
test('2D sculpt extremes keep an ordered grounded surface and invert their exact visible handles', () => {
  const forms: GlassForm[] = [{ lower: .55, middle: 1.25, upper: .55, facets: 6 }, { lower: 1.25, middle: .55, upper: 1.25, facets: 12 }, { ...DEFAULT_FORM }];
  for (const form of forms) {
    const vessel = vessel2D('glass-box', form);
    for (const key of ['lower', 'middle', 'upper'] as const) assert(Math.abs(sculptValue2D(key, sculptPoint2D(vessel, key).x) - form[key]) < 1e-10);
    for (const state of fixtures) {
      const xs = surfaceXs2D(vessel, state); for (let i = 1; i < xs.length; i++) assert(xs[i] > xs[i - 1]);
      const root = root2D(vessel, state, .5); assert(root.y >= vessel.top + 4); assert(inVessel2D(vessel, root));
    }
  }
});
test('2D terrain projection preserves stored grains and interpolates stored column centres', () => {
  const state = terrain(column => column % 2 ? 112 : 0), before = structuredClone(state);
  for (let i = 0; i < TERRAIN_COLUMNS; i++) assert.equal(smoothGrains2D(state, (i + .5) / TERRAIN_COLUMNS), state.columns[i].length);
  for (const shape of BOTTLE_SHAPES) { const vessel = vessel2D(shape); surfaceXs2D(vessel, state); rowPoint2D(vessel, state, .42, 100); root2D(vessel, state, .85); }
  assert.deepEqual(state, before);
});
test('2D foreground clipping follows the exact line drawn between adjacent surface samples', () => {
  const state = fixtures[3], vessel = vessel2D('round');
  for (let i = 0; i < 192; i++) {
    const a = root2D(vessel, state, i / 192), b = root2D(vessel, state, (i + 1) / 192), x = (a.x + b.x) / 2, y = (a.y + b.y) / 2;
    assert(Math.abs(surfaceY2D(vessel, state, normalizedX2D(vessel, state, x)) - y) < .002);
  }
});
test('2D surface segments remain inside concave necks between their contained endpoints', () => {
  for (const shape of BOTTLE_SHAPES) for (const state of fixtures) {
    const vessel = vessel2D(shape);
    for (let i = 0; i < 192; i++) for (const t of [.137, .456, .821]) {
      const root = root2D(vessel, state, (i + t) / 192);
      assert(inVessel2D(vessel, root), `${shape}: segment ${i} at ${t} is outside`);
    }
  }
});
test('moss ground-cover strips conform across the complete footprint instead of floating from a centre anchor', () => {
  const state = terrain(column => Math.round(28 + Math.cos(column / 48 * Math.PI * 2) * 17));
  for (const shape of BOTTLE_SHAPES) {
    const vessel = vessel2D(shape);
    for (const u of [.17, .36, .55, .79]) {
      const anchor = root2D(vessel, state, u);
      for (let x = anchor.x - 60; x <= anchor.x + 60; x += .7) {
        const offset = mossStripOffset2D(vessel, state, anchor, x), actual = surfaceY2D(vessel, state, normalizedX2D(vessel, state, x));
        assert(Math.abs(anchor.y + offset - actual) < 1e-10);
        // The same offset inversely maps rendered leaf coordinates for selection and spray.
        for (const scale of [.6, 1, 1.8]) { const sourceY = -13.7, worldY = anchor.y + offset + sourceY * scale; assert(Math.abs((worldY - anchor.y - offset) / scale - sourceY) < 1e-10); }
      }
    }
  }
});
test('material-run alignment preserves every stored grain and all separated deposit ordering', () => {
  const columns: MaterialKind[][] = [[], ['soil'], ['clay'], ['soil', 'soil', 'coir'], ['clay', 'soil', 'coir', 'soil', 'bark'], ['gravel', 'charcoal', 'gravel'], ['bark', 'coir', 'charcoal']];
  for (const a of columns) for (const b of columns) {
    const before = structuredClone([a, b]), aligned = alignedRuns2D(a, b);
    assert.deepEqual(aligned.flatMap(run => Array(run.left).fill(run.material)), a);
    assert.deepEqual(aligned.flatMap(run => Array(run.right).fill(run.material)), b);
    assert.deepEqual([a, b], before);
  }
});
test('continuous material bands cover the complete smooth soil surface without occupancy-cell gaps', () => {
  const hillside: Terrain = { columns: Array.from({ length: TERRAIN_COLUMNS }, (_, i) => [...Array<MaterialKind>(4).fill('clay'), ...Array<MaterialKind>(Math.round(20 + Math.abs(i - 24) * .8)).fill('soil'), ...Array<MaterialKind>(3).fill('coir')]) };
  const states = [...fixtures, hillside, { columns: hillside.columns.map((column, i) => i % 3 ? column : ['bark', ...column, 'gravel'] as MaterialKind[]) }];
  for (const shape of BOTTLE_SHAPES) for (const state of states) {
    const vessel = vessel2D(shape), bands = soilBands2D(vessel, state);
    for (let interval = -1; interval < TERRAIN_COLUMNS; interval++) {
      const group = bands.filter(band => band.interval === interval); if (!group.length) continue;
      const count = group[0].top.length;
      for (let sample = 0; sample < count; sample++) {
        assert.equal(group[0].bottom[sample].y, FLOOR_Y);
        for (let layer = 0; layer < group.length; layer++) {
          assert(group[layer].top[sample].y <= group[layer].bottom[sample].y);
          if (layer) assert.deepEqual(group[layer].bottom[sample], group[layer - 1].top[sample]);
        }
        const top = group[group.length - 1].top[sample];
        assert(Math.abs(top.y - surfaceY2D(vessel, state, normalizedX2D(vessel, state, top.x))) < .01);
      }
    }
  }
});
