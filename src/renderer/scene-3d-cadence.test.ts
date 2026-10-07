import test from 'node:test';
import assert from 'node:assert/strict';
import { heavyFrameDelay } from './scene-3d-cadence';
test('continuous eight-Hz input cannot postpone the next five-Hz frame deadline', () => {
  let last = 0;
  const frames = [0], inputs = Array.from({ length: 17 }, (_, i) => i * 125), events = new Set(inputs);
  for (let time = 1; time <= 2200; time++) if (events.has(time)) {
    const delay = heavyFrameDelay(true, last, time, false);
    if (!delay) { last = time; frames.push(time); } else events.add(time + delay);
  }
  assert.equal(frames[frames.length - 1], 2000); assert.ok(frames.length >= 11);
  for (let i = 1; i < frames.length; i++) assert.ok(frames[i] - frames[i - 1] <= 200);
});
test('final release snapshot is presented by its existing deadline without another input', () => {
  const last = 1000, released = 1075; assert.equal(heavyFrameDelay(true, last, released, false), 125); assert.equal(heavyFrameDelay(true, last, 1200, false), 0);
});
test('shape/lid/resize changes and workshop frames are not delayed', () => {
  assert.equal(heavyFrameDelay(true, 1000, 1001, true), 0); assert.equal(heavyFrameDelay(false, 1000, 1001, false), 0);
});
