import assert from 'node:assert/strict';
import test from 'node:test';
import { MATERIAL_KINDS, TERRAIN_COLUMNS, TERRAIN_GRAIN_HEIGHT, TERRAIN_MAX_HEIGHT } from '../shared/catalog';
import type { MaterialKind, Terrain } from '../shared/types';
import { pourTerrain, scoopTerrain, terrainColumnIndex } from './terrain';

const COLUMN_24_CENTER = 24.5 / TERRAIN_COLUMNS;

function terrain(height = 0, material: MaterialKind = 'soil'): Terrain {
  return { columns: Array.from({ length: TERRAIN_COLUMNS }, () => Array<MaterialKind>(height).fill(material)) };
}

function total(value: Terrain): number {
  return value.columns.reduce((sum, column) => sum + column.length, 0);
}

function counts(value: Terrain): Record<MaterialKind, number> {
  const result: Record<MaterialKind, number> = { soil: 0, clay: 0, gravel: 0, coir: 0, bark: 0, charcoal: 0 };
  for (const column of value.columns) for (const grain of column) result[grain]++;
  return result;
}

function frozen(value: Terrain): Terrain {
  for (const column of value.columns) Object.freeze(column);
  Object.freeze(value.columns);
  return Object.freeze(value);
}

function coordinateCases(): { x: number; index: number; label: string }[] {
  const cases = [
    { x: 0, index: 0, label: 'left endpoint' },
    { x: 0.1, index: 4, label: '0.1 belongs to column 4, not rounded column 5' },
    { x: 1, index: 47, label: 'right endpoint' },
  ];
  for (let index = 0; index < TERRAIN_COLUMNS; index += 1) {
    cases.push({ x: (index + 0.5) / TERRAIN_COLUMNS, index, label: `column ${index} center` });
    cases.push({ x: index / TERRAIN_COLUMNS, index, label: `column ${index} exact left edge` });
    cases.push({ x: (index + 1) / TERRAIN_COLUMNS, index: Math.min(index + 1, TERRAIN_COLUMNS - 1), label: `column ${index} exact right edge` });
    if (index > 0) {
      cases.push({ x: index / TERRAIN_COLUMNS - 1e-12, index: index - 1, label: `just left of boundary ${index}` });
      cases.push({ x: index / TERRAIN_COLUMNS + 1e-12, index, label: `just right of boundary ${index}` });
    }
  }
  return cases;
}

test('uniform 48-column mapping handles centers, exact edges and either side of every internal boundary', () => {
  assert.equal(TERRAIN_COLUMNS, 48);
  for (const { x, index, label } of coordinateCases()) assert.equal(terrainColumnIndex(x), index, label);
});

test('pour actually deposits at each uniformly mapped column on empty flat terrain without gravity masking the target', () => {
  for (const { x, index, label } of coordinateCases()) {
    const input = terrain();
    const result = pourTerrain(input, 'charcoal', x, 1);
    assert.equal(total(result), 1, label);
    for (let column = 0; column < TERRAIN_COLUMNS; column += 1) {
      assert.deepEqual(result.columns[column], column === index ? ['charcoal'] : [], `${label}: column ${column}`);
    }
    assert.equal(total(input), 0, 'the input terrain is never mutated');
  }
});

test('scoop actually removes from each uniformly mapped column on equal-height terrain without local fallback masking the target', () => {
  for (const { x, index, label } of coordinateCases()) {
    const input = terrain(3, 'gravel');
    const result = scoopTerrain(input, x, 1);
    assert.equal(total(result), total(input) - 1, label);
    for (let column = 0; column < TERRAIN_COLUMNS; column += 1) {
      assert.deepEqual(result.columns[column], Array<MaterialKind>(column === index ? 2 : 3).fill('gravel'), `${label}: column ${column}`);
    }
    assert.ok(input.columns.every((column) => column.length === 3), 'the input terrain is never mutated');
  }
});

