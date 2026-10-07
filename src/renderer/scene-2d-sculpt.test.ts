import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultGlassSide, GLASS_HEIGHT_LIMITS, TERRAIN_COLUMNS } from '../shared/catalog';
import type { GlassForm, GlassSide, Terrain } from '../shared/types';
import { aboveTerrain2D, DEFAULT_FORM, FLOOR_Y, inVessel2D, normalizedX2D, openingEnds2D, openingPolygon2D, openingY2D, pondDepth2D, pondPoint2D, root2D, rowPoint2D, sculptControlPoint2D, sculptControlValue2D, surfaceXs2D, vessel2D, vesselBounds2D } from './scene-2d-geometry';

const low: GlassSide = { lower: { width: .4, height: .12 }, middle: { width: 1.35, height: .4 }, upper: { width: .4, height: .76 } };
const high: GlassSide = { lower: { width: 1.35, height: .36 }, middle: { width: .4, height: .7 }, upper: { width: 1.35, height: 1.08 } };
const forms: GlassForm[] = [
  { ...DEFAULT_FORM, facets: 7, sides: { left: low, right: high } },
  { ...DEFAULT_FORM, facets: 13, sides: { left: high, right: low } },
  { ...DEFAULT_FORM, facets: 7, sides: { left: high, right: high } },
  { ...DEFAULT_FORM, facets: 13, sides: { left: low, right: low } },
];
const terrain = (height: (column: number) => number): Terrain => ({ columns: Array.from({ length: TERRAIN_COLUMNS }, (_, column) => Array(height(column)).fill('soil')) });
const states = [terrain(() => 0), terrain(() => 40), terrain(() => 112), terrain(i => i % 2 ? 112 : 0), terrain(i => i < 24 ? 40 : 112), terrain(i => Math.round(8 + Math.abs(i - 24) * 2.8))];

test('all six independent sculpt controls round-trip both width and height at allowed extremes', () => {
  for (const form of forms) {
    const vessel = vessel2D('glass-box', form);
    for (const side of ['left', 'right'] as const) for (const key of ['lower', 'middle', 'upper'] as const) {
      const expected = form.sides![side][key], result = sculptControlValue2D(side, key, sculptControlPoint2D(vessel, side, key));
      assert(Math.abs(result.width - expected.width) < 1e-12); assert(Math.abs(result.height - expected.height) < 1e-12);
      assert.deepEqual(sculptControlValue2D(side, key, { x: side === 'left' ? -1000 : 1000, y: -1000 }), { width: 1.35, height: GLASS_HEIGHT_LIMITS[key][1] });
    }
  }
});

test('changing the left control changes only the left wall and opens a genuinely slanted polygon rim', () => {
  const side = defaultGlassSide(DEFAULT_FORM), initial = vessel2D('glass-box', { ...DEFAULT_FORM, sides: { left: side, right: side } });
  const left = structuredClone(side); left.upper.height = 1.08; left.middle.width = 1.35;
  const changed = vessel2D('glass-box', { ...DEFAULT_FORM, sides: { left, right: side } });
  for (const y of [200, 350, 500, 650]) assert.equal(vesselBounds2D(initial, y).right, vesselBounds2D(changed, y).right);
  assert.notEqual(vesselBounds2D(initial, 350).left, vesselBounds2D(changed, 350).left);
  assert(openingEnds2D(changed).left.y < openingEnds2D(changed).right.y);
  for (const facets of [7, 13]) {
    const vessel = vessel2D('glass-box', { ...changed.form, facets }), points = openingPolygon2D(vessel);
    assert.equal(points.length, facets); assert.equal(new Set(points.map(p => `${p.x}:${p.y}`)).size, facets);
    assert(points.some(p => p.y < openingY2D(vessel, p.x) - 5)); assert(points.some(p => p.y > openingY2D(vessel, p.x) + 5));
  }
});

test('independent sculpt extremes keep dense and steep terrain contained, ordered and exactly hittable', () => {
  for (const [formIndex, form] of forms.entries()) for (const [stateIndex, state] of states.entries()) {
    const vessel = vessel2D('glass-box', form), xs = surfaceXs2D(vessel, state);
    for (let i = 1; i < xs.length; i++) assert(xs[i] > xs[i - 1], `ordered ${formIndex}/${stateIndex}/${i}`);
    for (let i = 0; i < 192; i++) for (const t of [.137, .456, .821]) {
      const u = (i + t) / 192, root = root2D(vessel, state, u), context = `${formIndex}/${stateIndex}/${i}/${t}`;
      assert(inVessel2D(vessel, root), `root outside ${context}: ${JSON.stringify(root)}`);
      assert(Math.abs(normalizedX2D(vessel, state, root.x) - u) < 1e-6, `inverse ${context}`);
      assert(aboveTerrain2D(vessel, state, { x: root.x, y: root.y - .1 }), `above ${context}`);
      assert(!aboveTerrain2D(vessel, state, { x: root.x, y: root.y + .2 }), `below ${context}`);
    }
    for (const level of [0, 1, 40, 80, 112]) {
      let previous = -Infinity;
      for (let i = 0; i <= 192; i++) { const point = rowPoint2D(vessel, state, i / 192, level); assert(point.x >= previous - 1e-8); previous = point.x; assert(Number.isFinite(point.y)); }
    }
  }
});

test('pond depth remains separate and maps a bounded surface above its stored ground without modifying either', () => {
  const state = terrain(() => 20), pond = { depths: Array<number>(48).fill(15) }, before = structuredClone({ state, pond });
  for (const form of forms) {
    const vessel = vessel2D('glass-box', form);
    for (let i = 0; i <= 100; i++) {
      const u = i / 100, ground = root2D(vessel, state, u), water = pondPoint2D(vessel, state, pond, u);
      assert.equal(pondDepth2D(pond, u), 15); assert.equal(water.x, ground.x); assert.equal(water.y, FLOOR_Y - 35 * 5);
      assert(water.y < ground.y); assert.deepEqual(pondPoint2D(vessel, state, undefined, u), ground);
      assert(pondPoint2D(vessel, state, { depths: Array(48).fill(92) }, u).y >= openingY2D(vessel, water.x) + 4);
    }
  }
  assert.deepEqual({ state, pond }, before);
});
