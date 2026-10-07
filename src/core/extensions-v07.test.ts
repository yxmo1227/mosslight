import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_WOOD_FORM, ENTITY_SCALE_LIMITS, WOOD_MAX_BRANCHES } from '../shared/catalog';
import type { Decoration, TerrariumAction, TerrariumState, WoodForm } from '../shared/types';
import { advanceSimulation, applyAction, createInitialState, DAY_MILLISECONDS, WATER_VAPOR_CAPACITY, WETNESS_HALF_LIFE_MILLISECONDS, WOOD_BASE_DECAY_RATE, WOOD_DAMP_DECAY_RATE } from './simulation';
import { MAX_SIMULATED_DAYS, MAX_TIMESTAMP, migrateSaveState, validateAction, validateState, validateWoodForm } from './validation';
import { pondWater } from './hydrology';

const NOW = 1000, DAY = DAY_MILLISECONDS;
const close = (actual: number, expected: number, tolerance = 1e-12): void => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
function frozen<T>(value: T): T { if (value && typeof value === 'object') { for (const nested of Object.values(value)) frozen(nested); Object.freeze(value); } return value; }
const woodForm = (): WoodForm => structuredClone(DEFAULT_WOOD_FORM);
function forest(): TerrariumState {
  const state = createInitialState(NOW);
  state.decorations = [
    { id: 'wood', kind: 'wood', x: .3, y: .4, scale: 1 },
    { id: 'stone', kind: 'stone', x: .45, y: .5, scale: .8, support: { parentId: 'wood', x: .7 } },
    { id: 'stump', kind: 'stump', x: .6, y: .6, scale: 1.2, support: { parentId: 'stone', x: .6 } },
  ];
  state.plants = (['cushion-moss', 'sheet-moss', 'fern', 'fittonia', 'amber-mushroom', 'ivory-mushroom'] as const).map((kind, index) => ({
    id: `plant-${index}`, kind, x: .4 + index * .04, y: .5, scale: 1,
    growth: .4, health: .9, ageDays: 1, wetness: 0, support: { parentId: 'stump', x: .2 + index * .1 },
  }));
  state.pond = { depths: Array(48).fill(1) };
  return state;
}
function withCondition(): TerrariumState {
  const state = forest();
  for (const item of state.decorations) item.condition = { wetness: 1, decay: item.kind === 'stone' ? 0 : .2 };
  state.decorations[0].wood = woodForm(); return state;
}
const inventory = (state: TerrariumState): number => state.ecology.moisture + state.ecology.waterReserve + state.ecology.humidity * WATER_VAPOR_CAPACITY;
function withoutCondition(item: Decoration): Omit<Decoration, 'condition' | 'colonization'> { const { condition: _condition, colonization: _colonization, ...structure } = item; return structure; }

test('every plant and decoration can resize at existing scale endpoints without changing descendants', () => {
  const state = frozen(forest());
  for (const scale of [...ENTITY_SCALE_LIMITS, 1.27]) for (const type of ['plant', 'decoration'] as const) {
    const items = type === 'plant' ? state.plants : state.decorations;
    for (const item of items) {
      const action: TerrariumAction = type === 'plant' ? { type: 'resize-plant', id: item.id, scale } : { type: 'resize-decoration', id: item.id, scale };
      const result = applyAction(state, frozen(action), NOW);
      const expected = structuredClone(state), target = [...expected.plants, ...expected.decorations].find(entry => entry.id === item.id)!;
      target.scale = scale;
      assert.deepEqual(result, expected);
      assert.deepEqual(validateState(result), result);
      for (const decoration of result.decorations) assert.equal(Object.hasOwn(decoration, 'condition'), false);
    }
  }
});

test('resize commands reject malformed scales, stale IDs and cross-kind IDs atomically', () => {
  const state = frozen(forest());
  for (const type of ['resize-plant', 'resize-decoration']) {
    const id = type === 'resize-plant' ? 'plant-0' : 'wood';
    for (const scale of [.399, 2.001, NaN, Infinity, -Infinity, null, undefined, '1']) assert.throws(() => applyAction(state, { type, id, scale }, NOW));
    for (const wrong of ['missing', type === 'resize-plant' ? 'wood' : 'plant-0']) assert.throws(() => applyAction(state, { type, id: wrong, scale: 1 }, NOW), /not found/);
  }
  assert.equal(state.decorations[0].scale, 1); assert.equal(state.plants[0].scale, 1);
});

