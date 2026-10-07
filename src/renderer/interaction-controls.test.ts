import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_GLASS_FORM, MATERIAL_KINDS } from '../shared/catalog';
import { displayTerrariumName, editGlassControl, glassControl, glassFormDraft, glassWidth, keyboardGlassWidth, SCOOP_RADII, terrainToolAction, widgetDragStep, WidgetMoveQueue, type MoveScheduler } from './interaction-controls';

test('pour controls send the faster bounded dose for every material', () => {
  for (const material of MATERIAL_KINDS) assert.deepEqual(terrainToolAction({ kind: 'pour', material }, .37, 4), { type: 'pour', material, x: .37, amount: 16 });
});

test('pond tools send bounded doses separate from misting and use the chosen drain footprint', () => {
  assert.deepEqual(terrainToolAction({ kind: 'water' }, .4, 4), { type: 'pour-water', x: .4, amount: 16 });
  for (const radius of SCOOP_RADII) assert.deepEqual(terrainToolAction({ kind: 'drain' }, .4, radius), { type: 'drain-water', x: .4, amount: 24, radius });
  for (const x of [NaN, Infinity, -.01, 1.01]) for (const kind of ['water','drain'] as const) assert.equal(terrainToolAction({ kind }, x, 4), null);
});

test('independent glass edit changes one control only and never aliases the source', () => {
  const original = glassFormDraft(undefined);
  const edited = editGlassControl(original, 'left', 'upper', { width: 1.1, height: 1.06 }, false);
  assert.deepEqual(glassControl(edited, 'left', 'upper'), { width: 1.1, height: 1.06 });
  assert.deepEqual(glassControl(edited, 'right', 'upper'), glassControl(original, 'right', 'upper'));
  assert.equal(original.sides, undefined); assert.equal(edited.upper, original.upper);
  const copy = glassFormDraft(edited); copy.sides!.left.upper.width = .4;
  assert.equal(edited.sides!.left.upper.width, 1.1);
});

test('linked glass edit updates matching points only and clamps both dimensions', () => {
  const form = editGlassControl(glassFormDraft(undefined), 'right', 'middle', { width: 99, height: -1 }, true);
  assert.deepEqual(form.sides!.left.middle, { width: 1.35, height: .4 });
  assert.deepEqual(form.sides!.right.middle, form.sides!.left.middle);
  assert.notEqual(form.sides!.right.middle, form.sides!.left.middle);
  const next = editGlassControl(form, 'right', 'middle', { width: NaN, height: Infinity }, false);
  assert.deepEqual(next.sides!.right.middle, form.sides!.right.middle);
});

test('broad scoop retains the chosen footprint and one bounded dose', () => {
  for (const radius of SCOOP_RADII) assert.deepEqual(terrainToolAction({ kind: 'scoop' }, .62, radius), { type: 'scoop', x: .62, amount: 24, radius });
});

test('terrain controls reject malformed positions rather than sending them to main', () => {
  for (const x of [NaN, Infinity, -Infinity, -.01, 1.01]) {
    assert.equal(terrainToolAction({ kind: 'scoop' }, x, 4), null);
    assert.equal(terrainToolAction({ kind: 'pour', material: 'soil' }, x, 4), null);
  }
  for (const x of [0, 1]) assert.notEqual(terrainToolAction({ kind: 'scoop' }, x, 4), null);
});

test('old saves get an independent form draft without modifying frozen defaults', () => {
  const draft = glassFormDraft(undefined); assert.deepEqual(draft, DEFAULT_GLASS_FORM);
  draft.lower = .55; assert.equal(DEFAULT_GLASS_FORM.lower, .82);
});

test('saved form drafts preserve all three rings and facet count without aliasing', () => {
  const original = { lower: .6, middle: 1.2, upper: .8, facets: 12 as const };
  const draft = glassFormDraft(original); assert.deepEqual(draft, original);
  draft.middle = .7; assert.equal(original.middle, 1.2);
});

