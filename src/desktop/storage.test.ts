import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { createInitialState, applyAction } from '../core/simulation.js';
import { DEFAULT_GLASS_FORM, defaultGlassSide } from '../shared/catalog.js';
import type { TerrariumState } from '../shared/types.js';
import { decodeSave, encodeSave, hasV06Features, LocalStore, MAX_SAVE_BYTES, readSaveFile } from './storage.js';

function fixture(): { store: LocalStore; cleanup(): void } {
  const directory = mkdtempSync(join(tmpdir(), 'mosslight-storage-test-'));
  return { store: new LocalStore(directory), cleanup() {
    assert(resolve(directory).startsWith(resolve(tmpdir()) + '\\mosslight-storage-test-') || resolve(directory).startsWith(resolve(tmpdir()) + '/mosslight-storage-test-'));
    rmSync(directory, { recursive: true });
  } };
}
function legacySave(name = '原来的小森林'): string {
  const { terrain: _terrain, care: _care, ...base } = createInitialState(1000);
  const state = { ...base, schemaVersion: 1, name, layers: [{ material: 'gravel', depth: .16 }, { material: 'clay', depth: .1 }, { material: 'soil', depth: .28 }] };
  return JSON.stringify({ format: 'mosslight', version: 1, checksum: createHash('sha256').update(JSON.stringify(state)).digest('hex'), state }, null, 4) + '\n';
}
test('v1 checksum is checked before migration; envelope and state versions must match', () => {
  const raw = legacySave(); const migrated = decodeSave(raw);
  assert.equal(migrated.schemaVersion, 2); assert.equal(migrated.name, '原来的小森林');
  assert.equal(migrated.terrain.columns.length, 48);
  assert.equal(JSON.parse(encodeSave(migrated)).version, 2);
  const bad = JSON.parse(raw); bad.state.name = 'tampered';
  assert.throws(() => decodeSave(JSON.stringify(bad)), /checksum verification failed/);
  const mismatch = JSON.parse(raw); mismatch.version = 2;
  assert.throws(() => decodeSave(JSON.stringify(mismatch)), /Unsupported save version/);
  const extra = JSON.parse(raw); extra.secret = 'not accepted';
  assert.throws(() => decodeSave(JSON.stringify(extra)), /Unsupported save version/);
});
test('both v1 originals retain exact bytes across repeated v2 saves', () => {
  const f = fixture();
  try {
    const primary = legacySave(), backup = legacySave('更早的森林');
    writeFileSync(f.store.primary, primary); writeFileSync(f.store.backup, backup);
    const loaded = f.store.load().state; assert(loaded);
    f.store.save(loaded); f.store.save(loaded); f.store.save(loaded);
    const originals = readdirSync(f.store.directory).filter((name) => name.startsWith('terrarium.v1-original-'));
    assert.equal(originals.length, 2);
    const bytes = originals.map((name) => readFileSync(join(f.store.directory, name), 'utf8'));
    assert(bytes.includes(primary)); assert(bytes.includes(backup));
    assert.equal(JSON.parse(readFileSync(f.store.primary, 'utf8')).version, 2);
    assert.deepEqual(readSaveFile(f.store.primary), loaded);
  } finally { f.cleanup(); }
});
test('a v1-only backup is preserved before recreation of primary', () => {
  const f = fixture();
  try {
    const original = legacySave(); writeFileSync(f.store.backup, original);
    const loaded = f.store.load().state; assert(loaded);
    f.store.save(loaded); f.store.save(loaded);
    const copies = readdirSync(f.store.directory).filter((name) => name.startsWith('terrarium.v1-original-'));
    assert.equal(copies.length, 1); assert.equal(readFileSync(join(f.store.directory, copies[0]!), 'utf8'), original);
  } finally { f.cleanup(); }
});
test('checksummed export round trips the ecological state', () => {
  const original = applyAction(createInitialState(1000), { type: 'starter' }, 1000);
  assert.deepEqual(decodeSave(encodeSave(original)), original);
});

