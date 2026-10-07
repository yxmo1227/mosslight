import test from 'node:test';
import assert from 'node:assert/strict';
import { clampToWorkArea, moveWidgetWithinArea, validWidgetDelta, onlineElapsed } from './window-state.js';
test('rescues widget after removal of a monitor', () => {
  assert.deepEqual(clampToWorkArea({ x: 3000, y: 1400, width: 320, height: 400 }, { x: 0, y: 0, width: 1920, height: 1040 }), { x: 1600, y: 640, width: 320, height: 400 });
});
test('negative monitor coordinates remain valid', () => {
  assert.deepEqual(clampToWorkArea({ x: -1800, y: 100, width: 320, height: 400 }, { x: -1920, y: 0, width: 1920, height: 1080 }), { x: -1800, y: 100, width: 320, height: 400 });
});
test('small work areas contain the whole bottle', () => {
  assert.deepEqual(clampToWorkArea({ x: 20, y: 30, width: 400, height: 500 }, { x: 0, y: 0, width: 300, height: 350 }), { x: 0, y: 0, width: 300, height: 350 });
});
test('missed suspend events are never accelerated', () => {
  assert.deepEqual(onlineElapsed(1000, 2000), { ms: 1000, mode: 'online' });
  assert.deepEqual(onlineElapsed(1000, 3_601_000), { ms: 3_600_000, mode: 'offline' });
  assert.deepEqual(onlineElapsed(2000, 1000), { ms: 0, mode: 'online' });
});
test('widget movement rejects nonfinite, fractional, coercible and oversized deltas', () => {
  for (const value of [NaN, Infinity, -Infinity, .25, 513, -513, '2', null, {}, [2]]) {
    assert.equal(validWidgetDelta(value, 0), false); assert.equal(validWidgetDelta(0, value), false);
  }
  for (const value of [-512, 0, 512]) assert.equal(validWidgetDelta(value, value), true);
  assert.throws(() => moveWidgetWithinArea({ x: 0, y: 0, width: 320, height: 400 }, NaN, 0, { x: 0, y: 0, width: 1920, height: 1080 }), /Invalid/);
});
test('direct bottle drag keeps dimensions and clamps both positive and negative monitors', () => {
  const bounds = { x: -500, y: 600, width: 320, height: 400 }, area = { x: -1920, y: 0, width: 1920, height: 1080 };
  assert.deepEqual(moveWidgetWithinArea(bounds, 500, 500, area), { x: -320, y: 680, width: 320, height: 400 });
  assert.deepEqual(moveWidgetWithinArea(bounds, -500, -500, area), { x: -1000, y: 100, width: 320, height: 400 });
  assert.deepEqual(bounds, { x: -500, y: 600, width: 320, height: 400 });
});
