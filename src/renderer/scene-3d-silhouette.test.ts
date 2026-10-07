import test from 'node:test';
import assert from 'node:assert/strict';
import { ProjectedSilhouette } from './scene-3d-silhouette';
import { ThreeTerrarium } from './scene-3d';

test('transparent vessel interior is a filled shape target, independent of pixel alpha', () => {
  const shape = new ProjectedSilhouette(80, 100);
  shape.triangle({ x: 10, y: 12 }, { x: 70, y: 12 }, { x: 10, y: 90 });
  shape.triangle({ x: 70, y: 12 }, { x: 70, y: 90 }, { x: 10, y: 90 });
  assert.equal(shape.contains({ x: 40, y: 45 }), true);
  for (const point of [{ x: 0, y: 45 }, { x: 79, y: 45 }, { x: 40, y: 3 }, { x: -1, y: 50 }, { x: 80, y: 50 }]) assert.equal(shape.contains(point), false);
});
test('a separate floating lid does not make the gap below it clickable', () => {
  const shape = new ProjectedSilhouette(100, 100);
  shape.triangle({ x: 20, y: 40 }, { x: 80, y: 40 }, { x: 50, y: 95 });
  shape.triangle({ x: 45, y: 8 }, { x: 80, y: 8 }, { x: 80, y: 20 });
  assert.equal(shape.contains({ x: 65, y: 12 }), true); assert.equal(shape.contains({ x: 65, y: 30 }), false);
});
test('actual isBottleAt performs stencil lookups, never raycasting or GPU readback', () => {
  const shape = new ProjectedSilhouette(20, 20); shape.triangle({ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 0, y: 20 });
  const engine = { silhouette: shape, performance: { silhouetteTests: 0 }, ray: () => { throw new Error('No raycasting for pointer passthrough'); } };
  for (let i = 0; i < 10_000; i++) assert.equal(ThreeTerrarium.prototype.isBottleAt.call(engine as unknown as ThreeTerrarium, { x: 3, y: 4 }), true);
  assert.equal(engine.performance.silhouetteTests, 10_000);
});
test('degenerate and out-of-range triangles do not create broad hit regions', () => {
  const shape = new ProjectedSilhouette(10, 10);
  shape.triangle({ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 9, y: 0 });
  shape.triangle({ x: -20, y: -10 }, { x: -10, y: -10 }, { x: -15, y: -2 });
  assert.equal(shape.pixels.reduce((sum, value) => sum + value, 0), 0);
});
