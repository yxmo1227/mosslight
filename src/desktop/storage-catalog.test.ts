import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import type { DecorationKind, PlantKind, TerrariumState } from '../shared/types';
import { createInitialState } from '../core/simulation';
import { decodeSave, encodeSave, hasV09Features, hasV10Features, LocalStore } from './storage';

const NEW_PLANTS: PlantKind[] = ['star-moss', 'fern-moss', 'creeping-fig', 'oxalis', 'scarlet-mushroom', 'violet-mushroom'];
const NEW_OBJECTS: DecorationKind[] = ['fairy', 'gardener', 'reader', 'cat', 'dog', 'mushroom-house', 'treehouse', 'arc-lamp', 'slender-steps', 'sun', 'moon', 'star'];
function oldV09(): TerrariumState {
  const state = createInitialState(1000); state.ecology.simulatedDays = 73;
  state.plants = [{ id: 'moss', kind: 'sheet-moss', x: .4, y: .7, scale: 1, growth: .7, health: .8, wetness: 0, ageDays: 73,
    ecology: { drought: 0, waterlogging: 0, spread: .3, cycle: .2, generation: 0 } }];
  state.decorations = [
    { id: 'house', kind: 'cottage', x: .6, y: .7, scale: 1, colonization: { moss: .2, health: .8 } },
    { id: 'wood', kind: 'wood', x: .2, y: .7, scale: 1, wood: { length: 1, angle: 0, branches: [] }, condition: { wetness: .1, decay: .2, mold: 0 } },
    { id: 'path', kind: 'path', x: .5, y: .7, scale: 1 },
  ];
  state.pond = { depths: Array(48).fill(2), exchange: .25 }; return state;
}
const features: Array<[string, (state: TerrariumState) => void]> = [
  ...NEW_PLANTS.map(kind => [kind, (state: TerrariumState) => { state.plants[0].kind = kind; }] as [string, (state: TerrariumState) => void]),
  ...NEW_OBJECTS.map(kind => [kind, (state: TerrariumState) => { state.decorations.push({ id: 'new-object', kind, x: .7, y: .2, scale: 1 }); }] as [string, (state: TerrariumState) => void]),
  ...(['natural', 'birch', 'charred'] as const).map(tone => [`tone-${tone}`, (state: TerrariumState) => { state.decorations[1].wood!.tone = tone; }] as [string, (state: TerrariumState) => void]),
];
const bytes = (state: TerrariumState): string => JSON.stringify(JSON.parse(encodeSave(state)), null, 4) + '\r\n';
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'mosslight-storage-v010-'));
  return { store: new LocalStore(directory), cleanup() {
    const rel = relative(resolve(tmpdir()), resolve(directory));
    assert(rel.startsWith('mosslight-storage-v010-') && !rel.startsWith('..') && !isAbsolute(rel));
    rmSync(directory, { recursive: true });
  } };
}

test('v0.9 ecological extensions and hidden legacy path alone are not v0.10 features', () => {
  const state = oldV09(); assert(hasV09Features(state)); assert(!hasV10Features(state));
  assert.deepEqual(decodeSave(bytes(state)), state);
  const zero = oldV09(); zero.plants[0].ecology!.spread = 0; zero.pond!.exchange = 0;
  zero.decorations[0].colonization!.moss = 0; zero.decorations[1].condition!.mold = 0;
  assert(!hasV10Features(zero)); assert(hasV09Features(zero));
  const f = fixture(); try {
    writeFileSync(f.store.primary, bytes(state)); f.store.save(state);
    assert(!readdirSync(f.store.directory).some(name => name.startsWith('terrarium.before-v0.10-')));
  } finally { f.cleanup(); }
});

