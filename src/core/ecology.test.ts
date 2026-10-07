import assert from 'node:assert/strict';
import test from 'node:test';
import type { PlantKind, TerrariumState } from '../shared/types';
import { advanceSimulation, applyAction, createInitialState, DAY_MILLISECONDS as DAY, WATER_VAPOR_CAPACITY } from './simulation';
import { MAX_PLANTS, MIN_HEALTH, validateState } from './validation';
import { drainPond, pondWater, pourPond, reconcilePond, withdrawPondWater } from './hydrology';

function forest(): TerrariumState {
  const state = createInitialState(0);
  state.plants = (['sheet-moss', 'cushion-moss', 'fern', 'fittonia', 'amber-mushroom', 'ivory-mushroom'] as PlantKind[]).map((kind, i) => ({
    id: `plant-${i}`, kind, x: .35 + i * .04, y: .6, scale: 1, growth: .18, health: .9, ageDays: 0, wetness: 0,
  }));
  state.decorations = [
    { id: 'house', kind: 'cottage', x: .55, y: .6, scale: 1 },
    { id: 'stairs', kind: 'steps', x: .6, y: .6, scale: 1 },
    { id: 'wood', kind: 'wood', x: .4, y: .6, scale: 1 },
  ];
  return state;
}
const advance = (state: TerrariumState, days: number): TerrariumState => advanceSimulation(state, days * DAY, 'offline', Math.min(8e15, state.updatedAt + Math.ceil(days * DAY)));
const inventory = (state: TerrariumState): number => state.ecology.moisture + state.ecology.waterReserve + state.ecology.humidity * WATER_VAPOR_CAPACITY + pondWater(state.pond);
const close = (a: number, b: number, tolerance = 1e-8): void => assert(Math.abs(a - b) <= tolerance, `${a} != ${b}`);

test('healthy moss spreads markedly onto existing houses, stairs and wood while preserving authored geometry', () => {
  const state = forest(), after73 = advance(state, 73), year = advance(state, 365);
  assert(after73.plants[0].ecology!.spread > .6);
  for (const item of year.decorations) {
    assert(item.colonization!.moss > .9, `${item.kind} has a broad contiguous moss coating`);
    assert(item.colonization!.health > .65);
    const old = state.decorations.find(old => old.id === item.id)!;
    assert.deepEqual([item.x, item.y, item.scale, item.support], [old.x, old.y, old.scale, old.support]);
  }
  assert.deepEqual(year.terrain, state.terrain);
  assert.deepEqual(validateState(year), year);
});

test('new mushroom clusters have persistent authored provenance, independent phases and bounded nonrecursive reproduction', () => {
  const state = forest(), result = advance(state, 1095);
  const children = result.plants.filter(plant => plant.ecology?.generation === 1);
  assert.equal(children.length, 4);
  assert.equal(result.plants.length, 10);
  for (const child of children) {
    const parent = result.plants.find(parent => parent.id === child.ecology!.parentId)!;
    assert.equal(parent.kind, child.kind); assert.equal(parent.ecology!.generation, 0);
    assert.notEqual(child.ecology!.cycle, parent.ecology!.cycle);
    assert.equal(child.ecology!.offspring, undefined);
  }
  const repeated = advance(state, 1095); assert.deepEqual(repeated, result);
  assert.equal(advance(result, 3650).plants.length, result.plants.length);
  const removedChild = applyAction(result, { type: 'remove-plant', id: children[0].id }, result.updatedAt);
  assert(!advance(removedChild, 365).plants.some(plant => plant.id === children[0].id), 'deleting a spawned child is respected');
  const sourceId = children[1].ecology!.parentId!;
  const removedSource = applyAction(result, { type: 'remove-plant', id: sourceId }, result.updatedAt);
  assert(!removedSource.plants.some(plant => plant.ecology?.parentId === sourceId));
  assert.deepEqual(validateState(removedSource), removedSource);
});

test('no moss or fungal sources means no spontaneous colonies, and full user collections are not displaced', () => {
  const empty = forest(); empty.plants = [];
  const after = advance(empty, 1095);
  assert.equal(after.plants.length, 0); assert(after.decorations.every(item => !item.colonization));
  const crowded = forest();
  crowded.plants = Array.from({ length: MAX_PLANTS }, (_, i) => ({ ...crowded.plants[4], id: `manual-${i}` }));
  const result = advance(crowded, 1095);
  assert.deepEqual(result.plants.map(p => p.id), crowded.plants.map(p => p.id));
  assert(result.plants.every(p => p.ecology!.generation === 0));
});

test('dark fungi use organic substrate instead of a photosynthesis requirement', () => {
  const state = forest(); state.environment.light = 0;
  const result = advance(state, 60);
  assert(result.plants.find(p => p.kind === 'amber-mushroom')!.growth > .7);
  assert.equal(result.plants.find(p => p.kind === 'fern')!.growth, .18);
  assert(result.plants.some(p => p.ecology?.generation === 1));
  const matureDark = advance(forest(), 365); matureDark.environment.light = 0;
  const dormant = advance(matureDark, 90);
  dormant.decorations.push({ id: 'new-dark-house', kind: 'cottage', x: .4, y: .6, scale: 1 });
  assert(!advance(dormant, 365).decorations.find(item => item.id === 'new-dark-house')!.colonization,
    'dormant unlit moss does not coat newly placed objects merely because it was once mature');
  dormant.plants = dormant.plants.filter(plant => !plant.kind.includes('moss'));
  assert(advance(dormant, 90).decorations[0].colonization!.health < .15,
    'established surface mats remain light-dependent after the original movable moss is removed');
});

