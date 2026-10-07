import assert from 'node:assert/strict';
import test from 'node:test';
import type { Decoration, MaterialKind, Plant, TerrariumState } from '../shared/types';
import { BOTTLE_SHAPES, MATERIAL_KINDS, TERRAIN_COLUMNS, TERRAIN_MAX_HEIGHT } from '../shared/catalog';
import { applyAction } from './simulation';
import { MAX_DECORATIONS, MAX_PLANTS, MIN_HEALTH, migrateSaveState, validateAction, validateState } from './validation';

const NOW = 1_789_689_600_000;
const clone = <T>(value: T): T => structuredClone(value);
const plant = (id = 'plant-1'): Plant => ({
  id, kind: 'fern', x: 0.5, y: 0.5, scale: 1, growth: 0.2, health: 1, ageDays: 0, wetness: 0,
});
const decoration = (id = 'decoration-1'): Decoration => ({ id, kind: 'stone', x: 0.5, y: 0.5, scale: 1 });

function populated(): TerrariumState {
  return {
    schemaVersion: 2, name: '我的小森林', bottle: 'round',
    terrain: { columns: Array.from({ length: TERRAIN_COLUMNS }, () => ['gravel', 'clay', 'soil']) },
    plants: [plant()], decorations: [decoration()],
    environment: { temperature: 22, light: 0.65 },
    ecology: { moisture: 0.55, humidity: 0.65, waterReserve: 0.5, simulatedDays: 0 },
    care: { sunlight: 0 }, closed: true, speed: 1, paused: false, vacation: false,
    createdAt: NOW, updatedAt: NOW,
    preferences: { widgetSize: 'medium', alwaysOnTop: true, launchAtLogin: false, reducedMotion: false },
  };
}

type LegacySave = Omit<TerrariumState, 'schemaVersion' | 'terrain' | 'care' | 'plants'> & {
  schemaVersion: 1; layers: { material: 'gravel' | 'clay' | 'soil'; depth: number }[];
  plants: Omit<Plant, 'wetness'>[];
};
function legacySave(): LegacySave {
  const { terrain: _terrain, care: _care, plants, schemaVersion: _version, ...state } = populated();
  return {
    ...state, schemaVersion: 1,
    layers: [{ material: 'gravel', depth: 0.2 }, { material: 'clay', depth: 0.25 }, { material: 'soil', depth: 0.5 }],
    plants: plants.map(({ wetness: _wetness, ...legacyPlant }) => legacyPlant),
  };
}

function rejectsState(change: (state: TerrariumState) => void): void {
  const state = populated();
  change(state);
  assert.throws(() => validateState(state));
}

test('validation returns a fully detached schema-valid copy, including empty and mixed columns', () => {
  const input = populated();
  input.terrain.columns[0] = [];
  input.terrain.columns[1] = Array.from({ length: TERRAIN_MAX_HEIGHT }, () => 'coir');
  input.terrain.columns[2] = ['charcoal', 'soil', 'bark', 'gravel', 'coir', 'clay', 'soil'];
  const result = validateState(input);
  assert.deepEqual(result, input);
  assert.notEqual(result, input);
  for (const key of ['terrain', 'care', 'plants', 'decorations', 'environment', 'ecology', 'preferences'] as const) {
    assert.notEqual(result[key], input[key]);
  }
  assert.notEqual(result.terrain.columns, input.terrain.columns);
  for (let index = 0; index < TERRAIN_COLUMNS; index++) assert.notEqual(result.terrain.columns[index], input.terrain.columns[index]);
  assert.notEqual(result.plants[0], input.plants[0]);
  assert.notEqual(result.decorations[0], input.decorations[0]);
});

test('schema-2 imports preserve old and expanded column heights without rescaling or sharing arrays', () => {
  for (const height of [0, 1, 39, 40, 41, 111, 112]) {
    const input = populated();
    input.terrain.columns = Array.from({ length: TERRAIN_COLUMNS }, (_, column) =>
      Array.from({ length: height }, (_, row) => MATERIAL_KINDS[(column + row) % MATERIAL_KINDS.length]));
    const serialized = JSON.stringify(input);
    const validated = validateState(input);
    const imported = migrateSaveState(JSON.parse(serialized));
    assert.deepEqual(validated, input);
    assert.deepEqual(imported, input);
    assert.equal(JSON.stringify(input), serialized);
    for (let column = 0; column < TERRAIN_COLUMNS; column++) {
      assert.equal(imported.terrain.columns[column]!.length, height);
      assert.notEqual(validated.terrain.columns[column], input.terrain.columns[column]);
      assert.notEqual(imported.terrain.columns[column], input.terrain.columns[column]);
      if (column > 0) assert.notEqual(imported.terrain.columns[column], imported.terrain.columns[column - 1]);
    }
    imported.terrain.columns[0]!.pop();
    assert.equal(input.terrain.columns[0]!.length, height);
    assert.equal(validated.terrain.columns[0]!.length, height);
  }
});

test('all published plant and decoration kinds validate', () => {
  const input = populated();
  input.plants = ['cushion-moss', 'sheet-moss', 'fern', 'fittonia'].map((kind, index) => ({
    ...plant(`plant-${index}`), kind: kind as Plant['kind'],
  }));
  input.decorations = ['stone', 'wood'].map((kind, index) => ({
    ...decoration(`decor-${index}`), kind: kind as Decoration['kind'],
  }));
  assert.deepEqual(validateState(input), input);
});

