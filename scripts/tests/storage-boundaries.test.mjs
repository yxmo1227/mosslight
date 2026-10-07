// Exercise the real storage bundle; all user-data reads/writes use an in-memory Map.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { constants, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { runInNewContext } from 'node:vm';

const productRoot = resolve(import.meta.dirname, '../..');
const rootInfo = lstatSync(productRoot);
assert(rootInfo.isDirectory() && !rootInfo.isSymbolicLink());
const require = createRequire(join(productRoot, 'package.json'));
const storagePath = join(productRoot, 'src/desktop/storage.ts');
const sourceInfo = lstatSync(storagePath);
assert(sourceInfo.isFile() && !sourceInfo.isSymbolicLink());
// Permit canonical ancestor aliases (for example /var on macOS) and Windows
// casing without permitting linked source directories to escape the checkout.
const comparablePath = (path) => process.platform === 'win32' ? path.toLowerCase() : path;
assert.equal(
  comparablePath(realpathSync(storagePath)),
  comparablePath(join(realpathSync(productRoot), 'src/desktop/storage.ts')),
);
const source = readFileSync(storagePath, 'utf8');
const { build } = require('esbuild');
const code = (await build({
  entryPoints: [storagePath], bundle: true, platform: 'node', format: 'cjs',
  target: 'node22', write: false, logLevel: 'silent',
})).outputFiles[0].text;
console.log(JSON.stringify({
  source: 'src/desktop/storage.ts',
  sha256: createHash('sha256').update(source).digest('hex'),
  compiledInMemory: true,
  userDataFilesWritten: 0,
}));

function probe(mode) {
  const directory = join(productRoot, 'QA-memory-only');
  const files = new Map();
  const fds = new Map();
  let nextFd = 10;
  let copyCalls = 0;
  const readCounts = new Map();
  const stat = (path) => {
    if (path !== directory && !files.has(path)) throw new Error('ENOENT');
    return {
      isFile: () => path !== directory,
      isDirectory: () => path === directory,
      isSymbolicLink: () => false,
      nlink: 1,
      size: Buffer.byteLength(files.get(path) ?? ''),
    };
  };
  const fakeFs = {
    constants,
    mkdirSync() {},
    existsSync: (path) => path === directory || files.has(path),
    lstatSync: stat,
    openSync(path, flags) {
      if (flags === 'wx') {
        if (files.has(path)) throw Error('EEXIST');
        files.set(path, '');
      } else if (!files.has(path)) throw Error('ENOENT');
      const fd = ++nextFd;
      fds.set(fd, path);
      return fd;
    },
    fstatSync: (fd) => stat(fds.get(fd)),
    readFileSync(fd) {
      const path = typeof fd === 'number' ? fds.get(fd) : fd;
      const count = (readCounts.get(path) ?? 0) + 1; readCounts.set(path, count);
      if (mode === 'legacy-read-failure' &&
          ((path.endsWith('terrarium.json') && [1, 3].includes(count)) ||
           (path.endsWith('terrarium.backup.json') && [1, 2].includes(count)))) throw Error('EIO');
      return files.get(path);
    },
    writeFileSync: (fd, content) => files.set(typeof fd === 'number' ? fds.get(fd) : fd, content),
    closeSync() {},
    fsyncSync() {},
    renameSync(from, to) {
      files.set(to, files.get(from));
      files.delete(from);
    },
    copyFileSync(from, to) {
      copyCalls++;
      if (mode === 'EACCES' || mode === 'ENOSPC' || mode.startsWith('legacy-fail') || mode === 'extension-fail-copy') throw Error(mode);
      if (files.has(to)) throw Error('EEXIST');
      files.set(to, mode === 'extension-corrupt-copy' ? '{bad-copy' : files.get(from));
    },
  };
  const context = {
    require(id) {
      if (id === 'node:fs') return fakeFs;
      if (id === 'node:path' || id === 'node:crypto') return require(id);
      // Fail closed if the storage bundle gains another capability. In
      // particular, never delegate another filesystem API or Electron.
      throw new Error(`Unexpected storage bundle dependency: ${id}`);
    },
    module: { exports: {} }, exports: {}, files, directory, mode, Buffer, console, createHash,
    copyCount: () => copyCalls,
  };
  runInNewContext(code + '\n' + `
    const empty = { schemaVersion:1, name:'QA', bottle:'round', layers:[{material:'gravel',depth:.16},{material:'clay',depth:.1},{material:'soil',depth:.28}], plants:[], decorations:[], environment:{temperature:22,light:.65}, ecology:{moisture:.55,humidity:.65,waterReserve:.18,simulatedDays:0}, closed:true, speed:1, paused:false, vacation:false, createdAt:1000,updatedAt:1000,preferences:{widgetSize:'medium',alwaysOnTop:true,launchAtLogin:false,reducedMotion:false} };
    const store = new LocalStore(directory), migrated = migrateSaveState(empty), good = encodeSave(migrated);
    if (mode.startsWith('legacy-')) {
      const legacy = JSON.stringify({format:'mosslight',version:1,state:empty,checksum:createHash('sha256').update(JSON.stringify(empty)).digest('hex')});
      files.set(store.primary, legacy); files.set(store.backup, legacy);
    }
    else if (mode.startsWith('extension-')) { files.set(store.primary, good); files.set(store.backup, good); }
    else if (mode === 'sole-corrupt-backup') files.set(store.backup, '{broken-backup');
    else if (mode === 'oversized-only-backup') files.set(store.backup, 'x'.repeat(MAX_SAVE_BYTES + 1));
    else { files.set(store.primary, mode.startsWith('oversized') ? 'x'.repeat(MAX_SAVE_BYTES + 1) : '{broken-primary'); files.set(store.backup, mode === 'oversized-both' ? 'y'.repeat(MAX_SAVE_BYTES + 1) : good); }
    const primaryBefore = files.get(store.primary), backupBefore = files.get(store.backup);
    const loaded = store.load(); let saveRejected = false;
    const next = mode.startsWith('extension-') ? {...migrated,bottle:'cat'} : migrated;
    try { store.save(next); store.save(next); } catch (error) { saveRejected = /Autosave is paused/.test(error.message); }
    const recovered = [...files.entries()].filter(([path]) => path.includes('recovered'));
    globalThis.result = { mode, loadedValidBackup: loaded.state !== null && encodeSave(loaded.state) === good, saveRejected, originalPrimaryIntact: files.get(store.primary) === primaryBefore, originalBackupIntact: files.get(store.backup) === backupBefore, preservedOriginal: recovered.some(([, bytes]) => bytes === backupBefore), backupNowValid: files.get(store.backup) === good, copyCalls:copyCount() };
  `, context, { timeout: 5_000 });
  return context.result;
}

