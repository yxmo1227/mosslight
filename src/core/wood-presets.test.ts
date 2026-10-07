import assert from 'node:assert/strict';
import test from 'node:test';
import { WOOD_PRESETS, WOOD_PRESET_KINDS, woodPresetForm } from '../shared/catalog';
import { applyAction, createInitialState } from './simulation';
import { MAX_DECORATIONS, validateAction, validateState, validateWoodForm } from './validation';
import { decodeSave, encodeSave } from '../desktop/storage';

const NOW = 1000;
const base = () => ({ type: 'add-decoration', kind: 'wood', x: .5, y: .5 });

test('four immutable wood presets map to distinct validated forms with zero through three branches', () => {
  assert.deepEqual(WOOD_PRESET_KINDS, ['single', 'fork', 'double-fork', 'branched']);
  assert.equal(new Set(WOOD_PRESETS.map(p => JSON.stringify(p.form))).size, 4);
  assert(Object.isFrozen(WOOD_PRESETS));
  for (const [index, preset] of WOOD_PRESETS.entries()) {
    const form = woodPresetForm(preset.id);
    assert.equal(form.branches.length, index); assert.deepEqual(validateWoodForm(form), form);
    assert(Object.isFrozen(preset) && Object.isFrozen(preset.form) && Object.isFrozen(preset.form.branches));
    assert(preset.form.branches.every(Object.isFrozen));
    form.length = .5; if (form.branches[0]) form.branches[0].length = .2;
    assert.deepEqual(woodPresetForm(preset.id), preset.form);
  }
});

test('preset creation atomically stores its complete shape and support without changing existing landscape', () => {
  const initial = createInitialState(NOW);
  initial.decorations = [{ id: 'stump', kind: 'stump', x: .4, y: .4, scale: .8 }];
  const before = structuredClone(initial);
  for (const preset of WOOD_PRESETS) {
    const action = { ...base(), woodPreset: preset.id, support: { parentId: 'stump', x: .6 } };
    const state = applyAction(initial, action, NOW);
    assert.equal(state.decorations.length, 2);
    assert.deepEqual(state.decorations[1].wood, woodPresetForm(preset.id));
    assert.deepEqual(state.decorations[1].support, action.support);
    assert.equal(state.decorations[1].scale, 1);
    const expected = structuredClone(before); expected.decorations.push(state.decorations[1]);
    assert.deepEqual(state, expected); assert.deepEqual(initial, before);
    assert.deepEqual(validateState(state), state);
    assert.deepEqual(decodeSave(encodeSave(state)), state);
    assert(!Object.hasOwn(state.decorations[1], 'woodPreset'), 'No new persisted schema field');
  }
});

test('preset add validates bounded identifiers and only permits the field on new wood', () => {
  for (const woodPreset of [undefined, null, '', 'unknown', 'single ', 'constructor', '__proto__', 0, [], {}, new String('single')]) {
    assert.throws(() => validateAction({ ...base(), woodPreset }));
  }
  for (const kind of ['stone', 'stump']) assert.throws(() => validateAction({ ...base(), kind, woodPreset: 'single' }));
  for (const type of ['add-plant', 'move-decoration', 'resize-decoration', 'wood-form']) assert.throws(() => validateAction({ ...base(), type, woodPreset: 'single' }));
  assert.throws(() => validateAction({ ...base(), woodPreset: 'single', wood: woodPresetForm('single') }));
  assert.throws(() => validateAction({ ...base(), woodPreset: 'single', extra: true }));
  let called = false;
  const getter = { ...base(), get woodPreset() { called = true; return 'single'; } };
  assert.throws(() => validateAction(getter)); assert.equal(called, false);
  const hidden = Object.defineProperty(base(), 'woodPreset', { value: 'single' });
  assert.throws(() => validateAction(hidden));
});

test('preset creation preserves existing capacity, attachment and action atomicity protections', () => {
  const initial = createInitialState(NOW), before = structuredClone(initial);
  assert.throws(() => applyAction(initial, { ...base(), woodPreset: 'fork', support: { parentId: 'missing', x: .5 } }, NOW));
  assert.deepEqual(initial, before);
  const full = createInitialState(NOW);
  full.decorations = Array.from({ length: MAX_DECORATIONS }, (_, i) => ({ id: `wood-${i}`, kind: 'wood', x: .5, y: .5, scale: 1 }));
  const snapshot = structuredClone(full);
  assert.throws(() => applyAction(full, { ...base(), woodPreset: 'single' }, NOW));
  assert.deepEqual(full, snapshot);
});

test('legacy and custom wood are never converted by selection-independent size/care/ordinary creation', () => {
  let state = applyAction(createInitialState(NOW), base(), NOW);
  assert.equal(state.decorations[0].wood, undefined);
  const legacy = state.decorations[0].id;
  state = applyAction(state, { type: 'resize-decoration', id: legacy, scale: 2 }, NOW);
  assert.equal(state.decorations[0].wood, undefined);
  const custom = { length: 1.77, angle: 41, branches: [{ at: .41, length: .37, angle: -32 }] };
  state = applyAction(state, { type: 'wood-form', id: legacy, value: custom }, NOW);
  state = applyAction(state, { ...base(), woodPreset: 'branched' }, NOW);
  assert.deepEqual(state.decorations[0].wood, custom);
  const resized = applyAction(state, { type: 'resize-decoration', id: state.decorations[1].id, scale: .4 }, NOW);
  assert.deepEqual(resized.decorations[1].wood, state.decorations[1].wood);
  const hostileSave = structuredClone(resized) as unknown as { decorations: Record<string, unknown>[] };
  hostileSave.decorations[1].woodPreset = 'branched';
  assert.throws(() => validateState(hostileSave), 'Preset names are actions, not extra import fields');
});