test('English defaults never rename existing or imported multilingual terrariums', () => {
  assert.equal(createInitialState(1000).name, 'My Little Forest');
  for (const name of ['我的小森林', '雨后森林', 'Bosque de Lucía', '森 🌱']) {
    const original = { ...createInitialState(1000), name };
    const restored = decodeSave(encodeSave(original));
    assert.equal(restored.name, name, 'schema-2 import preserves the original name');
    assert.equal(decodeSave(legacySave(name)).name, name, 'strict v1 migration preserves the original name');
    const shaped = applyAction(applyAction(restored, { type: 'bottle', shape: 'glass-box' }, 1001), {
      type: 'glass-form', value: { lower: .55, middle: 1.25, upper: .72, facets: 12 },
    }, 1002);
    assert.equal(decodeSave(encodeSave(shaped)).name, name, 'shape extensions do not translate stored data');
  }
});

test('English storage status does not change a saved legacy default name on restart', () => {
  const f = fixture();
  try {
    const original = { ...createInitialState(1000), name: '我的小森林' };
    f.store.save(original);
    const reopened = new LocalStore(f.store.directory).load();
    assert.equal(reopened.message, 'Saved locally · Offline ready');
    assert.deepEqual(reopened.state, original);
  } finally { f.cleanup(); }
});
test('changed content and oversized documents are rejected', () => {
  const doc = JSON.parse(encodeSave(createInitialState(1000)));
  doc.state.ecology.moisture = 0.9;
  assert.throws(() => decodeSave(JSON.stringify(doc)), /checksum verification failed/);
  assert.throws(() => decodeSave(' '.repeat(MAX_SAVE_BYTES + 1)), /too large/);
});
test('valid checksum is not permission to import malicious state', () => {
  const doc = JSON.parse(encodeSave(createInitialState(1000)));
  doc.state.environment.temperature = -999;
  doc.checksum = createHash('sha256').update(JSON.stringify(doc.state)).digest('hex');
  assert.throws(() => decodeSave(JSON.stringify(doc)));
});
test('atomic saves retain the previous valid version as backup', () => {
  const f = fixture();
  try {
    const first = createInitialState(1000);
    const second = applyAction(first, { type: 'rename', name: '雨后森林' }, 2000);
    f.store.save(first); f.store.save(second);
    assert.deepEqual(f.store.load().state, second);
    assert.deepEqual(readSaveFile(f.store.backup), first);
    assert(!readdirSync(f.store.directory).some((name) => name.endsWith('.tmp')));
  } finally { f.cleanup(); }
});
test('corrupt primary recovers backup and preserves original bytes', () => {
  const f = fixture();
  try {
    const state = createInitialState(1000);
    f.store.save(state); f.store.save(state);
    writeFileSync(f.store.primary, '{broken');
    const result = f.store.load();
    assert.deepEqual(result.state, state);
    assert.match(result.message, /Restored from backup/);
    const preserved = readdirSync(f.store.directory).find((name) => name.startsWith('terrarium.recovered-'));
    assert(preserved);
    assert.equal(readFileSync(join(f.store.directory, preserved), 'utf8'), '{broken');
  } finally { f.cleanup(); }
});
test('invalid new state cannot replace a good primary', () => {
  const f = fixture();
  try {
    const state = createInitialState(1000); f.store.save(state);
    const before = readFileSync(f.store.primary, 'utf8');
    assert.throws(() => f.store.save({ ...state, schemaVersion: 99 } as never));
    assert.equal(readFileSync(f.store.primary, 'utf8'), before);
  } finally { f.cleanup(); }
});
test('missing primary can recover an existing valid backup', () => {
  const f = fixture();
  try {
    const state = createInitialState(1000);
    writeFileSync(f.store.backup, encodeSave(state));
    assert.deepEqual(f.store.load().state, state);
  } finally { f.cleanup(); }
});
test('a sole corrupt backup is preserved before later autosaves can replace it', () => {
  const f = fixture();
  try {
    writeFileSync(f.store.backup, 'precious-but-corrupt');
    assert.equal(f.store.load().state, null);
    f.store.save(createInitialState(1000)); f.store.save(createInitialState(2000));
    const recovered = readdirSync(f.store.directory).filter((name) => name.startsWith('terrarium.recovered-'));
    assert(recovered.some((name) => readFileSync(join(f.store.directory, name), 'utf8') === 'precious-but-corrupt'));
  } finally { f.cleanup(); }
});

