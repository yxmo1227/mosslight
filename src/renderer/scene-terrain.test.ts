import assert from 'node:assert/strict';
import test from 'node:test';
import { BOTTLE_SHAPES, MATERIAL_KINDS, TERRAIN_COLUMNS, TERRAIN_GRAIN_HEIGHT, TERRAIN_MAX_HEIGHT } from '../shared/catalog';
import type { MaterialKind, Terrain } from '../shared/types';
import { TERRAIN_BOUNDS, terrainColumnBounds, terrainColumnIndex, terrainHeightAt, terrainNormalizedX, terrainRootAt, terrainRuns } from './scene-terrain';

function terrainWithHeights(heights: readonly number[]): Terrain {
  return { columns: Array.from({ length: TERRAIN_COLUMNS }, (_, index) => Array<MaterialKind>(heights[index] ?? 0).fill('soil')) };
}

test('terrain contract is 48 columns with at most 112 five-unit grains', () => {
  assert.equal(TERRAIN_COLUMNS, 48);
  assert.equal(TERRAIN_MAX_HEIGHT, 112);
  assert.equal(TERRAIN_GRAIN_HEIGHT, 5);
});

test('column selection clamps endpoints and preserves every column boundary', () => {
  for (const x of [-Infinity, -100, -0.001, 0, NaN]) assert.equal(terrainColumnIndex(x), 0);
  for (const x of [1, 1.001, 100, Infinity]) assert.equal(terrainColumnIndex(x), TERRAIN_COLUMNS - 1);
  for (let index = 0; index < TERRAIN_COLUMNS; index += 1) {
    assert.equal(terrainColumnIndex((index + 0.5) / TERRAIN_COLUMNS), index);
    assert.equal(terrainColumnIndex(index / TERRAIN_COLUMNS), index);
    if (index > 0) assert.equal(terrainColumnIndex(index / TERRAIN_COLUMNS - 1e-8), index - 1);
  }
});

test('height follows individual columns without smoothing valleys or peaks', () => {
  const heights = Array.from({ length: TERRAIN_COLUMNS }, (_, index) => index % (TERRAIN_MAX_HEIGHT + 1));
  const terrain = terrainWithHeights(heights);
  const original = structuredClone(terrain);
  for (let index = 0; index < TERRAIN_COLUMNS; index += 1) {
    assert.equal(terrainHeightAt(terrain, (index + 0.5) / TERRAIN_COLUMNS), heights[index] * TERRAIN_GRAIN_HEIGHT);
  }
  const relief = terrainWithHeights([40, 0, 1, 40]);
  assert.equal(terrainHeightAt(relief, 0.5 / TERRAIN_COLUMNS), 200);
  assert.equal(terrainHeightAt(relief, 1.5 / TERRAIN_COLUMNS), 0);
  assert.equal(terrainHeightAt(relief, 2.5 / TERRAIN_COLUMNS), 5);
  assert.equal(terrainHeightAt(relief, 3.5 / TERRAIN_COLUMNS), 200);
  assert.deepEqual(terrain, original, 'height queries must leave terrain unchanged');
});

test('inverse terrain x keeps exact column boundaries stable after canvas rounding', () => {
  for (const shape of BOTTLE_SHAPES) {
    const bounds = TERRAIN_BOUNDS[shape];
    for (let index = 0; index <= TERRAIN_COLUMNS; index += 1) {
      const x = index / TERRAIN_COLUMNS;
      const worldX = bounds.left + x * (bounds.right - bounds.left);
      assert.equal(terrainNormalizedX(bounds, worldX - 1e-13), x);
      assert.equal(terrainNormalizedX(bounds, worldX + 1e-13), x);
    }
    const genuinePosition = 0.4999999;
    assert.ok(Math.abs(terrainNormalizedX(bounds, bounds.left + genuinePosition * (bounds.right - bounds.left)) - genuinePosition) < 1e-14);
    assert.equal(terrainColumnIndex(terrainNormalizedX(bounds, bounds.left + genuinePosition * (bounds.right - bounds.left))), 23);
    assert.equal(terrainNormalizedX(bounds, bounds.left - 100), 0);
    assert.equal(terrainNormalizedX(bounds, bounds.right + 100), 1);
  }
});

test('height reads edge columns and treats empty columns as zero height', () => {
  const heights = Array<number>(TERRAIN_COLUMNS).fill(0);
  heights[0] = 4;
  heights[TERRAIN_COLUMNS - 1] = 40;
  const terrain = terrainWithHeights(heights);
  assert.equal(terrainHeightAt(terrain, -1), 20);
  assert.equal(terrainHeightAt(terrain, 1), 200);
  assert.equal(terrainHeightAt(terrain, 2), 200);
  assert.equal(terrainHeightAt(terrain, 0.5), 0);
  assert.equal(terrainHeightAt({ columns: [] }, 0.5), 0);
});

