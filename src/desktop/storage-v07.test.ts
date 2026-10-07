import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { advanceSimulation, applyAction, createInitialState } from '../core/simulation';
import { DEFAULT_GLASS_FORM, DEFAULT_WOOD_FORM, defaultGlassSide } from '../shared/catalog';
import type { DecorationKind, TerrariumState } from '../shared/types';
import { decodeSave, encodeSave, hasV07Features, hasV09Features, LocalStore, MAX_SAVE_BYTES, readSaveFile } from './storage';

function fixture(): { store: LocalStore; cleanup(): void } {
  const directory = mkdtempSync(join(tmpdir(), 'mosslight-storage-v07-'));
  return { store: new LocalStore(directory), cleanup() {
    const rel = relative(resolve(tmpdir()), resolve(directory));
    assert(rel && !rel.startsWith('..') && !isAbsolute(rel) && rel.startsWith('mosslight-storage-v07-'));
    rmSync(directory, { recursive: true });
  } };
}
function previousState(name = 'Previous forest 森林'): TerrariumState {
  const state = createInitialState(1000); state.name = name;
  state.bottle = 'glass-box'; state.glassForm = { ...DEFAULT_GLASS_FORM, facets: 7, sides: { left: defaultGlassSide(), right: defaultGlassSide() } };
  state.terrain = { columns: state.terrain.columns.map(() => Array.from({ length: 80 }, () => 'soil' as const)) };
  state.pond = { depths: Array(48).fill(2) };
  state.decorations = [{ id: 'wood', kind: 'wood', x: .3, y: .5, scale: .4 }, { id: 'stump', kind: 'stump', x: .6, y: .5, scale: 2, support: { parentId: 'wood', x: .7 } }];
  state.plants = [{ id: 'fungi', kind: 'ivory-mushroom', x: .6, y: .5, scale: 1, growth: .4, health: .9, ageDays: 1, wetness: 0, support: { parentId: 'stump', x: .5 } }];
  return state;
}
const formatted = (state: TerrariumState): string => JSON.stringify(JSON.parse(encodeSave(state)), null, 4) + '\r\n';
function examples(): Array<{ label: string; state: TerrariumState }> {
  const woodOnly = previousState(); woodOnly.decorations[0].wood = structuredClone(DEFAULT_WOOD_FORM);
  return [{ label: 'wood-only', state: woodOnly }, ...(['wood', 'stone', 'stump'] as const).flatMap(kind => [0, 1].map(wetness => {
    const state = previousState(); state.decorations[0].kind = kind;
    state.decorations[0].condition = { wetness, decay: kind === 'stone' ? 0 : wetness };
    return { label: `${kind}-condition-${wetness}`, state };
  }))];
}

test('ordinary scaling and zero spray keep old data; ecological time now safely introduces v09 fields', () => {
  let state = previousState(); assert.equal(hasV07Features(state), false);
  state = applyAction(state, { type: 'resize-decoration', id: 'wood', scale: 2 }, 1000);
  state = applyAction(state, { type: 'resize-plant', id: 'fungi', scale: .4 }, 1000);
  state = applyAction(state, { type: 'spray-decoration', decorationId: 'wood', amount: 0 }, 1000);
  assert.equal(hasV07Features(state), false);
  const beforeTime = structuredClone(state);
  state = advanceSimulation(state, 86_400_000, 'offline', 86_401_000);
  // Intentional v0.9 behavior: pond exchange and reversible life state are now
  // persisted; older readers must be protected rather than mislabelled compatible.
  assert.equal(hasV09Features(state), true);
  assert.deepEqual(state.decorations.map(({ condition, colonization, ...geometry }) => geometry), beforeTime.decorations);
  const f = fixture();
  try {
    f.store.save(beforeTime); const original = readFileSync(f.store.primary, 'utf8'); f.store.save(state);
    assert.equal(readFileSync(join(f.store.directory, 'terrarium.before-v0.9-primary.json'), 'utf8'), original);
    assert.deepEqual(readSaveFile(f.store.primary), state);
  }
  finally { f.cleanup(); }
});