test('null, primitives, arrays and incomplete imports are rejected', () => {
  for (const input of [null, undefined, true, 1, 'save', [], {}, { schemaVersion: 1 }]) {
    assert.throws(() => validateState(input));
  }
});

test('schema version is strict and missing fields are not silently defaulted', () => {
  for (const version of [0, 1, '2', null, NaN]) {
    rejectsState((state) => { (state as unknown as Record<string, unknown>).schemaVersion = version; });
  }
  for (const key of Object.keys(populated())) {
    const input = populated() as unknown as Record<string, unknown>;
    delete input[key];
    assert.throws(() => validateState(input), `missing ${key}`);
  }
});

test('unexpected fields are rejected at every schema depth', () => {
  const paths: ((state: TerrariumState) => object)[] = [
    (state) => state, (state) => state.environment, (state) => state.ecology,
    (state) => state.preferences, (state) => state.terrain, (state) => state.care,
    (state) => state.plants[0]!, (state) => state.decorations[0]!,
  ];
  for (const path of paths) {
    rejectsState((state) => { Object.assign(path(state), { execute: 'untrusted import' }); });
  }
  const imported = JSON.parse(JSON.stringify(populated()).replace('"schemaVersion":2', '"schemaVersion":2,"__proto__":{"polluted":true}')) as unknown;
  assert.throws(() => validateState(imported));
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
});

test('custom prototypes and accessor properties are rejected without invoking getters', () => {
  const input = populated();
  assert.throws(() => validateState(Object.assign(Object.create({ inherited: true }) as object, input)));
  let calls = 0;
  const accessor = clone(input);
  Object.defineProperty(accessor, 'name', { enumerable: true, get() { calls += 1; return 'unsafe'; } });
  assert.throws(() => validateState(accessor));
  assert.equal(calls, 0);
  const nestedAccessor = clone(input);
  Object.defineProperty(nestedAccessor.environment, 'light', { enumerable: true, get() { calls += 1; return 0.5; } });
  assert.throws(() => validateState(nestedAccessor));
  assert.equal(calls, 0);
});

test('hidden and symbol fields cannot bypass state or action allowlists', () => {
  for (const symbol of [false, true]) {
    const state = populated();
    Object.defineProperty(state, symbol ? Symbol('execute') : 'execute', { value: 'unsafe', enumerable: symbol });
    assert.throws(() => validateState(state));
    const action = { type: 'starter' };
    Object.defineProperty(action, symbol ? Symbol('execute') : 'execute', { value: 'unsafe', enumerable: symbol });
    assert.throws(() => applyAction(populated(), action, NOW));
    const preferences = { reducedMotion: true };
    Object.defineProperty(preferences, symbol ? Symbol('execute') : 'execute', { value: 'unsafe', enumerable: symbol });
    assert.throws(() => applyAction(populated(), { type: 'preferences', value: preferences }, NOW));
  }
  const hiddenRequired = populated();
  Object.defineProperty(hiddenRequired, 'name', { value: 'Hidden', enumerable: false });
  assert.throws(() => validateState(hiddenRequired));
});

test('array entry accessors and modified array prototypes are rejected without execution', () => {
  let calls = 0;
  for (const key of ['plants', 'decorations'] as const) {
    const state = populated();
    Object.defineProperty(state[key], '0', { enumerable: true, get() { calls += 1; throw new Error('getter executed'); } });
    assert.throws(() => validateState(state), /Invalid/);
    assert.equal(calls, 0);
    const extra = populated();
    Object.defineProperty(extra[key], 'execute', { value: 'unsafe', enumerable: true });
    assert.throws(() => validateState(extra));
    const inherited = populated();
    Object.setPrototypeOf(inherited[key], Object.create(Array.prototype) as object);
    assert.throws(() => validateState(inherited));
  }
  const nested = populated();
  Object.setPrototypeOf(nested.plants[0]!, { inherited: true });
  assert.throws(() => validateState(nested));
  for (const column of [false, true]) {
    const input = populated();
    const collection = column ? input.terrain.columns[0]! : input.terrain.columns;
    Object.defineProperty(collection, '0', { enumerable: true, get() { calls += 1; throw new Error('getter executed'); } });
    assert.throws(() => validateState(input), /Invalid/);
    assert.equal(calls, 0);
    const extra = populated();
    Object.assign(column ? extra.terrain.columns[0]! : extra.terrain.columns, { execute: 'unsafe' });
    assert.throws(() => validateState(extra));
    const inherited = populated();
    Object.setPrototypeOf(column ? inherited.terrain.columns[0]! : inherited.terrain.columns, Object.create(Array.prototype) as object);
    assert.throws(() => validateState(inherited));
  }
});

test('enum and boolean fields reject lookalikes', () => {
  for (const change of [
    (state: TerrariumState) => { state.bottle = 'triangle' as TerrariumState['bottle']; },
    (state: TerrariumState) => { state.speed = 24 as TerrariumState['speed']; },
    (state: TerrariumState) => { state.plants[0]!.kind = 'mushroom' as Plant['kind']; },
    (state: TerrariumState) => { state.decorations[0]!.kind = 'logo' as Decoration['kind']; },
    (state: TerrariumState) => { state.preferences.widgetSize = 'huge' as TerrariumState['preferences']['widgetSize']; },
  ]) rejectsState(change);
  for (const key of ['closed', 'paused', 'vacation'] as const) {
    rejectsState((state) => { (state as unknown as Record<string, unknown>)[key] = 'true'; });
  }
  for (const key of ['alwaysOnTop', 'launchAtLogin', 'reducedMotion'] as const) {
    rejectsState((state) => { (state.preferences as unknown as Record<string, unknown>)[key] = 1; });
  }
});