for (const shape of BOTTLE_SHAPES) {
  test(`${shape}: legacy terrain helper anchors roots through the preserved 200-unit fixture`, () => {
    const bounds = TERRAIN_BOUNDS[shape];
    const heights = Array<number>(TERRAIN_COLUMNS).fill(0);
    heights[0] = 40;
    heights[24] = 7;
    heights[TERRAIN_COLUMNS - 1] = 2;
    const terrain = terrainWithHeights(heights);
    assert.deepEqual(terrainRootAt(terrain, shape, { x: 0, y: 0.5 }), { x: bounds.left, y: bounds.bottom - 200 });
    assert.deepEqual(terrainRootAt(terrain, shape, { x: 0.5, y: 0.5 }), { x: (bounds.left + bounds.right) / 2, y: bounds.bottom - 35 });
    assert.deepEqual(terrainRootAt(terrain, shape, { x: 1, y: 0.5 }), { x: bounds.right, y: bounds.bottom - 10 });
    assert.deepEqual(terrainRootAt(terrainWithHeights([]), shape, { x: 0.5, y: 0.5 }), { x: (bounds.left + bounds.right) / 2, y: bounds.bottom });
  });

  test(`${shape}: y only offsets shallow ground depth, with bounded x and y`, () => {
    const bounds = TERRAIN_BOUNDS[shape];
    const terrain = terrainWithHeights(Array<number>(TERRAIN_COLUMNS).fill(40));
    const back = terrainRootAt(terrain, shape, { x: 0.5, y: -10 });
    const middle = terrainRootAt(terrain, shape, { x: 0.5, y: 0.5 });
    const front = terrainRootAt(terrain, shape, { x: 0.5, y: 10 });
    assert.equal(back.x, middle.x);
    assert.equal(front.x, middle.x);
    assert.equal(back.y, bounds.bottom - 200 - bounds.depthSpan / 2);
    assert.equal(front.y, bounds.bottom - 200 + bounds.depthSpan / 2);
    assert.equal(front.y - back.y, bounds.depthSpan);
    assert.deepEqual(terrainRootAt(terrain, shape, { x: -Infinity, y: -Infinity }), { x: bounds.left, y: back.y });
    assert.deepEqual(terrainRootAt(terrain, shape, { x: Infinity, y: Infinity }), { x: bounds.right, y: front.y });
    assert.deepEqual(terrainRootAt(terrain, shape, { x: NaN, y: NaN }), { x: bounds.left, y: back.y });
  });

  test(`${shape}: column bounds tile its complete cross-section`, () => {
    const bounds = TERRAIN_BOUNDS[shape];
    const width = (bounds.right - bounds.left) / TERRAIN_COLUMNS;
    let previousRight = bounds.left;
    for (let index = 0; index < TERRAIN_COLUMNS; index += 1) {
      const column = terrainColumnBounds(bounds, index);
      assert.equal(column.left, previousRight);
      assert.ok(Math.abs(column.right - column.left - width) < 1e-10);
      previousRight = column.right;
    }
    assert.equal(previousRight, bounds.right);
    assert.deepEqual(terrainColumnBounds(bounds, -100), terrainColumnBounds(bounds, 0));
    assert.deepEqual(terrainColumnBounds(bounds, 100), terrainColumnBounds(bounds, TERRAIN_COLUMNS - 1));
    assert.deepEqual(terrainColumnBounds(bounds, 2.9), terrainColumnBounds(bounds, 2));
  });
}

test('runs preserve all six materials in their bottom-to-top order', () => {
  const column = MATERIAL_KINDS.flatMap((material, index) => Array<MaterialKind>(index + 1).fill(material));
  const runs = terrainRuns(column);
  let start = 0;
  assert.deepEqual(runs, MATERIAL_KINDS.map((material, index) => {
    const run = { material, start, count: index + 1 };
    start += run.count;
    return run;
  }));
  assert.deepEqual(runs.flatMap((run) => Array<MaterialKind>(run.count).fill(run.material)), column);
  assert.deepEqual(terrainRuns([...MATERIAL_KINDS].reverse()).map((run) => run.material), [...MATERIAL_KINDS].reverse());
});

test('runs merge only contiguous deposits without mutating the source column', () => {
  const column: readonly MaterialKind[] = Object.freeze(['soil', 'soil', 'gravel', 'soil', 'charcoal', 'charcoal', 'soil']);
  assert.deepEqual(terrainRuns(column), [
    { material: 'soil', start: 0, count: 2 },
    { material: 'gravel', start: 2, count: 1 },
    { material: 'soil', start: 3, count: 1 },
    { material: 'charcoal', start: 4, count: 2 },
    { material: 'soil', start: 6, count: 1 },
  ]);
  const changed = terrainRuns(column);
  changed[0].count = 99;
  assert.equal(terrainRuns(column)[0].count, 2);
  assert.deepEqual(column, ['soil', 'soil', 'gravel', 'soil', 'charcoal', 'charcoal', 'soil']);
  assert.deepEqual(terrainRuns([]), []);
});
