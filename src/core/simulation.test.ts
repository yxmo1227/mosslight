import assert from 'node:assert/strict';
import test from 'node:test';
import type { MaterialKind, TerrariumState } from '../shared/types';
import { BOTTLE_SHAPES, MATERIAL_KINDS, TERRAIN_COLUMNS, TERRAIN_MAX_HEIGHT } from '../shared/catalog';
import { advanceSimulation, applyAction, createInitialState, WATER_VAPOR_CAPACITY } from './simulation';
import { MAX_DECORATIONS, MAX_PLANTS, MIN_HEALTH, validateState } from './validation';

const NOW = 1_789_689_600_000;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const clone = <T>(value: T): T => structuredClone(value);

function close(actual: number, expected: number, tolerance = 1e-9): void {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not within ${tolerance} of ${expected}`);
}

function waterInventory(state: TerrariumState): number {
  return state.ecology.moisture + state.ecology.humidity * WATER_VAPOR_CAPACITY + state.ecology.waterReserve;
}

function started(): TerrariumState {
  return applyAction(createInitialState(NOW), { type: 'starter' }, NOW);
}

function freezeDeep<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const nested of Object.values(value)) freezeDeep(nested);
    Object.freeze(value);
  }
  return value;
}

function assertFiniteTree(input: unknown): void {
  if (typeof input === 'number') assert.ok(Number.isFinite(input), 'every numeric result must remain finite');
  else if (input !== null && typeof input === 'object') for (const value of Object.values(input)) assertFiniteTree(value);
}

test('a new schema-2 terrarium is an empty bottle with thin uniform granular terrain and moisture', () => {
  const state = createInitialState(NOW);
  assert.equal(state.schemaVersion, 2);
  assert.equal(state.name, 'My Little Forest');
  assert.equal(state.preferences.alwaysOnTop, true);
  assert.deepEqual(state.plants, []);
  assert.deepEqual(state.decorations, []);
  assert.equal(state.terrain.columns.length, TERRAIN_COLUMNS);
  const expected: MaterialKind[] = ['gravel', 'gravel', 'clay', ...Array<MaterialKind>(7).fill('soil')];
  for (const column of state.terrain.columns) assert.deepEqual(column, expected);
  assert.deepEqual(state.care, { sunlight: 0 });
  close(state.ecology.moisture, 0.55, 0.03);
  close(state.ecology.humidity, 0.65, 0.03);
  assert.equal(state.ecology.simulatedDays, 0);
  assert.equal(state.speed, 1);
  assert.equal(state.paused, false);
  assert.equal(state.createdAt, NOW);
  assert.equal(state.updatedAt, NOW);
  assert.deepEqual(validateState(state), state);
  const second = createInitialState(NOW);
  assert.notEqual(state.terrain, second.terrain);
  assert.notEqual(state.terrain.columns, second.terrain.columns);
  assert.notEqual(state.terrain.columns[0], state.terrain.columns[1]);
  assert.notEqual(state.terrain.columns[0], second.terrain.columns[0]);
  assert.notEqual(state.care, second.care);
  assert.notEqual(state.preferences, second.preferences);
});

test('the default online clock advances 4 real hours to 4 ecological days', () => {
  const state = started();
  const result = advanceSimulation(state, 4 * HOUR, 'online', NOW + 4 * HOUR);
  close(result.ecology.simulatedDays, 4);
  assert.equal(result.updatedAt, NOW + 4 * HOUR);
  for (let index = 0; index < state.plants.length; index += 1) {
    close(result.plants[index]!.ageDays - state.plants[index]!.ageDays, 4);
  }
});

test('online speed is relative to 24x and offline time always remains 1x', () => {
  for (const speed of [1, 2, 5, 10] as const) {
    const state = applyAction(started(), { type: 'speed', speed }, NOW);
    close(advanceSimulation(state, HOUR, 'online', NOW + HOUR).ecology.simulatedDays, speed);
    close(advanceSimulation(state, 8 * HOUR, 'offline', NOW + 8 * HOUR).ecology.simulatedDays, 1 / 3);
  }
});

test('pause leaves ecology and plant metrics unchanged while refreshing the timestamp', () => {
  const state = applyAction(started(), { type: 'pause', paused: true }, NOW);
  for (const mode of ['online', 'offline'] as const) {
    const result = advanceSimulation(state, 30 * DAY, mode, NOW + DAY);
    assert.deepEqual(result.ecology, state.ecology);
    assert.deepEqual(result.plants, state.plants);
    assert.equal(result.updatedAt, NOW + DAY);
    assert.notEqual(result, state);
  }
  const resumed = applyAction(state, { type: 'pause', paused: false }, NOW + DAY);
  assert.ok(advanceSimulation(resumed, HOUR, 'online', NOW + DAY + HOUR).ecology.simulatedDays > 0);
});

test('zero elapsed time refreshes time without ecological change, and clock regressions do not rewind', () => {
  const state = started();
  const result = advanceSimulation(state, 0, 'online', NOW + 1);
  assert.deepEqual(result.ecology, state.ecology);
  assert.deepEqual(result.plants, state.plants);
  assert.equal(result.updatedAt, NOW + 1);
  const regressed = advanceSimulation(result, 0, 'offline', NOW - 1);
  assert.equal(regressed.updatedAt, NOW + 1);
  assert.equal(applyAction(result, { type: 'lid', closed: false }, NOW - 1).updatedAt, NOW + 1);
});

test('starter supplies a small original planting and decoration set with globally unique IDs', () => {
  const state = started();
  assert.ok(state.plants.length > 0 && state.plants.length < MAX_PLANTS);
  assert.ok(state.decorations.length > 0 && state.decorations.length < MAX_DECORATIONS);
  assert.ok(state.plants.some((plant) => plant.kind === 'cushion-moss' || plant.kind === 'sheet-moss'));
  assert.ok(state.plants.some((plant) => plant.kind === 'fern'));
  assert.ok(state.plants.some((plant) => plant.kind === 'fittonia'));
  assert.ok(state.plants.every((plant) => plant.wetness === 0));
  assert.ok(state.decorations.some((item) => item.kind === 'stone'));
  assert.ok(state.decorations.some((item) => item.kind === 'wood'));
  const ids = [...state.plants, ...state.decorations].map((item) => item.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(validateState(state), state);
});

test('starter is idempotent and retains the existing user planting', () => {
  const empty = applyAction(createInitialState(NOW), { type: 'pour', material: 'bark', x: 0.8, amount: 1 }, NOW);
  const userPlanted = applyAction(empty, { type: 'add-plant', kind: 'fern', x: 0.12, y: 0.86 }, NOW);
  const userDecorated = applyAction(userPlanted, { type: 'add-decoration', kind: 'stone', x: 0.91, y: 0.24 }, NOW);
  const first = applyAction(userDecorated, { type: 'starter' }, NOW);
  const repeated = applyAction(first, { type: 'starter' }, NOW);
  assert.deepEqual(repeated, first);
  assert.deepEqual(first.terrain, userDecorated.terrain);
  assert.deepEqual(first.plants.find((plant) => plant.id === userDecorated.plants[0]!.id), userDecorated.plants[0]);
  assert.deepEqual(first.decorations.find((item) => item.id === userDecorated.decorations[0]!.id), userDecorated.decorations[0]);
});

test('starter fills only available capacity and never discards user objects to make room', () => {
  let state = createInitialState(NOW);
  for (let index = 0; index < MAX_PLANTS - 1; index += 1) state = applyAction(state, { type: 'add-plant', kind: 'fern', x: 0.5, y: 0.5 }, NOW);
  for (let index = 0; index < MAX_DECORATIONS - 1; index += 1) state = applyAction(state, { type: 'add-decoration', kind: 'stone', x: 0.5, y: 0.5 }, NOW);
  const before = clone(state);
  const filled = applyAction(state, { type: 'starter' }, NOW);
  assert.equal(filled.plants.length, MAX_PLANTS);
  assert.equal(filled.decorations.length, MAX_DECORATIONS);
  assert.deepEqual(filled.plants.slice(0, before.plants.length), before.plants);
  assert.deepEqual(filled.decorations.slice(0, before.decorations.length), before.decorations);
  assert.deepEqual(applyAction(filled, { type: 'starter' }, NOW), filled);
  assert.deepEqual(state, before);
  assert.deepEqual(filled.terrain, before.terrain);
  assert.deepEqual(validateState(filled), filled);
});

test('plant and decoration editing uses validated bottle-plane coordinates', () => {
  const empty = createInitialState(NOW);
  const planted = applyAction(empty, { type: 'add-plant', kind: 'fern', x: 0, y: 1 }, NOW + 1);
  const plant = planted.plants[0]!;
  assert.equal(plant.x, 0);
  assert.equal(plant.y, 1);
  const moved = applyAction(planted, { type: 'move-plant', id: plant.id, x: 1, y: 0 }, NOW + 2);
  assert.equal(moved.plants[0]!.x, 1);
  assert.equal(moved.plants[0]!.y, 0);
  assert.deepEqual(applyAction(moved, { type: 'remove-plant', id: plant.id }, NOW + 3).plants, []);
  const decorated = applyAction(empty, { type: 'add-decoration', kind: 'wood', x: 1, y: 0 }, NOW + 1);
  const item = decorated.decorations[0]!;
  const decorationMoved = applyAction(decorated, { type: 'move-decoration', id: item.id, x: 0, y: 1 }, NOW + 2);
  assert.equal(decorationMoved.decorations[0]!.x, 0);
  assert.equal(decorationMoved.decorations[0]!.y, 1);
  assert.deepEqual(applyAction(decorationMoved, { type: 'remove-decoration', id: item.id }, NOW + 3).decorations, []);
});

test('the remaining UI actions update only their intended state and preserve untouched settings', () => {
  let state = createInitialState(NOW);
  state = applyAction(state, { type: 'rename', name: 'My little forest' }, NOW + 1);
  assert.equal(state.name, 'My little forest');
  state = applyAction(state, { type: 'bottle', shape: 'square' }, NOW + 2);
  assert.equal(state.bottle, 'square');
  const terrainBefore = clone(state.terrain);
  state = applyAction(state, { type: 'pour', material: 'clay', x: 0.5, amount: 1 }, NOW + 3);
  assert.notDeepEqual(state.terrain, terrainBefore);
  assert.equal(state.terrain.columns.length, TERRAIN_COLUMNS);
  state = applyAction(state, { type: 'environment', temperature: 10, light: 0 }, NOW + 4);
  assert.deepEqual(state.environment, { temperature: 10, light: 0 });
  state = applyAction(state, { type: 'lid', closed: false }, NOW + 5);
  assert.equal(state.closed, false);
  state = applyAction(state, { type: 'vacation', enabled: true }, NOW + 6);
  assert.equal(state.vacation, true);
  const previous = clone(state.preferences);
  state = applyAction(state, { type: 'preferences', value: { widgetSize: 'large', reducedMotion: true } }, NOW + 7);
  assert.deepEqual(state.preferences, { ...previous, widgetSize: 'large', reducedMotion: true });
  assert.deepEqual(validateState(state), state);
});

test('reset really removes the planting and restores ecology, while retaining preferences', () => {
  let state = started();
  state = applyAction(state, { type: 'preferences', value: { widgetSize: 'large', alwaysOnTop: false, launchAtLogin: true, reducedMotion: true } }, NOW);
  state = applyAction(state, { type: 'environment', temperature: 35, light: 0 }, NOW);
  state = advanceSimulation(state, DAY, 'online', NOW + DAY);
  const reset = applyAction(state, { type: 'reset' }, NOW + DAY + 1);
  assert.deepEqual(reset.plants, []);
  assert.deepEqual(reset.decorations, []);
  assert.equal(reset.ecology.simulatedDays, 0);
  assert.deepEqual(reset.preferences, state.preferences);
  assert.notEqual(reset.preferences, state.preferences);
  assert.equal(reset.terrain.columns.length, 48);
  assert(reset.terrain.columns.every(column => column.length === 0));
  assert.equal(reset.pond, undefined);
  assert.deepEqual(reset.care, { sunlight: 0 });
  close(reset.ecology.moisture, 0.55, 0.03);
});

test('growth never exceeds maturity and poor conditions never permanently kill plants', () => {
  const state = started();
  state.closed = false;
  state.environment = { temperature: 35, light: 0 };
  state.ecology.moisture = 0;
  state.ecology.humidity = 0;
  state.ecology.waterReserve = 0;
  for (const plant of state.plants) { plant.growth = 0.99; plant.health = MIN_HEALTH; }
  const result = advanceSimulation(state, 365 * DAY, 'offline', NOW + 365 * DAY);
  assert.equal(result.plants.length, state.plants.length);
  for (const plant of result.plants) {
    assert.ok(plant.growth >= 0 && plant.growth <= 1);
    assert.ok(plant.health >= MIN_HEALTH && plant.health <= 1);
  }
  const healthy = started();
  for (const plant of healthy.plants) plant.growth = 1;
  const mature = advanceSimulation(healthy, 90 * DAY, 'offline', NOW + 90 * DAY);
  for (const plant of mature.plants) assert.ok(plant.growth <= 1);
  assertFiniteTree(result);
  assertFiniteTree(mature);
});

test('healthy conditions allow stressed plants to recover rather than remaining dead', () => {
  const state = started();
  state.closed = true;
  state.environment = { temperature: 22, light: 0.65 };
  state.ecology = { ...state.ecology, moisture: 0.55, humidity: 0.65, waterReserve: 0.5 };
  for (const plant of state.plants) plant.health = MIN_HEALTH;
  const recovered = advanceSimulation(state, 7 * DAY, 'offline', NOW + 7 * DAY);
  assert.ok(recovered.plants.every((plant) => plant.health > MIN_HEALTH));
});

test('temperature, lighting and water conditions materially affect growth', () => {
  const favorable = started();
  favorable.closed = true;
  favorable.environment = { temperature: 22, light: 0.65 };
  favorable.ecology = { ...favorable.ecology, moisture: 0.55, humidity: 0.65, waterReserve: 0.35 };
  const dark = clone(favorable);
  dark.environment.light = 0;
  const hot = clone(favorable);
  hot.environment.temperature = 35;
  const dry = clone(favorable);
  dry.ecology.moisture = 0;
  dry.ecology.humidity = 0;
  dry.ecology.waterReserve = 0;
  const simulate = (state: TerrariumState): number => advanceSimulation(state, 7 * DAY, 'offline', NOW + 7 * DAY).plants.reduce((total, plant) => total + plant.growth, 0);
  const controlGrowth = simulate(favorable);
  assert.ok(controlGrowth > simulate(dark), 'light must affect growth');
  assert.ok(controlGrowth > simulate(hot), 'temperature must affect growth');
  assert.ok(controlGrowth > simulate(dry), 'water must affect growth');
});

test('soil support and stored water influence growth or soil recharge', () => {
  const supported = started();
  supported.closed = true;
  const withoutSoil = clone(supported);
  withoutSoil.terrain.columns = withoutSoil.terrain.columns.map((column) => column.filter((material) => material !== 'soil'));
  const full = advanceSimulation(supported, 7 * DAY, 'offline', NOW + 7 * DAY);
  const thin = advanceSimulation(withoutSoil, 7 * DAY, 'offline', NOW + 7 * DAY);
  assert.notDeepEqual(full.plants.map((plant) => [plant.growth, plant.health]), thin.plants.map((plant) => [plant.growth, plant.health]));
  const reserve = started();
  reserve.closed = true;
  reserve.ecology.moisture = 0.05;
  reserve.ecology.humidity = 0.05;
  reserve.ecology.waterReserve = 0.6;
  const emptyReserve = clone(reserve);
  emptyReserve.ecology.waterReserve = 0;
  assert.ok(advanceSimulation(reserve, DAY, 'offline', NOW + DAY).ecology.moisture > advanceSimulation(emptyReserve, DAY, 'offline', NOW + DAY).ecology.moisture);
});

test('a closed bottle conserves its fixed water inventory while an open one loses water', () => {
  const closed = started();
  closed.closed = true;
  const open = clone(closed);
  open.closed = false;
  const initial = waterInventory(closed);
  const closedResult = advanceSimulation(closed, 30 * DAY, 'offline', NOW + 30 * DAY);
  const openResult = advanceSimulation(open, 30 * DAY, 'offline', NOW + 30 * DAY);
  close(waterInventory(closedResult), initial, 1e-8);
  assert.ok(waterInventory(openResult) < initial - 0.001);
  assert.ok(waterInventory(openResult) < waterInventory(closedResult));
});

test('no watering means no spontaneous water creation, even in a dry closed bottle', () => {
  const dry = started();
  dry.closed = true;
  dry.ecology.moisture = 0;
  dry.ecology.humidity = 0;
  dry.ecology.waterReserve = 0;
  const result = advanceSimulation(dry, 3650 * DAY, 'offline', NOW + 3650 * DAY);
  close(waterInventory(result), 0);
  assertFiniteTree(result);
  const wet = started();
  const before = waterInventory(wet);
  for (const material of MATERIAL_KINDS) {
    const edited = applyAction(wet, { type: 'pour', material, x: 0.5, amount: 1 }, NOW);
    close(waterInventory(edited), before);
    const scooped = applyAction(edited, { type: 'scoop', x: 0.5, amount: 1 }, NOW);
    close(waterInventory(scooped), before);
  }
});

test('watering increases only bounded stored inventory, including zero and saturated inputs', () => {
  const state = started();
  const zero = applyAction(state, { type: 'water', amount: 0 }, NOW + 1);
  close(waterInventory(zero), waterInventory(state));
  const watered = applyAction(state, { type: 'water', amount: 0.2 }, NOW + 1);
  assert.ok(waterInventory(watered) > waterInventory(state));
  assert.ok(waterInventory(watered) <= waterInventory(state) + 0.2 + 1e-9);
  const saturated = clone(state);
  saturated.ecology.moisture = 1;
  saturated.ecology.humidity = 1;
  saturated.ecology.waterReserve = 1;
  const result = applyAction(saturated, { type: 'water', amount: 0.2 }, NOW + 1);
  assert.ok(waterInventory(result) <= 2 + WATER_VAPOR_CAPACITY + 1e-9);
  assert.deepEqual(validateState(result), result);
});

test('vacation slows growth and protects plant health while preserving the normal clock', () => {
  const normal = started();
  normal.closed = false;
  normal.environment = { temperature: 35, light: 0.9 };
  normal.ecology.moisture = 0.05;
  normal.ecology.humidity = 0.05;
  normal.ecology.waterReserve = 0;
  const vacation = applyAction(normal, { type: 'vacation', enabled: true }, NOW);
  const ordinary = advanceSimulation(normal, 7 * DAY, 'offline', NOW + 7 * DAY);
  const protectedResult = advanceSimulation(vacation, 7 * DAY, 'offline', NOW + 7 * DAY);
  close(ordinary.ecology.simulatedDays, protectedResult.ecology.simulatedDays);
  assert.ok(protectedResult.plants.every((plant, index) => plant.health >= ordinary.plants[index]!.health));
  const favorable = started();
  favorable.closed = true;
  const slowed = applyAction(favorable, { type: 'vacation', enabled: true }, NOW);
  const ordinaryGrowth = advanceSimulation(favorable, 4 * DAY, 'offline', NOW + 4 * DAY).plants.reduce((total, plant) => total + plant.growth, 0);
  const slowedGrowth = advanceSimulation(slowed, 4 * DAY, 'offline', NOW + 4 * DAY).plants.reduce((total, plant) => total + plant.growth, 0);
  assert.ok(slowedGrowth < ordinaryGrowth);
  assert.ok(waterInventory(protectedResult) <= waterInventory(vacation) + 1e-9, 'protection must not conjure water');
});

test('large elapsed times are bounded, finite and schema-valid without per-frame replay', { timeout: 3000 }, () => {
  for (const elapsed of [3650 * DAY, 1e18, Number.MAX_VALUE]) {
    const result = advanceSimulation(started(), elapsed, 'online', NOW + DAY);
    assertFiniteTree(result);
    assert.deepEqual(validateState(result), result);
    assert.ok(result.ecology.simulatedDays >= 0 && result.ecology.simulatedDays <= 1e9);
    assert.ok(result.plants.every((plant) => plant.ageDays <= 1e9 && plant.growth <= 1 && plant.health >= MIN_HEALTH));
  }
});

test('invalid elapsed values, modes and timestamps are rejected rather than corrupting the clock', () => {
  const state = started();
  const before = clone(state);
  for (const elapsed of [-1, NaN, Infinity, -Infinity, '1000' as unknown as number]) {
    assert.throws(() => advanceSimulation(state, elapsed, 'online', NOW + 1));
  }
  assert.throws(() => advanceSimulation(state, DAY, 'warp' as 'online', NOW + 1));
  for (const now of [-1, NaN, Infinity, 1.5, 8_640_000_000_000_001]) {
    assert.throws(() => createInitialState(now));
    assert.throws(() => advanceSimulation(state, DAY, 'online', now));
    assert.throws(() => applyAction(state, { type: 'starter' }, now));
  }
  assert.deepEqual(state, before);
});

test('simulation rejects malformed existing state and produces no NaN for boundary environments', () => {
  const malformed = started();
  malformed.ecology.moisture = NaN;
  assert.throws(() => advanceSimulation(malformed, DAY, 'offline', NOW + DAY));
  assert.throws(() => applyAction(malformed, { type: 'water', amount: 0.1 }, NOW + DAY));
  for (const temperature of [10, 35]) for (const light of [0, 1]) for (const height of [0, TERRAIN_MAX_HEIGHT]) {
    const state = started();
    state.environment = { temperature, light };
    state.terrain.columns = Array.from({ length: TERRAIN_COLUMNS }, () => Array<MaterialKind>(height).fill('soil'));
    const result = advanceSimulation(state, 365 * DAY, 'offline', NOW + 365 * DAY);
    assertFiniteTree(result);
    assert.deepEqual(validateState(result), result);
  }
});

test('all core operations are pure and accept deeply frozen state and actions', () => {
  const state = freezeDeep(started());
  const before = clone(state);
  const action = freezeDeep({ type: 'preferences', value: { reducedMotion: true } });
  const result = applyAction(state, action, NOW + 1);
  const advanced = advanceSimulation(state, DAY, 'offline', NOW + DAY);
  assert.deepEqual(state, before);
  assert.notEqual(result, state);
  assert.notEqual(result.preferences, state.preferences);
  assert.notEqual(advanced.ecology, state.ecology);
  assert.notEqual(advanced.plants, state.plants);
  assert.notEqual(advanced.plants[0], state.plants[0]);
  assert.deepEqual(action, { type: 'preferences', value: { reducedMotion: true } });
  const first = advanceSimulation(state, DAY, 'offline', NOW + DAY);
  const second = advanceSimulation(state, DAY, 'offline', NOW + DAY);
  assert.deepEqual(first, second, 'simulation must be deterministic for the same input');
});

test('capacity guards prevent UI add actions from overfilling collections', () => {
  let state = createInitialState(NOW);
  for (let index = 0; index < MAX_PLANTS; index += 1) state = applyAction(state, { type: 'add-plant', kind: 'fern', x: 0.5, y: 0.5 }, NOW);
  assert.throws(() => applyAction(state, { type: 'add-plant', kind: 'fern', x: 0.5, y: 0.5 }, NOW));
  for (let index = 0; index < MAX_DECORATIONS; index += 1) state = applyAction(state, { type: 'add-decoration', kind: 'stone', x: 0.5, y: 0.5 }, NOW);
  assert.throws(() => applyAction(state, { type: 'add-decoration', kind: 'stone', x: 0.5, y: 0.5 }, NOW));
  assert.equal(state.plants.length, MAX_PLANTS);
  assert.equal(state.decorations.length, MAX_DECORATIONS);
  assert.deepEqual(validateState(state), state);
});

test('moving or removing nonexistent IDs fails without mutating the bottle', () => {
  const state = started();
  const before = clone(state);
  for (const action of [
    { type: 'move-plant', id: 'missing-plant', x: 0.5, y: 0.5 },
    { type: 'remove-plant', id: 'missing-plant' },
    { type: 'move-decoration', id: 'missing-decoration', x: 0.5, y: 0.5 },
    { type: 'remove-decoration', id: 'missing-decoration' },
  ]) {
    assert.throws(() => applyAction(state, action, NOW + 1));
    assert.deepEqual(state, before);
  }
});

test('all bottle shapes validate and lidless containers cannot be closed', () => {
  for (const shape of BOTTLE_SHAPES) {
    const state = applyAction(started(), { type: 'bottle', shape }, NOW);
    assert.equal(state.bottle, shape);
    assert.deepEqual(validateState(state), state);
    if (shape === 'open-cylinder' || shape === 'open-cube') {
      assert.equal(state.closed, false);
      assert.throws(() => applyAction(state, { type: 'lid', closed: true }, NOW));
      assert.equal(applyAction(state, { type: 'lid', closed: false }, NOW).closed, false);
      const before = waterInventory(state);
      assert.ok(waterInventory(advanceSimulation(state, 7 * DAY, 'offline', NOW + 7 * DAY)) < before);
    } else {
      assert.equal(applyAction(state, { type: 'lid', closed: true }, NOW).closed, true);
    }
  }
  const glassBox = applyAction(applyAction(started(), { type: 'bottle', shape: 'open-cube' }, NOW), { type: 'bottle', shape: 'glass-box' }, NOW);
  assert.equal(applyAction(glassBox, { type: 'lid', closed: true }, NOW).closed, true);
});

test('faceted glass form action owns its data, persists through care and switching, and leaves reset unchanged', () => {
  const original = applyAction(started(), { type: 'bottle', shape: 'glass-box' }, NOW);
  const before = clone(original);
  const form = { lower: 0.6, middle: 1.2, upper: 0.8, facets: 10 as const };
  const shaped = applyAction(original, { type: 'glass-form', value: form }, NOW + 1);
  assert.deepEqual(shaped.glassForm, form);
  assert.notEqual(shaped.glassForm, form);
  assert.deepEqual(shaped.terrain, original.terrain);
  assert.deepEqual(shaped.plants, original.plants);
  assert.deepEqual(original, before);
  const advanced = advanceSimulation(shaped, HOUR, 'online', NOW + HOUR);
  assert.deepEqual(advanced.glassForm, form);
  const cat = applyAction(shaped, { type: 'bottle', shape: 'cat' }, NOW + 2);
  assert.deepEqual(cat.glassForm, form, 'switching away remembers the sculpted glass form');
  const returned = applyAction(cat, { type: 'bottle', shape: 'glass-box' }, NOW + 3);
  assert.deepEqual(returned.glassForm, form);
  const reset = applyAction(returned, { type: 'reset' }, NOW + 4);
  assert.deepEqual(reset, { ...createInitialState(NOW + 4), terrain: { columns: Array.from({ length: 48 }, () => []) } });
  assert.equal(Object.hasOwn(reset, 'glassForm'), false);
});

test('shaping is rejected outside the faceted glass vessel without state mutation', () => {
  for (const shape of BOTTLE_SHAPES.filter((shape) => shape !== 'glass-box')) {
    const state = applyAction(started(), { type: 'bottle', shape }, NOW);
    const before = clone(state);
    assert.throws(() => applyAction(state, {
      type: 'glass-form', value: { lower: 1, middle: 1, upper: 1, facets: 8 },
    }, NOW + 1), RangeError);
    assert.deepEqual(state, before);
  }
});

test('fast doses and adjustable rounded brush actions reach the core without changing ecology', () => {
  const state = started();
  const count = (value: TerrariumState): number => value.terrain.columns.reduce((sum, column) => sum + column.length, 0);
  const poured = applyAction(state, { type: 'pour', material: 'clay', x: 0.5, amount: 32 }, NOW + 1);
  assert.equal(count(poured), count(state) + 32);
  assert.deepEqual(poured.ecology, state.ecology);
  for (const radius of [2, 4, 7]) {
    const scooped = applyAction(poured, { type: 'scoop', x: 0.5, amount: 24, radius }, NOW + 2);
    assert.equal(count(scooped), count(poured) - 24);
    assert.deepEqual(scooped.ecology, poured.ecology);
    const changed = scooped.terrain.columns.map((column, index) => column.length !== poured.terrain.columns[index]!.length);
    assert.equal(changed.filter(Boolean).length, 2 * radius + 1);
    for (let index = 0; index < TERRAIN_COLUMNS; index++) {
      assert.deepEqual(scooped.terrain.columns[index], poured.terrain.columns[index]!.slice(0, scooped.terrain.columns[index]!.length));
      if (Math.abs(index - 24) > radius) assert.equal(changed[index], false);
    }
  }
});

test('expanded substrate capacity survives immutable actions and online/offline simulation', () => {
  for (const material of MATERIAL_KINDS) {
    const input = started();
    input.terrain.columns = Array.from({ length: TERRAIN_COLUMNS }, () => Array<MaterialKind>(112).fill(material));
    const before = clone(input);
    const state = freezeDeep(input);
    const capped = applyAction(state, { type: 'pour', material: 'soil', x: 0.5, amount: 32 }, NOW + 1);
    assert.deepEqual(capped.terrain, state.terrain);
    const scooped = applyAction(state, { type: 'scoop', x: 0.5, amount: 24, radius: 4 }, NOW + 1);
    assert.equal(scooped.terrain.columns.reduce((sum, column) => sum + column.length, 0), 48 * 112 - 24);
    assert.deepEqual(scooped.ecology, state.ecology);
    for (const mode of ['online', 'offline'] as const) {
      const advanced = advanceSimulation(state, DAY, mode, NOW + DAY);
      assertFiniteTree(advanced);
      assert.deepEqual(validateState(advanced), advanced);
      assert.deepEqual(advanced.terrain, state.terrain, 'time cannot rescale or remove substrate');
      for (let index = 0; index < TERRAIN_COLUMNS; index++) assert.notEqual(advanced.terrain.columns[index], state.terrain.columns[index]);
    }
    assert.deepEqual(state, before);
  }
  const old = started();
  old.terrain.columns = Array.from({ length: TERRAIN_COLUMNS }, () => Array<MaterialKind>(40).fill('gravel'));
  const poured = applyAction(freezeDeep(old), { type: 'pour', material: 'soil', x: 0.5, amount: 8 }, NOW + 1);
  assert.equal(poured.terrain.columns.reduce((sum, column) => sum + column.length, 0), 48 * 40 + 8);
  assert.ok(poured.terrain.columns.some((column) => column.length > 40));
  assert.ok(poured.terrain.columns.every((column) => column.slice(0, 40).every((kind) => kind === 'gravel')));
});

test('targeted spray gives immediate bounded wetness and growth feedback to only its chosen plant', () => {
  const state = started();
  const before = clone(state);
  const target = state.plants[0]!;
  const amount = 0.025;
  const sprayed = applyAction(state, { type: 'spray', plantId: target.id, amount }, NOW);
  const result = sprayed.plants[0]!;
  close(result.wetness, 0.25);
  close(result.growth - target.growth, 0.05 * (amount / 0.1));
  assert.ok(result.health >= target.health && result.health - target.health <= 0.04 * result.wetness + 1e-9);
  close(result.ageDays, target.ageDays);
  close(sprayed.ecology.simulatedDays, state.ecology.simulatedDays);
  assert.deepEqual(sprayed.plants.slice(1), state.plants.slice(1));
  assert.ok(waterInventory(sprayed) > waterInventory(state));
  assert.ok(waterInventory(sprayed) <= waterInventory(state) + amount + 1e-9);
  assert.deepEqual(state, before);
  assert.deepEqual(validateState(sprayed), sprayed);
});

test('zero-time spray spam cannot farm growth or health after a complete wet cycle', () => {
  const initial = started();
  const target = initial.plants[0]!;
  let state = initial;
  for (let index = 0; index < 4; index += 1) state = applyAction(state, { type: 'spray', plantId: target.id, amount: 0.025 }, NOW);
  const fullyWet = clone(state.plants[0]!);
  close(fullyWet.wetness, 1);
  close(fullyWet.growth - target.growth, 0.05);
  assert.ok(fullyWet.health - target.health <= 0.04 + 1e-9);
  for (let index = 0; index < 100; index += 1) {
    const beforeWater = waterInventory(state);
    state = applyAction(state, { type: 'spray', plantId: target.id, amount: 0.025 }, NOW);
    assert.ok(waterInventory(state) <= beforeWater + 0.025 + 1e-9);
    assert.deepEqual(state.plants[0], fullyWet);
  }
  close(state.ecology.simulatedDays, 0);
  assert.deepEqual(initial.plants[0], target);
});

test('spray feedback respects partial wetness and the mature/healthy ceilings', () => {
  const state = started();
  const target = state.plants[0]!;
  target.wetness = 0.9;
  target.growth = 0.999;
  target.health = 0.999;
  const result = applyAction(state, { type: 'spray', plantId: target.id, amount: 0.025 }, NOW);
  close(result.plants[0]!.wetness, 1);
  assert.ok(result.plants[0]!.growth <= 1);
  assert.ok(result.plants[0]!.growth - target.growth <= 0.005 + 1e-9);
  assert.ok(result.plants[0]!.health <= 1);
  assert.ok(result.plants[0]!.health - target.health <= 0.004 + 1e-9);
  assert.deepEqual(validateState(result), result);
});

test('zero-dose and untargeted spray do not grant plant growth', () => {
  const state = started();
  const target = state.plants[0]!;
  for (const plantId of [null, target.id]) {
    const zero = applyAction(state, { type: 'spray', plantId, amount: 0 }, NOW);
    assert.deepEqual(zero, state);
  }
  const untargeted = applyAction(state, { type: 'spray', plantId: null, amount: 0.025 }, NOW);
  assert.deepEqual(untargeted.plants, state.plants);
  assert.ok(waterInventory(untargeted) > waterInventory(state));
  assert.ok(waterInventory(untargeted) <= waterInventory(state) + 0.025 + 1e-9);
});

test('paused spray cannot grant immediate growth or advance plant age', () => {
  const state = applyAction(started(), { type: 'pause', paused: true }, NOW);
  const target = state.plants[0]!;
  let sprayed = state;
  for (let index = 0; index < 8; index += 1) sprayed = applyAction(sprayed, { type: 'spray', plantId: target.id, amount: 0.025 }, NOW);
  close(sprayed.plants[0]!.growth, target.growth);
  close(sprayed.plants[0]!.health, target.health);
  close(sprayed.plants[0]!.ageDays, target.ageDays);
  close(sprayed.ecology.simulatedDays, state.ecology.simulatedDays);
  assert.ok(sprayed.plants[0]!.wetness >= target.wetness);
  assert.deepEqual(state.plants[0], target);
});

test('sunlight is temporary care without immediate growth, water creation or permanent climate changes', () => {
  const state = started();
  const sunlit = applyAction(state, { type: 'sunlight' }, NOW);
  assert.equal(sunlit.care.sunlight, 1);
  assert.deepEqual(sunlit.plants, state.plants);
  assert.deepEqual(sunlit.ecology, state.ecology);
  assert.deepEqual(sunlit.environment, state.environment);
  assert.deepEqual(applyAction(sunlit, { type: 'sunlight' }, NOW), sunlit);
  const result = advanceSimulation(sunlit, 120_000, 'online', NOW + 120_000);
  close(result.care.sunlight, 0.25);
  assert.deepEqual(result.environment, state.environment);
  assert.deepEqual(state.care, { sunlight: 0 });
});

test('temporary sunlight affects simulated wellbeing without altering the stored environment', () => {
  const state = started();
  state.environment = { temperature: 20, light: 0.2 };
  const sunlit = applyAction(state, { type: 'sunlight' }, NOW);
  const baseline = advanceSimulation(state, 30_000, 'online', NOW + 30_000);
  const boosted = advanceSimulation(sunlit, 30_000, 'online', NOW + 30_000);
  assert.ok(boosted.plants.reduce((sum, plant) => sum + plant.growth, 0) > baseline.plants.reduce((sum, plant) => sum + plant.growth, 0));
  assert.deepEqual(boosted.environment, state.environment);
  close(boosted.ecology.simulatedDays, baseline.ecology.simulatedDays);
});

test('sunlight care boosts every default starter plant rather than penalizing the ordinary setup', () => {
  const state = started();
  const baseline = advanceSimulation(state, 60_000, 'online', NOW + 60_000);
  const boosted = advanceSimulation(applyAction(state, { type: 'sunlight' }, NOW), 60_000, 'online', NOW + 60_000);
  const totalGrowth = (input: TerrariumState): number => input.plants.reduce((sum, plant) => sum + plant.growth, 0);
  assert.ok(totalGrowth(boosted) > totalGrowth(baseline));
  for (let index = 0; index < state.plants.length; index += 1) {
    assert.ok(boosted.plants[index]!.growth > baseline.plants[index]!.growth, `sunlight should boost ${state.plants[index]!.kind}`);
  }
  assert.deepEqual(boosted.environment, state.environment);
  assert.deepEqual(validateState(boosted), boosted);
});

test('sunlight and plant wetness decay by real-time half-lives independently of speed or online/offline mode', () => {
  for (const speed of [1, 2, 5, 10] as const) for (const mode of ['online', 'offline'] as const) {
    const state = started();
    state.speed = speed;
    state.care.sunlight = 1;
    for (const plant of state.plants) plant.wetness = 1;
    const after60s = advanceSimulation(state, 60_000, mode, NOW + 60_000);
    close(after60s.care.sunlight, 0.5);
    for (const plant of after60s.plants) close(plant.wetness, Math.pow(0.5, 60 / 90));
    const after90s = advanceSimulation(state, 90_000, mode, NOW + 90_000);
    close(after90s.care.sunlight, Math.pow(0.5, 90 / 60));
    for (const plant of after90s.plants) close(plant.wetness, 0.5);
  }
});

test('care decays during pause while ecological time, growth, health and stored water remain unchanged', () => {
  const state = applyAction(started(), { type: 'pause', paused: true }, NOW);
  state.care.sunlight = 1;
  for (const plant of state.plants) plant.wetness = 1;
  const result = advanceSimulation(state, 90_000, 'online', NOW + 90_000);
  close(result.care.sunlight, Math.pow(0.5, 90 / 60));
  assert.deepEqual(result.ecology, state.ecology);
  assert.deepEqual(result.environment, state.environment);
  for (let index = 0; index < state.plants.length; index += 1) {
    close(result.plants[index]!.wetness, 0.5);
    assert.deepEqual({ ...result.plants[index]!, wetness: 1 }, state.plants[index]);
  }
  assert.equal(result.updatedAt, NOW + 90_000);
});

test('8 hours offline expires transient care without accelerating the offline ecosystem', () => {
  const state = started();
  state.speed = 10;
  state.care.sunlight = 1;
  for (const plant of state.plants) plant.wetness = 1;
  const result = advanceSimulation(state, 8 * HOUR, 'offline', NOW + 8 * HOUR);
  assert.ok(result.care.sunlight < 1e-10);
  assert.ok(result.plants.every((plant) => plant.wetness < 1e-10));
  close(result.ecology.simulatedDays, 1 / 3);
  assert.deepEqual(result.environment, state.environment);
});

test('huge real deltas also bound and expire transient care without producing NaN', { timeout: 3000 }, () => {
  const state = started();
  state.care.sunlight = 1;
  for (const plant of state.plants) plant.wetness = 1;
  for (const paused of [false, true]) {
    state.paused = paused;
    const result = advanceSimulation(state, Number.MAX_VALUE, 'online', NOW + DAY);
    close(result.care.sunlight, 0);
    assert.ok(result.plants.every((plant) => plant.wetness === 0));
    assertFiniteTree(result);
    assert.deepEqual(validateState(result), result);
    if (paused) assert.deepEqual(result.ecology, state.ecology);
  }
});

test('new care and terrain commands reject malicious, obsolete, unknown and out-of-range inputs atomically', () => {
  const state = started();
  const before = clone(state);
  const target = state.plants[0]!.id;
  const actions: unknown[] = [
    { type: 'layer', material: 'soil', depth: 0.5 },
    { type: 'pour', material: 'logo', x: 0.5, amount: 1 },
    { type: 'pour', material: 'soil', x: -0.01, amount: 1 },
    { type: 'pour', material: 'soil', x: 0.5, amount: Infinity },
    { type: 'scoop', x: 1.01, amount: 1 }, { type: 'scoop', x: 0.5, amount: -1 },
    { type: 'spray', plantId: target, amount: -0.001 },
    { type: 'spray', plantId: target, amount: 0.025001 },
    { type: 'spray', plantId: target, amount: NaN },
    { type: 'spray', plantId: target, amount: '0.025' },
    { type: 'spray', plantId: 'missing', amount: 0.025 },
    { type: 'spray', plantId: '../escape', amount: 0.025 },
    { type: 'spray', plantId: {}, amount: 0.025 },
    { type: 'sunlight', duration: Number.MAX_VALUE },
    { type: 'spray', plantId: null, amount: 0.025, growth: 1 },
    { type: 'pour', material: 'soil', x: 0.5, amount: 1, execute: 'unsafe' },
    { type: 'scoop', x: 0.5, amount: 1, execute: 'unsafe' },
    { type: 'import', state },
    JSON.parse('{"type":"sunlight","__proto__":{"polluted":true}}'),
  ];
  for (const action of actions) {
    assert.throws(() => applyAction(state, action, NOW));
    assert.deepEqual(state, before);
  }
  let calls = 0;
  const accessor = { type: 'spray', plantId: target };
  Object.defineProperty(accessor, 'amount', { enumerable: true, get() { calls += 1; return 0.025; } });
  assert.throws(() => applyAction(state, accessor, NOW));
  assert.equal(calls, 0);
  const hidden = { type: 'sunlight' };
  Object.defineProperty(hidden, Symbol('execute'), { value: true, enumerable: true });
  assert.throws(() => applyAction(state, hidden, NOW));
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
});

test('care and sculpting operations remain pure for frozen inputs and leave foreign objects untouched', () => {
  const state = freezeDeep(started());
  const before = clone(state);
  const target = state.plants[0]!.id;
  for (const action of [
    { type: 'pour', material: 'coir', x: 0.4, amount: 1 },
    { type: 'scoop', x: 0.4, amount: 1 },
    { type: 'spray', plantId: target, amount: 0.025 },
    { type: 'sunlight' },
  ]) {
    const frozen = freezeDeep(action);
    const result = applyAction(state, frozen, NOW);
    assert.notEqual(result, state);
    assert.deepEqual(state, before);
    assert.deepEqual(result.decorations, state.decorations);
    assert.notEqual(result.terrain, state.terrain);
    assert.notEqual(result.terrain.columns[0], state.terrain.columns[0]);
  }
});

test('material composition and local root position affect growth without changing the water inventory', () => {
  const state = applyAction(createInitialState(NOW), { type: 'add-plant', kind: 'fern', x: 0.25, y: 0.5 }, NOW);
  const center = Math.min(TERRAIN_COLUMNS - 1, Math.floor(state.plants[0]!.x * TERRAIN_COLUMNS));
  state.terrain.columns = Array.from({ length: TERRAIN_COLUMNS }, (_, index) =>
    Array<MaterialKind>(10).fill(Math.abs(index - center) <= 1 ? 'soil' : 'gravel'));
  const away = clone(state);
  // Moving the same three fertile columns preserves global retention and grain count.
  for (let index = 0; index < TERRAIN_COLUMNS; index += 1) away.terrain.columns[index] =
    Array<MaterialKind>(10).fill(Math.abs(index - (TERRAIN_COLUMNS - 5)) <= 1 ? 'soil' : 'gravel');
  const supported = advanceSimulation(state, 4 * DAY, 'offline', NOW + 4 * DAY);
  const unsupported = advanceSimulation(away, 4 * DAY, 'offline', NOW + 4 * DAY);
  assert.ok(supported.plants[0]!.growth > unsupported.plants[0]!.growth);
  close(waterInventory(supported), waterInventory(state), 1e-8);
  close(waterInventory(unsupported), waterInventory(away), 1e-8);
  for (const material of MATERIAL_KINDS) {
    const mixed = clone(state);
    mixed.terrain.columns = Array.from({ length: TERRAIN_COLUMNS }, () => Array<MaterialKind>(TERRAIN_MAX_HEIGHT).fill(material));
    const result = advanceSimulation(mixed, 365 * DAY, 'offline', NOW + 365 * DAY);
    assertFiniteTree(result);
    assert.deepEqual(validateState(result), result);
  }
});

test('zero elapsed time never decays care or alters wetness, growth or stored water', () => {
  const state = started();
  state.care.sunlight = 1;
  for (const plant of state.plants) plant.wetness = 1;
  const before = clone(state);
  for (const mode of ['online', 'offline'] as const) {
    const result = advanceSimulation(state, 0, mode, NOW + 1);
    assert.deepEqual(result, { ...before, updatedAt: NOW + 1 });
    assert.deepEqual(state, before);
  }
});

test('root support at x=0.1 uses uniform column 4 neighbors, not the former rounded column 5', () => {
  const supported = applyAction(createInitialState(NOW), { type: 'add-plant', kind: 'fern', x: 0.1, y: 0.5 }, NOW);
  supported.terrain.columns = Array.from({ length: TERRAIN_COLUMNS }, (_, index) =>
    Array<MaterialKind>(10).fill(index === 3 ? 'soil' : 'gravel'));
  const matchedControl = clone(supported);
  matchedControl.terrain.columns[3] = Array<MaterialKind>(10).fill('gravel');
  matchedControl.terrain.columns[6] = Array<MaterialKind>(10).fill('soil');
  // Identical global material inventory isolates local root support: uniform
  // column 4 sees fertile column 3; former rounded column 5 sees column 6 instead.
  const favorable = advanceSimulation(supported, 4 * DAY, 'offline', NOW + 4 * DAY);
  const unfavorable = advanceSimulation(matchedControl, 4 * DAY, 'offline', NOW + 4 * DAY);
  assert.ok(favorable.plants[0]!.growth > unfavorable.plants[0]!.growth);
  close(favorable.ecology.moisture, unfavorable.ecology.moisture);
  close(favorable.ecology.humidity, unfavorable.ecology.humidity);
  close(favorable.ecology.waterReserve, unfavorable.ecology.waterReserve);
  assert.deepEqual(validateState(favorable), favorable);
  assert.deepEqual(validateState(unfavorable), unfavorable);
});

test('real-time care still expires when the ecological age ceiling prevents more simulation', () => {
  const state = started();
  state.ecology.simulatedDays = 1e9;
  state.care.sunlight = 1;
  for (const plant of state.plants) { plant.wetness = 1; plant.ageDays = 1e9; }
  const result = advanceSimulation(state, 90_000, 'online', NOW + 90_000);
  close(result.care.sunlight, Math.pow(0.5, 90 / 60));
  assert.deepEqual(result.ecology, state.ecology);
  for (let index = 0; index < state.plants.length; index += 1) {
    close(result.plants[index]!.wetness, 0.5);
    assert.deepEqual({ ...result.plants[index]!, wetness: 1 }, state.plants[index]);
  }
});

test('corrupted care and wetness state cannot bypass simulation or dispatch validation', () => {
  for (const value of [-0.001, 1.001, NaN, Infinity]) {
    const care = started();
    care.care.sunlight = value;
    assert.throws(() => advanceSimulation(care, 60_000, 'online', NOW + 60_000));
    assert.throws(() => applyAction(care, { type: 'sunlight' }, NOW));
    const wetness = started();
    wetness.plants[0]!.wetness = value;
    assert.throws(() => advanceSimulation(wetness, 60_000, 'offline', NOW + 60_000));
    assert.throws(() => applyAction(wetness, { type: 'spray', plantId: wetness.plants[0]!.id, amount: 0.025 }, NOW));
  }
});
