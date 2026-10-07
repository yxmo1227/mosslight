import assert from 'node:assert/strict';
import test from 'node:test';
import { GLASS_BANDS, GLASS_HEIGHT_LIMITS, MAX_SUPPORT_DEPTH } from '../shared/catalog';
import type { GlassForm, MaterialKind, TerrariumState } from '../shared/types';
import { advanceSimulation, applyAction, createInitialState } from './simulation';
import { migrateSaveState, validateAction, validateState } from './validation';

const NOW = 1000;
function frozen<T>(value: T): T { if (value && typeof value === 'object') { for (const nested of Object.values(value)) frozen(nested); Object.freeze(value); } return value; }
function tree(): TerrariumState {
  const state = createInitialState(NOW);
  state.decorations = [
    { id: 'root', kind: 'wood', x: .3, y: .4, scale: 1 },
    { id: 'stone', kind: 'stone', x: .45, y: .5, scale: 1, support: { parentId: 'root', x: .7 } },
    { id: 'stump', kind: 'stump', x: .6, y: .6, scale: 1, support: { parentId: 'stone', x: .6 } },
  ];
  state.plants = [{ id: 'moss', kind: 'sheet-moss', x: .55, y: .7, scale: 1, growth: .4, health: .9, ageDays: 1, wetness: 0, support: { parentId: 'stump', x: .4 } }];
  return state;
}
function form(): GlassForm {
  return { lower: .82, middle: 1, upper: .72, facets: 7, sides: {
    left: { lower: { width: .4, height: .12 }, middle: { width: .8, height: .4 }, upper: { width: 1.35, height: .76 } },
    right: { lower: { width: 1.35, height: .36 }, middle: { width: 1.1, height: .7 }, upper: { width: .4, height: 1.08 } },
  } };
}
const close = (actual: number, expected: number): void => assert.ok(Math.abs(actual - expected) < 1e-12);

test('asymmetric glass controls and every polygon count validate, clone and survive care actions', () => {
  for (let facets = 5; facets <= 16; facets++) {
    const input = frozen({ ...form(), facets });
    const original = frozen({ ...createInitialState(NOW), bottle: 'glass-box' as const });
    const shaped = applyAction(original, { type: 'glass-form', value: input }, NOW);
    assert.deepEqual(shaped.glassForm, input);
    assert.notEqual(shaped.glassForm?.sides?.left.lower, input.sides?.left.lower);
    const imported = migrateSaveState(JSON.parse(JSON.stringify(shaped)));
    assert.deepEqual(imported, shaped);
    const cared = applyAction(shaped, { type: 'sunlight' }, NOW + 1);
    assert.deepEqual(cared.glassForm, input);
    assert.deepEqual(advanceSimulation(cared, 1000, 'online', NOW + 1001).glassForm, input);
  }
  const old = { ...createInitialState(NOW), glassForm: { lower: .82, middle: 1, upper: .72, facets: 8 } };
  assert.deepEqual(validateState(old), old); assert.equal(Object.hasOwn(validateState(old).glassForm!, 'sides'), false);
});

test('bilateral glass validation rejects incomplete, crossing-range and hostile controls', () => {
  const reject = (value: unknown): void => {
    assert.throws(() => validateState({ ...createInitialState(NOW), glassForm: value }));
    assert.throws(() => validateAction({ type: 'glass-form', value }));
  };
  for (const side of ['left', 'right'] as const) for (const band of GLASS_BANDS) {
    for (const [key, bad] of [['width', .399], ['width', 1.351], ['height', GLASS_HEIGHT_LIMITS[band][0] - .001], ['height', GLASS_HEIGHT_LIMITS[band][1] + .001], ['width', NaN], ['height', Infinity]] as const) {
      const value = form(); value.sides![side][band][key] = bad; reject(value);
    }
  }
  for (const sides of [null, undefined, [], {}, { left: form().sides!.left }, { ...form().sides!, extra: true }]) reject({ ...form(), sides });
  const missing = form(); Reflect.deleteProperty(missing.sides!.left, 'lower'); reject(missing);
  const extra = form(); Object.assign(extra.sides!.right.upper, { script: 'no' }); reject(extra);
  let calls = 0; const accessor = form(); Object.defineProperty(accessor.sides!.left.lower, 'width', { enumerable: true, get() { calls++; return 1; } }); reject(accessor); assert.equal(calls, 0);
});