for (const { label, state } of examples()) test(`v0.7 ${label} preserves exact original primary and backup once`, () => {
  const f = fixture();
  try {
    assert.equal(hasV07Features(decodeSave(encodeSave(state))), true);
    const primary = formatted(previousState('Original primary 🌿')), backup = formatted(previousState('Older original 森林'));
    writeFileSync(f.store.primary, primary); writeFileSync(f.store.backup, backup);
    const p = join(f.store.directory, 'terrarium.before-v0.7-primary.json'), b = join(f.store.directory, 'terrarium.before-v0.7-backup.json');
    f.store.save(state); f.store.save(state);
    assert.equal(readFileSync(p, 'utf8'), primary); assert.equal(readFileSync(b, 'utf8'), backup);
    assert.deepEqual(readSaveFile(f.store.primary), state);
    const reopened = new LocalStore(f.store.directory); assert.deepEqual(reopened.load().state, state);
    reopened.save(previousState('Later old-compatible forest')); reopened.save(state);
    assert.equal(readFileSync(p, 'utf8'), primary); assert.equal(readFileSync(b, 'utf8'), backup);
    assert.equal(readdirSync(f.store.directory).filter(name => name.startsWith('terrarium.before-v0.7-')).length, 2);
    assert(!readdirSync(f.store.directory).some(name => name.endsWith('.tmp')));
  } finally { f.cleanup(); }
});

test('failed pre-v0.7 preservation blocks both writes and leaves conflicting bytes untouched', () => {
  for (const generation of ['primary', 'backup']) for (const kind of ['corrupt', 'too-large', 'new-feature']) {
    const f = fixture();
    try {
      const old = previousState(), next = examples()[0].state, primary = formatted(old), backup = formatted(previousState('Older backup'));
      writeFileSync(f.store.primary, primary); writeFileSync(f.store.backup, backup);
      const target = join(f.store.directory, `terrarium.before-v0.7-${generation}.json`);
      const conflict = kind === 'corrupt' ? 'important invalid original' : kind === 'too-large' ? 'x'.repeat(MAX_SAVE_BYTES + 1) : formatted(next);
      writeFileSync(target, conflict);
      assert.throws(() => f.store.save(next), /Autosave is paused/);
      assert.equal(readFileSync(f.store.primary, 'utf8'), primary); assert.equal(readFileSync(f.store.backup, 'utf8'), backup);
      assert.equal(readFileSync(target, 'utf8'), conflict);
      assert.throws(() => f.store.save(old), /Autosave is paused/, 'subsequent ordinary saves cannot bypass the failed gate');
      assert.equal(readFileSync(f.store.primary, 'utf8'), primary); assert.equal(readFileSync(f.store.backup, 'utf8'), backup);
    } finally { f.cleanup(); }
  }
});

test('an existing valid pre-v0.7 original is never replaced by a newer compatible forest', () => {
  const f = fixture();
  try {
    const p = join(f.store.directory, 'terrarium.before-v0.7-primary.json'), original = formatted(previousState('Very first original'));
    writeFileSync(p, original); f.store.save(previousState('Later forest')); f.store.save(examples()[0].state);
    assert.equal(readFileSync(p, 'utf8'), original);
  } finally { f.cleanup(); }
});

test('backup-only and mixed-generation upgrade preserves only the available compatible original', () => {
  for (const newPrimary of [false, true]) {
    const f = fixture();
    try {
      const next = examples()[0].state, original = formatted(previousState('Only compatible generation'));
      if (newPrimary) writeFileSync(f.store.primary, formatted(next));
      writeFileSync(f.store.backup, original); f.store.save(next);
      assert.equal(readFileSync(join(f.store.directory, 'terrarium.before-v0.7-backup.json'), 'utf8'), original);
      assert(!readdirSync(f.store.directory).includes('terrarium.before-v0.7-primary.json'));
      assert.deepEqual(readSaveFile(f.store.primary), next);
    } finally { f.cleanup(); }
  }
});