test('pour conserves each six-material dose and existing bottom-to-top order', () => {
  let state = terrain();
  const sequence: MaterialKind[] = ['bark', 'soil', 'charcoal', 'gravel', 'coir', 'clay'];
  for (const kind of sequence) {
    const before = structuredClone(state);
    const previousCounts = counts(before);
    state = pourTerrain(state, kind, 0.5, 8);
    assert.equal(total(state), total(before) + 8);
    for (const material of MATERIAL_KINDS) {
      assert.equal(counts(state)[material], previousCounts[material] + (kind === material ? 8 : 0));
    }
    for (let index = 0; index < TERRAIN_COLUMNS; index++) {
      assert.deepEqual(state.columns[index].slice(0, before.columns[index].length), before.columns[index]);
    }
  }
});

test('arbitrary six-material stacks are accepted and only top grains are excavated', () => {
  const state = terrain();
  const stack: MaterialKind[] = ['bark', 'soil', 'charcoal', 'gravel', 'coir', 'clay'];
  state.columns[24] = [...stack];
  const poured = pourTerrain(state, 'bark', COLUMN_24_CENTER, 1);
  assert.deepEqual(poured.columns[24].slice(0, stack.length), stack);
  const scooped = scoopTerrain(state, COLUMN_24_CENTER, 2);
  assert.deepEqual(scooped.columns[24], stack.slice(0, -2));
  assert.equal(total(scooped), total(state) - 2);
});

test('repeated local pours produce persistent hills and bounded downhill slopes', () => {
  let state = terrain(3, 'gravel');
  for (let index = 0; index < 24; index++) state = pourTerrain(state, 'soil', COLUMN_24_CENTER, 8);
  assert.equal(total(state), TERRAIN_COLUMNS * 3 + 24 * 8);
  assert.ok(state.columns[24].length > state.columns[8].length + 4);
  assert.ok(state.columns.some((column) => column.length !== state.columns[0].length));
  for (let index = 0; index < TERRAIN_COLUMNS; index++) {
    if (index < 16 || index > 32) assert.deepEqual(state.columns[index], ['gravel', 'gravel', 'gravel']);
  }
  // The new deposited surface remains locally sloped rather than a lone tower.
  for (let index = 17; index < 32; index++) {
    assert.ok(Math.abs(state.columns[index].length - state.columns[index - 1].length) <= 1);
  }
});

test('scoop carves a broad rounded valley without flattening outside its footprint', () => {
  const state = terrain(18);
  const valley = scoopTerrain(state, COLUMN_24_CENTER, 24);
  assert.equal(total(valley), total(state) - 24);
  for (let index = 0; index < TERRAIN_COLUMNS; index++) {
    const distance = Math.abs(index - 24);
    if (distance > 4) assert.deepEqual(valley.columns[index], state.columns[index]);
    else assert.ok(valley.columns[index].length < state.columns[index].length, 'every brush column receives excavation');
  }
  assert.ok(valley.columns[24].length <= valley.columns[20].length);
  for (let offset = 1; offset <= 4; offset++) {
    assert.ok(valley.columns[24 - offset].length >= valley.columns[25 - offset].length);
    assert.ok(valley.columns[24 + offset].length >= valley.columns[23 + offset].length);
    assert.ok(Math.abs(valley.columns[24 - offset].length - valley.columns[24 + offset].length) <= 1);
  }
  assert.ok(valley.columns[24].length >= 14, 'a brush dose must not excavate a narrow 24-grain shaft');
});

test('explicit small-radius scooping stays within two columns with deterministic ties', () => {
  const state = terrain();
  state.columns[22] = ['bark'];
  state.columns[23] = ['clay'];
  state.columns[25] = ['charcoal'];
  state.columns[26] = ['soil'];
  state.columns[27] = ['gravel'];
  const result = scoopTerrain(state, COLUMN_24_CENTER, 8, 2);
  assert.equal(total(result), 1);
  assert.deepEqual(result.columns[27], ['gravel']);
  const tie = scoopTerrain(state, COLUMN_24_CENTER, 1, 2);
  assert.equal(tie.columns[23].length, 0);
  assert.deepEqual(tie.columns[25], ['charcoal']);
});

