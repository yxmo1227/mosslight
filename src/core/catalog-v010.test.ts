import assert from 'node:assert/strict';
import test from 'node:test';
import type { DecorationKind, PlantKind, TerrariumState, WoodForm } from '../shared/types';
import { DECORATION_ITEMS, isFloatingDecoration, isMossKind, isMushroomKind, PLANT_ITEMS, WOOD_PRESETS } from '../shared/catalog';
import { advanceSimulation, applyAction, createInitialState, DAY_MILLISECONDS } from './simulation';
import { migrateSaveState, validateAction, validateState, validateWoodForm } from './validation';

const NOW = 1000;
const NEW_PLANTS: PlantKind[] = ['star-moss', 'fern-moss', 'creeping-fig', 'oxalis', 'scarlet-mushroom', 'violet-mushroom'];
const NEW_OBJECTS: DecorationKind[] = ['fairy', 'gardener', 'reader', 'cat', 'dog', 'mushroom-house', 'treehouse', 'arc-lamp', 'slender-steps', 'sun', 'moon', 'star'];
const FLOATS = NEW_OBJECTS.filter(isFloatingDecoration);
const advance = (state: TerrariumState, days: number): TerrariumState => advanceSimulation(state, days * DAY_MILLISECONDS, 'offline', state.updatedAt + days * DAY_MILLISECONDS);
const addObject = (state: TerrariumState, kind: DecorationKind, extra = {}): TerrariumState => applyAction(state, { type: 'add-decoration', kind, x: .5, y: .4, ...extra }, state.updatedAt);

test('v0.10 catalog kinds round-trip through actions, validation and JSON import without sharing user state', () => {
  assert.equal(new Set(PLANT_ITEMS.map(item => item.id)).size, PLANT_ITEMS.length);
  assert.equal(new Set(DECORATION_ITEMS.map(item => item.id)).size, DECORATION_ITEMS.length);
  for (const kind of NEW_PLANTS) {
    assert(PLANT_ITEMS.some(item => item.id === kind));
    const initial = createInitialState(NOW);
    const result = applyAction(initial, { type: 'add-plant', kind, x: .2, y: .8 }, NOW);
    assert.equal(result.plants[0].kind, kind); assert.deepEqual(initial.plants, []);
    assert.deepEqual(migrateSaveState(JSON.parse(JSON.stringify(result))), result);
    const clone = validateState(result); assert.notEqual(clone.plants[0], result.plants[0]);
  }
  for (const kind of NEW_OBJECTS) {
    assert(DECORATION_ITEMS.some(item => item.id === kind));
    const state = addObject(createInitialState(NOW), kind);
    assert.equal(state.decorations[0].kind, kind);
    assert.deepEqual(migrateSaveState(JSON.parse(JSON.stringify(state))), state);
  }
  for (const kind of ['not-a-plant', 'star-moss ', 'Scarlet-mushroom', null, {}, '__proto__']) {
    assert.throws(() => validateAction({ type: 'add-plant', kind, x: .5, y: .5 }));
    assert.throws(() => validateAction({ type: 'add-decoration', kind, x: .5, y: .5 }));
  }
});

test('new mosses and mushrooms use category-wide spread and lifecycle; greenery remains nonreproductive foliage', () => {
  for (const kind of NEW_PLANTS) {
    let state = applyAction(createInitialState(NOW), { type: 'add-plant', kind, x: .5, y: .4 }, NOW);
    state = addObject(state, 'mushroom-house');
    const result = advance(state, 365), plant = result.plants[0];
    assert(plant.health > .55 && plant.growth > .9, `${kind} grows under suitable conditions`);
    if (isMossKind(kind)) {
      assert(plant.ecology!.spread > .9); assert(result.decorations[0].colonization!.moss > .85);
      assert.equal(result.plants.length, 1);
    } else if (isMushroomKind(kind)) {
      assert.equal(result.plants.length, 3);
      assert(result.plants.slice(1).every(item => item.kind === kind && item.ecology!.parentId === plant.id));
      assert.notEqual(plant.ecology!.cycle, .2);
      assert.equal(result.decorations[0].colonization, undefined);
    } else {
      assert.equal(plant.ecology!.spread, 0); assert.equal(result.plants.length, 1);
      assert.equal(result.decorations[0].colonization, undefined);
    }
    assert.deepEqual(validateState(result), result);
  }
});