test('support forests are detached on import and preserve all original fallback and local coordinates', () => {
  const input = frozen(tree()), result = validateState(input);
  assert.deepEqual(result, input); assert.deepEqual(migrateSaveState(JSON.parse(JSON.stringify(input))), input);
  assert.notEqual(result.plants[0].support, input.plants[0].support);
  assert.notEqual(result.decorations[1].support, input.decorations[1].support);
  const advanced = advanceSimulation(input, 3600000, 'online', NOW + 3600000);
  assert.deepEqual(advanced.decorations.map(({ condition: _condition, colonization: _colonization, ...geometry }) => geometry), input.decorations);
  assert.deepEqual(advanced.plants.map(item => [item.id, item.x, item.y, item.scale, item.support]), input.plants.map(item => [item.id, item.x, item.y, item.scale, item.support]));
});

test('moving a support translates all descendants once, clamps the group and preserves local attachment x', () => {
  const input = frozen(tree());
  const result = applyAction(input, { type: 'move-decoration', id: 'root', x: .5, y: .55 }, NOW + 1);
  for (const item of [...result.decorations, ...result.plants]) {
    const previous = [...input.decorations, ...input.plants].find(entry => entry.id === item.id)!;
    close(item.x - previous.x, .2); close(item.y - previous.y, .15);
    assert.deepEqual(item.support, previous.support);
  }
  const edge = applyAction(input, { type: 'move-decoration', id: 'root', x: 1, y: 1 }, NOW + 1);
  for (const item of [...edge.decorations, ...edge.plants]) {
    const previous = [...input.decorations, ...input.plants].find(entry => entry.id === item.id)!;
    close(item.x - previous.x, .4); close(item.y - previous.y, .3);
  }
  close(input.decorations[0].x, .3); assert.deepEqual(validateState(edge), edge);
});

test('move omission preserves attachment; explicit null detaches and parent removal only detaches immediate children', () => {
  const input = frozen(tree());
  const moved = applyAction(input, { type: 'move-plant', id: 'moss', x: .56, y: .7 }, NOW + 1);
  assert.deepEqual(moved.plants[0].support, input.plants[0].support);
  const detached = applyAction(input, { type: 'move-plant', id: 'moss', x: .2, y: .3, support: null }, NOW + 1);
  assert.equal(Object.hasOwn(detached.plants[0], 'support'), false); assert.equal(detached.plants[0].x, .2);
  const removed = applyAction(input, { type: 'remove-decoration', id: 'root' }, NOW + 1);
  assert.equal(Object.hasOwn(removed.decorations[0], 'support'), false);
  assert.equal(removed.decorations[0].x, .45); assert.equal(removed.decorations[0].y, .5);
  assert.deepEqual(removed.decorations[1].support, { parentId: 'stone', x: .6 });
  assert.deepEqual(removed.plants[0].support, { parentId: 'stump', x: .4 });
  assert.deepEqual(validateState(removed), removed);
});