test('terrain requires exactly 48 dense bounded material columns while preserving arbitrary six-material order', () => {
  for (const materials of [MATERIAL_KINDS, [...MATERIAL_KINDS].reverse()]) {
    const input = populated();
    input.terrain.columns[0] = [...materials];
    assert.deepEqual(validateState(input), input);
  }
  rejectsState((state) => { state.terrain.columns.pop(); });
  rejectsState((state) => { state.terrain.columns.push([]); });
  rejectsState((state) => { state.terrain.columns[0]!.push('sand' as MaterialKind); });
  rejectsState((state) => { state.terrain.columns[1] = Array.from({ length: TERRAIN_MAX_HEIGHT + 1 }, () => 'soil'); });
  rejectsState((state) => { delete state.terrain.columns[0]; });
  rejectsState((state) => { delete state.terrain.columns[0]![0]; });
  rejectsState((state) => { state.terrain.columns[0] = 'soil' as unknown as MaterialKind[]; });
  rejectsState((state) => { state.terrain.columns = {} as MaterialKind[][]; });
  rejectsState((state) => { state.terrain = [] as unknown as TerrariumState['terrain']; });
});

test('every numeric field rejects NaN, infinity and numeric strings', () => {
  const locations: ((state: TerrariumState, value: number) => void)[] = [
    (state, value) => { state.createdAt = value; }, (state, value) => { state.updatedAt = value; },
    (state, value) => { state.environment.temperature = value; }, (state, value) => { state.environment.light = value; },
    (state, value) => { state.ecology.moisture = value; }, (state, value) => { state.ecology.humidity = value; },
    (state, value) => { state.ecology.waterReserve = value; }, (state, value) => { state.ecology.simulatedDays = value; },
    (state, value) => { state.care.sunlight = value; },
    ...['x', 'y', 'scale', 'growth', 'health', 'ageDays', 'wetness'].map((key) => (state: TerrariumState, value: number) => {
      (state.plants[0] as unknown as Record<string, unknown>)[key] = value;
    }),
    ...['x', 'y', 'scale'].map((key) => (state: TerrariumState, value: number) => {
      (state.decorations[0] as unknown as Record<string, unknown>)[key] = value;
    }),
  ];
  for (const set of locations) {
    for (const value of [NaN, Infinity, -Infinity, '0.5' as unknown as number]) rejectsState((state) => set(state, value));
  }
});

test('state numeric ranges enforce both endpoints', () => {
  for (const key of ['x', 'y', 'growth', 'wetness'] as const) {
    rejectsState((state) => { state.plants[0]![key] = -0.001; });
    rejectsState((state) => { state.plants[0]![key] = 1.001; });
  }
  for (const key of ['x', 'y'] as const) {
    rejectsState((state) => { state.decorations[0]![key] = -0.001; });
    rejectsState((state) => { state.decorations[0]![key] = 1.001; });
  }
  for (const key of ['moisture', 'humidity', 'waterReserve'] as const) {
    rejectsState((state) => { state.ecology[key] = -0.001; });
    rejectsState((state) => { state.ecology[key] = 1.001; });
  }
  rejectsState((state) => { state.care.sunlight = -0.001; });
  rejectsState((state) => { state.care.sunlight = 1.001; });
  for (const target of ['plants', 'decorations'] as const) {
    rejectsState((state) => { state[target][0]!.scale = 0.399; });
    rejectsState((state) => { state[target][0]!.scale = 2.001; });
  }
  rejectsState((state) => { state.plants[0]!.health = MIN_HEALTH - 0.001; });
  rejectsState((state) => { state.plants[0]!.health = 1.001; });
  rejectsState((state) => { state.environment.temperature = 9.999; });
  rejectsState((state) => { state.environment.temperature = 35.001; });
  rejectsState((state) => { state.environment.light = -0.001; });
  rejectsState((state) => { state.environment.light = 1.001; });
  for (const value of [-0.001, 1_000_000_001]) {
    rejectsState((state) => { state.plants[0]!.ageDays = value; });
    rejectsState((state) => { state.ecology.simulatedDays = value; });
  }
  for (const value of [-1, 1.5, 8_640_000_000_000_001, Number.MAX_SAFE_INTEGER + 1]) {
    rejectsState((state) => { state.createdAt = value; });
    rejectsState((state) => { state.updatedAt = value; });
  }
});

test('names and IDs have bounded lengths and reject controls and invalid identifier characters', () => {
  const valid = populated();
  valid.name = '瓶中森 · Mosslight';
  valid.plants[0]!.id = 'A_1-valid-id';
  assert.deepEqual(validateState(valid), valid);
  for (const name of ['', ' '.repeat(10), 'a'.repeat(81), 'terrarium\nexecute', 'terrarium\u0000', 'terrarium\u0085']) {
    rejectsState((state) => { state.name = name; });
  }
  for (const id of ['', 'x'.repeat(81), 'contains space', '../escape', '植株', 'id\u0000']) {
    rejectsState((state) => { state.plants[0]!.id = id; });
    rejectsState((state) => { state.decorations[0]!.id = id; });
  }
});