test('all added plant kinds retain reversible drying without permanent death; mushrooms do not require photosynthesis', () => {
  for (const kind of NEW_PLANTS) {
    const state = applyAction(createInitialState(NOW), { type: 'add-plant', kind, x: .5, y: .5 }, NOW);
    state.plants[0].growth = 1;
    state.environment = { temperature: 35, light: 1 };
    state.ecology.moisture = state.ecology.waterReserve = state.ecology.humidity = 0;
    const dried = advance(state, 73);
    assert.equal(dried.plants[0].id, state.plants[0].id);
    assert(dried.plants[0].growth < .25 && dried.plants[0].ecology!.drought > .99);
    assert(dried.plants[0].health >= .12);
    let recovering = applyAction(dried, { type: 'environment', temperature: 22, light: .55 }, dried.updatedAt);
    for (let i = 0; i < 4; i++) recovering = applyAction(recovering, { type: 'water', amount: .2 }, recovering.updatedAt);
    const healthy = advance(recovering, 60);
    assert(healthy.plants[0].health > .6 && healthy.plants[0].growth > .65, `${kind} recovers`);
    if (isMushroomKind(kind)) {
      const dark = applyAction(createInitialState(NOW), { type: 'add-plant', kind, x: .5, y: .5 }, NOW);
      dark.environment.light = 0;
      assert(advance(dark, 90).plants.length > 1, `${kind} supports dim/dark fungal growth`);
    }
  }
});

test('floating ornaments preserve free x/y and never acquire moss, wetness or wood condition', () => {
  for (const kind of FLOATS) {
    let state = addObject(createInitialState(NOW), kind, { x: .23, y: .18 });
    const id = state.decorations[0].id;
    state = applyAction(state, { type: 'move-decoration', id, x: .76, y: .25 }, NOW);
    state = applyAction(state, { type: 'resize-decoration', id, scale: 1.8 }, NOW);
    state = applyAction(state, { type: 'add-plant', kind: 'star-moss', x: .76, y: .25 }, NOW);
    state = addObject(state, 'treehouse', { x: .76, y: .25 });
    const before = structuredClone(state.decorations[0]);
    const misted = applyAction(state, { type: 'spray-decoration', decorationId: id, amount: .025 }, NOW);
    assert(misted.ecology.moisture > state.ecology.moisture, 'spray water still reaches the bottle');
    assert.deepEqual(misted.decorations[0], before, 'ornaments do not get solid-surface wetness');
    const year = advance(misted, 365);
    assert.deepEqual(year.decorations[0], before);
    assert(year.decorations[1].colonization!.moss > .8, 'structural objects still receive normal moss growth');
    assert.deepEqual(validateState(year), year);
  }
});