test('all four new action schemas require exact keys and never execute getters', () => {
  const actions = [
    { type: 'resize-plant', id: 'plant-0', scale: 1 }, { type: 'resize-decoration', id: 'wood', scale: 1 },
    { type: 'wood-form', id: 'wood', value: woodForm() }, { type: 'spray-decoration', decorationId: 'wood', amount: .025 },
  ];
  let calls = 0;
  for (const action of actions) {
    assert.deepEqual(validateAction(action), action);
    assert.throws(() => validateAction({ ...action, extra: true }));
    assert.throws(() => validateAction(Object.create(action)));
    for (const key of Object.keys(action)) {
      const missing = { ...action }; Reflect.deleteProperty(missing, key); assert.throws(() => validateAction(missing));
      const getter = { ...action }; Object.defineProperty(getter, key, { enumerable: true, get() { calls++; return Reflect.get(action, key); } }); assert.throws(() => validateAction(getter));
    }
    const hidden = { ...action }; Object.defineProperty(hidden, 'hidden', { value: true }); assert.throws(() => validateAction(hidden));
    assert.throws(() => validateAction({ ...action, [Symbol('hidden')]: true }));
  }
  assert.equal(calls, 0);
});

test('wood form preserves bounded branch order and deep-owned copies across actions and imports', () => {
  for (const length of [.5, 2]) for (const angle of [-160, 160]) for (const count of [0, WOOD_MAX_BRANCHES]) {
    const value = frozen({ length, angle, branches: Array.from({ length: count }, (_, index) => ({ at: index ? .85 : .2, length: index ? .8 : .2, angle: index ? 80 : -80 })) });
    const state = frozen(forest()), result = applyAction(state, { type: 'wood-form', id: 'wood', value }, NOW);
    assert.deepEqual(result.decorations[0].wood, value);
    assert.notEqual(result.decorations[0].wood, value); assert.notEqual(result.decorations[0].wood!.branches, value.branches);
    if (count) assert.notEqual(result.decorations[0].wood!.branches[0], value.branches[0]);
    assert.deepEqual(result.decorations[0].condition, { wetness: 0, decay: 0 });
    const imported = migrateSaveState(JSON.parse(JSON.stringify(result)));
    assert.deepEqual(imported, result); assert.notEqual(imported.decorations[0].condition, result.decorations[0].condition);
    if (count) assert.notEqual(imported.decorations[0].wood!.branches[0], result.decorations[0].wood!.branches[0]);
  }
});

test('wood editing changes no support relation, fallback coordinate, sibling scale or existing condition', () => {
  const state = frozen(withCondition());
  for (const value of [woodForm(), { length: 2, angle: 160, branches: [] }]) {
    const result = applyAction(state, frozen({ type: 'wood-form', id: 'wood', value }), NOW);
    const expected = structuredClone(state); expected.decorations[0].wood = structuredClone(value);
    assert.deepEqual(result, expected);
    assert.deepEqual(result.plants, state.plants);
    assert.deepEqual(result.decorations[0].condition, state.decorations[0].condition, 'editing is not rejuvenation');
  }
});

test('wood forms belong only to existing driftwood, never stones, stumps or plants', () => {
  const state = frozen(forest());
  for (const id of ['missing', 'plant-0', 'stone', 'stump']) assert.throws(() => applyAction(state, { type: 'wood-form', id, value: woodForm() }, NOW));
  for (const index of [1, 2]) {
    const invalid = forest(); invalid.decorations[index].wood = woodForm(); assert.throws(() => validateState(invalid), /only driftwood/);
  }
  assert.equal(state.decorations[0].wood, undefined);
});

