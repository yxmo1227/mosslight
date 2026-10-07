import assert from 'node:assert/strict';
import test from 'node:test';
import type { Decoration } from '../shared/types';
import { excludedSupports2D, nearestSupport2D, supportHeight2D, supportLocalX2D, supportOrder2D, supportPoint2D, supportProfile2D } from './scene-2d-layout';

const alpha = new Uint8ClampedArray(12 * 10);
for (let x = 2; x <= 9; x++) for (let y = 2 + Math.floor((x - 2) / 2); y < 10; y++) alpha[y * 12 + x] = 255;
// A single anti-aliased pixel must not become a support above the visible solid edge.
alpha[1 * 12 + 5] = 50;
const profile = supportProfile2D(alpha, 12, 10, 6, 9);
const surface = { id: 'wood', root: { x: 240, y: 450 }, scale: 2, profile };
const decoration = (id: string, parentId?: string): Decoration => ({ id, kind: 'stone', x: .5, y: .7, scale: 1, ...(parentId ? { support: { parentId, x: .5 } } : {}) });

test('support profile is extracted from visible sprite alpha, remains finite and does not mutate the mask', () => {
  const before = alpha.slice(); assert.equal(profile.left, 2); assert.equal(profile.right, 9);
  for (let x = 2; x <= 9; x++) assert.equal(profile.top[x], 2.5 + Math.floor((x - 2) / 2));
  assert(profile.top.every(Number.isFinite)); assert.deepEqual(alpha, before);
  const empty = supportProfile2D(new Uint8ClampedArray(120), 12, 10, 6, 9);
  assert.equal(empty.left, 6); assert.equal(empty.right, 6); assert(empty.top.every(y => y === 9));
});

test('all local attachment coordinates invert the exact painted support transform', () => {
  for (const scale of [.35, 1, 2.1]) for (let i = 0; i <= 100; i++) {
    const s = { ...surface, scale }, local = i / 100, point = supportPoint2D(s, local);
    assert(Math.abs(supportLocalX2D(s, point.x) - local) < 1e-12);
    assert(Math.abs(supportHeight2D(s, point.x) - point.y) < 1e-12);
    const moved = supportPoint2D({ ...s, root: { x: s.root.x + 15, y: s.root.y - 27 } }, local);
    assert(Math.abs(moved.x - point.x - 15) < 1e-12); assert(Math.abs(moved.y - point.y + 27) < 1e-12);
  }
});

test('nearest support resolves only the actual top edge and excludes self and descendants', () => {
  const root = supportPoint2D(surface, .42), child = { ...surface, id: 'stump', root: { x: 260, y: 400 } };
  assert.equal(nearestSupport2D([surface, child], { x: root.x, y: root.y - 3 }, new Set())?.parentId, 'wood');
  assert.equal(nearestSupport2D([surface], { x: root.x, y: root.y + 40 }, new Set()), undefined);
  assert.equal(nearestSupport2D([surface], { x: root.x - 100, y: root.y }, new Set()), undefined);
  assert.equal(nearestSupport2D([surface], root, new Set(['wood'])), undefined);
  const objects = [decoration('root'), decoration('child', 'root'), decoration('grandchild', 'child'), decoration('unrelated')];
  assert.deepEqual([...excludedSupports2D(objects, 'root')].sort(), ['root', 'child', 'grandchild'].sort());
  assert.deepEqual([...excludedSupports2D(objects)], []);
});

test('stack traversal is parent-before-child, non-mutating and terminates on malformed cycles', () => {
  const objects = [decoration('top', 'middle'), decoration('base'), decoration('middle', 'base')], before = structuredClone(objects);
  assert.deepEqual(supportOrder2D(objects).map(item => item.id), ['base', 'middle', 'top']); assert.deepEqual(objects, before);
  const cycle = [decoration('a', 'b'), decoration('b', 'a')];
  assert.equal(new Set(supportOrder2D(cycle).map(item => item.id)).size, 2);
});