test('unique corrupt backup survives consecutive saves as an independent recovery copy', () => {
  const result = probe('sole-corrupt-backup');
  console.log(JSON.stringify(result));
  assert.equal(result.preservedOriginal, true);
  assert.equal(result.backupNowValid, true);
  assert.equal(result.copyCalls, 1);
  assert.equal(result.saveRejected, false);
});

for (const mode of ['EACCES', 'ENOSPC']) test(`valid backup remains readable when recovery preservation fails with ${mode}`, () => {
  const result = probe(mode);
  console.log(JSON.stringify(result));
  assert.equal(result.loadedValidBackup, true);
  assert.equal(result.saveRejected, true);
  assert.equal(result.originalPrimaryIntact, true);
  assert.equal(result.originalBackupIntact, true);
});

for (const mode of ['oversized-primary', 'oversized-only-backup', 'oversized-both']) test(`${mode} is never duplicated or overwritten`, () => {
  const result = probe(mode);
  console.log(JSON.stringify(result));
  assert.equal(result.copyCalls, 0);
  assert.equal(result.saveRejected, true);
  assert.equal(result.originalPrimaryIntact, true);
  assert.equal(result.originalBackupIntact, true);
  if (mode === 'oversized-primary') assert.equal(result.loadedValidBackup, true);
});

test('v1 migration remains readable but never overwrites originals if preservation fails', () => {
  const result = probe('legacy-fail-EACCES');
  assert.equal(result.loadedValidBackup, true);
  assert.equal(result.saveRejected, true);
  assert.equal(result.originalPrimaryIntact, true);
  assert.equal(result.originalBackupIntact, true);
});

test('intermittent original-file read failures fail closed even if a later migration read succeeds', () => {
  const result = probe('legacy-read-failure');
  assert.equal(result.loadedValidBackup, true);
  assert.equal(result.saveRejected, true);
  assert.equal(result.originalPrimaryIntact, true);
  assert.equal(result.originalBackupIntact, true);
});

for (const mode of ['extension-fail-copy', 'extension-corrupt-copy']) test(`${mode}: optional v0.3 shape never overwrites compatible v0.2 originals`, () => {
  const result = probe(mode);
  assert.equal(result.loadedValidBackup, true);
  assert.equal(result.saveRejected, true);
  assert.equal(result.originalPrimaryIntact, true);
  assert.equal(result.originalBackupIntact, true);
  assert(result.copyCalls > 0);
});
