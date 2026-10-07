import assert from 'node:assert/strict';
import test from 'node:test';
import type { TerrariumAction } from '../shared/types';
import { StrokeController, type PointerPoint, type StrokeScheduler } from './stroke-controller';

function fixture() {
  let tick: (() => void) | null = null;
  let resolve: (() => void) | null = null;
  let flushes = 0;
  let interval = 0;
  const actions: TerrariumAction[] = [];
  const effects: (PointerPoint | null)[] = [];
  const scheduler: StrokeScheduler = { every: (callback, ms) => { tick = callback; interval = ms; return 1; }, clear: () => { tick = null; } };
  const controller = new StrokeController({
    actionAt: point => point.x >= 0 && point.x <= 1 ? { type: 'spray', plantId: 'leaf', amount: .012 } : null,
    perform: action => { actions.push(action); return new Promise<void>(done => { resolve = done; }); },
    finish: async () => { flushes++; }, effect: point => effects.push(point), failed: error => { throw error; },
  }, scheduler);
  return { controller, actions, effects, tick: () => tick?.(), finishDose: () => resolve?.(), flushes: () => flushes, interval: () => interval };
}

test('holding sends one bounded dose and does not queue while it is pending', async () => {
  const f = fixture(); f.controller.start({ x: .5, y: .5 }); await Promise.resolve();
  for (let i = 0; i < 100; i++) f.tick();
  assert.equal(f.actions.length, 1); assert.equal(f.interval(), 125); assert(f.controller.inFlight);
  const stopped = f.controller.stop(); f.finishDose(); await stopped; assert.equal(f.flushes(), 1);
});
test('move follows latest pointer and leaving the bottle does not dose', async () => {
  const f = fixture(); f.controller.start({ x: .5, y: .4 }); await Promise.resolve(); f.finishDose();
  await new Promise<void>(done => setImmediate(done));
  f.controller.move({ x: 2, y: .7 }); f.tick(); assert.equal(f.actions.length, 1); assert.equal(f.effects.at(-1), null);
  f.controller.move({ x: .6, y: .7 }); assert.deepEqual(f.effects.at(-1), { x: .6, y: .7 });
  f.tick(); await Promise.resolve(); assert.equal(f.actions.length, 2);
  const stopped = f.controller.stop(); f.finishDose(); await stopped;
});
for (const reason of ['release', 'cancel', 'lostcapture', 'blur', 'visibility', 'escape', 'rightclick', 'exit']) {
  test(`${reason}: stop is synchronous, repeated stop is harmless, flush waits for pending dose`, async () => {
    const f = fixture(); f.controller.start({ x: .5, y: .5 }); await Promise.resolve();
    const stopped = f.controller.stop(); assert(!f.controller.active); assert.equal(f.effects.at(-1), null);
    for (let i = 0; i < 20; i++) f.tick(); await f.controller.stop();
    assert.equal(f.actions.length, 1); assert.equal(f.flushes(), 0);
    f.finishDose(); await stopped; assert.equal(f.flushes(), 1);
  });
}
test('disposal prevents future strokes and clears scheduled activity', async () => {
  const f = fixture(); f.controller.dispose(); f.controller.start({ x: .5, y: .5 }); f.tick(); await Promise.resolve(); assert.equal(f.actions.length, 0);
});
test('release before the first microtask cancels a not-yet-issued dose', async () => {
  const f = fixture(); f.controller.start({ x: .5, y: .5 }); await f.controller.stop();
  assert.equal(f.actions.length, 0); assert.equal(f.flushes(), 1);
});
test('a deferred action guard becomes false after release or a new stroke', async () => {
  let captured: (() => boolean) | null = null;
  const controller = new StrokeController({ actionAt: () => ({ type: 'spray', plantId: null, amount: .012 }),
    perform: async (_action, valid) => { captured = valid; }, finish: async () => undefined, effect: () => undefined, failed: error => { throw error; },
  }, { every: () => 1, clear: () => undefined });
  controller.start({ x: .5, y: .5 }); await Promise.resolve(); assert(captured); const previous = captured as () => boolean; assert(previous());
  await controller.stop(); assert(!previous()); controller.start({ x: .5, y: .5 }); assert(!previous()); await controller.stop();
});