test('wood form rejects every numeric overflow, lookalike, missing key and recursive branch', () => {
  const reject = (value: unknown): void => {
    assert.throws(() => validateWoodForm(value));
    assert.throws(() => applyAction(frozen(forest()), { type: 'wood-form', id: 'wood', value }, NOW));
    const state = forest(); Object.assign(state.decorations[0], { wood: value }); assert.throws(() => validateState(state));
  };
  for (const value of [undefined, null, [], {}, { ...woodForm(), extra: true }, Object.create(woodForm())]) reject(value);
  for (const key of ['length', 'angle', 'branches']) { const value = woodForm(); Reflect.deleteProperty(value, key); reject(value); }
  for (const [key, values] of [['length', [.499, 2.001, NaN, Infinity, '1']], ['angle', [-160.001, 160.001, NaN, Infinity, '0']]] as const) {
    for (const value of values) reject({ ...woodForm(), [key]: value });
  }
  for (const [key, values] of [['at', [.199, .851, NaN, '0.5']], ['length', [.199, .801, Infinity, null]], ['angle', [-80.001, 80.001, -Infinity, undefined]]] as const) {
    for (const value of values) reject({ ...woodForm(), branches: [{ ...woodForm().branches[0], [key]: value }] });
  }
  reject({ ...woodForm(), branches: Array.from({ length: 4 }, () => ({ at: .5, length: .5, angle: 0 })) });
  reject({ ...woodForm(), branches: [{ at: .5, length: .5, angle: 0, branches: [] }] });
  for (const key of ['at', 'length', 'angle']) { const branch = { ...woodForm().branches[0] }; Reflect.deleteProperty(branch, key); reject({ ...woodForm(), branches: [branch] }); }
});

test('wood branches reject sparse/accessor/modified arrays and hidden fields without invoking imported code', () => {
  let calls = 0;
  const sparse = woodForm(); delete sparse.branches[0];
  const entryGetter = woodForm(); Object.defineProperty(entryGetter.branches, '0', { enumerable: true, get() { calls++; return { at: .5, length: .4, angle: 0 }; } });
  const propertyGetter = woodForm(); Object.defineProperty(propertyGetter.branches[0], 'at', { enumerable: true, get() { calls++; return .5; } });
  const extra = woodForm(); Object.assign(extra.branches, { secret: true });
  const modified = woodForm(); Object.setPrototypeOf(modified.branches, Object.create(Array.prototype));
  const hidden = woodForm(); Object.defineProperty(hidden.branches[0], 'secret', { value: true });
  const symbol = woodForm(); Object.assign(symbol.branches[0], { [Symbol('secret')]: true });
  for (const value of [sparse, entryGetter, propertyGetter, extra, modified, hidden, symbol]) assert.throws(() => validateWoodForm(value));
  assert.equal(calls, 0);
});

test('condition validation is exact, independently cloned and prohibits stone decay', () => {
  const state = frozen(withCondition()), result = validateState(state);
  assert.deepEqual(result, state);
  for (let index = 0; index < result.decorations.length; index++) assert.notEqual(result.decorations[index].condition, state.decorations[index].condition);
  const invalid = forest(); invalid.decorations[1].condition = { wetness: 1, decay: .001 }; assert.throws(() => validateState(invalid), /stone cannot decay/);
  let calls = 0;
  const values: unknown[] = [undefined, null, [], {}, { wetness: 0 }, { decay: 0 }, { wetness: 0, decay: 0, extra: true }, Object.create({ wetness: 0, decay: 0 }), { get wetness() { calls++; return 0; }, decay: 0 }];
  for (const key of ['wetness', 'decay']) for (const bad of [-.001, 1.001, NaN, Infinity, '0', null]) values.push({ wetness: 0, decay: 0, [key]: bad });
  for (const condition of values) { const input = forest(); Object.assign(input.decorations[0], { condition }); assert.throws(() => validateState(input)); }
  assert.equal(calls, 0);
});

test('positive decoration spray adds one bounded water dose and wets only its target without plant rewards', () => {
  for (const id of ['wood', 'stone', 'stump']) {
    const state = frozen(forest()), result = applyAction(state, { type: 'spray-decoration', decorationId: id, amount: .025 }, NOW);
    close(inventory(result) - inventory(state), .025);
    assert.deepEqual(result.ecology, applyAction(state, { type: 'spray', plantId: null, amount: .025 }, NOW).ecology);
    assert.deepEqual(result.plants, state.plants); assert.deepEqual(result.terrain, state.terrain); assert.deepEqual(result.pond, state.pond);
    for (const item of result.decorations) {
      assert.deepEqual(withoutCondition(item), state.decorations.find(previous => previous.id === item.id));
      if (item.id === id) assert.deepEqual(item.condition, { wetness: .25, decay: 0 });
      else assert.equal(Object.hasOwn(item, 'condition'), false);
    }
  }
});

