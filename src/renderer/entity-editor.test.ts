import assert from 'node:assert/strict';
import test from 'node:test';
import { createInitialState } from '../core/simulation';
import { validateWoodForm } from '../core/validation';
import { DEFAULT_WOOD_FORM, WOOD_MAX_BRANCHES } from '../shared/catalog';
import type { TerrariumState, WoodForm } from '../shared/types';
import { editableWood, previewEntityEdit, withBranchCount } from './entity-editor';

function frozen<T>(value: T): T { if (value && typeof value === 'object') { for (const nested of Object.values(value)) frozen(nested); Object.freeze(value); } return value; }
function forest(): TerrariumState {
  const state = createInitialState(1000);
  state.decorations = [{ id: 'wood', kind: 'wood', x: .3, y: .5, scale: 1, wood: editableWood(), condition: { wetness: .4, decay: .2 } }, { id: 'stone', kind: 'stone', x: .5, y: .5, scale: .8, support: { parentId: 'wood', x: .6 } }];
  state.plants = [{ id: 'moss', kind: 'sheet-moss', x: .5, y: .5, scale: 1, health: .9, growth: .4, wetness: 0, ageDays: 1, support: { parentId: 'stone', x: .5 } }];
  return state;
}

test('editableWood returns independent default and supplied forms including every branch', () => {
  const a = editableWood(), b = editableWood(); assert.deepEqual(a, DEFAULT_WOOD_FORM);
  a.branches[0].angle = 20; assert.notEqual(a.branches[0].angle, b.branches[0].angle); assert.deepEqual(b, DEFAULT_WOOD_FORM);
  const input = frozen({ length: 1.7, angle: -100, branches: [{ at: .7, length: .6, angle: -50 }] }), output = editableWood(input);
  assert.deepEqual(output, input); assert.notEqual(output, input); assert.notEqual(output.branches, input.branches); assert.notEqual(output.branches[0], input.branches[0]);
});

test('branch count edits preserve retained branches, order and source ownership', () => {
  const input = frozen(editableWood());
  for (let count = 0; count <= WOOD_MAX_BRANCHES; count++) {
    const result = withBranchCount(input, count); assert.equal(result.branches.length, count);
    assert.equal(result.length, input.length); assert.equal(result.angle, input.angle);
    assert.deepEqual(validateWoodForm(result), result);
    for (let index = 0; index < Math.min(count, input.branches.length); index++) { assert.deepEqual(result.branches[index], input.branches[index]); assert.notEqual(result.branches[index], input.branches[index]); }
  }
  const extended = withBranchCount({ ...editableWood(), branches: [] }, 3);
  assert.equal(new Set(extended.branches.map(branch => branch.at)).size, 3);
  assert.equal(new Set(extended.branches).size, 3);
  const trimmed = withBranchCount(extended, 1); assert.deepEqual(trimmed.branches, [extended.branches[0]]);
});

test('branch count clamps finite controls without unbounded array creation', () => {
  for (const [count, expected] of [[-100, 0], [1.8, 1], [100, 3], [Number.MAX_SAFE_INTEGER, 3]]) assert.equal(withBranchCount(editableWood(), count).branches.length, expected);
});

test('plant resize preview changes only its scalar while support and siblings are unchanged', () => {
  const state = frozen(forest()), result = previewEntityEdit(state, { type: 'resize-plant', id: 'moss', scale: 2 });
  assert.notEqual(result, state); assert.notEqual(result.plants, state.plants); assert.notEqual(result.plants[0], state.plants[0]);
  assert.deepEqual(result.plants[0], { ...state.plants[0], scale: 2 });
  assert.equal(result.decorations, state.decorations); assert.equal(result.plants[0].support, state.plants[0].support);
  assert.equal(result.terrain, state.terrain); assert.equal(result.ecology, state.ecology); assert.equal(result.updatedAt, state.updatedAt);
});

test('parent resize preview preserves child scale, local anchors, fallback coordinates and condition', () => {
  const state = frozen(forest()), result = previewEntityEdit(state, { type: 'resize-decoration', id: 'wood', scale: .4 });
  assert.deepEqual(result.decorations[0], { ...state.decorations[0], scale: .4 });
  assert.equal(result.decorations[1], state.decorations[1]); assert.equal(result.plants, state.plants);
  assert.equal(result.decorations[0].condition, state.decorations[0].condition);
  assert.equal(result.decorations[0].wood, state.decorations[0].wood);
});