test('a corrupt backup is preserved even when the primary is healthy', () => {
  const f = fixture();
  try {
    const state = createInitialState(1000); f.store.save(state);
    writeFileSync(f.store.backup, 'older-precious-corrupt-save');
    assert.deepEqual(f.store.load().state, state);
    f.store.save(state); f.store.save(state);
    const copies = readdirSync(f.store.directory).filter((name) => name.startsWith('terrarium.recovered-'));
    assert.equal(copies.length, 1);
    assert.equal(readFileSync(join(f.store.directory, copies[0]!), 'utf8'), 'older-precious-corrupt-save');
  } finally { f.cleanup(); }
});
test('oversized damaged primary keeps its bytes and permits reading a good backup', () => {
  const f = fixture();
  try {
    const state = createInitialState(1000);
    writeFileSync(f.store.backup, encodeSave(state));
    writeFileSync(f.store.primary, 'x'.repeat(MAX_SAVE_BYTES + 1));
    assert.deepEqual(f.store.load().state, state);
    assert.throws(() => f.store.save(state), /Autosave is paused/);
    assert.equal(readFileSync(f.store.primary, 'utf8').length, MAX_SAVE_BYTES + 1);
  } finally { f.cleanup(); }
});

test('first custom shape preserves compatible v2 primary and backup verbatim across saves and restart', () => {
  const f = fixture();
  try {
    const first = createInitialState(1000), second = applyAction(first, { type: 'rename', name: '雕形之前' }, 2000);
    f.store.save(first); f.store.save(second);
    const oldPrimary = readFileSync(f.store.primary), oldBackup = readFileSync(f.store.backup);
    const shaped = { ...second, bottle: 'glass-box' as const, glassForm: { lower: .82, middle: 1.15, upper: .7, facets: 8 as const } };
    f.store.save(shaped); f.store.save(shaped);
    const p = join(f.store.directory, 'terrarium.before-v0.3-primary.json');
    const b = join(f.store.directory, 'terrarium.before-v0.3-backup.json');
    assert.deepEqual(readFileSync(p), oldPrimary); assert.deepEqual(readFileSync(b), oldBackup);
    const reopened = new LocalStore(f.store.directory);
    assert.deepEqual(reopened.load().state, shaped);
    reopened.save({ ...shaped, glassForm: { ...shaped.glassForm, lower: .6 } });
    assert.deepEqual(readFileSync(p), oldPrimary); assert.deepEqual(readFileSync(b), oldBackup);
    assert.equal(readdirSync(f.store.directory).filter(name => name.startsWith('terrarium.before-v0.3-')).length, 2);
  } finally { f.cleanup(); }
});

test('cat selection also preserves a compatible source; damaged preservation fails closed', () => {
  const f = fixture();
  try {
    const initial = createInitialState(1000); f.store.save(initial);
    const original = readFileSync(f.store.primary);
    const cat = { ...initial, bottle: 'cat' as const };
    const target = join(f.store.directory, 'terrarium.before-v0.3-primary.json');
    writeFileSync(target, 'do not overwrite this failed backup');
    assert.throws(() => f.store.save(cat), /Autosave is paused/);
    assert.deepEqual(readFileSync(f.store.primary), original);
    assert.equal(readFileSync(target, 'utf8'), 'do not overwrite this failed backup');
  } finally { f.cleanup(); }
});

test('taller v0.5 soil preserves both compatible originals and survives restart without rescaling', () => {
  const f = fixture();
  try {
    const initial = { ...createInitialState(1000), bottle: 'cat' as const };
    const boundary = { ...initial, name: 'Old height', terrain: { columns: initial.terrain.columns.map(() => Array.from({ length: 40 }, () => 'soil' as const)) } };
    f.store.save(initial); f.store.save(boundary);
    assert(!readdirSync(f.store.directory).some(name => name.startsWith('terrarium.before-v0.5-')));
    const originalPrimary = readFileSync(f.store.primary), originalBackup = readFileSync(f.store.backup);
    const tall = { ...boundary, terrain: { columns: boundary.terrain.columns.map((column, index) => index === 24 ? [...column, 'coir' as const] : column) } };
    f.store.save(tall); f.store.save(tall);
    const p = join(f.store.directory, 'terrarium.before-v0.5-primary.json');
    const b = join(f.store.directory, 'terrarium.before-v0.5-backup.json');
    assert.deepEqual(readFileSync(p), originalPrimary); assert.deepEqual(readFileSync(b), originalBackup);
    const reopened = new LocalStore(f.store.directory);
    assert.deepEqual(reopened.load().state, tall);
    reopened.save(tall);
    assert.deepEqual(readFileSync(p), originalPrimary); assert.deepEqual(readFileSync(b), originalBackup);
    // Even after a later low landscape, the first compatible originals are retained.
    reopened.save(boundary); reopened.save(tall);
    assert.deepEqual(readFileSync(p), originalPrimary); assert.deepEqual(readFileSync(b), originalBackup);
  } finally { f.cleanup(); }
});

