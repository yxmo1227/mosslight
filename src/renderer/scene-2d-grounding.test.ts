import assert from 'node:assert/strict';
import test from 'node:test';
import { bearingProfile2D, mossAttachmentOffset2D, onSupportSpan2D, resolveGrounding2D, supportHeight2D, supportPoint2D, supportProfile2D } from './scene-2d-layout';

test('opaque contact ignores shadow margins and locates the real narrow plant footer', () => {
  const width = 60, height = 80, mask = new Uint8ClampedArray(width * height);
  for (let y = 5; y < 65; y++) for (let x = 28; x <= 32; x++) mask[y * width + x] = 255;
  for (let y = 67; y < 78; y++) for (let x = 5; x < 55; x++) mask[y * width + x] = 100; // soft ground shadow
  for (let y = 25; y < 62; y++) mask[y * width + 9] = 255; // dangling foliage is not a stem root
  const before = mask.slice();
  for (const kind of ['fern', 'fittonia'] as const) {
    const profile = bearingProfile2D(mask, width, height, 30, 60, kind, 100);
    assert.equal(profile.points.length, 5); assert(profile.points.every(point => point.y === 4.5)); assert(profile.points.every(point => Math.abs(point.x) <= 3));
    const result = resolveGrounding2D(profile, { x: 200, y: 400 }, 1, () => 400);
    assert(result.origin.y < 400, 'transparent authored anchor cannot replace the actual footer');
    for (const foot of profile.points) assert(Math.abs(result.origin.y + foot.y - 400.6) < 1e-9);
  }
  assert.deepEqual(mask, before);
});

test('flat and ordinary sloped bases are seated by one rigid translation at every scale', () => {
  const profile = { points: Array.from({ length: 21 }, (_, i) => ({ x: i - 10, y: 4 + Math.sin(i / 20 * Math.PI) })), height: 160 };
  for (const scale of [.4, 1, 2]) for (const slope of [0, .1, -.25]) {
    const surface = (x: number): number => 420 + (x - 250) * slope, result = resolveGrounding2D(profile, { x: 250, y: 420 }, scale, surface);
    assert(result.samples === profile.points.length); assert(result.embedding <= Math.min(24 * scale, profile.height * scale * .2));
    for (const foot of profile.points) assert(result.origin.y + foot.y * scale >= surface(result.origin.x + foot.x * scale) - 1e-9, 'ordinary base must not float');
    assert.equal(result.origin.x, 250); // no shear, stretch or automatic horizontal relocation
  }
});

test('extreme valleys allow a real unsupported overhang instead of burying most of a rigid object', () => {
  const profile = { points: [{ x: -40, y: 4 }, { x: 0, y: 5 }, { x: 40, y: 4 }], height: 70 };
  for (const scale of [.4, 1, 2]) {
    const result = resolveGrounding2D(profile, { x: 300, y: 500 }, scale, x => x < 300 ? 200 : 580);
    assert(Math.abs(result.embedding - 14 * scale) < 1e-9); assert(result.origin.y < 250);
    assert(result.origin.y + profile.points[2].y * scale < 580, 'a steep ravine is not filled with invented terrain');
  }
});

test('parent contact ignores unsupported child-foot samples beyond the real support span', () => {
  const alpha = new Uint8ClampedArray(100); for (let x = 3; x <= 6; x++) for (let y = 4; y < 10; y++) alpha[y * 10 + x] = 255;
  const parent = { id: 'parent', root: { x: 200, y: 300 }, scale: 1, profile: supportProfile2D(alpha, 10, 10, 5, 9) };
  const profile = { points: [{ x: -20, y: 1 }, { x: 0, y: 1 }, { x: 20, y: 1 }], height: 50 };
  const result = resolveGrounding2D(profile, { x: 200, y: 300 }, 1, x => onSupportSpan2D(parent, x) ? supportPoint2D(parent, .5).y : null);
  assert.equal(result.samples, 1); assert(Math.abs(result.embedding - .6) < 1e-9);
  assert.equal(resolveGrounding2D(profile, { x: 500, y: 200 }, 1, () => null).samples, 0);
});

test('a tilted stick rests on its real middle when its lowest endpoint misses a short support', () => {
  const profile = { points: [{ x: 50, y: 40 }], fallback: [{ x: -50, y: -30 }, { x: 0, y: 5 }, { x: 50, y: 40 }], height: 90 };
  const result = resolveGrounding2D(profile, { x: 300, y: 400 }, 1, x => Math.abs(x - 300) <= 8 ? 400 : null);
  assert.equal(result.samples, 1); assert(Math.abs(result.origin.y - 395.6) < 1e-9);
});

test('oversized moss conforms on a finite support and has a rounded limited overhang instead of an endpoint-height shelf', () => {
  const mask = new Uint8ClampedArray(30 * 40); for (let x = 4; x < 25; x++) for (let y = 8 + Math.floor(x / 4); y < 40; y++) mask[y * 30 + x] = 255;
  const parent = { id: 'short-stick', root: { x: 300, y: 450 }, scale: .5, profile: supportProfile2D(mask, 30, 40, 15, 35) }, anchor = supportPoint2D(parent, .5);
  for (let x = supportPoint2D(parent, 0).x; x <= supportPoint2D(parent, 1).x; x += .2) assert(Math.abs(mossAttachmentOffset2D(parent, anchor, x, 230, 370) - (supportHeight2D(parent, x) - anchor.y)) < 1e-10);
  const left = [230, 240, 260, 280].map(x => mossAttachmentOffset2D(parent, anchor, x, 230, 370)); assert(new Set(left).size > 2); assert(left.every(Number.isFinite));
  assert(Math.abs(mossAttachmentOffset2D(parent, anchor, 230, 230, 370)) <= 12); assert(Math.abs(mossAttachmentOffset2D(parent, anchor, 370, 230, 370)) <= 12);
});