test('support validation rejects missing, plant, self, cyclic and overly deep parents atomically', () => {
  for (const parentId of ['missing', 'moss', 'root', 'stone', 'stump']) {
    const input = frozen(tree());
    assert.throws(() => applyAction(input, { type: 'move-decoration', id: 'root', x: .3, y: .4, support: { parentId, x: .5 } }, NOW + 1));
    assert.equal(input.decorations[0].support, undefined);
  }
  const state = createInitialState(NOW);
  state.decorations = Array.from({ length: MAX_SUPPORT_DEPTH + 1 }, (_, index) => ({ id: `d${index}`, kind: 'stone', x: .5, y: .5, scale: 1, ...(index ? { support: { parentId: `d${index - 1}`, x: .5 } } : {}) }));
  assert.deepEqual(validateState(state), state);
  const tooDeep = { ...state, plants: [{ ...tree().plants[0], support: { parentId: `d${MAX_SUPPORT_DEPTH}`, x: .5 } }] };
  assert.throws(() => validateState(tooDeep));
  assert.throws(() => applyAction(frozen(state), { type: 'add-plant', kind: 'cushion-moss', x: .5, y: .5, support: { parentId: `d${MAX_SUPPORT_DEPTH}`, x: .5 } }, NOW));
});

test('attachment plain-data and action optional fields reject hostile values without invoking getters', () => {
  const values: unknown[] = [undefined, null, [], {}, { parentId: 'root' }, { parentId: 'root', x: -.01 }, { parentId: 'root', x: 1.01 }, { parentId: 'root', x: NaN }, { parentId: 'root', x: '0.5' }, { parentId: 'root', x: .5, extra: true }, Object.create({ parentId: 'root', x: .5 })];
  let calls = 0; values.push({ parentId: 'root', get x() { calls++; return .5; } });
  for (const support of values) {
    const state = tree(); Object.assign(state.plants[0], { support }); assert.throws(() => validateState(state));
    assert.throws(() => validateAction({ type: 'add-plant', kind: 'fern', x: .5, y: .5, support }));
    if (support !== null) assert.throws(() => validateAction({ type: 'move-decoration', id: 'root', x: .5, y: .5, support }));
  }
  assert.equal(calls, 0);
});

test('new mushrooms and stump are bounded original kinds, never accepted by legacy schema-1 imports', () => {
  for (const kind of ['amber-mushroom', 'ivory-mushroom'] as const) {
    const state = applyAction(createInitialState(NOW), { type: 'add-plant', kind, x: .5, y: .5 }, NOW);
    const advanced = advanceSimulation(frozen(state), 3600000, 'online', NOW + 3600000);
    assert.equal(advanced.plants[0].kind, kind); assert.ok(advanced.plants[0].growth > state.plants[0].growth);
    assert.deepEqual(validateState(advanced), advanced);
    const { terrain: _terrain, care: _care, ...base } = state;
    const legacy = { ...base, schemaVersion: 1, layers: [{ material: 'gravel', depth: .2 }, { material: 'clay', depth: .2 }, { material: 'soil', depth: .4 }], plants: state.plants.map(({ wetness: _wetness, ...plant }) => plant) };
    assert.throws(() => migrateSaveState(legacy));
  }
  const stump = applyAction(createInitialState(NOW), { type: 'add-decoration', kind: 'stump', x: .5, y: .5 }, NOW);
  assert.equal(stump.decorations[0].kind, 'stump');
  const { terrain: _terrain, care: _care, ...base } = stump;
  const legacy = { ...base, schemaVersion: 1, layers: [{ material: 'gravel', depth: .2 }, { material: 'clay', depth: .2 }, { material: 'soil', depth: .4 }] };
  assert.throws(() => migrateSaveState(legacy));
  legacy.decorations[0].kind = 'wood'; legacy.decorations[0].support = { parentId: 'missing', x: .5 };
  assert.throws(() => migrateSaveState(legacy));
});