test('unsafe pre-v0.5 preservation target blocks all normal save rotation', () => {
  for (const targetKind of ['damaged', 'too-tall'] as const) {
    const f = fixture();
    try {
      const initial = createInitialState(1000);
      f.store.save(initial); f.store.save({ ...initial, name: 'Newer original' });
      const p = readFileSync(f.store.primary), b = readFileSync(f.store.backup);
      const tall = { ...initial, terrain: { columns: initial.terrain.columns.map(() => Array.from({ length: 41 }, () => 'soil' as const)) } };
      const target = join(f.store.directory, 'terrarium.before-v0.5-backup.json');
      const conflict = targetKind === 'damaged' ? 'preserve my damaged original' : encodeSave(tall);
      writeFileSync(target, conflict);
      assert.throws(() => f.store.save(tall), /Autosave is paused/);
      assert.deepEqual(readFileSync(f.store.primary), p); assert.deepEqual(readFileSync(f.store.backup), b);
      assert.equal(readFileSync(target, 'utf8'), conflict);
    } finally { f.cleanup(); }
  }
});

test('a backup-only compatible forest is preserved before first taller primary', () => {
  const f = fixture();
  try {
    const old = createInitialState(1000), original = encodeSave(old);
    writeFileSync(f.store.backup, original);
    const tall = { ...old, terrain: { columns: old.terrain.columns.map(() => Array.from({ length: 80 }, () => 'bark' as const)) } };
    f.store.save(tall);
    assert.equal(readFileSync(join(f.store.directory, 'terrarium.before-v0.5-backup.json'), 'utf8'), original);
    assert(!readdirSync(f.store.directory).includes('terrarium.before-v0.5-primary.json'));
    assert.deepEqual(f.store.load().state, tall);
  } finally { f.cleanup(); }
});

test('tall terrain is never mislabelled as a v0.2-compatible shape restore point', () => {
  const f = fixture();
  try {
    const initial = createInitialState(1000);
    const tall = { ...initial, terrain: { columns: initial.terrain.columns.map(() => Array.from({ length: 41 }, () => 'soil' as const)) } };
    f.store.save(tall); f.store.save(tall);
    f.store.save({ ...tall, bottle: 'cat' });
    assert(!readdirSync(f.store.directory).some(name => name.startsWith('terrarium.before-v0.3-')));
  } finally { f.cleanup(); }
});

/** These are independent, valid feature examples, not labels inferred from filenames. */
function v06Examples(): Array<{ label: string; state: TerrariumState }> {
  const initial = createInitialState(1000);
  const wood = applyAction(initial, { type: 'add-decoration', kind: 'wood', x: .5, y: .4 }, 1001);
  const support = { parentId: wood.decorations[0]!.id, x: .4 };
  return [
    { label: 'empty pond data', state: { ...initial, pond: { depths: Array.from({ length: 48 }, () => 0) } } },
    { label: 'filled pond', state: applyAction(initial, { type: 'pour-water', x: .5, amount: 16 }, 1001) },
    { label: 'independent glass sides', state: { ...initial, bottle: 'glass-box', glassForm: { ...DEFAULT_GLASS_FORM, sides: { left: defaultGlassSide(), right: defaultGlassSide() } } } },
    ...[5, 7, 9, 11, 13, 14, 15, 16].map(facets => ({ label: `${facets}-sided opening`, state: { ...initial, glassForm: { ...DEFAULT_GLASS_FORM, facets } } })),
    ...(['amber-mushroom', 'ivory-mushroom'] as const).map(kind => ({ label: kind, state: applyAction(initial, { type: 'add-plant', kind, x: .5, y: .5 }, 1001) })),
    { label: 'stump', state: applyAction(initial, { type: 'add-decoration', kind: 'stump', x: .5, y: .5 }, 1001) },
    { label: 'plant support', state: applyAction(wood, { type: 'add-plant', kind: 'sheet-moss', x: .5, y: .4, support }, 1002) },
    { label: 'decoration support', state: applyAction(wood, { type: 'add-decoration', kind: 'stone', x: .5, y: .4, support }, 1002) },
  ];
}