for (const [label, change] of features) test(`v0.10 ${label} preserves both exact first originals once, then round-trips`, () => {
  const f = fixture(); try {
    const primary = bytes(oldV09()), backupState = oldV09(); backupState.name = 'Earlier forest';
    const backup = bytes(backupState);
    writeFileSync(f.store.primary, primary); writeFileSync(f.store.backup, backup);
    const extended = oldV09(); change(extended);
    assert(hasV10Features(extended)); assert(hasV09Features(extended), 'new catalog also fails older reader compatibility');
    assert.deepEqual(decodeSave(bytes(extended)), extended);
    f.store.save(extended); extended.name = 'Later saved forest'; f.store.save(extended);
    assert.equal(readFileSync(join(f.store.directory, 'terrarium.before-v0.10-primary.json'), 'utf8'), primary);
    assert.equal(readFileSync(join(f.store.directory, 'terrarium.before-v0.10-backup.json'), 'utf8'), backup);
    assert.deepEqual(new LocalStore(f.store.directory).load().state, extended);
    assert.deepEqual(readdirSync(f.store.directory).filter(name => name.startsWith('terrarium.before-')).sort(), [
      'terrarium.before-v0.10-backup.json', 'terrarium.before-v0.10-primary.json',
    ], 'v0.9 originals must not be mislabeled as compatible with v0.8 or older');
  } finally { f.cleanup(); }
});

test('pre-existing compatible preservation files remain byte-for-byte immutable', () => {
  const f = fixture(); try {
    const original = oldV09(); original.name = 'First ever protected original'; const preserved = bytes(original);
    for (const generation of ['primary', 'backup']) writeFileSync(join(f.store.directory, `terrarium.before-v0.10-${generation}.json`), preserved);
    writeFileSync(f.store.primary, bytes(oldV09())); writeFileSync(f.store.backup, bytes(oldV09()));
    const extended = oldV09(); features[0][1](extended); f.store.save(extended);
    for (const generation of ['primary', 'backup']) assert.equal(readFileSync(join(f.store.directory, `terrarium.before-v0.10-${generation}.json`), 'utf8'), preserved);
  } finally { f.cleanup(); }
});

test('invalid, incompatible and special preservation targets fail closed before primary or backup replacement, with sticky failure', () => {
  const extended = oldV09(); features[0][1](extended);
  for (const generation of ['primary', 'backup']) for (const conflict of ['broken', bytes(extended), 'directory']) {
    const f = fixture(); try {
      const original = bytes(oldV09()), target = join(f.store.directory, `terrarium.before-v0.10-${generation}.json`);
      writeFileSync(f.store.primary, original); writeFileSync(f.store.backup, original);
      if (conflict === 'directory') mkdirSync(target); else writeFileSync(target, conflict);
      assert.throws(() => f.store.save(extended), /Autosave is paused/);
      assert.equal(readFileSync(f.store.primary, 'utf8'), original); assert.equal(readFileSync(f.store.backup, 'utf8'), original);
      if (conflict !== 'directory') {
        assert.equal(readFileSync(target, 'utf8'), conflict);
        writeFileSync(target, original);
        assert.throws(() => f.store.save(extended), /Autosave is paused/, 'repairing a target does not silently clear this running store failure');
        assert.equal(readFileSync(f.store.primary, 'utf8'), original); assert.equal(readFileSync(f.store.backup, 'utf8'), original);
      }
    } finally { f.cleanup(); }
  }
});

test('already-upgraded files never become downgrade originals and do not hide an invalid existing target', () => {
  const extended = oldV09(); features.at(-1)![1](extended);
  const f = fixture(); try {
    const original = bytes(extended);
    writeFileSync(f.store.primary, original); writeFileSync(f.store.backup, original);
    f.store.save(extended);
    assert.deepEqual(readdirSync(f.store.directory).filter(name => name.startsWith('terrarium.before-')), []);
    writeFileSync(join(f.store.directory, 'terrarium.before-v0.10-primary.json'), 'invalid downgrade target');
    const beforePrimary = readFileSync(f.store.primary, 'utf8'), beforeBackup = readFileSync(f.store.backup, 'utf8');
    assert.throws(() => f.store.save(extended), /Autosave is paused/);
    assert.equal(readFileSync(f.store.primary, 'utf8'), beforePrimary); assert.equal(readFileSync(f.store.backup, 'utf8'), beforeBackup);
  } finally { f.cleanup(); }
});

test('first v0.10 save without older files creates no invented downgrade backup', () => {
  const f = fixture(); try {
    const state = oldV09(); features[0][1](state); f.store.save(state);
    assert(existsSync(f.store.primary)); assert(!existsSync(f.store.backup));
    assert.deepEqual(readdirSync(f.store.directory).filter(name => name.startsWith('terrarium.before-')), []);
    assert.deepEqual(decodeSave(readFileSync(f.store.primary, 'utf8')), state);
  } finally { f.cleanup(); }
});
