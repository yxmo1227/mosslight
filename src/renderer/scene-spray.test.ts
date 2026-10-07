import assert from 'node:assert/strict';
import test from 'node:test';
import { sampledSprayPlant, sampledSprayTarget, sprayConePoint, sprayConeSamples } from './scene';
import type { Position, Selection } from './scene';

function distanceSquared(point: Position, source: Position): number {
  return (point.x - source.x) ** 2 + (point.y - source.y) ** 2;
}
function equalPosition(first: Position, second: Position): boolean {
  return Math.abs(first.x - second.x) < 1e-9 && Math.abs(first.y - second.y) < 1e-9;
}
function closePosition(actual: Position, expected: Position): void {
  assert.ok(equalPosition(actual, expected), `expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
}
function key(point: Position): string { return `${point.x.toFixed(9)},${point.y.toFixed(9)}`; }

test('spray cone starts at its source and terminates 135 below with a 67-unit half width', () => {
  const source = Object.freeze({ x: 210, y: 318 });
  closePosition(sprayConePoint(source, 0, -1), source);
  closePosition(sprayConePoint(source, 0, 1), source);
  closePosition(sprayConePoint(source, 1, -1), { x: source.x - 67, y: source.y + 135 });
  closePosition(sprayConePoint(source, 1, 0), { x: source.x, y: source.y + 135 });
  closePosition(sprayConePoint(source, 1, 1), { x: source.x + 67, y: source.y + 135 });
  for (const t of [0.25, 0.5, 0.75]) {
    for (const spread of [-1, -2 / 3, -1 / 3, 0, 1 / 3, 2 / 3, 1]) {
      closePosition(sprayConePoint(source, t, spread), { x: source.x + spread * 67 * t, y: source.y + 123 * t + 12 * t * t });
    }
  }
  assert.deepEqual(source, { x: 210, y: 318 }, 'cone queries must not move the spray source');
});

test('sampling is bounded to 49 unique points on seven downward rings and seven cone lanes', () => {
  const source = { x: -32, y: 71 };
  const samples = sprayConeSamples(source);
  assert.equal(samples.length, 49);
  assert.ok(samples.length <= 49);
  assert.equal(new Set(samples.map(key)).size, 49);
  const expected: Position[] = [];
  for (let ring = 1; ring <= 7; ring += 1) {
    const t = ring / 7;
    for (const spread of [-1, -2 / 3, -1 / 3, 0, 1 / 3, 2 / 3, 1]) {
      expected.push({ x: source.x + spread * 67 * t, y: source.y + 123 * t + 12 * t * t });
    }
  }
  assert.deepEqual(new Set(samples.map(key)), new Set(expected.map(key)));
  for (const point of samples) {
    const dy = point.y - source.y;
    assert.ok(dy > 0 && dy <= 135, 'samples must only spray downward to the cone terminal');
    // Invert dy = 123t + 12t² to independently check the curved cone width.
    const t = (Math.sqrt(123 ** 2 + 48 * dy) - 123) / 24;
    assert.ok(t > 0 && t <= 1 + 1e-12);
    assert.ok(Math.abs(point.x - source.x) <= 67 * t + 1e-9, 'a sample must not leave the visible cone');
  }
});

test('cone samples are ordered by Euclidean distance from the source, not ring generation order', () => {
  const source = { x: 310, y: 220 };
  const samples = sprayConeSamples(source);
  let previous = -Infinity;
  for (const point of samples) {
    const distance = distanceSquared(point, source);
    assert.ok(distance >= previous - 1e-9, 'hit testing must reach nearer visible plants first');
    previous = distance;
  }
  closePosition(samples[0], { x: source.x, y: source.y + 123 / 7 + 12 / 49 });
});

test('point and sample geometry translate consistently without changing cone reach or ordering', () => {
  const source = Object.freeze({ x: 140, y: 97 });
  const original = sprayConeSamples(source);
  for (const offset of [{ x: 500, y: -900 }, { x: -1000, y: 320 }, { x: 0.25, y: -0.5 }]) {
    const translatedSource = { x: source.x + offset.x, y: source.y + offset.y };
    const translated = sprayConeSamples(translatedSource);
    assert.equal(translated.length, original.length);
    for (let index = 0; index < original.length; index += 1) {
      closePosition(translated[index], { x: original[index].x + offset.x, y: original[index].y + offset.y });
    }
    closePosition(sprayConePoint(translatedSource, 0.4, -2 / 3), {
      x: sprayConePoint(source, 0.4, -2 / 3).x + offset.x,
      y: sprayConePoint(source, 0.4, -2 / 3).y + offset.y,
    });
  }
  assert.deepEqual(source, { x: 140, y: 97 });
});

test('a directly hit plant wins immediately with exactly one callback', () => {
  const source = { x: 40, y: 110 };
  const direct: Selection = { type: 'plant', id: 'direct-plant' };
  let calls = 0;
  const target = sampledSprayPlant(source, point => {
    calls += 1;
    assert.deepEqual(point, source);
    return direct;
  });
  assert.deepEqual(target, direct);
  assert.equal(calls, 1);
});

test('nearest visible sampled plant wins after skipping blank and foreground-decoration hits', () => {
  const source = { x: 170, y: 120 };
  const samples = sprayConeSamples(source);
  const nearest: Selection = { type: 'plant', id: 'near-plant' };
  const farther: Selection = { type: 'plant', id: 'far-plant' };
  const decoration: Selection = { type: 'decoration', id: 'foreground-stone' };
  const calls: Position[] = [];
  const target = sampledSprayPlant(source, point => {
    calls.push({ ...point });
    if (equalPosition(point, source) || equalPosition(point, samples[0])) return decoration;
    if (equalPosition(point, samples[7])) return nearest;
    if (equalPosition(point, samples[36])) return farther;
    return null;
  });
  assert.deepEqual(target, nearest);
  assert.equal(calls.length, 9, 'stop immediately after the direct check and eighth sample');
  assert.deepEqual(calls, [source, ...samples.slice(0, 8)]);
});

test('a foreground decoration never becomes a care target or causes a second through-hit at its point', () => {
  const source = { x: 101, y: 230 };
  const visiblePlant: Selection = { type: 'plant', id: 'visible-leaf' };
  const decoration: Selection = { type: 'decoration', id: 'opaque-wood' };
  const samples = sprayConeSamples(source);
  const visited = new Set<string>();
  const target = sampledSprayPlant(source, point => {
    const pointKey = key(point);
    assert.ok(!visited.has(pointKey), 'foreground hit must not be retried to reach a hidden underlying plant');
    visited.add(pointKey);
    return equalPosition(point, samples[3]) ? visiblePlant : decoration;
  });
  assert.deepEqual(target, visiblePlant);
  assert.equal(visited.size, 5);
});

test('blank and decoration-only cones return null with at most 50 callbacks', () => {
  const source = Object.freeze({ x: 73, y: -21 });
  for (const hit of [null, { type: 'decoration', id: 'covering-stone' } as Selection]) {
    const calls: Position[] = [];
    assert.equal(sampledSprayPlant(source, point => { calls.push({ ...point }); return hit; }), null);
    assert.equal(calls.length, 50);
    assert.ok(calls.length <= 50, 'one direct check plus at most 49 samples bounds every dose');
    assert.deepEqual(calls, [source, ...sprayConeSamples(source)]);
  }
  assert.deepEqual(source, { x: 73, y: -21 });
});

test('general care targets the first visible plant or decoration without spraying through it', () => {
  const source = { x: 50, y: 80 }, decoration: Selection = { type: 'decoration', id: 'damp-stone' }, plant: Selection = { type: 'plant', id: 'moss' };
  let calls = 0; assert.deepEqual(sampledSprayTarget(source, () => { calls++; return decoration; }), decoration); assert.equal(calls, 1);
  const samples = sprayConeSamples(source); calls = 0;
  assert.deepEqual(sampledSprayTarget(source, point => { calls++; return equalPosition(point, samples[1]) ? decoration : equalPosition(point, samples[8]) ? plant : null; }), decoration); assert.equal(calls, 3);
  calls = 0; assert.equal(sampledSprayTarget(source, () => { calls++; return null; }), null); assert.equal(calls, 50);
});
