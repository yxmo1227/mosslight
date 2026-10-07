import assert from 'node:assert/strict';
import test from 'node:test';
import { createInitialState } from './simulation';
import { validateState } from './validation';
import type { PlantEcology } from '../shared/types';

const life = (): PlantEcology => ({ drought: .2, waterlogging: 0, spread: .4, cycle: .5, generation: 0, offspring: 0 });
function fixture() {
  const state = createInitialState(1_000);
  state.ecology.simulatedDays = 73;
  state.plants = [{ id: 'source', kind: 'amber-mushroom', x: .4, y: .6, scale: 1, growth: .8, health: .8, ageDays: 73, wetness: 0 }];
  state.decorations = [{ id: 'stump', kind: 'stump', x: .4, y: .6, scale: 1 }];
  return state;
}
test('v09 validates old day-73 state without introducing lifecycle fields or changing geometry', () => {
  const old = fixture(), copy = validateState(old);
  assert.deepEqual(copy, old); assert.notEqual(copy, old); assert(!('ecology' in copy.plants[0]));
});
test('v09 optional ecological fields are independently copied and strictly bounded', () => {
  const s = fixture(); s.plants[0].ecology = life();
  s.decorations[0].condition = { wetness: 0, decay: .4, mold: .3 };
  s.decorations[0].colonization = { moss: .7, health: .8 };
  s.pond = { depths: Array(48).fill(1), exchange: .99 };
  const copy = validateState(s); assert.deepEqual(copy, s);
  copy.plants[0].ecology!.drought = .9; copy.decorations[0].colonization!.moss = 0;
  assert.equal(s.plants[0].ecology.drought, .2); assert.equal(s.decorations[0].colonization.moss, .7);
  for (const key of ['drought', 'waterlogging', 'spread', 'cycle'] as const) for (const value of [-.1, 1.01, NaN, Infinity, '1']) {
    const bad = structuredClone(s); (bad.plants[0].ecology as unknown as Record<string, unknown>)[key] = value;
    assert.throws(() => validateState(bad));
  }
  for (const patch of [{ generation: 2 }, { generation: 1 }, { offspring: 3 }, { offspring: .5 }, { parentId: 'source' }, { hidden: 1 }]) {
    const bad = structuredClone(s); Object.assign(bad.plants[0].ecology!, patch); assert.throws(() => validateState(bad));
  }
  const getter = structuredClone(s); let reads = 0;
  Object.defineProperty(getter.plants[0].ecology!, 'drought', { enumerable: true, get() { reads++; return 0; } });
  assert.throws(() => validateState(getter)); assert.equal(reads, 0);
});
test('generated colony provenance is bounded, same-kind and never recursive', () => {
  const s = fixture(); s.plants[0].ecology = life();
  s.plants.push({ ...structuredClone(s.plants[0]), id: 'child', ecology: { ...life(), generation: 1, parentId: 'source' } });
  assert.doesNotThrow(() => validateState(s));
  for (const parentId of ['missing', 'child']) { const bad = structuredClone(s); bad.plants[1].ecology!.parentId = parentId; assert.throws(() => validateState(bad)); }
  const species = structuredClone(s); species.plants[1].kind = 'fern'; assert.throws(() => validateState(species));
  const nesting = structuredClone(s); nesting.plants.push({ ...structuredClone(s.plants[1]), id: 'grandchild', ecology: { ...life(), generation: 1, parentId: 'child' } });
  assert.throws(() => validateState(nesting));
});
test('pond exchange cannot create negative inventory, and moss/mold extensions reject malformed values', () => {
  for (const exchange of [-.1, 1.1, NaN, Infinity, '0.5']) { const s = fixture(); s.pond = { depths: Array(48).fill(1), exchange: exchange as number }; assert.throws(() => validateState(s)); }
  const empty = fixture(); empty.pond = { depths: Array(48).fill(0), exchange: .1 }; assert.throws(() => validateState(empty));
  empty.pond.exchange = 0; assert.doesNotThrow(() => validateState(empty));
  for (const bad of [{ moss: 2, health: .8 }, { moss: .2, health: NaN }, { moss: .2, health: .8, extra: true }]) {
    const s = fixture(); s.decorations[0].colonization = bad; assert.throws(() => validateState(s));
  }
  const stone = fixture(); stone.decorations[0].kind = 'stone'; stone.decorations[0].condition = { wetness: 0, decay: 0, mold: 0 };
  assert.throws(() => validateState(stone));
});
