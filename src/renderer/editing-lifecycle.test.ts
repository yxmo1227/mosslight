import assert from 'node:assert/strict';
import test from 'node:test';
import { applyAction, createInitialState } from '../core/simulation';
import { DECORATION_ITEMS, STONE_VARIANTS, STUMP_VARIANTS, WOOD_PRESETS, woodPresetForm } from '../shared/catalog';
import type { DecorationVariant, TerrariumAction, TerrariumState, WoodPresetKind } from '../shared/types';
import type { Position, Selection, TerrariumScene } from './scene';
import { CatalogPicker } from './catalog-picker';
import { editableWood, EntityEditor } from './entity-editor';

/** Minimal event-contract fixture, not a browser layout or native-input claim. */
class ElementStub extends EventTarget {
  value = ''; textContent = ''; hidden = false; disabled = false; draggable = false;
  dataset: Record<string, string> = {}; options: unknown[] = []; children: ElementStub[] = [];
  attributes = new Map<string, string>(); captures = new Set<number>(); classes = new Set<string>();
  classList = { toggle: (name: string, enabled: boolean): void => { if (enabled) this.classes.add(name); else this.classes.delete(name); } };
  constructor(readonly id: string) { super(); }
  setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
  getAttribute(name: string): string | null { return this.attributes.get(name) ?? null; }
  querySelectorAll(): ElementStub[] { return this.children; }
  replaceChildren(...children: unknown[]): void { this.options = children; }
  setPointerCapture(id: number): void { this.captures.add(id); }
  hasPointerCapture(id: number): boolean { return this.captures.has(id); }
  releasePointerCapture(id: number): void { if (this.captures.delete(id)) emit(this, 'lostpointercapture', { pointerId: id }); }
  focus(): void { /* Focus has no layout behavior in this fixture. */ }
  getBoundingClientRect(): { left: number; top: number; width: number; height: number } { return { left: 0, top: 0, width: 100, height: 100 }; }
}
function emit(target: EventTarget, type: string, values: Record<string, unknown> = {}): Event {
  const event = new Event(type, { cancelable: true });
  for (const [key, value] of Object.entries({ button: 0, pointerId: 1, clientX: 50, clientY: 50, ...values })) Object.defineProperty(event, key, { value });
  target.dispatchEvent(event); return event;
}
function dom(): { get(id: string): ElementStub; document: EventTarget & { hidden: boolean }; window: EventTarget; palette: ElementStub[]; flushTimers(): void; restore(): void } {
  const elements = new Map<string, ElementStub>(), palette: ElementStub[] = [], timers: Array<() => void> = [];
  const get = (id: string): ElementStub => { if (!elements.has(id)) elements.set(id, new ElementStub(id)); return elements.get(id)!; };
  const document = Object.assign(new EventTarget(), { hidden: false, getElementById: get, querySelectorAll: () => palette });
  const window = Object.assign(new EventTarget(), { setTimeout: (callback: () => void) => { timers.push(callback); return timers.length; } });
  const previous = ['document', 'window', 'Option'].map(key => ({ key, descriptor: Object.getOwnPropertyDescriptor(globalThis, key) }));
  for (const [key, value] of Object.entries({ document, window, Option: class { constructor(readonly text: string, readonly value: string) {} } })) Object.defineProperty(globalThis, key, { configurable: true, value });
  return { get, document, window, palette, flushTimers() { for (const callback of timers.splice(0)) callback(); }, restore() { for (const { key, descriptor } of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } } };
}
function editorFixture(legacy = false) {
  const ui = dom();
  const ranges = ['entity-scale'];
  ui.get('entity-editor').children = ranges.map(ui.get);
  let state: TerrariumState = createInitialState(1000), selection: Selection | null = { type: 'decoration', id: 'wood' };
  state.decorations = [{ id: 'wood', kind: 'wood', x: .3, y: .5, scale: 1, wood: editableWood() }, { id: 'stone', kind: 'stone', x: .5, y: .5, scale: 1, support: { parentId: 'wood', x: .6 } }];
  if (legacy) delete state.decorations[0].wood;
  state.plants = [{ id: 'moss', kind: 'sheet-moss', x: .5, y: .5, scale: 1, growth: .4, health: .9, wetness: 0, ageDays: 1, support: { parentId: 'stone', x: .4 } }];
  const commits: TerrariumAction[] = [], complete: Array<() => void> = [];
  const editor = new EntityEditor({ state: () => state, selection: () => selection, render() {}, close() { selection = null; editor.sync(); },
    commit(action) { commits.push(action); return new Promise<void>(resolve => complete.push(() => { state = applyAction(state, action, state.updatedAt); resolve(); })); },
  }); editor.sync();
  return { ui, editor, commits, state: () => state, select(value: Selection | null) { selection = value; editor.sync(); },
    input(id: string, value: number) { const input = ui.get(id); input.value = String(value); emit(input, 'input'); },
    async ack() { complete.shift()?.(); await Promise.resolve(); await Promise.resolve(); },
  };
}