test('glass pointer widths clamp and quantize to the slider step', () => {
  assert.equal(glassWidth(.9913, 1), .99); assert.equal(glassWidth(.554, 1), .55);
  assert.equal(glassWidth(12, 1), 1.25); assert.equal(glassWidth(-1, 1), .55);
  for (const invalid of [NaN, Infinity, -Infinity]) assert.equal(glassWidth(invalid, .82), .82);
});

test('keyboard shape control covers normal step, accelerated step and boundaries', () => {
  assert.equal(keyboardGlassWidth(1, 'ArrowRight'), 1.01);
  assert.equal(keyboardGlassWidth(1, 'ArrowUp', true), 1.1);
  assert.equal(keyboardGlassWidth(1, 'ArrowLeft'), .99);
  assert.equal(keyboardGlassWidth(1, 'ArrowDown', true), .9);
  assert.equal(keyboardGlassWidth(1.25, 'ArrowRight'), 1.25);
  assert.equal(keyboardGlassWidth(.55, 'ArrowLeft'), .55);
  assert.equal(keyboardGlassWidth(1, 'Home'), .55);
  assert.equal(keyboardGlassWidth(1, 'End'), 1.25);
  for (const key of ['Tab', 'Escape', 'Enter', 'a']) assert.equal(keyboardGlassWidth(1, key), null);
});

test('a bottle click or slight pointer jitter never moves its native window', () => {
  assert.deepEqual(widgetDragStep({ x: 100, y: 200 }, { x: 100, y: 200 }, { x: 103, y: 204 }, false), { moved: false, dx: 0, dy: 0 });
  assert.deepEqual(widgetDragStep({ x: 100, y: 200 }, { x: 100, y: 200 }, { x: 100, y: 200 }, false), { moved: false, dx: 0, dy: 0 });
});

test('bottle dragging begins after five screen pixels and then uses incremental deltas', () => {
  assert.deepEqual(widgetDragStep({ x: 100, y: 200 }, { x: 103, y: 200 }, { x: 107, y: 202 }, false), { moved: true, dx: 7, dy: 2 });
  assert.deepEqual(widgetDragStep({ x: 100, y: 200 }, { x: 107, y: 202 }, { x: 109, y: 201 }, true), { moved: true, dx: 2, dy: -1 });
  assert.deepEqual(widgetDragStep({ x: 100, y: 200 }, { x: 109, y: 201 }, { x: 109, y: 201 }, true), { moved: true, dx: 0, dy: 0 });
});

test('window movement is finite and integer-valued', () => {
  assert.deepEqual(widgetDragStep({ x: 0, y: 0 }, { x: 6, y: 1 }, { x: 8.4, y: 2.2 }, true), { moved: true, dx: 2, dy: 1 });
  assert.deepEqual(widgetDragStep({ x: 0, y: 0 }, { x: 6, y: 1 }, { x: NaN, y: 2 }, true), { moved: true, dx: 0, dy: 0 });
});

test('only the old built-in default receives a display alias; custom names are unchanged', () => {
  assert.equal(displayTerrariumName('\u6211\u7684\u5c0f\u68ee\u6797'), 'My Little Forest');
  for (const name of ['My Little Forest', 'Mira’s grove', '\u5c0f\u738b\u7684\u68ee\u6797', 'Rain & roots']) assert.equal(displayTerrariumName(name), name);
});

class FakeMoveClock implements MoveScheduler {
  time = 0;
  private id = 0;
  private jobs = new Map<number, { at: number; callback: () => void }>();
  now(): number { return this.time; }
  after(callback: () => void, milliseconds: number): number { const id = ++this.id; this.jobs.set(id, { at: this.time + milliseconds, callback }); return id; }
  cancel(handle: unknown): void { this.jobs.delete(handle as number); }
  advance(milliseconds: number): void {
    const end = this.time + milliseconds;
    for (;;) {
      const next = [...this.jobs].sort((a, b) => a[1].at - b[1].at)[0];
      if (!next || next[1].at > end) break;
      this.time = next[1].at; this.jobs.delete(next[0]); next[1].callback();
    }
    this.time = end;
  }
}