test('names are trimmed and chronological timestamps remain logically valid', () => {
  const state = populated();
  state.name = '  A little forest  ';
  assert.equal(validateState(state).name, 'A little forest');
  assert.equal(applyAction(state, { type: 'rename', name: '  Mosslight  ' }, NOW).name, 'Mosslight');
  rejectsState((input) => { input.updatedAt = input.createdAt - 1; });
  const upperBoundary = populated();
  upperBoundary.createdAt = 8_640_000_000_000_000;
  upperBoundary.updatedAt = upperBoundary.createdAt;
  assert.deepEqual(validateState(upperBoundary), upperBoundary);
});

test('IDs are globally unique, including across plants and decorations', () => {
  rejectsState((state) => { state.plants.push(plant(state.plants[0]!.id)); });
  rejectsState((state) => { state.decorations.push(decoration(state.decorations[0]!.id)); });
  rejectsState((state) => { state.decorations[0]!.id = state.plants[0]!.id; });
});

test('capacity boundaries and sparse/non-array collections are strictly validated', () => {
  assert.equal(MAX_PLANTS, 24);
  assert.equal(MAX_DECORATIONS, 20);
  const atCapacity = populated();
  atCapacity.plants = Array.from({ length: MAX_PLANTS }, (_, index) => plant(`plant-${index}`));
  atCapacity.decorations = Array.from({ length: MAX_DECORATIONS }, (_, index) => decoration(`decor-${index}`));
  assert.deepEqual(validateState(atCapacity), atCapacity);
  rejectsState((state) => { state.plants = Array.from({ length: MAX_PLANTS + 1 }, (_, index) => plant(`plant-${index}`)); });
  rejectsState((state) => { state.decorations = Array.from({ length: MAX_DECORATIONS + 1 }, (_, index) => decoration(`decor-${index}`)); });
  rejectsState((state) => { state.plants = new Array<Plant>(2); });
  rejectsState((state) => { state.decorations = new Array<Decoration>(2); });
  rejectsState((state) => { state.plants = {} as Plant[]; });
  rejectsState((state) => { state.decorations = null as unknown as Decoration[]; });
});

test('malicious JSON imports and action pollution do not modify the live state', () => {
  const live = populated();
  const before = clone(live);
  const imported = JSON.parse('{"schemaVersion":1,"constructor":{"prototype":{"polluted":true}}}') as unknown;
  assert.throws(() => validateState(imported));
  assert.throws(() => applyAction(live, JSON.parse('{"type":"preferences","value":{"__proto__":{"polluted":true}}}'), NOW));
  assert.deepEqual(live, before);
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
});

test('invalid and oversized actions fail closed with no state mutation', () => {
  const state = populated();
  const before = clone(state);
  const actions: unknown[] = [
    null, undefined, [], {}, 'starter', { type: 'import', state },
    { type: 'starter', extra: true }, { type: 'reset', extra: true },
    { type: 'rename', name: '' }, { type: 'rename', name: 'a'.repeat(81) }, { type: 'rename', name: 'bad\nname' },
    { type: 'bottle', shape: 'triangle' }, { type: 'layer', material: 'sand', depth: 0.2 },
    { type: 'layer', material: 'soil', depth: -0.1 }, { type: 'layer', material: 'soil', depth: 1.1 },
    { type: 'layer', material: 'soil', depth: 0.5 },
    { type: 'pour', material: 'sand', x: 0.5, amount: 1 },
    { type: 'pour', material: 'soil', x: -0.001, amount: 1 },
    { type: 'pour', material: 'soil', x: 0.5, amount: 1.5 },
    { type: 'pour', material: 'soil', x: 0.5, amount: 0 },
    { type: 'scoop', x: 1.001, amount: 8 }, { type: 'scoop', x: 0.5, amount: 33 },
    { type: 'spray', amount: 0.01 }, { type: 'spray', plantId: '../escape', amount: 0.01 },
    { type: 'spray', plantId: null, amount: 0.025001 }, { type: 'spray', plantId: null, amount: -0.001 },
    { type: 'spray', plantId: null, amount: Infinity }, { type: 'sunlight', amount: 1 },
    { type: 'add-plant', kind: 'fern', x: -0.001, y: 0.5 },
    { type: 'add-plant', kind: 'mushroom', x: 0.5, y: 0.5 },
    { type: 'add-plant', kind: 'fern', x: 0.5, y: Infinity },
    { type: 'move-plant', id: 'plant-1', x: 0.5, y: 1.001 },
    { type: 'move-plant', id: '../escape', x: 0.5, y: 0.5 },
    { type: 'remove-plant', id: '' },
    { type: 'add-decoration', kind: 'logo', x: 0.5, y: 0.5 },
    { type: 'add-decoration', kind: 'stone', x: 0.5, y: -0.001 },
    { type: 'move-decoration', id: 'decoration-1', x: NaN, y: 0.5 },
    { type: 'remove-decoration', id: 'x'.repeat(81) },
    { type: 'water', amount: -0.001 }, { type: 'water', amount: 0.201 }, { type: 'water', amount: NaN },
    { type: 'lid', closed: 'true' }, { type: 'environment', temperature: 9, light: 0.5 },
    { type: 'environment', temperature: 22, light: 1.01 }, { type: 'speed', speed: 24 },
    { type: 'pause', paused: 1 }, { type: 'vacation', enabled: 'yes' },
    { type: 'preferences', value: { widgetSize: 'huge' } },
    { type: 'preferences', value: { alwaysOnTop: 1 } },
    { type: 'preferences', value: { reducedMotion: false, execute: 'unsafe' } },
    { type: 'preferences', value: null },
  ];
  for (const action of actions) {
    assert.throws(() => applyAction(state, action, NOW + 1), `invalid action ${JSON.stringify(action)}`);
    assert.deepEqual(state, before);
  }
});