test('wood preview deep-clones the edited form without applying persistent condition initialization', () => {
  const state = frozen(forest()), value: WoodForm = frozen({ length: 2, angle: 100, branches: [{ at: .8, length: .7, angle: 75 }] });
  const result = previewEntityEdit(state, { type: 'wood-form', id: 'wood', value });
  assert.deepEqual(result.decorations[0], { ...state.decorations[0], wood: value });
  assert.notEqual(result.decorations[0].wood, value); assert.notEqual(result.decorations[0].wood!.branches[0], value.branches[0]);
  assert.equal(result.decorations[1], state.decorations[1]); assert.equal(result.plants, state.plants);
  const plain = forest(); delete plain.decorations[0].wood; delete plain.decorations[0].condition;
  const draft = previewEntityEdit(frozen(plain), { type: 'wood-form', id: 'wood', value }); assert.equal(Object.hasOwn(draft.decorations[0], 'condition'), false);
});

test('queued pure previews compose resize and form edits in order without overwriting unrelated fields', () => {
  const state = frozen(forest());
  const scaled = previewEntityEdit(state, { type: 'resize-decoration', id: 'wood', scale: 1.8 });
  const shaped = previewEntityEdit(scaled, { type: 'wood-form', id: 'wood', value: { ...editableWood(), length: 1.6 } });
  const latest = previewEntityEdit(shaped, { type: 'wood-form', id: 'wood', value: { ...editableWood(shaped.decorations[0].wood), angle: -45 } });
  assert.equal(latest.decorations[0].scale, 1.8); assert.equal(latest.decorations[0].wood!.length, 1.6); assert.equal(latest.decorations[0].wood!.angle, -45);
  assert.deepEqual(latest.decorations[0].condition, state.decorations[0].condition); assert.deepEqual(latest.decorations[1], state.decorations[1]); assert.equal(latest.plants, state.plants);
  assert.equal(state.decorations[0].scale, 1); assert.equal(state.decorations[0].wood!.length, 1);
});

test('stale preview IDs and cross-kind resize IDs cannot modify an unrelated entity', () => {
  const state = frozen(forest());
  for (const action of [{ type: 'resize-plant', id: 'wood', scale: 2 }, { type: 'resize-decoration', id: 'moss', scale: 2 }, { type: 'wood-form', id: 'missing', value: editableWood() }] as const) assert.deepEqual(previewEntityEdit(state, action), state);
});

test('whole-object pose previews preserve custom bend, branch structure, children and cosmetic state', () => {
  const original = forest(); original.decorations[0].wood!.bend = -.27;
  const state = frozen(original), value = frozen({ angle: -165, flipX: true });
  const result = previewEntityEdit(state, { type: 'object-pose', id: 'wood', value });
  assert.deepEqual(result.decorations[0], { ...state.decorations[0], pose: value });
  assert.notEqual(result.decorations[0].pose, value);
  assert.equal(result.decorations[0].wood, state.decorations[0].wood);
  assert.equal(result.decorations[0].condition, state.decorations[0].condition);
  assert.equal(result.decorations[1], state.decorations[1]); assert.equal(result.plants, state.plants);
  assert.equal(result.terrain, state.terrain); assert.equal(result.ecology, state.ecology);
  assert.equal(state.decorations[0].pose, undefined);
});

test('legacy pose previews do not convert wood and reject non-wood or stale targets', () => {
  const original = forest(); delete original.decorations[0].wood;
  const state = frozen(original), value = { angle: 15, flipX: false };
  const result = previewEntityEdit(state, { type: 'object-pose', id: 'wood', value });
  assert.equal(result.decorations[0].wood, undefined); assert.equal(Object.hasOwn(result.decorations[0], 'wood'), false);
  for (const id of ['stone', 'moss', 'missing']) assert.deepEqual(previewEntityEdit(state, { type: 'object-pose', id, value }), state);
});

test('editable custom form keeps optional bend while independently copying branches', () => {
  const source = frozen({ length: 1.3, angle: 42, bend: -.3, branches: [{ at: .5, length: .6, angle: 30 }] });
  const clone = editableWood(source), trimmed = withBranchCount(source, 0);
  assert.deepEqual(clone, source); assert.equal(trimmed.bend, -.3);
  clone.branches[0].length = .2; assert.equal(source.branches[0].length, .6);
});
