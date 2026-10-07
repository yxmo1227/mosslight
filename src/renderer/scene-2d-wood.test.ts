import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_WOOD_FORM } from '../shared/catalog';
import { woodGeometry2D, woodPathPoint2D } from './scene-2d-wood';

test('zero branches draws a single stick; every configured branch creates exactly one bounded path', () => {
  for (let count = 0; count <= 3; count++) {
    const form = { length: 1, angle: 0, branches: Array.from({ length: count }, (_, i) => ({ at: .2 + i * .3, length: .4, angle: i % 2 ? 60 : -65 })) }, before = structuredClone(form);
    const geometry = woodGeometry2D(form); assert.equal(geometry.paths.length, count + 1); assert.equal(geometry.paths.filter(path => path.branch === -1).length, 1); assert.deepEqual(form, before);
    assert.deepEqual(woodGeometry2D(form), geometry);
  }
});

test('all clockwise directions and branch extremes stay inside their dynamic raster bounds', () => {
  for (const angle of [-160, -90, -35, 0, 35, 90, 160]) for (const length of [.5, 1, 2]) for (const branchAngle of [-80, 0, 80]) {
    const form = { length, angle, branches: [{ at: .2, length: .2, angle: -branchAngle }, { at: .85, length: .8, angle: branchAngle }] }, geometry = woodGeometry2D(form), bounds = geometry.bounds;
    assert(Object.values(bounds).every(Number.isFinite)); assert(bounds.right > bounds.left && bounds.bottom > bounds.top);
    for (const path of geometry.paths) for (let i = 0; i <= 100; i++) { const point = woodPathPoint2D(path, i / 100), radius = path.width * .55 + .008; assert(point.x - radius >= bounds.left && point.x + radius <= bounds.right); assert(point.y - radius >= bounds.top && point.y + radius <= bounds.bottom); }
    assert((bounds.right - bounds.left) * 166 + 22 < 800 && (bounds.bottom - bounds.top) * 166 + 22 < 800, 'editable raster remains bounded');
  }
});

test('length, direction, attachment position and branch angle change actual authored geometry', () => {
  const baseline = woodGeometry2D(DEFAULT_WOOD_FORM);
  for (const form of [{ ...DEFAULT_WOOD_FORM, length: 2 }, { ...DEFAULT_WOOD_FORM, angle: 90 }, { ...DEFAULT_WOOD_FORM, branches: [{ at: .8, length: .6, angle: 15 }] }]) assert.notDeepEqual(woodGeometry2D(form), baseline);
  const flat = woodGeometry2D({ length: 1, angle: 0, branches: [] }).paths[0], vertical = woodGeometry2D({ length: 1, angle: 90, branches: [] }).paths[0];
  assert(Math.abs(vertical.a.x + flat.a.y) < 1e-10); assert(Math.abs(vertical.a.y - flat.a.x) < 1e-10);
});