test('action accessors and inherited records are rejected without invoking getters', () => {
  const state = populated();
  let calls = 0;
  const action = { type: 'water' };
  Object.defineProperty(action, 'amount', { enumerable: true, get() { calls += 1; return 0.1; } });
  assert.throws(() => applyAction(state, action, NOW));
  assert.equal(calls, 0);
  const nested = { type: 'preferences', value: {} };
  Object.defineProperty(nested.value, 'alwaysOnTop', { enumerable: true, get() { calls += 1; return true; } });
  assert.throws(() => applyAction(state, nested, NOW));
  assert.equal(calls, 0);
  assert.throws(() => applyAction(state, Object.assign(Object.create({ inherited: true }) as object, { type: 'starter' }), NOW));
});

test('unknown extra fields are rejected for every action shape', () => {
  const actions = [
    { type: 'rename', name: 'Valid' }, { type: 'bottle', shape: 'round' },
    { type: 'glass-form', value: { lower: 1, middle: 1, upper: 1, facets: 8 } },
    { type: 'pour', material: 'soil', x: 0, amount: 1 }, { type: 'scoop', x: 1, amount: 8 },
    { type: 'spray', plantId: null, amount: 0 }, { type: 'sunlight' },
    { type: 'add-plant', kind: 'fern', x: 0, y: 1 },
    { type: 'move-plant', id: 'plant-1', x: 0, y: 1 }, { type: 'remove-plant', id: 'plant-1' },
    { type: 'add-decoration', kind: 'wood', x: 0, y: 1 },
    { type: 'move-decoration', id: 'decoration-1', x: 0, y: 1 }, { type: 'remove-decoration', id: 'decoration-1' },
    { type: 'water', amount: 0 }, { type: 'lid', closed: false },
    { type: 'environment', temperature: 35, light: 1 }, { type: 'speed', speed: 10 },
    { type: 'pause', paused: true }, { type: 'vacation', enabled: true },
    { type: 'preferences', value: { reducedMotion: true } }, { type: 'starter' }, { type: 'reset' },
  ];
  for (const action of actions) assert.throws(() => applyAction(populated(), { ...action, execute: 'unsafe' }, NOW));
});

test('all bottle kinds validate and permanently open bottles cannot be saved closed', () => {
  for (const bottle of BOTTLE_SHAPES) {
    const state = populated();
    state.bottle = bottle;
    state.closed = false;
    assert.deepEqual(validateState(state), state);
    assert.deepEqual(validateAction({ type: 'bottle', shape: bottle }), { type: 'bottle', shape: bottle });
    state.closed = true;
    if (bottle === 'open-cylinder' || bottle === 'open-cube') assert.throws(() => validateState(state), /no lid/);
    else assert.deepEqual(validateState(state), state);
  }
});

test('care and wetness are required schema-2 fields and legacy layers are not accepted', () => {
  const noWetness = populated();
  delete (noWetness.plants[0] as unknown as Record<string, unknown>).wetness;
  assert.throws(() => validateState(noWetness));
  const noSunlight = populated();
  delete (noSunlight.care as unknown as Record<string, unknown>).sunlight;
  assert.throws(() => validateState(noSunlight));
  const oldLayers = populated();
  Object.assign(oldLayers, { layers: legacySave().layers });
  assert.throws(() => validateState(oldLayers));
});

test('granular and care action schemas enforce every numeric and identifier boundary', () => {
  for (const material of MATERIAL_KINDS) {
    for (const x of [0, 1]) {
      for (const amount of [1, 8, 24, 32]) {
        const action = { type: 'pour', material, x, amount };
        assert.deepEqual(validateAction(action), action);
        assert.deepEqual(validateAction({ type: 'scoop', x, amount }), { type: 'scoop', x, amount });
      }
    }
  }
  for (const plantId of [null, 'A_1-safe-id']) {
    for (const amount of [0, 0.025]) {
      const action = { type: 'spray', plantId, amount };
      assert.deepEqual(validateAction(action), action);
    }
  }
  assert.deepEqual(validateAction({ type: 'sunlight' }), { type: 'sunlight' });
  for (const invalid of [NaN, Infinity, -Infinity, '1', null, undefined]) {
    for (const type of ['pour', 'scoop']) {
      const action = type === 'pour' ? { type, material: 'soil', x: 0.5, amount: 1 } : { type, x: 0.5, amount: 1 };
      assert.throws(() => validateAction({ ...action, x: invalid }));
      assert.throws(() => validateAction({ ...action, amount: invalid }));
    }
    assert.throws(() => validateAction({ type: 'spray', plantId: null, amount: invalid }));
  }
  for (const amount of [-1, 0, 0.5, 32.1, 33]) {
    assert.throws(() => validateAction({ type: 'pour', material: 'soil', x: 0.5, amount }));
    assert.throws(() => validateAction({ type: 'scoop', x: 0.5, amount }));
  }
  for (const plantId of ['', '../escape', 'id with space', '植株', 'x'.repeat(81), false, {}]) {
    assert.throws(() => validateAction({ type: 'spray', plantId, amount: 0.01 }));
  }
});