test('pond state survives save without instant care rewards, then joins the v0.9 water cycle during time', () => {
  const original = frozen(applyAction(createInitialState(NOW), { type: 'starter' }, NOW));
  const watered = applyAction(original, { type: 'pour-water', x: .5, amount: 32 }, NOW);
  assert.equal(watered.pond!.depths.reduce((sum, depth) => sum + depth, 0), 32);
  assert.deepEqual(watered.ecology, original.ecology); assert.deepEqual(watered.plants, original.plants); assert.deepEqual(watered.care, original.care);
  assert.deepEqual(migrateSaveState(JSON.parse(JSON.stringify(watered))), watered);
  for (const mode of ['online', 'offline'] as const) {
    const dry = advanceSimulation(original, 3600000, mode, NOW + 3600000), wet = advanceSimulation(watered, 3600000, mode, NOW + 3600000);
    assert(wet.ecology.moisture > dry.ecology.moisture, 'pond capillary water reaches the soil');
    const remaining = (wet.pond!.depths.reduce((sum, value) => sum + value, 0) - (wet.pond!.exchange ?? 0)) / 480;
    assert(remaining < 32 / 480, 'visible pond inventory supplies that moisture');
    const stored = (state: typeof wet): number => state.ecology.moisture + state.ecology.waterReserve + state.ecology.humidity * .08;
    assert(Math.abs(stored(wet) + remaining - stored(watered) - 32 / 480) < 1e-9, 'closed unified water inventory is conserved');
  }
  const filled = { ...watered, terrain: { columns: Array.from({ length: 48 }, () => Array<MaterialKind>(100).fill('soil')) }, pond: { depths: Array(48).fill(12) } };
  const poured = applyAction(frozen(filled), { type: 'pour', material: 'clay', x: .5, amount: 8 }, NOW + 1);
  assert.equal(poured.pond!.depths.reduce((a, b) => a + b), 48 * 12 - 8, 'overflow equals exact displaced inventory when globally full');
  assert.deepEqual(poured.ecology, filled.ecology);
  const scooped = applyAction(poured, { type: 'scoop', x: .5, amount: 24 }, NOW + 2);
  assert.equal(scooped.pond!.depths.reduce((a, b) => a + b), 48 * 12 - 8);
  assert.deepEqual(validateState(scooped), scooped);
  const reset = applyAction(watered, { type: 'reset' }, NOW + 1); assert.equal(Object.hasOwn(reset, 'pond'), false);
});

test('pond and water action schema reject unbounded, fractional, sparse, accessor and extra fields', () => {
  const pond = { depths: Array(48).fill(0) }; const state = createInitialState(NOW);
  for (const input of [undefined, null, [], {}, { depths: Array(47).fill(0) }, { depths: Array(49).fill(0) }, { ...pond, execute: true }]) assert.throws(() => validateState({ ...state, pond: input }));
  for (const bad of [NaN, Infinity, -1, .5, 113, '1', null]) { const copy = structuredClone(pond); copy.depths[0] = bad; assert.throws(() => validateState({ ...state, pond: copy })); }
  const sparse = structuredClone(pond); delete sparse.depths[5]; assert.throws(() => validateState({ ...state, pond: sparse }));
  let calls = 0; const accessor = structuredClone(pond); Object.defineProperty(accessor.depths, '0', { enumerable: true, get() { calls++; return 0; } }); assert.throws(() => validateState({ ...state, pond: accessor })); assert.equal(calls, 0);
  assert.throws(() => validateState({ ...state, pond: { depths: Array(48).fill(103) } }), 'solid plus water must not exceed112');
  for (const type of ['pour-water', 'drain-water']) for (const amount of [0, 33, .5, NaN, Infinity]) assert.throws(() => validateAction({ type, x: .5, amount }));
  assert.throws(() => validateAction({ type: 'pour-water', x: .5, amount: 1, radius: 4 }));
  assert.throws(() => validateAction({ type: 'drain-water', x: .5, amount: 1, radius: 9 }));
  assert.deepEqual(validateAction({ type: 'drain-water', x: .5, amount: 32, radius: 8 }), { type: 'drain-water', x: .5, amount: 32, radius: 8 });
  assert.equal(Object.hasOwn(validateState(state), 'pond'), false);
});