test('zero decoration spray never creates fields or changes condition and still rejects stale targets', () => {
  for (const state of [forest(), withCondition()]) for (const decorationId of ['wood', 'stone', 'stump']) {
    assert.deepEqual(applyAction(frozen(state), { type: 'spray-decoration', decorationId, amount: 0 }, NOW), state);
  }
  for (const decorationId of ['missing', 'plant-0']) assert.throws(() => applyAction(frozen(forest()), { type: 'spray-decoration', decorationId, amount: 0 }, NOW), /Decoration not found/);
});

test('decoration spray clamps saturation, never repairs decay and respects pause', () => {
  for (const paused of [false, true]) {
    const state = withCondition(); state.paused = paused; state.decorations[0].condition = { wetness: .9, decay: .8 };
    state.ecology.moisture = state.ecology.humidity = state.ecology.waterReserve = 1;
    let result = frozen(state);
    for (let index = 0; index < 100; index++) result = applyAction(result, { type: 'spray-decoration', decorationId: 'wood', amount: .025 }, NOW);
    assert.deepEqual(result.decorations[0].condition, { wetness: 1, decay: .8 });
    assert.deepEqual(result.plants, state.plants); assert.deepEqual(result.ecology, state.ecology);
  }
});

test('decoration spray action cannot target null, multiple entities or unbounded quantities', () => {
  for (const amount of [-.001, .025001, NaN, Infinity, undefined, null, '0.01']) assert.throws(() => validateAction({ type: 'spray-decoration', decorationId: 'wood', amount }));
  for (const decorationId of [null, undefined, '', ['wood'], 'not an id']) assert.throws(() => validateAction({ type: 'spray-decoration', decorationId, amount: .01 }));
  assert.throws(() => validateAction({ type: 'spray-decoration', decorationId: 'wood', plantId: 'plant-0', amount: .01 }));
});

test('decoration wetness shares the real-time half-life across all clocks and pause states', () => {
  for (const speed of [1, 2, 5, 10] as const) for (const mode of ['online', 'offline'] as const) for (const paused of [false, true]) {
    const state = withCondition(); state.speed = speed; state.paused = paused;
    const result = advanceSimulation(frozen(state), WETNESS_HALF_LIFE_MILLISECONDS, mode, NOW + WETNESS_HALF_LIFE_MILLISECONDS);
    for (const item of result.decorations) close(item.condition!.wetness, .5);
    if (paused) {
      assert.deepEqual(result.ecology, state.ecology); assert.deepEqual(result.plants, state.plants);
      for (let index = 0; index < result.decorations.length; index++) close(result.decorations[index].condition!.decay, state.decorations[index].condition!.decay);
    }
  }
});

test('wood weathering is slow, bounded and monotonic on the existing online/offline clock', () => {
  for (const mode of ['online', 'offline'] as const) for (const speed of [1, 2, 5, 10] as const) {
    const state = withCondition(); state.speed = speed;
    for (const item of state.decorations) item.condition = { wetness: 0, decay: 0 };
    const elapsed = 3_600_000, days = mode === 'online' ? speed : 1 / 24;
    const result = advanceSimulation(frozen(state), elapsed, mode, NOW + elapsed);
    for (const item of result.decorations) {
      if (item.kind === 'stone') assert.equal(item.condition!.decay, 0);
      else {
        assert.ok(item.condition!.decay >= -Math.expm1(-WOOD_BASE_DECAY_RATE * days) - 1e-12);
        assert.ok(item.condition!.decay <= -Math.expm1(-(WOOD_BASE_DECAY_RATE + WOOD_DAMP_DECAY_RATE) * days) + 1e-12);
      }
    }
  }
});