test('floating ornaments reject attachments to themselves or as any other entity support, atomically', () => {
  for (const kind of FLOATS) {
    let state = addObject(createInitialState(NOW), 'stone');
    const stoneId = state.decorations[0].id;
    assert.throws(() => validateAction({ type: 'add-decoration', kind, x: .5, y: .5, support: { parentId: stoneId, x: .5 } }), /floating/);
    state = addObject(state, kind);
    const id = state.decorations[1].id, snapshot = structuredClone(state);
    assert.throws(() => applyAction(state, { type: 'move-decoration', id, x: .1, y: .1, support: { parentId: stoneId, x: .5 } }, NOW), /floating/);
    for (const command of [
      { type: 'add-plant', kind: 'star-moss' },
      { type: 'add-decoration', kind: 'stone' },
      { type: 'move-decoration', id: stoneId },
    ]) assert.throws(() => applyAction(state, { ...command, x: .5, y: .5, support: { parentId: id, x: .5 } }, NOW), /floating/);
    const planted = applyAction(state, { type: 'add-plant', kind: 'fern-moss', x: .5, y: .5 }, NOW);
    assert.throws(() => applyAction(planted, { type: 'move-plant', id: planted.plants[0].id, x: .1, y: .1, support: { parentId: id, x: .5 } }, NOW), /floating/);
    const badParent = structuredClone(state); badParent.decorations[0].support = { parentId: id, x: .5 };
    assert.throws(() => validateState(badParent), /floating/);
    for (const property of [{ support: { parentId: stoneId, x: .5 } }, { condition: { wetness: 0, decay: 0 } }, { colonization: { moss: 0, health: 1 } }]) {
      const invalid = structuredClone(state); Object.assign(invalid.decorations[1], property);
      assert.throws(() => validateState(invalid), /floating/);
    }
    assert.deepEqual(state, snapshot);
  }
});

test('wood tone is optional exact plain data and survives form edits, pose, resize, simulation and import', () => {
  const old: WoodForm = { length: 1.4, angle: -20, branches: [{ at: .3, length: .4, angle: 50 }], bend: -.1 };
  assert.deepEqual(validateWoodForm(old), old);
  for (const tone of ['natural', 'birch', 'charred'] as const) {
    let state = addObject(createInitialState(NOW), 'wood'); const id = state.decorations[0].id;
    const form = { ...structuredClone(old), tone };
    state = applyAction(state, { type: 'wood-form', id, value: form }, NOW);
    assert.deepEqual(state.decorations[0].wood, form); assert.notEqual(state.decorations[0].wood, form);
    assert.notEqual(state.decorations[0].wood!.branches[0], form.branches[0]);
    for (const action of [
      { type: 'move-decoration', id, x: .6, y: .7 }, { type: 'resize-decoration', id, scale: 1.8 },
      { type: 'object-pose', id, value: { angle: 80, flipX: true } },
    ]) state = applyAction(state, action, NOW);
    state = advance(state, 365);
    assert.deepEqual(state.decorations[0].wood, form);
    assert.deepEqual(migrateSaveState(JSON.parse(JSON.stringify(state))), state);
  }
  assert.equal(WOOD_PRESETS.find(item => item.id === 'double-fork')!.form.tone, 'birch');
  assert.equal(WOOD_PRESETS.find(item => item.id === 'branched')!.form.tone, 'charred');
  for (const tone of [null, undefined, 'Birch', 'natural ', 'moldy', {}, 0, new String('birch')]) {
    assert.throws(() => validateWoodForm({ ...old, tone }));
  }
  assert.throws(() => validateWoodForm({ ...old, tone: 'natural', opacity: 1 }));
  let calls = 0;
  assert.throws(() => validateWoodForm({ ...old, get tone() { calls++; return 'birch'; } }));
  assert.equal(calls, 0);
});

test('hidden legacy path remains valid through add, edit, attachment, spray and old-save round-trip', () => {
  assert(!DECORATION_ITEMS.some(item => (item.id as string) === 'path'));
  let state = addObject(createInitialState(NOW), 'stone'), stoneId = state.decorations[0].id;
  state = addObject(state, 'path', { support: { parentId: stoneId, x: .45 } });
  const pathId = state.decorations[1].id;
  state = applyAction(state, { type: 'move-decoration', id: pathId, x: .3, y: .6 }, NOW);
  state = applyAction(state, { type: 'spray-decoration', decorationId: pathId, amount: .02 }, NOW);
  assert.equal(state.decorations[1].kind, 'path'); assert.deepEqual(state.decorations[1].support, { parentId: stoneId, x: .45 });
  assert.deepEqual(migrateSaveState(JSON.parse(JSON.stringify(state))), state);
  assert.deepEqual(validateState(advance(state, 365)), advance(state, 365));
});