test('global capacity never overfills, while locally full terrain spills to remaining space', () => {
  const state = terrain(TERRAIN_MAX_HEIGHT);
  assert.equal(total(state), TERRAIN_COLUMNS * TERRAIN_MAX_HEIGHT);
  const full = pourTerrain(state, 'coir', 0.5, 8);
  assert.deepEqual(full, state);
  assert.notEqual(full, state);
  state.columns[0] = [];
  const spilled = pourTerrain(state, 'coir', COLUMN_24_CENTER, 8);
  assert.deepEqual(spilled.columns[0], Array(8).fill('coir'));
  assert.deepEqual(spilled.columns.slice(1), state.columns.slice(1));
  assert.deepEqual(state.columns[0], []);
});

test('pours pass the former 40-grain ceiling without rescaling old layers and stop at 112 grains', () => {
  assert.equal(TERRAIN_MAX_HEIGHT, 112);
  assert.equal(TERRAIN_GRAIN_HEIGHT, 5, 'raising capacity must not shrink existing grains');
  const stack = Array.from({ length: 40 }, (_, index) => MATERIAL_KINDS[index % MATERIAL_KINDS.length]);
  const input = frozen({ columns: Array.from({ length: TERRAIN_COLUMNS }, () => [...stack]) });
  let filled = pourTerrain(input, 'coir', COLUMN_24_CENTER, 32);
  assert.equal(total(filled), TERRAIN_COLUMNS * 40 + 32);
  assert.ok(filled.columns.some((column) => column.length > 40));
  for (let dose = 1; dose < 38; dose++) filled = pourTerrain(filled, 'coir', COLUMN_24_CENTER, 32);
  assert.equal(total(filled), TERRAIN_COLUMNS * 40 + 38 * 32);
  assert.equal(filled.columns.slice(16, 33).reduce((sum, column) => sum + column.length, 0), 17 * 40 + 38 * 32);
  assert.equal(Math.max(...filled.columns.map(column => column.length)), 112);
  assert.ok(filled.columns.filter((_, index) => index < 16 || index > 32).every(column => column.length === 40));
  for (let dose = 38; dose < 110; dose++) filled = pourTerrain(filled, 'coir', COLUMN_24_CENTER, 32);
  assert.equal(total(filled), TERRAIN_COLUMNS * 112);
  for (let index = 0; index < TERRAIN_COLUMNS; index++) {
    assert.deepEqual(input.columns[index], stack, 'the frozen input stays unchanged');
    assert.deepEqual(filled.columns[index].slice(0, 40), stack, 'old material order and amount stay unchanged');
    assert.equal(filled.columns[index].length, 112);
    assert.ok(filled.columns[index].slice(40).every((kind) => kind === 'coir'));
    assert.notEqual(filled.columns[index], input.columns[index]);
  }
  assert.deepEqual(pourTerrain(filled, 'charcoal', COLUMN_24_CENTER, 32), filled, 'only globally exhausted capacity discards a dose');
  const scooped = scoopTerrain(frozen(filled), COLUMN_24_CENTER, 32, 7);
  assert.equal(total(scooped), total(filled) - 32);
  for (let index = 0; index < TERRAIN_COLUMNS; index++) {
    assert.deepEqual(scooped.columns[index], filled.columns[index].slice(0, scooped.columns[index].length));
    assert.notEqual(scooped.columns[index], filled.columns[index]);
  }
});

test('partially full local terrain accepts only its remaining capacity', () => {
  const state = terrain(TERRAIN_MAX_HEIGHT);
  state.columns[24].pop();
  state.columns[25].splice(-2);
  const result = pourTerrain(state, 'charcoal', COLUMN_24_CENTER, 8);
  assert.equal(total(result), total(state) + 3);
  assert.equal(counts(result).charcoal, 3);
  assert.ok(result.columns.every((column) => column.length <= TERRAIN_MAX_HEIGHT));
});

test('pour and scoop endpoint coordinates map to the endpoint columns', () => {
  const left = pourTerrain(terrain(), 'bark', 0, 1);
  const right = pourTerrain(terrain(), 'charcoal', 1, 1);
  assert.deepEqual(left.columns[0], ['bark']);
  assert.deepEqual(right.columns[47], ['charcoal']);
  assert.equal(total(scoopTerrain(left, 0, 1)), 0);
  assert.equal(total(scoopTerrain(right, 1, 1)), 0);
});