test('optional scoop radius is strictly bounded, cloned only when present, and rejects malformed commands', () => {
  const base = { type: 'scoop', x: 0.5, amount: 24 };
  assert.equal(Object.hasOwn(validateAction(base), 'radius'), false);
  for (let radius = 1; radius <= 8; radius++) {
    assert.deepEqual(validateAction({ ...base, radius }), { ...base, radius });
  }
  for (const radius of [undefined, null, NaN, Infinity, -Infinity, '4', 0, -1, 1.1, 8.1, 9, {}, []]) {
    assert.throws(() => validateAction({ ...base, radius }));
  }
  assert.throws(() => validateAction({ ...base, radius: 4, extra: true }));
  assert.throws(() => validateAction({ type: 'scoop', radius: 4, amount: 24 }));
  assert.throws(() => validateAction({ type: 'pour', x: 0.5, amount: 8, material: 'soil', radius: 4 }));
  let calls = 0;
  const accessor = { ...base };
  Object.defineProperty(accessor, 'radius', { enumerable: true, get() { calls++; return 4; } });
  assert.throws(() => validateAction(accessor));
  assert.equal(calls, 0);
});

test('optional faceted glass form survives schema-2 save roundtrip without changing old saves', () => {
  const old = populated();
  for (const output of [validateState(old), migrateSaveState(old)]) {
    assert.deepEqual(output, old);
    assert.equal(Object.hasOwn(output, 'glassForm'), false);
  }
  for (const facets of [6, 8, 10, 12] as const) {
    const form = { lower: 0.55, middle: 1.25, upper: 0.85, facets };
    for (const bottle of BOTTLE_SHAPES) {
      const state = { ...populated(), bottle, closed: false, glassForm: form };
      const validated = validateState(state);
      assert.deepEqual(validated, state);
      assert.notEqual(validated.glassForm, form);
      assert.deepEqual(migrateSaveState(JSON.parse(JSON.stringify(validated))), state);
    }
    const action = { type: 'glass-form', value: form };
    const validated = validateAction(action);
    assert.deepEqual(validated, action);
    assert.equal(validated.type, 'glass-form');
    if (validated.type === 'glass-form') assert.notEqual(validated.value, form);
  }
  assert.throws(() => migrateSaveState({ ...legacySave(), glassForm: { lower: 1, middle: 1, upper: 1, facets: 8 } }));
});

test('glass form strictly validates exact finite widths and allowed integral facet counts', () => {
  const form = { lower: 1, middle: 1, upper: 1, facets: 8 };
  const reject = (value: unknown): void => {
    assert.throws(() => validateState({ ...populated(), glassForm: value }));
    assert.throws(() => validateAction({ type: 'glass-form', value }));
  };
  for (const value of [undefined, null, [], true, 1, 'form', {}]) reject(value);
  for (const key of ['lower', 'middle', 'upper', 'facets']) {
    const missing: Record<string, number> = { ...form };
    delete missing[key];
    reject(missing);
  }
  reject({ ...form, execute: 'unsafe' });
  for (const key of ['lower', 'middle', 'upper']) {
    for (const value of [NaN, Infinity, -Infinity, '1', null, undefined, 0.54999, 1.25001]) reject({ ...form, [key]: value });
    for (const value of [0.55, 1.25]) {
      assert.deepEqual(validateAction({ type: 'glass-form', value: { ...form, [key]: value } }), {
        type: 'glass-form', value: { ...form, [key]: value },
      });
    }
  }
  for (let facets = 5; facets <= 16; facets++) assert.deepEqual(validateAction({ type: 'glass-form', value: { ...form, facets } }), { type: 'glass-form', value: { ...form, facets } });
  for (const facets of [0, 4, 17, 8.1, NaN, Infinity, '8', undefined, null]) reject({ ...form, facets });
  assert.throws(() => validateAction({ type: 'glass-form' }));
  assert.throws(() => validateAction({ type: 'glass-form', value: form, extra: true }));
});

test('glass form rejects prototype, accessor, hidden and symbol mutations without executing imported code', () => {
  const form = { lower: 1, middle: 1, upper: 1, facets: 8 };
  const reject = (value: unknown): void => {
    assert.throws(() => validateState({ ...populated(), glassForm: value }));
    assert.throws(() => validateAction({ type: 'glass-form', value }));
  };
  reject(Object.assign(Object.create({ inherited: true }) as object, form));
  let calls = 0;
  for (const key of Object.keys(form)) {
    const accessor = { ...form };
    Object.defineProperty(accessor, key, { enumerable: true, get() { calls++; return 1; } });
    reject(accessor);
  }
  for (const key of ['hidden', Symbol('extra')]) {
    const hidden = { ...form };
    Object.defineProperty(hidden, key, { value: true });
    reject(hidden);
  }
  const nested = populated();
  Object.defineProperty(nested, 'glassForm', { enumerable: true, get() { calls++; return form; } });
  assert.throws(() => validateState(nested));
  const action = { type: 'glass-form' };
  Object.defineProperty(action, 'value', { enumerable: true, get() { calls++; return form; } });
  assert.throws(() => validateAction(action));
  assert.equal(calls, 0);
});

