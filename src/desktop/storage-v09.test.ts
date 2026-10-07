import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { createInitialState } from '../core/simulation';
import { decodeSave, encodeSave, hasV09Features, LocalStore } from './storage';
import type { TerrariumState } from '../shared/types';
const old = () => {
  const s = createInitialState(1_000); s.ecology.simulatedDays = 73;
  s.plants = [{ id: 'moss', kind: 'sheet-moss', x: .4, y: .7, scale: 1, growth: .7, health: .8, wetness: 0, ageDays: 73 }];
  s.decorations = [{ id: 'house', kind: 'cottage', x: .6, y: .7, scale: 1 }, { id: 'wood', kind: 'wood', x: .2, y: .7, scale: 1, condition: { wetness: .1, decay: .2 } }];
  s.pond = { depths: Array(48).fill(2) }; return s;
};
const features: Array<(s: TerrariumState) => void> = [
  s => { s.plants[0].ecology = { drought: 0, waterlogging: 0, spread: 0, cycle: 0, generation: 0 }; },
  s => { s.decorations[0].colonization = { moss: 0, health: 1 }; },
  s => { s.decorations[1].condition!.mold = 0; },
  s => { s.pond!.exchange = 0; },
];
const bytes = (s: TerrariumState) => JSON.stringify(JSON.parse(encodeSave(s)), null, 4) + '\r\n';
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'mosslight-storage-v09-'));
  return { store: new LocalStore(directory), cleanup() {
    const rel = relative(resolve(tmpdir()), resolve(directory)); assert(rel.startsWith('mosslight-storage-v09-') && !rel.startsWith('..') && !isAbsolute(rel));
    rmSync(directory, { recursive: true });
  } };
}
test('v08 day73 layout reads without adding v09 fields', () => { const s = old(); assert(!hasV09Features(s)); assert.deepEqual(decodeSave(bytes(s)), s); });
for (const [index, change] of features.entries()) test(`v09 extension ${index}, including zero, preserves both exact originals once`, () => {
  const f = fixture(); try {
    const primary = bytes(old()), b = old(); b.name = 'Earlier forest'; const backup = bytes(b);
    writeFileSync(f.store.primary, primary); writeFileSync(f.store.backup, backup);
    const s = old(); change(s); assert(hasV09Features(s)); f.store.save(s); f.store.save(s);
    assert.equal(readFileSync(join(f.store.directory, 'terrarium.before-v0.9-primary.json'), 'utf8'), primary);
    assert.equal(readFileSync(join(f.store.directory, 'terrarium.before-v0.9-backup.json'), 'utf8'), backup);
    assert.deepEqual(new LocalStore(f.store.directory).load().state, s);
    assert(!readdirSync(f.store.directory).includes('terrarium.before-v0.8-primary.json'), 'v08 layout is not mislabeled v071');
  } finally { f.cleanup(); }
});
test('invalid or v09 preservation targets block save before either old generation is overwritten', () => {
  const extended = old(); features[0](extended);
  for (const generation of ['primary', 'backup']) for (const conflict of ['broken', bytes(extended)]) {
    const f = fixture(); try {
      const original = bytes(old()), target = join(f.store.directory, `terrarium.before-v0.9-${generation}.json`);
      writeFileSync(f.store.primary, original); writeFileSync(f.store.backup, original); writeFileSync(target, conflict);
      assert.throws(() => f.store.save(extended), /Autosave is paused/);
      assert.equal(readFileSync(f.store.primary, 'utf8'), original); assert.equal(readFileSync(f.store.backup, 'utf8'), original); assert.equal(readFileSync(target, 'utf8'), conflict);
    } finally { f.cleanup(); }
  }
});
test('v09 originals never become older downgrade copies', () => {
  const f = fixture(); try {
    const s = old(); features[0](s); writeFileSync(f.store.primary, bytes(s)); writeFileSync(f.store.backup, bytes(s)); f.store.save(s);
    assert.deepEqual(readdirSync(f.store.directory).filter(name => name.startsWith('terrarium.before-')), []);
  } finally { f.cleanup(); }
});