test('operations are deterministic and return independent copies of frozen inputs', () => {
  const input = frozen(terrain(5, 'coir'));
  const before = structuredClone(input);
  const first = pourTerrain(input, 'bark', 0.5, 8);
  const second = pourTerrain(input, 'bark', 0.5, 8);
  assert.deepEqual(first, second);
  assert.deepEqual(input, before);
  assert.notEqual(first.columns, input.columns);
  for (let index = 0; index < TERRAIN_COLUMNS; index++) assert.notEqual(first.columns[index], input.columns[index]);
  const removed = scoopTerrain(input, 0.5, 8);
  assert.deepEqual(removed, scoopTerrain(input, 0.5, 8));
  assert.deepEqual(input, before);
  first.columns[0].push('soil');
  assert.deepEqual(input, before);
});

test('mapping, pour and scoop reject malformed coordinates and unbounded doses', () => {
  for (const x of [NaN, Infinity, -Infinity, -0.1, 1.1, '0.5', null, undefined, {}, []]) {
    assert.throws(() => terrainColumnIndex(x as number), TypeError);
    assert.throws(() => pourTerrain(terrain(), 'soil', x as number, 1), TypeError);
    assert.throws(() => scoopTerrain(terrain(), x as number, 1), TypeError);
  }
  for (const amount of [NaN, Infinity, -1, 0, 0.5, 32.1, 33, 1e12, '1', null]) {
    assert.throws(() => pourTerrain(terrain(), 'soil', 0.5, amount as number), TypeError);
    assert.throws(() => scoopTerrain(terrain(), 0.5, amount as number), TypeError);
  }
  assert.throws(() => pourTerrain(terrain(), 'unknown' as MaterialKind, 0.5, 1), TypeError);
  for (const radius of [NaN, Infinity, -1, 0, 0.5, 8.1, 9, '4', null]) {
    assert.throws(() => scoopTerrain(terrain(), 0.5, 1, radius as number), TypeError);
  }
});

test('fast 32-grain pours conserve mass, keep material prefixes and settle into local slopes', () => {
  let state = terrain(2, 'clay');
  for (const kind of MATERIAL_KINDS) {
    const before = structuredClone(state);
    state = pourTerrain(state, kind, COLUMN_24_CENTER, 32);
    assert.equal(total(state), total(before) + 32);
    for (let index = 0; index < TERRAIN_COLUMNS; index++) {
      assert.deepEqual(state.columns[index].slice(0, before.columns[index].length), before.columns[index]);
      assert.ok(state.columns[index].length <= TERRAIN_MAX_HEIGHT);
      if (index < 16 || index > 32) assert.deepEqual(state.columns[index], before.columns[index]);
    }
    for (let index = 17; index <= 32; index++) {
      assert.ok(Math.abs(state.columns[index].length - state.columns[index - 1].length) <= 1);
    }
  }
  assert.ok(state.columns.slice(16, 33).every((column) => column.length > 2));
});

test('all brush radii remove only existing top grains across the exact clipped disk footprint', () => {
  const stack: MaterialKind[] = ['gravel', 'clay', 'soil', 'coir', 'bark', 'charcoal'];
  for (const radius of [1, 2, 4, 7, 8]) {
    for (const x of [0, COLUMN_24_CENTER, 1]) {
      const input: Terrain = { columns: Array.from({ length: TERRAIN_COLUMNS }, () => [...stack]) };
      const before = structuredClone(input);
      const center = terrainColumnIndex(x);
      const result = scoopTerrain(input, x, 32, radius);
      const width = Math.min(TERRAIN_COLUMNS - 1, center + radius) - Math.max(0, center - radius) + 1;
      assert.equal(total(input) - total(result), Math.min(32, width * stack.length));
      for (let index = 0; index < TERRAIN_COLUMNS; index++) {
        assert.deepEqual(result.columns[index], stack.slice(0, result.columns[index].length));
        if (Math.abs(index - center) > radius) assert.deepEqual(result.columns[index], stack);
        else assert.ok(result.columns[index].length < stack.length, 'no skipped columns in the brush');
      }
      assert.deepEqual(input, before);
      assert.deepEqual(result, scoopTerrain(input, x, 32, radius));
    }
  }
});