function formattedSave(state: TerrariumState): string {
  // Non-default envelope formatting proves preservation copies the original bytes.
  return JSON.stringify(JSON.parse(encodeSave(state)), null, 4) + '\r\n';
}

test('v0.6 detection leaves all v0.5-compatible shape and height states unmarked', () => {
  const initial = createInitialState(1000);
  const oldStates: TerrariumState[] = [initial, { ...initial, bottle: 'cat' },
    { ...initial, terrain: { columns: initial.terrain.columns.map(() => Array.from({ length: 112 }, () => 'soil' as const)) } },
    ...[6, 8, 10, 12].map(facets => ({ ...initial, glassForm: { ...DEFAULT_GLASS_FORM, facets } })),
  ];
  for (const state of oldStates) {
    assert.equal(hasV06Features(decodeSave(encodeSave(state))), false);
  }
});

for (const { label, state } of v06Examples()) {
  test(`first v0.6 ${label} preserves both compatible originals exclusively`, () => {
    const f = fixture();
    try {
      assert.equal(hasV06Features(state), true);
      const old = createInitialState(1000);
      const primary = formattedSave({ ...old, name: 'Before the new tools 🌿' });
      const backup = formattedSave({ ...old, name: 'Older original 森林' });
      writeFileSync(f.store.primary, primary); writeFileSync(f.store.backup, backup);
      const p = join(f.store.directory, 'terrarium.before-v0.6-primary.json');
      const b = join(f.store.directory, 'terrarium.before-v0.6-backup.json');
      f.store.save(state); f.store.save(state);
      assert.equal(readFileSync(p, 'utf8'), primary); assert.equal(readFileSync(b, 'utf8'), backup);
      const reopened = new LocalStore(f.store.directory);
      assert.deepEqual(reopened.load().state, state);
      // Returning to a compatible state must not replace the first downgrade copies.
      reopened.save({ ...old, name: 'A later compatible forest' }); reopened.save(state);
      assert.equal(readFileSync(p, 'utf8'), primary); assert.equal(readFileSync(b, 'utf8'), backup);
      assert.equal(readdirSync(f.store.directory).filter(name => name.startsWith('terrarium.before-v0.6-')).length, 2);
      assert.deepEqual(readSaveFile(f.store.primary), state);
      assert(!readdirSync(f.store.directory).some(name => name.endsWith('.tmp')));
    } finally { f.cleanup(); }
  });
}

test('v0.6 preservation accepts existing compatible originals without overwriting their bytes', () => {
  const f = fixture();
  try {
    const old = createInitialState(1000);
    const preserved = formattedSave({ ...old, name: 'First compatible original', bottle: 'cat', terrain: { columns: old.terrain.columns.map(() => Array.from({ length: 112 }, () => 'bark' as const)) } });
    const p = join(f.store.directory, 'terrarium.before-v0.6-primary.json');
    const b = join(f.store.directory, 'terrarium.before-v0.6-backup.json');
    writeFileSync(p, preserved); writeFileSync(b, preserved);
    f.store.save(old); f.store.save({ ...old, name: 'Later compatible state' });
    f.store.save(v06Examples()[0]!.state);
    assert.equal(readFileSync(p, 'utf8'), preserved); assert.equal(readFileSync(b, 'utf8'), preserved);
  } finally { f.cleanup(); }
});

test('invalid or v0.6-incompatible downgrade targets block both writes and remain untouched', () => {
  for (const targetKind of ['damaged', 'oversized', 'v0.6'] as const) {
    for (const generation of ['primary', 'backup'] as const) {
      const f = fixture();
      try {
        const old = createInitialState(1000);
        const p = formattedSave({ ...old, name: 'Primary must remain' });
        const b = formattedSave({ ...old, name: 'Backup must remain' });
        writeFileSync(f.store.primary, p); writeFileSync(f.store.backup, b);
        const next = v06Examples()[0]!.state;
        const target = join(f.store.directory, `terrarium.before-v0.6-${generation}.json`);
        const conflict = targetKind === 'damaged' ? 'important damaged original' : targetKind === 'oversized' ? 'x'.repeat(MAX_SAVE_BYTES + 1) : formattedSave(next);
        writeFileSync(target, conflict);
        assert.throws(() => f.store.save(next), /Autosave is paused/);
        assert.equal(readFileSync(f.store.primary, 'utf8'), p); assert.equal(readFileSync(f.store.backup, 'utf8'), b);
        assert.equal(readFileSync(target, 'utf8'), conflict);
        // A subsequent ordinary save cannot bypass the failed preservation gate.
        assert.throws(() => f.store.save(old), /Autosave is paused/);
        assert.equal(readFileSync(f.store.primary, 'utf8'), p); assert.equal(readFileSync(f.store.backup, 'utf8'), b);
        assert(!readdirSync(f.store.directory).some(name => name.endsWith('.tmp')));
      } finally { f.cleanup(); }
    }
  }
});

