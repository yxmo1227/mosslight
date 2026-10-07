import test from 'node:test';
import assert from 'node:assert/strict';
import { BOTTLE_SHAPES, MATERIAL_KINDS } from '../shared/catalog';
import type { MaterialKind, Terrain } from '../shared/types';
import { containGrain, containsPoint, DEFAULT_GLASS_PROFILE, groundPoint, materialAt, normalizedAtWorldX, profileFor, radiusAt, ringPoint, seededRandom, smoothHeight, surfaceXs, terrainWorldX, wallDepthAt } from './scene-3d-profile';

const terrain = (height: (column: number) => number): Terrain => ({ columns: Array.from({ length: 48 }, (_, column) => Array.from({ length: height(column) }, (_, level) => MATERIAL_KINDS[level % MATERIAL_KINDS.length])) });
for (const shape of BOTTLE_SHAPES) {
  test(`${shape}: filled cross-section reaches both actual curved inner walls`, () => {
    const profile = profileFor(shape), state = terrain(() => 14);
    for (const u of [0, 1]) {
      const point = groundPoint(profile, state, u, .5);
      assert.ok(Math.abs(Math.abs(point.x) - (radiusAt(profile, point.y) - .05)) < 1e-8);
      assert.ok(containsPoint(profile, point));
    }
    for (let index = 0; index <= 100; index++) for (const depth of [0, .5, 1]) assert.ok(containsPoint(profile, groundPoint(profile, state, index / 100, depth)), `inside ${index}/${depth}`);
  });
  test(`${shape}: legal jagged legacy terrain has monotone, non-folding projected tops`, () => {
    const profile = profileFor(shape), state = terrain(column => column % 2 ? 2 : 32), original = JSON.stringify(state);
    let last = -Infinity;
    for (let index = 0; index <= 768; index++) { const point = groundPoint(profile, state, index / 768, .5); assert.ok(point.x >= last - 1e-8, `fold at ${index}: ${point.x} < ${last}`); assert.ok(containsPoint(profile, point), `wall at ${index}`); last = point.x; }
    assert.equal(JSON.stringify(state), original);
  });
  test(`${shape}: worst-case rotated grain bounding spheres stay wholly inside glass`, () => {
    const profile = profileFor(shape), rng = seededRandom(77);
    for (let index = 0; index < 100; index++) {
      const radius = .025 + rng() * .13, y = .1 + rng() * 2.1, raw = { x: (rng() * 2 - 1) * radiusAt(profile, y), y, z: radiusAt(profile, y) * profile.depth };
      const point = containGrain(profile, raw, radius);
      for (const dx of [-radius, radius]) for (const dy of [-radius, radius]) for (const dz of [-radius, radius]) assert.ok(containsPoint(profile, { x: point.x + dx, y: point.y + dy, z: point.z + dz }, .04), `grain ${index}`);
    }
  });
}
test('sculpted six/twelve-facet minimum/maximum profiles constrain both soil and particle cubes', () => {
  for (const facets of [6, 8, 10, 12] as const) for (const width of [.55, 1.25]) {
    const profile = profileFor('glass-box', { lower: width, middle: 1.8 - width, upper: width, facets }), state = terrain(index => Math.round(12 + 8 * Math.sin(index / 9)));
    for (let i = 0; i <= 192; i++) assert.ok(containsPoint(profile, groundPoint(profile, state, i / 192, .8)), `facet ${facets} width ${width} x ${i}`);
    for (const x of [-2, 0, 2]) { const p = containGrain(profile, { x, y: .2, z: 2 }, .14); for (const dx of [-.14, .14]) for (const dy of [-.14, .14]) for (const dz of [-.14, .14]) assert.ok(containsPoint(profile, { x: p.x + dx, y: p.y + dy, z: p.z + dz }, .04)); }
  }
});
test('material bands preserve exact bottom-to-top ordering', () => {
  const materials: MaterialKind[] = ['clay', 'charcoal', 'gravel', 'soil', 'bark', 'coir', 'soil'];
  const state: Terrain = { columns: Array.from({ length: 48 }, () => [...materials]) };
  for (let level = 0; level < materials.length; level++) assert.equal(materialAt(state, .5, level), materials[level]);
  const before = JSON.stringify(state); surfaceXs(profileFor('round'), state); assert.equal(JSON.stringify(state), before);
});
test('smooth terrain is continuous across column boundaries without rectangular steps', () => {
  const state = terrain(i => 3 + i % 7);
  for (let i = 1; i < 48; i++) assert.ok(Math.abs(smoothHeight(state, i / 48 - 1e-8) - smoothHeight(state, i / 48 + 1e-8)) < 1e-6);
});
test('empty terrain stays empty, deterministic geometry does not synthesize grains', () => {
  const state = terrain(() => 0), profile = profileFor('round');
  for (const x of [0, .3, .5, 1]) { assert.equal(smoothHeight(state, x), 0); assert.equal(materialAt(state, x, 0), null); assert.ok(Number.isFinite(terrainWorldX(profile, state, x, .115))); }
  assert.deepEqual([...surfaceXs(profile, state)], [...surfaceXs(profile, structuredClone(state))]);
});
test('facet wall interpolation and shared outer rings agree', () => {
  for (const facets of [6, 8, 10, 12] as const) {
    const profile = profileFor('glass-box', { ...DEFAULT_GLASS_PROFILE, facets });
    for (let i = 0; i < facets; i++) { const point = ringPoint(profile, 1.12, i / facets * Math.PI * 2, .045); assert.ok(Math.abs(wallDepthAt(profile, point.x, point.y) - Math.abs(point.z)) < 1e-7); }
  }
});
test('pointer inverse round-trips every rendered column even on pathological legacy terrain', () => {
  for (const shape of BOTTLE_SHAPES) {
    const profile = profileFor(shape, { lower: .55, middle: 1.25, upper: .55, facets: 6 });
    for (const height of [(i: number) => i % 2 ? 0 : 40, (i: number) => i < 12 ? 35 : 3, () => 12]) {
      const state = terrain(height);
      for (let i = 0; i < 96; i++) { const u = (i + .5) / 96, point = groundPoint(profile, state, u, .5); assert.ok(Math.abs(normalizedAtWorldX(profile, state, point.x) - u) < 2e-7, `${shape} column ${i}`); }
    }
  }
});
test('every side-layer row stays monotone on steep legacy data, not just its top', () => {
  for (const shape of BOTTLE_SHAPES) {
    const profile = profileFor(shape, { lower: 1.25, middle: .55, upper: 1.25, facets: 12 });
    for (const height of [(i: number) => i % 2 ? 0 : 40, (i: number) => i < 12 ? 35 : 3]) {
      const state = terrain(height);
      for (let row = 0; row <= 40; row++) {
        let last = -Infinity;
        for (let i = 0; i <= 192; i++) {
          const u = i / 192, x = terrainWorldX(profile, state, u, .115 + row * .05), y = .115 + Math.min(smoothHeight(state, u), row * .05);
          assert.ok(x >= last - 1e-8, `${shape} row ${row} fold ${i}`); assert.ok(containsPoint(profile, { x, y, z: 0 }), `${shape} row ${row} outside ${i}`); last = x;
        }
      }
    }
  }
});