test('size pointer cancellation reverts a draft and cannot leak into a later object resize', async () => {
  for (const cancellation of ['pointercancel', 'lostpointercapture']) {
    const f = editorFixture();
    try {
      const range = f.ui.get('entity-scale'), originalWood = structuredClone(f.state().decorations[0].wood);
      emit(range, 'pointerdown'); f.input('entity-scale', 1.8);
      assert.equal(f.editor.visibleState(f.state()).decorations[0].scale, 1.8);
      emit(range, cancellation); emit(range, 'change');
      assert.equal(f.commits.length, 0); assert.equal(f.editor.visibleState(f.state()).decorations[0].scale, 1);
      f.select({ type: 'decoration', id: 'stone' }); f.input('entity-scale', .6); emit(range, 'change');
      assert.deepEqual(f.commits, [{ type: 'resize-decoration', id: 'stone', scale: .6 }]);
      await f.ack(); assert.equal(f.state().decorations[0].scale, 1); assert.equal(f.state().decorations[1].scale, .6);
      assert.deepEqual(f.state().decorations[0].wood, originalWood);
    } finally { f.ui.restore(); }
  }
});

test('normal range release survives subsequent implicit capture loss and commits exactly once', async () => {
  const f = editorFixture();
  try {
    const range = f.ui.get('entity-scale'); emit(range, 'pointerdown'); f.input('entity-scale', 1.6);
    emit(range, 'pointerup'); emit(range, 'lostpointercapture'); emit(range, 'change'); emit(range, 'blur');
    assert.deepEqual(f.commits, [{ type: 'resize-decoration', id: 'wood', scale: 1.6 }]);
    await f.ack(); assert.equal(f.state().decorations[0].scale, 1.6); assert.equal(f.state().decorations[1].scale, 1);
    assert.deepEqual(f.state().decorations[1].support, { parentId: 'wood', x: .6 });
  } finally { f.ui.restore(); }
});

test('Escape, blur, hidden state, editor close and selection change discard uncommitted range previews', () => {
  for (const cancellation of ['escape', 'blur', 'window-blur', 'hidden', 'close', 'selection']) {
    const f = editorFixture();
    try {
      f.input('entity-scale', .7); assert.equal(f.editor.visibleState(f.state()).decorations[0].scale, .7);
      if (cancellation === 'escape') emit(f.ui.get('entity-scale'), 'keydown', { key: 'Escape' });
      else if (cancellation === 'blur') emit(f.ui.get('entity-scale'), 'blur');
      else if (cancellation === 'window-blur') emit(f.ui.window, 'blur');
      else if (cancellation === 'hidden') { f.ui.document.hidden = true; emit(f.ui.document, 'visibilitychange'); }
      else if (cancellation === 'close') emit(f.ui.get('close-entity-editor'), 'click');
      else f.select({ type: 'decoration', id: 'stone' });
      assert.equal(f.commits.length, 0); assert.deepEqual(f.editor.visibleState(f.state()), f.state());
    } finally { f.ui.restore(); }
  }
});

