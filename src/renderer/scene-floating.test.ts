import assert from 'node:assert/strict';
import test from 'node:test';
import { BOTTLE_SHAPES, defaultGlassSide, DEFAULT_GLASS_FORM } from '../shared/catalog';
import { floatingPoint2D, floatingPosition2D } from './scene-floating';
import { inVessel2D, vessel2D } from './scene-2d-geometry';

test('floating placement roundtrips in free air independently of landscape', () => {
  for (const shape of BOTTLE_SHAPES) {
    const vessel = vessel2D(shape);
    for (const point of [{ x: 300, y: 270 }, { x: 340, y: 410 }, { x: 260, y: 580 }]) {
      const position = floatingPosition2D(vessel, point); assert(position);
      assert.deepEqual(floatingPoint2D(vessel, position), point);
      assert.equal(Object.hasOwn(position, 'support'), false);
    }
    assert.equal(floatingPosition2D(vessel, { x: 20, y: 350 }), null);
    assert.equal(floatingPosition2D(vessel, { x: 300, y: 740 }), null);
  }
});
test('all finite normalized floating anchors clamp into changed and asymmetric glass without mutating saved coordinates', () => {
  const form = { ...DEFAULT_GLASS_FORM, sides: { left: defaultGlassSide(), right: defaultGlassSide() } };
  form.sides.left.upper = { width: .4, height: 1.08 };
  form.sides.right.upper = { width: 1.35, height: .76 };
  for (const shape of BOTTLE_SHAPES) {
    const vessel = vessel2D(shape, form);
    for (let x = 0; x <= 1; x += .05) for (let y = 0; y <= 1; y += .05) {
      const saved = Object.freeze({ x, y }), point = floatingPoint2D(vessel, saved);
      assert(inVessel2D(vessel, point), `${shape} ${JSON.stringify({ saved, point })}`);
      assert.equal(saved.x, x); assert.equal(saved.y, y);
    }
  }
});
