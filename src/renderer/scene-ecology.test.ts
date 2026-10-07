import assert from 'node:assert/strict';
import test from 'node:test';
import type { Decoration, PlantEcology } from '../shared/types';
import { decorationEcologyKey2D, drawObjectEcology2D, foliageCondition2D, mushroomFlush2D, plantEcologyKey2D, unitEcology } from './scene-ecology';

const ecology: PlantEcology = { drought: 0, waterlogging: 0, spread: 0, cycle: .4, generation: 0 };
test('stress appearance is finite, reversible, distinctly golden in drought and not healed by a wetness-only change', () => {
  const healthy = foliageCondition2D({ health: .9, ecology });
  const dry = foliageCondition2D({ health: .9, ecology: { ...ecology, drought: 1 } });
  const flooded = foliageCondition2D({ health: .9, ecology: { ...ecology, waterlogging: 1 } });
  assert.equal(healthy.wilt, 0); assert.equal(dry.wilt, 1);
  assert.ok(dry.pigment < .2); assert.ok(flooded.pigment > dry.pigment);
  assert.ok(flooded.wilt > .8); assert.deepEqual(foliageCondition2D({ health: .9, ecology }), healthy);
  assert.ok(foliageCondition2D({ health: .12 }).wilt > .9, 'legacy stressed save has visible fallback');
  for (const value of [-Infinity, Infinity, NaN, -10, 100]) assert.ok(unitEcology(value) >= 0 && unitEcology(value) <= 1);
});
test('all new render-relevant lifecycle and coverage fields invalidate sprite cache keys', () => {
  const base = plantEcologyKey2D({ ecology });
  for (const field of ['drought', 'waterlogging', 'spread', 'cycle'] as const) assert.notDeepEqual(plantEcologyKey2D({ ecology: { ...ecology, [field]: .9 } }), base);
  const item: Decoration = { id: 'log', kind: 'wood', x: .5, y: .5, scale: 1, condition: { wetness: 0, decay: 0, mold: 0 }, colonization: { moss: 0, health: 1 } };
  const key = decorationEcologyKey2D(item);
  for (const field of ['wetness', 'decay', 'mold'] as const) assert.notDeepEqual(decorationEcologyKey2D({ ...item, condition: { ...item.condition!, [field]: .9 } }), key);
  assert.notDeepEqual(decorationEcologyKey2D({ ...item, colonization: { moss: .9, health: 1 } }), key);
  assert.notDeepEqual(decorationEcologyKey2D({ ...item, colonization: { moss: 0, health: .1 } }), key);
});
test('mushroom cycle phases show at least six-fold cap-height contrast without deleting the persistent colony', () => {
  const mature = mushroomFlush2D(ecology), resting = mushroomFlush2D({ ...ecology, cycle: .94 });
  assert.equal(mature.scale, 1); assert.ok(mature.scale / resting.scale > 6); assert.equal(resting.dormant, true);
  assert.ok(mushroomFlush2D({ ...ecology, cycle: .76 }).fading > .5);
  assert.deepEqual(mushroomFlush2D(undefined), { scale: 1, fading: 0, dormant: false });
});

function recordOverlay(item: Decoration): { operations: unknown[][]; saved: number; mode: string } {
  const operations: unknown[][] = [], stack: string[] = [];
  const result = { operations, saved: 0, mode: 'source-over' };
  const canvas = {
    save() { stack.push(result.mode); result.saved++; }, restore() { result.mode = stack.pop()!; result.saved--; },
    get globalCompositeOperation() { return result.mode; }, set globalCompositeOperation(value: string) { result.mode = value; operations.push(['composite', value]); },
    set lineCap(value: string) { operations.push(['lineCap', value]); }, set lineWidth(value: number) { operations.push(['lineWidth', value]); },
    set fillStyle(value: string) { operations.push(['fillStyle', value]); }, set strokeStyle(value: string) { operations.push(['strokeStyle', value]); },
    beginPath() {}, moveTo(...v: number[]) { operations.push(['moveTo', ...v]); }, quadraticCurveTo(...v: number[]) { operations.push(['curve', ...v]); },
    ellipse(...v: number[]) { operations.push(['ellipse', ...v]); },
    fill() { assert.equal(result.mode, 'source-atop', 'moss/mold must remain inside original alpha'); operations.push(['fill']); },
    stroke() { assert.equal(result.mode, 'source-atop', 'fuzz must not create phantom support geometry'); operations.push(['stroke']); },
    fillRect(...v: number[]) { assert.equal(result.mode, 'source-atop'); operations.push(['rect', ...v]); },
  };
  drawObjectEcology2D(canvas as unknown as CanvasRenderingContext2D, item, 180, 210);
  return result;
}
test('object colonization uses stable growing patches exclusively masked by authored alpha', () => {
  const item: Decoration = { id: 'house', kind: 'cottage', x: .5, y: .5, scale: 1 };
  assert.equal(recordOverlay(item).operations.length, 0);
  const early = recordOverlay({ ...item, colonization: { moss: .08, health: .9 } });
  const grown = recordOverlay({ ...item, colonization: { moss: .9, health: .9 } });
  assert.ok(grown.operations.length > early.operations.length * 3, 'coverage must add wide patches, not just tint');
  assert.deepEqual(grown, recordOverlay({ ...item, colonization: { moss: .9, health: .9 } }));
  assert.equal(grown.saved, 0); assert.equal(grown.mode, 'source-over');
});
test('wet deadwood shows dark decay and surface fuzz without applying wood rot to stones or changing saved geometry', () => {
  const item: Decoration = { id: 'old-log', kind: 'stump', x: .5, y: .5, scale: 1, condition: { wetness: .8, decay: .85, mold: .9 } };
  const before = structuredClone(item), output = recordOverlay(item);
  assert.ok(output.operations.some(op => String(op[1]).startsWith('rgba(25,24,20,')));
  assert.ok(output.operations.some(op => String(op[1]).startsWith('rgba(228,230,200,')));
  assert.deepEqual(item, before); assert.equal(output.saved, 0); assert.equal(output.mode, 'source-over');
  const stone = recordOverlay({ ...item, kind: 'stone' });
  assert.ok(stone.operations.length < output.operations.length / 4);
});