test('pending editor commits retain later previews while acknowledgments arrive in order', async () => {
  const f = editorFixture();
  try {
    const originalWood = structuredClone(f.state().decorations[0].wood);
    f.input('entity-scale', 1.5); emit(f.ui.get('entity-scale'), 'change');
    f.input('entity-scale', .6); emit(f.ui.get('entity-scale'), 'change');
    assert.equal(f.commits.length, 2);
    assert.equal(f.editor.visibleState(f.state()).decorations[0].scale, .6);
    await f.ack(); assert.equal(f.state().decorations[0].scale, 1.5);
    assert.equal(f.editor.visibleState(f.state()).decorations[0].scale, .6);
    await f.ack(); assert.deepEqual(f.editor.visibleState(f.state()), f.state());
    assert.equal(f.state().decorations[0].scale, .6); assert.deepEqual(f.state().decorations[0].wood, originalWood);
    assert.deepEqual(f.state().decorations[1].support, { parentId: 'wood', x: .6 });
  } finally { f.ui.restore(); }
});

test('the simple size editor preserves both legacy and custom wood without conversion or replacement', async () => {
  for (const legacy of [true, false]) {
    const f = editorFixture(legacy);
    try {
      if (!legacy) f.state().decorations[0].wood = { length: 1.73, angle: -127, branches: [{ at: .81, length: .73, angle: 42 }] };
      f.editor.sync(); const originalWood = structuredClone(f.state().decorations[0].wood);
      assert.equal(f.commits.length, 0); assert.deepEqual(f.editor.visibleState(f.state()).decorations[0].wood, originalWood);
      f.input('entity-scale', 1.7); emit(f.ui.get('entity-scale'), 'change'); await f.ack();
      assert.deepEqual(f.state().decorations[0].wood, originalWood); assert.equal(f.state().decorations[0].condition, undefined);
      assert.equal(f.state().decorations[0].scale, 1.7); assert.equal(f.commits.length, 1);
      assert.deepEqual(f.state().decorations[1].support, { parentId: 'wood', x: .6 });
    } finally { f.ui.restore(); }
  }
});

function pickerFixture(extra: Array<{ decoration: string; variant?: string; woodPreset?: string }> = []) {
  const ui = dom(), canvas = ui.get('canvas'), button = ui.get('fern-card');
  button.dataset.plant = 'fern';
  const woods = WOOD_PRESETS.map(preset => { const item = ui.get(`wood-${preset.id}`); item.dataset.decoration = 'wood'; item.dataset.woodPreset = preset.id; return item; });
  const stones = STONE_VARIANTS.map(variant => { const item = ui.get(`stone-${variant.id}`); item.dataset.decoration = 'stone'; item.dataset.variant = variant.id; return item; });
  const stumps = STUMP_VARIANTS.map(variant => { const item = ui.get(`stump-${variant.id}`); item.dataset.decoration = 'stump'; item.dataset.variant = variant.id; return item; });
  const objects = DECORATION_ITEMS.map(object => { const item = ui.get(object.id); item.dataset.decoration = object.id; return item; });
  const invalid = extra.map((data, index) => { const item = ui.get(`invalid-${index}`); item.dataset = data; return item; });
  const wood = woods[3]; ui.palette.push(button, ...woods, ...stones, ...stumps, ...objects, ...invalid);
  const toggle = ui.get('wood-presets-toggle'), presets = ui.get('wood-presets'); toggle.setAttribute('aria-expanded', 'false'); presets.hidden = true;
  for (const id of ['stone-variants', 'stump-variants']) { ui.get(`${id}-toggle`).setAttribute('aria-expanded', 'false'); ui.get(id).hidden = true; }
  const additions: Array<{ kind: string; position: Position; woodPreset?: WoodPresetKind; variant?: DecorationVariant }> = [], previews: unknown[] = [], notices: string[] = [];
  const scene = { canvas,
    placementAt(x: number, y: number): Position | null { return x >= 0 && x <= 100 && y >= 0 && y <= 100 ? { x: x / 100, y: y / 100, ...(x > 60 ? { support: { parentId: 'existing-wood', x: .4 } } : {}) } : null; },
    setPlacementPreview(value: unknown) { previews.push(value); },
  } as unknown as TerrariumScene;
  const picker = new CatalogPicker({ scene, prepare() {}, add(pick, position) { additions.push({ kind: pick.kind, position, ...(pick.woodPreset ? { woodPreset: pick.woodPreset } : {}), ...(pick.variant ? { variant: pick.variant } : {}) }); }, notice(message) { notices.push(message); } });
  return { ui, canvas, button, wood, woods, stones, stumps, objects, invalid, toggle, presets, additions, previews, notices, picker };
}