test('weathering never removes, resizes, reshapes or detaches any object even after extreme absence', () => {
  for (const mode of ['online', 'offline'] as const) {
    const state = frozen(withCondition()), result = advanceSimulation(state, Number.MAX_VALUE, mode, MAX_TIMESTAMP);
    assert.equal(result.ecology.simulatedDays, MAX_SIMULATED_DAYS);
    assert.equal(result.decorations.length, state.decorations.length);
    // v0.9 adds traced fungal offspring, never removes or moves an authored plant.
    const authored = result.plants.filter(item => item.ecology?.generation !== 1);
    assert.equal(authored.length, state.plants.length);
    assert.deepEqual(authored.map(item => [item.id, item.x, item.y, item.scale, item.support]), state.plants.map(item => [item.id, item.x, item.y, item.scale, item.support]));
    assert.deepEqual(result.decorations.map(withoutCondition), state.decorations.map(withoutCondition));
    assert.deepEqual(authored.map(item => item.support), state.plants.map(item => item.support));
    assert.deepEqual(result.terrain, state.terrain);
    close(inventory(result) + pondWater(result.pond), inventory(state) + pondWater(state.pond), 1e-8);
    for (const item of result.decorations) { assert.equal(item.condition!.wetness, 0); assert.equal(item.condition!.decay, item.kind === 'stone' ? 0 : 1); }
    assert.deepEqual(validateState(result), result);
  }
});

test('decay and transient condition do not inject water, affect plant growth or consume pond inventory', () => {
  const bare = forest(), decorated = withCondition();
  for (const mode of ['online', 'offline'] as const) {
    const ordinary = advanceSimulation(frozen(bare), 8 * DAY, mode, NOW + 8 * DAY);
    const weathered = advanceSimulation(frozen(decorated), 8 * DAY, mode, NOW + 8 * DAY);
    assert.deepEqual(weathered.ecology, ordinary.ecology); assert.deepEqual(weathered.plants, ordinary.plants);
    assert.deepEqual(weathered.pond, ordinary.pond); assert.deepEqual(weathered.terrain, ordinary.terrain);
  }
});

test('wetness is integrated as a short-lived mist, not retained over a long offline step', () => {
  const dry = withCondition(); for (const item of dry.decorations) item.condition!.wetness = 0;
  const wet = structuredClone(dry); wet.decorations[0].condition!.wetness = 1;
  const elapsed = 30 * DAY, dryResult = advanceSimulation(frozen(dry), elapsed, 'offline', NOW + elapsed), wetResult = advanceSimulation(frozen(wet), elapsed, 'offline', NOW + elapsed);
  const difference = wetResult.decorations[0].condition!.decay - dryResult.decorations[0].condition!.decay;
  assert.ok(difference > 0);
  const integratedWetDays = WETNESS_HALF_LIFE_MILLISECONDS / Math.LN2 / DAY;
  assert.ok(difference <= .1 * WOOD_DAMP_DECAY_RATE * integratedWetDays + 1e-12, 'the wet contribution is bounded by its actual half-life integral');
});

test('moist surroundings increase cosmetic weathering and vacation slows it without changing time', () => {
  const wet = withCondition(), dry = withCondition();
  wet.environment = { temperature: 22, light: 0 }; dry.environment = { temperature: 22, light: 0 };
  wet.ecology = { moisture: 1, humidity: 1, waterReserve: 1, simulatedDays: 0 };
  dry.ecology = { moisture: 0, humidity: 0, waterReserve: 0, simulatedDays: 0 };
  for (const state of [wet, dry]) for (const item of state.decorations) item.condition!.wetness = 0;
  const vacation = { ...structuredClone(wet), vacation: true };
  const wetResult = advanceSimulation(frozen(wet), DAY, 'offline', NOW + DAY), dryResult = advanceSimulation(frozen(dry), DAY, 'offline', NOW + DAY), slowResult = advanceSimulation(frozen(vacation), DAY, 'offline', NOW + DAY);
  assert.ok(wetResult.decorations[0].condition!.decay > dryResult.decorations[0].condition!.decay);
  assert.ok(slowResult.decorations[0].condition!.decay < wetResult.decorations[0].condition!.decay);
  assert.equal(slowResult.ecology.simulatedDays, wetResult.ecology.simulatedDays);
});