test('100 high-rate one-pixel movements accumulate to 100 pixels without exceeding 50 Hz', () => {
  const clock = new FakeMoveClock(); const moves: { dx: number; dy: number; at: number }[] = [];
  const queue = new WidgetMoveQueue((dx, dy) => moves.push({ dx, dy, at: clock.now() }), clock);
  for (let index = 0; index < 100; index++) { queue.push(1, 0); clock.advance(1); }
  clock.advance(100);
  assert.equal(moves.reduce((sum, move) => sum + move.dx, 0), 100);
  assert(moves.every(move => move.dy === 0)); assert(moves.length <= 6);
  for (let index = 1; index < moves.length; index++) assert(moves[index].at - moves[index - 1].at >= 20);
});

test('large movements drain all bounded 512-pixel chunks and preserve opposite-axis signs', () => {
  const clock = new FakeMoveClock(); const moves: { dx: number; dy: number }[] = [];
  const queue = new WidgetMoveQueue((dx, dy) => moves.push({ dx, dy }), clock);
  queue.push(2049, -1537); clock.advance(150);
  assert(moves.every(move => Math.abs(move.dx) <= 512 && Math.abs(move.dy) <= 512));
  assert.equal(moves.reduce((sum, move) => sum + move.dx, 0), 2049);
  assert.equal(moves.reduce((sum, move) => sum + move.dy, 0), -1537);
  assert.deepEqual(moves.at(-1), { dx: 1, dy: 0 });
});

test('direction reversal accumulates signed displacement and release allows the remaining movement to drain', () => {
  const clock = new FakeMoveClock(); const moves: number[][] = [];
  const queue = new WidgetMoveQueue((dx, dy) => moves.push([dx, dy]), clock);
  queue.push(100, -100); queue.push(-20, 30); clock.advance(0);
  queue.push(-10, 10); clock.advance(20);
  assert.deepEqual(moves, [[80, -70], [-10, 10]]);
});

test('fractional screen coordinates quantize endpoints without cumulative rounding drift', () => {
  const start = { x: -10.3, y: 10.3 }; let last = start; let moved = false; let totalX = 0; let totalY = 0;
  for (const point of [{ x: -3.6, y: 3.6 }, { x: -3.4, y: 3.4 }, { x: -3.1, y: 3.1 }, { x: -2.6, y: 2.6 }]) {
    const delta = widgetDragStep(start, last, point, moved); moved = delta.moved; if (moved) last = point; totalX += delta.dx; totalY += delta.dy;
  }
  assert.equal(totalX, Math.round(last.x) - Math.round(start.x)); assert.equal(totalY, Math.round(last.y) - Math.round(start.y));
});

test('cancellation and disposal discard unsent motion; malformed movement never reaches the bridge', () => {
  const clock = new FakeMoveClock(); const moves: number[][] = [];
  const queue = new WidgetMoveQueue((dx, dy) => moves.push([dx, dy]), clock);
  queue.push(100, 50); queue.cancel(); clock.advance(100); assert.equal(moves.length, 0);
  for (const dx of [NaN, Infinity, .5, Number.MAX_SAFE_INTEGER + 1]) queue.push(dx, 1);
  clock.advance(100); assert.equal(moves.length, 0);
  queue.push(5, -5); clock.advance(0); queue.push(10, 10); queue.dispose(); clock.advance(100); queue.push(20, 20); clock.advance(100);
  assert.deepEqual(moves, [[5, -5]]);
});

test('a failed native move stops queued remainders and reports the error once', () => {
  const clock = new FakeMoveClock(); const errors: unknown[] = []; const failure = new Error('Native window unavailable');
  const queue = new WidgetMoveQueue(() => { throw failure; }, clock, error => errors.push(error));
  queue.push(1200, 0); clock.advance(100); assert.deepEqual(errors, [failure]);
});