test('drought visibly shrinks living foliage and care reverses dormancy without replacing authored entities', () => {
  const state = forest(); state.closed = false;
  for (const plant of state.plants) plant.growth = 1;
  state.environment = { temperature: 35, light: 1 };
  state.ecology.moisture = state.ecology.humidity = state.ecology.waterReserve = 0;
  const dry = advance(state, 73);
  assert.deepEqual(dry.plants.map(p => p.id), state.plants.map(p => p.id));
  for (const plant of dry.plants) {
    assert(plant.ecology!.drought > .99); assert(plant.growth < .25);
    assert(plant.health >= MIN_HEALTH && plant.health < .15);
  }
  assert.equal(dry.decorations[2].condition!.decay, 0, 'bone-dry wood is not biologically rotting');
  let cared = applyAction(dry, { type: 'environment', temperature: 22, light: .55 }, dry.updatedAt);
  cared = applyAction(cared, { type: 'lid', closed: true }, cared.updatedAt);
  for (let i = 0; i < 4; i++) cared = applyAction(cared, { type: 'water', amount: .2 }, cared.updatedAt);
  const recovered = advance(cared, 45);
  for (const plant of recovered.plants.filter(p => p.ecology!.generation === 0)) {
    assert(plant.ecology!.drought < .01); assert(plant.health > .6); assert(plant.growth > .55);
  }
});

test('persistent bright heat stresses wet plants; quick-care sunlight alone does not rewrite the permanent climate', () => {
  const state = forest(); state.environment = { temperature: 35, light: 1 };
  const stressed = advance(state, 30);
  assert(stressed.ecology.moisture > .5);
  assert(stressed.plants.every(p => p.ecology!.drought > .99));
  const coolBright = forest(); coolBright.environment = { temperature: 22, light: 1 };
  const bleached = advance(coolBright, 30);
  assert(bleached.plants.every(p => p.ecology!.drought > .79 && p.health < .4), 'excess irradiance alone can scorch shade foliage');
  const flashed = applyAction(forest(), { type: 'sunlight' }, 0);
  assert(advance(flashed, 1).plants.every(p => p.ecology!.drought < .01));
});

test('persistent saturation suppresses expansion/fruiting and creates visible but bounded dark/fuzzy wood condition', () => {
  const state = forest(); state.ecology.moisture = state.ecology.humidity = state.ecology.waterReserve = 1;
  const result = advance(state, 73);
  assert.equal(result.plants.length, state.plants.length);
  assert(result.plants.every(p => p.ecology!.waterlogging > .99 && p.growth < .2));
  assert(result.plants.filter(p => p.kind.includes('mushroom')).every(p => p.ecology!.cycle > .9));
  assert(result.decorations[2].condition!.mold! > .5);
  assert(result.decorations[2].condition!.decay > .1);
  assert(result.decorations.every(item => !item.colonization));
  assert.deepEqual(result.terrain, state.terrain);
});

test('pond water feeds dry soil, visibly recedes and conserves exact closed inventory over three years', () => {
  const state = forest(); state.ecology.moisture = state.ecology.humidity = state.ecology.waterReserve = 0;
  state.pond = { depths: Array(48).fill(8) };
  const closed = advance(state, 1095), open = advance({ ...structuredClone(state), closed: false }, 1095);
  close(inventory(closed), inventory(state));
  assert(closed.ecology.moisture > .4); assert(pondWater(closed.pond) < pondWater(state.pond));
  assert(inventory(open) < .001); assert.equal(pondWater(open.pond), 0);
  assert.deepEqual(validateState(closed), closed); assert.deepEqual(validateState(open), open);
});

test('fractional pond inventory survives pour, drain, soil displacement and the final grain without creation', () => {
  const state = forest(); state.pond = { depths: Array(48).fill(0) }; state.pond.depths[10] = 1;
  close(withdrawPondWater(state.terrain, state.pond, .4 / 480), .4 / 480);
  close(pondWater(state.pond), .6 / 480);
  const poured = pourPond(state.terrain, state.pond, .5, 1);
  close(pondWater(poured), 1.6 / 480);
  const reconciled = reconcilePond(state.terrain, poured); close(pondWater(reconciled), pondWater(poured));
  const drained = drainPond(state.terrain, state.pond, 10.5 / 48, 1, 1);
  assert.equal(pondWater(drained), 0); assert.equal(drained.exchange, undefined);
  const filled = { columns: state.terrain.columns.map(() => Array(112).fill('soil' as const)) };
  assert.equal(pondWater(reconcilePond(filled, poured)), 0);
});

test('three-year one-shot catchup closely matches daily catchup with bounded deterministic topology', () => {
  const state = forest(), single = advance(state, 1095);
  let daily = structuredClone(state);
  for (let day = 0; day < 1095; day++) daily = advance(daily, 1);
  close(inventory(single), inventory(daily));
  assert.deepEqual(single.plants.map(p => p.id), daily.plants.map(p => p.id));
  for (let i = 0; i < single.plants.length; i++) {
    close(single.plants[i].health, daily.plants[i].health, .015);
    close(single.plants[i].growth, daily.plants[i].growth, .015);
    const phaseDifference = Math.abs(single.plants[i].ecology!.cycle - daily.plants[i].ecology!.cycle);
    assert(Math.min(phaseDifference, 1 - phaseDifference) < .025);
  }
  for (let i = 0; i < single.decorations.length; i++) close(single.decorations[i].colonization!.moss, daily.decorations[i].colonization!.moss, .015);
});