test('catalog click only arms; the following bottle gesture waits for matching release to place once', () => {
  const f = pickerFixture();
  try {
    emit(f.button, 'click'); assert.equal(f.additions.length, 0); assert.equal(f.button.attributes.get('aria-pressed'), 'true');
    emit(f.canvas, 'pointerdown', { clientX: 70 }); assert.equal(f.additions.length, 0); assert(f.canvas.hasPointerCapture(1));
    emit(f.canvas, 'pointerup', { pointerId: 2, clientX: 70 }); assert.equal(f.additions.length, 0);
    emit(f.canvas, 'pointerup', { clientX: 70 }); assert.deepEqual(f.additions, [{ kind: 'fern', position: { x: .7, y: .5, support: { parentId: 'existing-wood', x: .4 } } }]);
    emit(f.canvas, 'pointerup', { clientX: 70 }); assert.equal(f.additions.length, 1); assert.equal(f.button.attributes.get('aria-pressed'), 'false');
    assert.equal(f.previews.at(-1), null); assert.equal(f.canvas.captures.size, 0);
  } finally { f.ui.restore(); }
});

test('armed placement cancels on outside release, capture loss, cancellation, Escape, blur and hiding', () => {
  for (const cancellation of ['outside', 'pointercancel', 'lostpointercapture', 'escape', 'blur', 'hidden', 'contextmenu']) {
    const f = pickerFixture();
    try {
      emit(f.button, 'click'); emit(f.canvas, 'pointerdown'); assert.equal(f.additions.length, 0);
      if (cancellation === 'outside') emit(f.canvas, 'pointerup', { clientX: 150 });
      else if (cancellation === 'escape') emit(f.ui.document, 'keydown', { key: 'Escape' });
      else if (cancellation === 'blur') emit(f.ui.window, 'blur');
      else if (cancellation === 'hidden') { f.ui.document.hidden = true; emit(f.ui.document, 'visibilitychange'); }
      else emit(f.canvas, cancellation);
      emit(f.canvas, 'pointerup'); assert.equal(f.additions.length, 0); assert.equal(f.previews.at(-1), null); assert.equal(f.canvas.captures.size, 0);
      assert.equal(f.button.attributes.get('aria-pressed'), 'false');
    } finally { f.ui.restore(); }
  }
});

test('palette drag commits only inside and suppresses its synthetic click without disabling later picks', () => {
  const f = pickerFixture();
  try {
    emit(f.wood, 'pointerdown', { clientX: 130 }); emit(f.wood, 'pointermove', { clientX: 70 });
    assert.equal(f.additions.length, 0); emit(f.wood, 'pointerup', { clientX: 70 }); assert.equal(f.additions.length, 1);
    emit(f.wood, 'click'); assert.equal(f.wood.attributes.get('aria-pressed'), 'false'); assert.equal(f.additions.length, 1);
    f.ui.flushTimers(); emit(f.wood, 'click'); assert.equal(f.wood.attributes.get('aria-pressed'), 'true'); assert.equal(f.additions.length, 1);
    emit(f.canvas, 'keydown', { key: 'Enter' }); assert.equal(f.additions.length, 2); assert.equal(f.wood.attributes.get('aria-pressed'), 'false');
  } finally { f.ui.restore(); }
});

test('canceled or out-of-vessel palette drags do not add objects or keep stale previews', () => {
  for (const cancellation of ['outside', 'pointercancel', 'lostpointercapture', 'blur', 'hidden']) {
    const f = pickerFixture();
    try {
      emit(f.button, 'pointerdown', { clientX: 130 }); emit(f.button, 'pointermove', { clientX: 70 });
      if (cancellation === 'outside') emit(f.button, 'pointerup', { clientX: 150 });
      else if (cancellation === 'blur') emit(f.ui.window, 'blur');
      else if (cancellation === 'hidden') { f.ui.document.hidden = true; emit(f.ui.document, 'visibilitychange'); }
      else emit(f.button, cancellation);
      emit(f.button, 'pointerup', { clientX: 70 }); assert.equal(f.additions.length, 0); assert.equal(f.previews.at(-1), null); assert.equal(f.button.captures.size, 0);
    } finally { f.ui.restore(); }
  }
});