test('backup-only v0.5 tall terrain is preserved verbatim before a new v0.6 primary', () => {
  const f = fixture();
  try {
    const old = createInitialState(1000);
    const tall = { ...old, terrain: { columns: old.terrain.columns.map(() => Array.from({ length: 112 }, () => 'clay' as const)) } };
    const original = formattedSave(tall); writeFileSync(f.store.backup, original);
    const next = { ...tall, pond: { depths: Array.from({ length: 48 }, () => 0) } };
    f.store.save(next);
    assert.equal(readFileSync(join(f.store.directory, 'terrarium.before-v0.6-backup.json'), 'utf8'), original);
    assert(!readdirSync(f.store.directory).includes('terrarium.before-v0.6-primary.json'));
    assert.deepEqual(f.store.load().state, next);
  } finally { f.cleanup(); }
});

test('already-v0.6 sources never become v0.3, v0.5, or v0.6 downgrade originals', () => {
  for (const { label, state } of v06Examples()) {
    const f = fixture();
    try {
      const source = formattedSave(state);
      writeFileSync(f.store.primary, source); writeFileSync(f.store.backup, source);
      const extended: TerrariumState = { ...state, bottle: 'cat', terrain: { columns: state.terrain.columns.map(() => Array.from({ length: 41 }, () => 'soil' as const)) } };
      f.store.save(extended); f.store.save(extended);
      assert(!readdirSync(f.store.directory).some(name => name.startsWith('terrarium.before-')), label);
      assert.deepEqual(readSaveFile(f.store.primary), extended);
    } finally { f.cleanup(); }
  }
});

test('mixed generations preserve only the compatible backup before v0.6 rotation', () => {
  const f = fixture();
  try {
    const next = v06Examples()[0]!.state;
    const original = formattedSave({ ...createInitialState(1000), name: 'Last old backup' });
    writeFileSync(f.store.primary, formattedSave(next)); writeFileSync(f.store.backup, original);
    f.store.save(next);
    assert.equal(readFileSync(join(f.store.directory, 'terrarium.before-v0.6-backup.json'), 'utf8'), original);
    assert(!readdirSync(f.store.directory).includes('terrarium.before-v0.6-primary.json'));
  } finally { f.cleanup(); }
});

test('new-feature restore targets cannot masquerade as pre-v0.3 or pre-v0.5 copies', () => {
  for (const version of ['0.3', '0.5'] as const) {
    const f = fixture();
    try {
      const old = createInitialState(1000);
      const original = formattedSave(old);
      writeFileSync(f.store.primary, original); writeFileSync(f.store.backup, original);
      const target = join(f.store.directory, `terrarium.before-v${version}-primary.json`);
      const conflict = formattedSave(v06Examples()[0]!.state); writeFileSync(target, conflict);
      const next: TerrariumState = version === '0.3' ? { ...old, bottle: 'cat' }
        : { ...old, terrain: { columns: old.terrain.columns.map(() => Array.from({ length: 41 }, () => 'soil' as const)) } };
      assert.throws(() => f.store.save(next), /Autosave is paused/);
      assert.equal(readFileSync(f.store.primary, 'utf8'), original); assert.equal(readFileSync(f.store.backup, 'utf8'), original);
      assert.equal(readFileSync(target, 'utf8'), conflict);
    } finally { f.cleanup(); }
  }
});

test('ordinary v0.5-compatible saves do not create a v0.6 downgrade checkpoint', () => {
  const f = fixture();
  try {
    const initial = createInitialState(1000);
    f.store.save(initial); f.store.save({ ...initial, bottle: 'cat', glassForm: { ...DEFAULT_GLASS_FORM } });
    assert(!readdirSync(f.store.directory).some(name => name.startsWith('terrarium.before-v0.6-')));
  } finally { f.cleanup(); }
});