test('schema-1 migration preserves complete metadata, order, and independently owned columns', () => {
  const input = legacySave();
  input.ecology.simulatedDays = 12.25;
  input.updatedAt = NOW + 123;
  input.plants[0]!.ageDays = 10.5;
  input.preferences.reducedMotion = true;
  const before = clone(input);
  const migrated = migrateSaveState(input);
  assert.equal(migrated.schemaVersion, 2);
  const { schemaVersion: _version, layers: _layers, plants: _plants, ...originalCommon } = input;
  const { schemaVersion: _newVersion, terrain: _terrain, care: _care, plants: _newPlants, ...migratedCommon } = migrated;
  assert.deepEqual(migratedCommon, originalCommon);
  assert.deepEqual(migrated.plants, input.plants.map((entry) => ({ ...entry, wetness: 0 })));
  assert.deepEqual(migrated.care, { sunlight: 0 });
  const expected: MaterialKind[] = [
    ...Array.from({ length: 4 }, (): MaterialKind => 'gravel'),
    ...Array.from({ length: 5 }, (): MaterialKind => 'clay'),
    ...Array.from({ length: 9 }, (): MaterialKind => 'soil'),
  ];
  assert.equal(migrated.terrain.columns.length, 48);
  for (const column of migrated.terrain.columns) assert.deepEqual(column, expected);
  assert.notEqual(migrated.terrain.columns[0], migrated.terrain.columns[1]);
  migrated.terrain.columns[0]!.push('bark');
  assert.deepEqual(migrated.terrain.columns[1], expected);
  assert.deepEqual(input, before);
  assert.notEqual(migrated.preferences, input.preferences);
  assert.notEqual(migrated.plants[0], input.plants[0]);
  assert.deepEqual(validateState(migrated), migrated);
  assert.throws(() => validateState(input));
});

test('schema-1 terrain migration handles hidden layers, empty soil, tiny rounding and visual height limits deterministically', () => {
  for (const depths of [[0, 0, 0], [0, 1, 1], [1, 1, 1], [0.001, 0, 0.001], [0, 0, 0.5], [0.1, 0.1, 0.1]]) {
    const old = legacySave();
    old.layers.forEach((layer, index) => { layer.depth = depths[index]!; });
    const result = migrateSaveState(old);
    assert.deepEqual(migrateSaveState(old), result);
    const expectedHeight = Math.min(40, Math.round(Math.min(210, depths.reduce((sum, depth) => sum + depth, 0) * 95) / 5));
    for (const column of result.terrain.columns) {
      assert.equal(column.length, expectedHeight);
      let previous = -1;
      for (const material of column) {
        const index = ['gravel', 'clay', 'soil'].indexOf(material);
        assert.ok(index >= previous, 'bottom-to-top layer order must remain intact');
        assert.ok(depths[index]! > 0, 'hidden zero-depth layers must remain absent');
        previous = index;
      }
    }
  }
  const full = legacySave();
  full.layers.forEach((layer) => { layer.depth = 1; });
  const column = migrateSaveState(full).terrain.columns[0]!;
  assert.equal(column.filter((material) => material === 'gravel').length, 14);
  assert.equal(column.filter((material) => material === 'clay').length, 13);
  assert.equal(column.filter((material) => material === 'soil').length, 13);
});

test('schema-1 migration retains strict three-layer and original-three-bottle rules', () => {
  const changes: ((state: LegacySave) => void)[] = [
    (state) => { state.layers.pop(); },
    (state) => { state.layers.push({ material: 'soil', depth: 0.5 }); },
    (state) => { state.layers.reverse(); },
    (state) => { state.layers[0]!.material = 'soil'; },
    (state) => { state.layers[0]!.material = 'coir' as 'soil'; },
    (state) => { state.layers[0]!.depth = -0.001; },
    (state) => { state.layers[1]!.depth = 1.001; },
    (state) => { state.layers[0]!.depth = NaN; },
    (state) => { state.layers[0]!.depth = '0.5' as unknown as number; },
    (state) => { delete state.layers[0]; },
    (state) => { state.bottle = 'open-cylinder'; },
    (state) => { state.bottle = 'open-cube'; },
    (state) => { state.bottle = 'glass-box'; },
    (state) => { state.bottle = 'cat'; },
    (state) => { Object.assign(state.plants[0]!, { wetness: 0 }); },
    (state) => { Object.assign(state, { care: { sunlight: 0 } }); },
    (state) => { Object.assign(state, { terrain: populated().terrain }); },
  ];
  for (const change of changes) {
    const state = legacySave();
    change(state);
    assert.throws(() => migrateSaveState(state));
  }
  for (const bottle of ['round', 'square', 'cylinder'] as const) {
    const input = legacySave();
    input.bottle = bottle;
    assert.equal(migrateSaveState(input).bottle, bottle);
  }
});

