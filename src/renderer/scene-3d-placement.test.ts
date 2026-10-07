import test from 'node:test';
import assert from 'node:assert/strict';
import { BOTTLE_SHAPES } from '../shared/catalog';
import { containsPoint, profileFor } from './scene-3d-profile';
import { fitContent } from './scene-3d-placement';
import type { ContentBounds } from './scene-3d-placement';

const envelopes: ContentBounds[] = [
  { min: { x: -.52, y: -.12, z: -.39 }, max: { x: .52, y: .38, z: .39 } },
  { min: { x: -.72, y: 0, z: -.62 }, max: { x: .72, y: 1.46, z: .62 } },
  { min: { x: -.56, y: -.035, z: -.19 }, max: { x: .55, y: .66, z: .21 } },
];
for (const shape of BOTTLE_SHAPES) test(`${shape}: whole plant/wood envelope fits before shader clipping`, () => {
  const profile = profileFor(shape);
  for (const bounds of envelopes) for (const x of [-1.6, 0, 1.6]) for (const z of [-.9, 0, .9]) {
    const anchor = { x, y: 1.35, z }, before = JSON.stringify({ anchor, bounds }), fit = fitContent(profile, anchor, bounds);
    for (const localX of [bounds.min.x, bounds.max.x]) for (const localY of [Math.max(0, bounds.min.y), bounds.max.y]) for (const localZ of [bounds.min.z, bounds.max.z]) {
      assert.ok(containsPoint(profile, { x: fit.position.x + localX * fit.scale, y: fit.position.y + localY * fit.scale, z: fit.position.z + localZ * fit.scale }, .048), `${JSON.stringify({ shape, anchor, bounds, fit })}`);
    }
    assert.equal(JSON.stringify({ anchor, bounds }), before);
  }
});
test('ordinary centered plants keep their natural scale; depth translation comes before shrink', () => {
  const profile = profileFor('open-cylinder'), center = fitContent(profile, { x: 0, y: .5, z: 0 }, envelopes[1]), nearGlass = fitContent(profile, { x: 0, y: .5, z: 1.1 }, envelopes[1]);
  assert.equal(center.scale, 1); assert.equal(nearGlass.scale, 1); assert.ok(nearGlass.position.z < 1.1);
});