test('v0.7 source generations never masquerade as v0.3, v0.5, v0.6 or v0.7 downgrade files', () => {
  for (const { state } of examples()) {
    const f = fixture();
    try {
      const bytes = formatted(state); writeFileSync(f.store.primary, bytes); writeFileSync(f.store.backup, bytes);
      f.store.save(state); f.store.save(state);
      assert(!readdirSync(f.store.directory).some(name => name.startsWith('terrarium.before-')));
    } finally { f.cleanup(); }
  }
});

test('v0.7 fields in old-version preservation targets cannot bypass existing gates', () => {
  for (const version of ['0.3', '0.5', '0.6']) {
    const f = fixture();
    try {
      const old = createInitialState(1000), original = formatted(old);
      writeFileSync(f.store.primary, original); writeFileSync(f.store.backup, original);
      const foreign = { ...old, decorations: [{ id: 'wet-stone', kind: 'stone' as const, x: .5, y: .5, scale: 1, condition: { wetness: 0, decay: 0 } }] };
      const conflict = formatted(foreign), target = join(f.store.directory, `terrarium.before-v${version}-primary.json`); writeFileSync(target, conflict);
      const next = version === '0.3' ? { ...old, bottle: 'cat' as const } : version === '0.5'
        ? { ...old, terrain: { columns: old.terrain.columns.map(() => Array.from({ length: 41 }, () => 'soil' as const)) } }
        : { ...old, pond: { depths: Array(48).fill(0) } };
      assert.throws(() => f.store.save(next), /Autosave is paused/);
      assert.equal(readFileSync(f.store.primary, 'utf8'), original); assert.equal(readFileSync(f.store.backup, 'utf8'), original);
      assert.equal(readFileSync(target, 'utf8'), conflict);
    } finally { f.cleanup(); }
  }
});

test('positive spray and wood-form editing create v0.7 data, while both remain strict immutable exports', () => {
  const initial = previousState();
  for (const next of [applyAction(initial, { type: 'spray-decoration', decorationId: 'wood', amount: .025 }, 1000), applyAction(initial, { type: 'wood-form', id: 'wood', value: structuredClone(DEFAULT_WOOD_FORM) }, 1000)]) {
    assert.equal(hasV07Features(next), true); assert.deepEqual(decodeSave(encodeSave(next)), next);
    assert.equal(hasV07Features(initial), false);
  }
});

test('maximal terrain, object counts, wood branches and condition stay within the unchanged export cap', () => {
  const state = createInitialState(1000); state.name = '森'.repeat(80);
  state.terrain.columns = state.terrain.columns.map(() => Array.from({ length: 112 }, () => 'charcoal' as const));
  state.pond = { depths: Array(48).fill(0) };
  state.decorations = Array.from({ length: 20 }, (_, index) => ({ id: `wood-${index}`, kind: 'wood' as DecorationKind, x: .5, y: .5, scale: 2,
    wood: { length: 2, angle: 160, branches: Array.from({ length: 3 }, () => ({ at: .85, length: .8, angle: 80 })) }, condition: { wetness: 1, decay: 1 },
    ...(index ? { support: { parentId: 'wood-0', x: .85 } } : {}),
  }));
  state.plants = Array.from({ length: 24 }, (_, index) => ({ id: `plant-${index}`, kind: 'ivory-mushroom', x: .5, y: .5, scale: 2, health: 1, growth: 1, ageDays: 1e9, wetness: 1, support: { parentId: 'wood-19', x: 1 } }));
  const serialized = encodeSave(state); assert.ok(Buffer.byteLength(serialized) < MAX_SAVE_BYTES);
  assert.deepEqual(decodeSave(serialized), state);
});