test('Driftwood disclosure only reveals four choices and collapsing cancels an armed preset', () => {
  const f = pickerFixture();
  try {
    emit(f.toggle, 'click'); assert.equal(f.toggle.getAttribute('aria-expanded'), 'true'); assert.equal(f.presets.hidden, false);
    assert.equal(f.woods.length, 4); assert.equal(f.additions.length, 0);
    emit(f.wood, 'click'); emit(f.canvas, 'pointermove', { clientX: 70 });
    assert(f.previews.at(-1)); emit(f.toggle, 'click');
    assert.equal(f.toggle.getAttribute('aria-expanded'), 'false'); assert.equal(f.presets.hidden, true);
    assert.equal(f.previews.at(-1), null); assert(f.woods.every(button => button.getAttribute('aria-pressed') === 'false'));
    emit(f.canvas, 'keydown', { key: 'Enter' }); assert.equal(f.additions.length, 0);
    emit(f.toggle, 'click'); emit(f.presets, 'keydown', { key: 'Escape' });
    assert.equal(f.presets.hidden, true); assert.equal(f.toggle.getAttribute('aria-expanded'), 'false'); assert.equal(f.additions.length, 0);
  } finally { f.ui.restore(); }
});

test('each wood preset is an exclusive armed choice whose ghost and explicit keyboard placement carry the same form key', () => {
  for (const [index, preset] of WOOD_PRESETS.entries()) {
    const f = pickerFixture();
    try {
      emit(f.toggle, 'click'); emit(f.woods[index], 'click');
      assert.equal(f.additions.length, 0, 'Clicking a preset is never an add action');
      assert.deepEqual(f.woods.map(button => button.getAttribute('aria-pressed')), WOOD_PRESETS.map((_, i) => String(i === index)));
      emit(f.canvas, 'pointermove', { clientX: 70 });
      assert.deepEqual(f.previews.at(-1), { type: 'decoration', kind: 'wood', woodPreset: preset.id, position: { x: .7, y: .5, support: { parentId: 'existing-wood', x: .4 } } });
      assert.deepEqual(woodPresetForm(preset.id), preset.form);
      emit(f.canvas, 'keydown', { key: index % 2 ? ' ' : 'Enter' });
      assert.deepEqual(f.additions, [{ kind: 'wood', woodPreset: preset.id, position: { x: .5, y: .65 } }]);
      assert.equal(f.previews.at(-1), null); assert.equal(f.woods[index].getAttribute('aria-pressed'), 'false');
    } finally { f.ui.restore(); }
  }
});

test('each preset drag places once with its original form key and local support anchor', () => {
  for (const [index, preset] of WOOD_PRESETS.entries()) {
    const f = pickerFixture();
    try {
      const button = f.woods[index]; emit(f.toggle, 'click');
      emit(button, 'pointerdown', { clientX: 130 }); emit(button, 'pointermove', { clientX: 70 });
      assert.equal(f.additions.length, 0); emit(button, 'pointerup', { clientX: 70 }); emit(button, 'click');
      assert.deepEqual(f.additions, [{ kind: 'wood', woodPreset: preset.id, position: { x: .7, y: .5, support: { parentId: 'existing-wood', x: .4 } } }]);
      assert.equal(button.getAttribute('aria-pressed'), 'false'); assert.equal(f.previews.at(-1), null);
    } finally { f.ui.restore(); }
  }
});

test('Escape cancels an armed wood shape and choosing another preset never mutates existing objects', () => {
  const f = pickerFixture();
  try {
    emit(f.toggle, 'click'); emit(f.woods[0], 'click'); emit(f.woods[3], 'click');
    assert.deepEqual(f.woods.map(button => button.getAttribute('aria-pressed')), ['false', 'false', 'false', 'true']);
    assert.equal(f.additions.length, 0); emit(f.canvas, 'pointermove');
    emit(f.ui.document, 'keydown', { key: 'Escape' });
    assert.equal(f.previews.at(-1), null); emit(f.canvas, 'pointerdown'); emit(f.canvas, 'pointerup');
    assert.equal(f.additions.length, 0); assert(f.woods.every(button => button.getAttribute('aria-pressed') === 'false'));
  } finally { f.ui.restore(); }
});