test('zero elapsed and ecological age ceiling preserve decay while real-time wetness may expire', () => {
  const state = frozen(withCondition());
  assert.deepEqual(advanceSimulation(state, 0, 'online', NOW), state);
  const capped = { ...structuredClone(state), ecology: { ...state.ecology, simulatedDays: MAX_SIMULATED_DAYS } };
  const result = advanceSimulation(frozen(capped), 90_000, 'online', NOW + 90_000);
  assert.deepEqual(result.ecology, capped.ecology);
  for (let index = 0; index < result.decorations.length; index++) { close(result.decorations[index].condition!.wetness, .5); close(result.decorations[index].condition!.decay, capped.decorations[index].condition!.decay); }
});

test('resized and reshaped support groups preserve the existing move, detach and parent-removal contract', () => {
  let state = applyAction(frozen(forest()), { type: 'resize-decoration', id: 'wood', scale: 2 }, NOW);
  state = applyAction(state, { type: 'wood-form', id: 'wood', value: { length: 2, angle: 160, branches: [] } }, NOW);
  const moved = applyAction(frozen(state), { type: 'move-decoration', id: 'wood', x: .4, y: .5 }, NOW);
  for (const item of [...moved.plants, ...moved.decorations]) {
    const previous = [...state.plants, ...state.decorations].find(entry => entry.id === item.id)!;
    close(item.x - previous.x, .1); close(item.y - previous.y, .1); assert.equal(item.scale, previous.scale); assert.deepEqual(item.support, previous.support);
  }
  const removed = applyAction(moved, { type: 'remove-decoration', id: 'wood' }, NOW);
  assert.equal(removed.decorations[0].support, undefined); close(removed.decorations[0].x, .55);
  assert.deepEqual(removed.decorations[1].support, { parentId: 'stone', x: .6 });
  assert.deepEqual(removed.plants.map(item => item.support), moved.plants.map(item => item.support));
  const detached = applyAction(moved, { type: 'move-decoration', id: 'stump', x: .2, y: .3, support: null }, NOW);
  assert.equal(detached.decorations[2].support, undefined); assert.deepEqual(validateState(detached), detached);
});

test('legacy schema-2 reads/actions stay lossless while elapsed time initializes v0.9 ecological coatings without changing geometry', () => {
  const state = frozen(forest());
  for (const action of [{ type: 'starter' }, { type: 'sunlight' }, { type: 'resize-decoration', id: 'wood', scale: .4 }] as const) {
    const result = applyAction(state, action, NOW);
    for (const item of result.decorations) { assert.equal(Object.hasOwn(item, 'wood'), false); assert.equal(Object.hasOwn(item, 'condition'), false); }
  }
  for (const mode of ['online', 'offline'] as const) {
    const result = advanceSimulation(state, 30 * DAY, mode, NOW + 30 * DAY);
    assert.deepEqual(result.decorations.map(withoutCondition), state.decorations);
    assert(result.decorations.filter(item => item.kind === 'wood' || item.kind === 'stump').every(item => item.condition && item.condition.decay > 0));
    assert.deepEqual(validateState(result), result);
  }
  assert.deepEqual(migrateSaveState(JSON.parse(JSON.stringify(state))), state);
});

test('legacy v1 strictly rejects wood/condition fields while old decoration output remains unchanged', () => {
  const initial = createInitialState(NOW), { terrain: _terrain, care: _care, ...base } = initial;
  const decoration: Decoration = { id: 'old-wood', kind: 'wood', x: .5, y: .5, scale: 2 };
  const legacy = { ...base, schemaVersion: 1, layers: [{ material: 'gravel', depth: .2 }, { material: 'clay', depth: .2 }, { material: 'soil', depth: .4 }], decorations: [decoration] };
  const old = migrateSaveState(legacy); assert.deepEqual(old.decorations, [decoration]);
  for (const extra of [{ wood: woodForm() }, { condition: { wetness: 0, decay: 0 } }]) assert.throws(() => migrateSaveState({ ...legacy, decorations: [{ ...decoration, ...extra }] }));
});
