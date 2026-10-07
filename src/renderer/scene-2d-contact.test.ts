import assert from 'node:assert/strict';
import test from 'node:test';
import { contactRoots2D, stumpFeet2D } from './scene-2d-contact';
import { mushroomStemFeet2D } from './scene-botany';
import { supportContactHeight2D, supportProfile2D } from './scene-2d-layout';

test('each mushroom stem reaches its own steep surface at every supported scale without moving its cap', () => {
  for (const growth of [0, .18, .4, 1]) for (const scale of [.4, 1, 2]) {
    const feet = mushroomStemFeet2D('steep-cluster', growth).map(foot => ({ x: foot.x * 166, y: foot.y * 166, width: foot.width * 166 })), saved = structuredClone(feet);
    const origin = { x: 300, y: 220 }, surface = (x: number): number => 500 + (x - 300) * 1.3;
    const roots = contactRoots2D(feet, origin, scale, surface);
    assert.equal(roots.length, feet.length); assert(roots.length >= 3);
    for (let i = 0; i < roots.length; i++) {
      assert.equal(roots[i].x, feet[i].x); assert.equal(roots[i].width, feet[i].width);
      assert(Math.abs(origin.y + roots[i].bottom * scale - surface(origin.x + roots[i].x * scale) - .85) < 1e-9);
      assert(roots[i].bottom > feet[i].y + 60, 'large ravines cannot retain the old short embedding cap');
    }
    assert.deepEqual(feet, saved); assert.notEqual(roots[0].bottom, roots.at(-1)!.bottom);
  }
});

test('root contact never adds imaginary terrain or extends an already buried foot', () => {
  const feet = [{ x: -12, y: 3, width: 2 }, { x: 0, y: 3, width: 2 }, { x: 12, y: 3, width: 2 }];
  const roots = contactRoots2D(feet, { x: 200, y: 450 }, 1, x => x < 195 ? null : x > 205 ? 510 : 420);
  assert.deepEqual(roots, [{ x: 12, top: 1, bottom: 60.85, width: 2 }]);
  assert.deepEqual(contactRoots2D(feet, { x: 0, y: 0 }, NaN, () => 500), []);
});

test('stump skirt derives a contiguous genuine opaque footer, not its shadow or transparent canvas', () => {
  const mask = new Uint8ClampedArray(60 * 80);
  for (let x = 15; x <= 45; x++) for (let y = 18; y < 61 + Math.floor(x / 10); y++) mask[y * 60 + x] = 255;
  for (let x = 2; x < 58; x++) for (let y = 70; y < 78; y++) mask[y * 60 + x] = 70;
  const before = mask.slice(), feet = stumpFeet2D(mask, 60, 80, 30, 60, 50);
  assert.equal(feet.length, 31); assert(feet.every((foot, i) => i === 0 || foot.x - feet[i - 1].x === 1));
  assert(feet.every(foot => foot.y < 6 && foot.width > 1)); assert.deepEqual(mask, before);
});

test('transparent gaps in a wood support cannot act as an interpolated shelf', () => {
  const mask = new Uint8ClampedArray(40 * 30);
  for (const x of [5, 6, 7, 30, 31, 32]) for (let y = 10; y < 30; y++) mask[y * 40 + x] = 255;
  const support = { id: 'fork', root: { x: 300, y: 400 }, scale: 2, profile: supportProfile2D(mask, 40, 30, 20, 25) };
  assert.equal(supportContactHeight2D(support, 300), null);
  assert.equal(supportContactHeight2D(support, 273), 371);
  assert.equal(supportContactHeight2D(support, 350), null);
  const roots = contactRoots2D([{ x: -27, y: 0, width: 2 }, { x: 0, y: 0, width: 2 }], { x: 300, y: 350 }, 1, x => supportContactHeight2D(support, x) ?? 590);
  assert(Math.abs(roots[0].bottom - 21.85) < 1e-9); assert(Math.abs(roots[1].bottom - 240.85) < 1e-9);
});