test('stone and stump disclosures only expand choices and closing cancels provisional placement', () => {
  for (const id of ['stone-variants', 'stump-variants']) {
    const f = pickerFixture();
    try {
      const toggle = f.ui.get(`${id}-toggle`), choices = f.ui.get(id), tile = id === 'stone-variants' ? f.stones[2] : f.stumps[1];
      emit(toggle, 'click'); assert.equal(choices.hidden, false); assert.equal(toggle.getAttribute('aria-expanded'), 'true');
      assert.equal(f.additions.length, 0); emit(tile, 'click'); emit(f.canvas, 'pointermove'); assert(f.previews.at(-1));
      emit(toggle, 'click'); assert.equal(choices.hidden, true); assert.equal(f.previews.at(-1), null);
      emit(f.canvas, 'keydown', { key: 'Enter' }); assert.equal(f.additions.length, 0);
      emit(toggle, 'click'); emit(tile, 'click'); emit(choices, 'keydown', { key: 'Escape' });
      assert.equal(choices.hidden, true); assert.equal(toggle.getAttribute('aria-expanded'), 'false'); assert.equal(tile.getAttribute('aria-pressed'), 'false');
    } finally { f.ui.restore(); }
  }
});

test('all six natural variants arm exclusively and preserve their variant from preview to one atomic drop', () => {
  for (let index = 0; index < 6; index++) {
    const f = pickerFixture();
    try {
      const choices = [...f.stones, ...f.stumps], button = choices[index];
      const kind = button.dataset.decoration, variant = button.dataset.variant;
      emit(button, 'click'); assert.equal(f.additions.length, 0);
      assert.deepEqual(choices.map(value => value.getAttribute('aria-pressed')), choices.map((_, i) => String(i === index)));
      emit(f.canvas, 'pointermove', { clientX: 70 });
      const position = { x: .7, y: .5, support: { parentId: 'existing-wood', x: .4 } };
      assert.deepEqual(f.previews.at(-1), { type: 'decoration', kind, variant, position });
      emit(f.canvas, 'pointerdown', { clientX: 70 }); assert.equal(f.additions.length, 0);
      emit(f.canvas, 'pointerup', { clientX: 70 }); emit(f.canvas, 'pointerup', { clientX: 70 });
      assert.deepEqual(f.additions, [{ kind, variant, position }]); assert.equal(f.previews.at(-1), null);
    } finally { f.ui.restore(); }
  }
});

test('all catalog decorations and six natural variants can drag to place once and cancel outside or on capture loss', () => {
  for (let index = 0; index < 13; index++) {
    const f = pickerFixture();
    try {
      const button = [...f.stones, ...f.stumps, ...f.objects][index];
      for (const cancellation of ['outside', 'pointercancel', 'lostpointercapture', 'escape']) {
        emit(button, 'pointerdown', { clientX: 130 }); emit(button, 'pointermove', { clientX: 70 });
        if (cancellation === 'outside') emit(button, 'pointerup', { clientX: 150 });
        else if (cancellation === 'escape') emit(f.ui.document, 'keydown', { key: 'Escape' });
        else emit(button, cancellation);
        emit(button, 'pointerup', { clientX: 70 }); f.ui.flushTimers();
        assert.equal(f.additions.length, 0); assert.equal(f.previews.at(-1), null);
      }
      emit(button, 'pointerdown', { clientX: 130 }); emit(button, 'pointermove', { clientX: 70 });
      emit(button, 'pointerup', { clientX: 70 }); emit(button, 'click');
      assert.deepEqual(f.additions, [{ kind: button.dataset.decoration, ...(button.dataset.variant ? { variant: button.dataset.variant } : {}), position: { x: .7, y: .5, support: { parentId: 'existing-wood', x: .4 } } }]);
      assert.equal(button.getAttribute('aria-pressed'), 'false'); assert.equal(f.previews.at(-1), null);
    } finally { f.ui.restore(); }
  }
});

