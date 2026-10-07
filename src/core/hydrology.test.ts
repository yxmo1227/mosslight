import assert from 'node:assert/strict';
import test from 'node:test';
import { TERRAIN_COLUMNS, TERRAIN_MAX_HEIGHT } from '../shared/catalog';
import type { Pond, Terrain } from '../shared/types';
import { drainPond, pourPond, reconcilePond } from './hydrology';

const terrain = (heights: number[] = Array(48).fill(0)): Terrain => ({ columns: heights.map(height => Array(height).fill('soil')) });
const volume = (pond: Pond): number => pond.depths.reduce((sum, depth) => sum + depth, 0);
const empty = (): Pond => ({ depths: Array(48).fill(0) });
function frozen<T>(value: T): T { if (value && typeof value === 'object') { for (const item of Object.values(value)) frozen(item); Object.freeze(value); } return value; }

test('flat basins level within one integer unit without a staircase or loss', () => {
  const ground = frozen(terrain()); let pond = frozen(empty());
  for (let count = 1; count <= 50; count++) {
    const previous = pond; pond = frozen(pourPond(ground, previous, .5, 32));
    assert.equal(volume(pond), count * 32);
    assert.equal(volume(previous), (count - 1) * 32);
    assert.ok(Math.max(...pond.depths) - Math.min(...pond.depths) <= 1);
  }
  assert.deepEqual(reconcilePond(ground, pond), pond, 'settled inventory is idempotent');
  assert.notEqual(reconcilePond(ground, pond).depths, pond.depths);
});

test('a ridge traps a pond until the available basin volume reaches its spill level', () => {
  const heights = Array<number>(48).fill(0); heights[16] = heights[31] = 20;
  for (let index = 17; index <= 30; index++) heights[index] = 4;
  const ground = frozen(terrain(heights)); let pond = empty();
  for (let count = 0; count < 7; count++) pond = pourPond(ground, pond, 24.5 / 48, 32);
  assert.equal(volume(pond), 224);
  for (let index = 0; index < 48; index++) assert.equal(pond.depths[index], index >= 17 && index <= 30 ? 16 : 0);
  const spilled = pourPond(ground, frozen(pond), 24.5 / 48, 1);
  assert.equal(volume(spilled), 225);
  assert.ok(spilled.depths.slice(0, 16).some(Boolean) || spilled.depths.slice(32).some(Boolean));
  assert.equal(volume(pond), 224);
});

test('terrain displacement conserves water until global remaining capacity is exhausted', () => {
  const before = frozen({ depths: Array<number>(48).fill(20) });
  const heights = Array<number>(48).fill(0); heights[24] = 112;
  const moved = reconcilePond(frozen(terrain(heights)), before);
  assert.equal(volume(moved), volume(before)); assert.equal(moved.depths[24], 0);
  const crowded = reconcilePond(frozen(terrain(Array(48).fill(100))), before);
  assert.equal(volume(crowded), 48 * 12);
  assert.ok(crowded.depths.every(depth => depth === 12));
  assert.equal(volume(before), 960);
  const full = pourPond(terrain(Array(48).fill(112)), undefined, .5, 32);
  assert.equal(volume(full), 0);
});

test('excavating a ridge releases existing water into the newly reachable lower basin', () => {
  const heights = Array<number>(48).fill(0); heights[16] = heights[31] = 20;
  for (let index = 17; index <= 30; index++) heights[index] = 4;
  let pond = empty(); const ground = terrain(heights);
  for (let count = 0; count < 4; count++) pond = pourPond(ground, pond, .5, 32);
  heights[16] = 0;
  const released = reconcilePond(terrain(heights), frozen(pond));
  assert.equal(volume(released), 128);
  assert.ok(released.depths.slice(0, 16).some(Boolean));
  assert.ok(released.depths.slice(32).every(depth => depth === 0), 'the remaining high ridge stays closed');
});

test('drain doses are bounded and remove only the chosen local inventory before leveling', () => {
  const ground = frozen(terrain());
  const pond = frozen({ depths: Array<number>(48).fill(10) });
  const drained = drainPond(ground, pond, .5, 24, 2);
  assert.equal(volume(drained), 480 - 24); assert.equal(volume(pond), 480);
  assert.ok(Math.max(...drained.depths) - Math.min(...drained.depths) <= 1);
  const onlyRemote = empty(); onlyRemote.depths[0] = 20;
  const wall = Array<number>(48).fill(112); wall[0] = wall[24] = 0;
  assert.deepEqual(drainPond(terrain(wall), frozen(onlyRemote), .5, 32, 1), onlyRemote);
  assert.deepEqual(drainPond(ground, undefined, .5, 32), empty());
});

test('hydrology validates finite integer inventory, ordinary dense data, dose and brush bounds', () => {
  const ground = terrain(); const variants: unknown[] = [null, {}, { depths: [] }, { depths: Array(49).fill(0) }];
  for (const depth of [NaN, Infinity, -1, .5, 113, '1', null, undefined]) { const pond = empty(); pond.depths[0] = depth as number; variants.push(pond); }
  const sparse = empty(); delete sparse.depths[3]; variants.push(sparse);
  const extra = empty(); Object.assign(extra.depths, { run: true }); variants.push(extra);
  let calls = 0; const getter = empty(); Object.defineProperty(getter.depths, '0', { enumerable: true, get() { calls++; return 0; } }); variants.push(getter);
  for (const pond of variants) {
    assert.throws(() => reconcilePond(ground, pond as Pond));
    assert.throws(() => pourPond(ground, pond as Pond, .5, 1));
    assert.throws(() => drainPond(ground, pond as Pond, .5, 1));
  }
  assert.equal(calls, 0);
  for (const amount of [0, -1, .5, 33, Infinity, NaN]) {
    assert.throws(() => pourPond(ground, undefined, .5, amount));
    assert.throws(() => drainPond(ground, undefined, .5, amount));
  }
  for (const radius of [0, 9, .5, NaN]) assert.throws(() => drainPond(ground, undefined, .5, 1, radius));
  for (const x of [-.1, 1.1, NaN, Infinity]) assert.throws(() => pourPond(ground, undefined, x, 1));
  assert.throws(() => pourPond(terrain(Array(48).fill(112)), { depths: Array(48).fill(1) }, .5, 1));
});

test('one hundred deterministic worst-range landscapes settle finitely and preserve exact water volume', { timeout: 5000 }, () => {
  for (let seed = 0; seed < 100; seed++) {
    const ground = frozen(terrain(Array.from({ length: TERRAIN_COLUMNS }, (_, index) => (index * 17 + seed * 11) % 113)));
    const input = frozen({ depths: ground.columns.map((column, index) => (index * 29 + seed * 7) % (113 - column.length)) });
    const result = reconcilePond(ground, input);
    assert.equal(volume(result), volume(input));
    assert.deepEqual(reconcilePond(ground, result), result);
    assert.deepEqual(reconcilePond(ground, input), result);
    for (let index = 0; index < 48; index++) assert.ok(Number.isInteger(result.depths[index]) && result.depths[index] >= 0 && ground.columns[index].length + result.depths[index] <= TERRAIN_MAX_HEIGHT);
  }
});