test('schema-1 migration rejects missing or extra properties at every old schema depth', () => {
  const paths: ((state: LegacySave) => object)[] = [
    (state) => state, (state) => state.layers[0]!, (state) => state.plants[0]!,
    (state) => state.decorations[0]!, (state) => state.environment,
    (state) => state.ecology, (state) => state.preferences,
  ];
  for (const path of paths) {
    for (const key of Object.keys(path(legacySave()))) {
      const input = legacySave();
      delete (path(input) as Record<string, unknown>)[key];
      assert.throws(() => migrateSaveState(input), `missing legacy ${key}`);
    }
    const input = legacySave();
    Object.assign(path(input), { execute: 'unsafe' });
    assert.throws(() => migrateSaveState(input));
  }
  const polluted = JSON.parse(JSON.stringify(legacySave()).replace('"schemaVersion":1', '"schemaVersion":1,"__proto__":{"polluted":true}')) as unknown;
  assert.throws(() => migrateSaveState(polluted));
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
});

test('schema-1 migration rejects prototypes, accessors, symbols and modified arrays without invoking getters', () => {
  let calls = 0;
  const paths: ((state: LegacySave) => object)[] = [
    (state) => state, (state) => state.layers[0]!, (state) => state.plants[0]!,
    (state) => state.decorations[0]!, (state) => state.environment, (state) => state.ecology, (state) => state.preferences,
  ];
  for (const path of paths) {
    const inherited = legacySave();
    Object.setPrototypeOf(path(inherited), { inherited: true });
    assert.throws(() => migrateSaveState(inherited));
    const accessor = legacySave();
    const key = Object.keys(path(accessor))[0]!;
    Object.defineProperty(path(accessor), key, { enumerable: true, get() { calls += 1; return 1; } });
    assert.throws(() => migrateSaveState(accessor));
    assert.equal(calls, 0);
    for (const key of ['hidden', Symbol('unsafe')]) {
      const modified = legacySave();
      Object.defineProperty(path(modified), key, { value: 'unsafe' });
      assert.throws(() => migrateSaveState(modified));
    }
  }
  for (const key of ['layers', 'plants', 'decorations'] as const) {
    const accessor = legacySave();
    Object.defineProperty(accessor[key], '0', { enumerable: true, get() { calls += 1; return {}; } });
    assert.throws(() => migrateSaveState(accessor));
    assert.equal(calls, 0);
    const sparse = legacySave();
    delete sparse[key][0];
    assert.throws(() => migrateSaveState(sparse));
    const inherited = legacySave();
    Object.setPrototypeOf(inherited[key], Object.create(Array.prototype) as object);
    assert.throws(() => migrateSaveState(inherited));
    const extra = legacySave();
    Object.assign(extra[key], { execute: 'unsafe' });
    assert.throws(() => migrateSaveState(extra));
  }
});

test('schema-1 migration validates original ranges, global IDs, capacities and chronological timestamps before conversion', () => {
  const changes: ((state: LegacySave) => void)[] = [
    (state) => { state.name = 'bad\nname'; }, (state) => { state.name = 'x'.repeat(81); },
    (state) => { state.plants[0]!.id = '../escape'; },
    (state) => { state.plants[0]!.x = -0.001; }, (state) => { state.plants[0]!.y = 1.001; },
    (state) => { state.plants[0]!.scale = 0.399; }, (state) => { state.plants[0]!.growth = 1.001; },
    (state) => { state.plants[0]!.health = MIN_HEALTH - 0.001; }, (state) => { state.plants[0]!.ageDays = 1_000_000_001; },
    (state) => { state.plants[0]!.kind = 'unknown' as Plant['kind']; },
    (state) => { state.decorations[0]!.id = state.plants[0]!.id; },
    (state) => { state.decorations[0]!.x = NaN; }, (state) => { state.decorations[0]!.scale = 2.001; },
    (state) => { state.environment.temperature = 35.001; }, (state) => { state.environment.light = -0.001; },
    (state) => { state.ecology.moisture = 1.001; }, (state) => { state.ecology.humidity = Infinity; },
    (state) => { state.ecology.waterReserve = -0.001; }, (state) => { state.ecology.simulatedDays = 1_000_000_001; },
    (state) => { state.speed = 24 as TerrariumState['speed']; }, (state) => { state.closed = 'true' as unknown as boolean; },
    (state) => { state.createdAt = -1; }, (state) => { state.updatedAt = state.createdAt - 1; },
    (state) => { state.updatedAt = 1.5; }, (state) => { state.updatedAt = 8_640_000_000_000_001; },
    (state) => { state.preferences.alwaysOnTop = 1 as unknown as boolean; },
    (state) => { state.plants = Array.from({ length: 25 }, (_, index) => ({ ...state.plants[0]!, id: `plant-${index}` })); },
    (state) => { state.decorations = Array.from({ length: 21 }, (_, index) => decoration(`decor-${index}`)); },
  ];
  for (const change of changes) {
    const input = legacySave();
    change(input);
    assert.throws(() => migrateSaveState(input));
  }
});

test('migrateSaveState strictly clones schema-2 and rejects unsupported or malformed version dispatch', () => {
  const input = populated();
  const output = migrateSaveState(input);
  assert.deepEqual(output, input);
  assert.notEqual(output, input);
  assert.notEqual(output.terrain.columns[0], input.terrain.columns[0]);
  for (const version of [0, 3, '1', '2', null, undefined, NaN]) {
    assert.throws(() => migrateSaveState({ ...legacySave(), schemaVersion: version }));
  }
  for (const input of [null, undefined, true, 1, 'save', [], {}, { schemaVersion: 1 }, { schemaVersion: 2 }]) {
    assert.throws(() => migrateSaveState(input));
  }
  const malformed = populated();
  malformed.plants[0]!.wetness = 2;
  assert.throws(() => migrateSaveState(malformed));
});