test('new decoration keyboard placement is explicit, and cross-family or unknown variant metadata never arms', () => {
  const f = pickerFixture([{ decoration: 'stone', variant: 'fallen' }, { decoration: 'stump', variant: 'spire' }, { decoration: 'pavilion', variant: 'flat' }, { decoration: 'stone', variant: 'unknown' }, { decoration: 'wood', variant: 'flat', woodPreset: 'single' }]);
  try {
    for (const [index, button] of f.objects.entries()) {
      emit(button, 'click'); assert.equal(f.additions.length, index);
      emit(f.canvas, 'keydown', { key: index % 2 ? ' ' : 'Enter' }); assert.equal(f.additions.at(-1)!.kind, button.dataset.decoration);
    }
    const count = f.additions.length;
    for (const button of f.invalid) {
      emit(button, 'pointerdown', { clientX: 130 }); emit(button, 'pointermove'); emit(button, 'pointerup'); emit(button, 'click');
      emit(f.canvas, 'keydown', { key: 'Enter' });
      assert.equal(f.additions.length, count); assert.equal(f.previews.at(-1), null);
    }
  } finally { f.ui.restore(); }
});

test('simple rotate and flip compose during pending acknowledgments without replacing legacy or custom wood', async () => {
  for (const legacy of [true, false]) {
    const f = editorFixture(legacy);
    try {
      if (!legacy) f.state().decorations[0].wood = { length: 1.73, angle: -127, bend: -.28, branches: [{ at: .81, length: .73, angle: 42 }] };
      const original = structuredClone(f.state());
      emit(f.ui.get('wood-rotate-right'), 'click'); emit(f.ui.get('wood-rotate-right'), 'click'); emit(f.ui.get('wood-flip'), 'click'); emit(f.ui.get('wood-rotate-left'), 'click');
      assert.deepEqual(f.commits, [
        { type: 'object-pose', id: 'wood', value: { angle: 15, flipX: false } },
        { type: 'object-pose', id: 'wood', value: { angle: 30, flipX: false } },
        { type: 'object-pose', id: 'wood', value: { angle: 30, flipX: true } },
        { type: 'object-pose', id: 'wood', value: { angle: 15, flipX: true } },
      ]);
      assert.deepEqual(f.editor.visibleState(f.state()).decorations[0].pose, { angle: 15, flipX: true });
      for (let i = 0; i < 4; i++) await f.ack();
      assert.deepEqual(f.state().decorations[0], { ...original.decorations[0], pose: { angle: 15, flipX: true } });
      assert.deepEqual(f.state().decorations[1], original.decorations[1]); assert.deepEqual(f.state().plants, original.plants);
      assert.equal(f.ui.get('wood-flip').getAttribute('aria-pressed'), 'true');
    } finally { f.ui.restore(); }
  }
});

test('rotation wraps at the angle bounds, flip is reversible, and non-wood selection cannot emit pose edits', async () => {
  const f = editorFixture();
  try {
    f.state().decorations[0].pose = { angle: 180, flipX: false }; f.editor.sync();
    emit(f.ui.get('wood-rotate-right'), 'click'); await f.ack(); assert.equal(f.state().decorations[0].pose!.angle, -165);
    emit(f.ui.get('wood-rotate-left'), 'click'); await f.ack(); assert.equal(f.state().decorations[0].pose!.angle, -180);
    emit(f.ui.get('wood-rotate-left'), 'click'); await f.ack(); assert.equal(f.state().decorations[0].pose!.angle, 165);
    emit(f.ui.get('wood-flip'), 'click'); emit(f.ui.get('wood-flip'), 'click'); await f.ack(); await f.ack();
    assert.deepEqual(f.state().decorations[0].pose, { angle: 165, flipX: false });
    const count = f.commits.length;
    for (const selection of [{ type: 'decoration', id: 'stone' }, { type: 'plant', id: 'moss' }, null] as const) {
      f.select(selection); emit(f.ui.get('wood-rotate-left'), 'click'); emit(f.ui.get('wood-flip'), 'click'); assert.equal(f.commits.length, count);
    }
  } finally { f.ui.restore(); }
});

test('canceled size draft cannot leak through a subsequent rotate action', async () => {
  const f = editorFixture();
  try {
    emit(f.ui.get('entity-scale'), 'pointerdown'); f.input('entity-scale', 1.9); emit(f.ui.get('entity-scale'), 'pointercancel');
    emit(f.ui.get('wood-rotate-right'), 'click'); emit(f.ui.get('entity-scale'), 'change');
    assert.deepEqual(f.commits, [{ type: 'object-pose', id: 'wood', value: { angle: 15, flipX: false } }]);
    await f.ack(); assert.equal(f.state().decorations[0].scale, 1);
  } finally { f.ui.restore(); }
});