test('brush exhausts only its bounded local inventory and leaves distant layers intact', () => {
  let state = terrain(1, 'bark');
  const radius = 7;
  const first = scoopTerrain(state, COLUMN_24_CENTER, 32, radius);
  assert.equal(total(state) - total(first), 15);
  assert.deepEqual(scoopTerrain(first, COLUMN_24_CENTER, 32, radius), first);
  assert.deepEqual(scoopTerrain(state, COLUMN_24_CENTER, 24), scoopTerrain(state, COLUMN_24_CENTER, 24, 4));
  for (let index = 0; index < 100; index++) state = scoopTerrain(state, 0, 32, 8);
  assert.ok(state.columns.slice(0, 9).every((column) => column.length === 0));
  assert.ok(state.columns.slice(9).every((column) => column.length === 1));
});

test('strict terrain schema rejects missing, extra, oversized, sparse and hostile entries', () => {
  const sparseColumns = terrain();
  delete sparseColumns.columns[4];
  const sparseGrains = terrain();
  sparseGrains.columns[4] = Array<MaterialKind>(1);
  const symbolColumns = terrain();
  Object.defineProperty(symbolColumns.columns, Symbol('extra'), { value: 1 });
  const wrongMaterial = terrain();
  wrongMaterial.columns[3] = ['private-code' as MaterialKind];
  const extraGrain = terrain();
  Object.assign(extraGrain.columns[4], { extra: true });
  const inherited = Object.create({ columns: terrain().columns }) as Terrain;
  const malformed: unknown[] = [
    null, [], {}, { columns: [] }, { columns: terrain().columns.slice(1) },
    { columns: [...terrain().columns, []] }, { columns: terrain(TERRAIN_MAX_HEIGHT + 1).columns },
    { columns: terrain().columns, unknown: true }, sparseColumns, sparseGrains,
    symbolColumns, wrongMaterial, extraGrain, inherited,
  ];
  for (const input of malformed) {
    assert.throws(() => pourTerrain(input as Terrain, 'soil', 0.5, 1), TypeError);
    assert.throws(() => scoopTerrain(input as Terrain, 0.5, 1), TypeError);
  }
});

test('hostile accessors are rejected without execution', () => {
  let executions = 0;
  const accessor = { get columns() { executions++; return terrain().columns; } };
  const grainAccessor = terrain();
  Object.defineProperty(grainAccessor.columns[4], '0', {
    enumerable: true, get() { executions++; return 'soil'; },
  });
  const columnAccessor = terrain();
  Object.defineProperty(columnAccessor.columns, '4', {
    enumerable: true, get() { executions++; return []; },
  });
  for (const input of [accessor, grainAccessor, columnAccessor]) {
    assert.throws(() => pourTerrain(input as Terrain, 'soil', 0.5, 1), TypeError);
    assert.throws(() => scoopTerrain(input as Terrain, 0.5, 1), TypeError);
  }
  assert.equal(executions, 0);
});

test('many mixed operations stay bounded and preserve dense valid terrain', { timeout: 5000 }, () => {
  let state = terrain();
  for (let index = 0; index < 1000; index++) {
    const x = (((index * 17) % TERRAIN_COLUMNS) + 0.5) / TERRAIN_COLUMNS;
    const before = total(state);
    state = pourTerrain(state, MATERIAL_KINDS[index % MATERIAL_KINDS.length], x, 8);
    assert.ok(total(state) >= before && total(state) <= before + 8);
    if (index % 3 === 0) {
      const poured = total(state);
      state = scoopTerrain(state, x, 5);
      assert.ok(total(state) <= poured && total(state) >= poured - 5);
    }
    assert.equal(state.columns.length, TERRAIN_COLUMNS);
    assert.ok(state.columns.every((column) => column.length <= TERRAIN_MAX_HEIGHT
      && column.every((grain) => MATERIAL_KINDS.includes(grain))));
    assert.ok(total(state) <= TERRAIN_COLUMNS * TERRAIN_MAX_HEIGHT);
  }
});
