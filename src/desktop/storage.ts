import { constants, copyFileSync, existsSync, lstatSync, mkdirSync, openSync, closeSync, readFileSync, renameSync, writeFileSync, fsyncSync, fstatSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import type { TerrariumState } from '../shared/types.js';
import { migrateSaveState, validateState } from '../core/validation.js';

export const MAX_SAVE_BYTES = 256 * 1024;
/** Version 0.4 and earlier reject taller columns even though schema 2 is retained. */
const LEGACY_TERRAIN_HEIGHT = 40;
function hasExtendedTerrain(state: TerrariumState): boolean {
  return state.terrain.columns.some(column => column.length > LEGACY_TERRAIN_HEIGHT);
}
/** Optional schema-2 fields remain absent until the corresponding tool is used. */
export function hasV06Features(state: TerrariumState): boolean {
  return state.pond !== undefined || state.glassForm?.sides !== undefined
    || (state.glassForm !== undefined && ![6, 8, 10, 12].includes(state.glassForm.facets))
    || state.plants.some(plant => plant.support !== undefined || plant.kind === 'amber-mushroom' || plant.kind === 'ivory-mushroom')
    || state.decorations.some(item => item.support !== undefined || item.kind === 'stump');
}
export function hasV07Features(state: TerrariumState): boolean {
  return hasV08Features(state) || state.decorations.some(item => item.wood !== undefined || item.condition !== undefined);
}
/** v0.7.1 and earlier reject these optional fields and new decoration kinds. */
export function hasV08Features(state: TerrariumState): boolean {
  return hasV09Features(state) || state.decorations.some(item => !['stone', 'wood', 'stump'].includes(item.kind)
    || item.variant !== undefined || item.pose !== undefined || item.wood?.bend !== undefined);
}
/** v0.8 and earlier reject the lazy ecological extensions, including explicit zero values. */
export function hasV09Features(state: TerrariumState): boolean {
  return hasV10Features(state) || state.pond?.exchange !== undefined || state.plants.some(item => item.ecology !== undefined)
    || state.decorations.some(item => item.colonization !== undefined || item.condition?.mold !== undefined);
}
/** v0.9 readers reject new catalog kinds and even an explicit natural wood tone.
 * Keep this edition boundary fixed rather than deriving it from a mutable palette. */
export function hasV10Features(state: TerrariumState): boolean {
  return state.plants.some(item => ['star-moss', 'fern-moss', 'creeping-fig', 'oxalis', 'scarlet-mushroom', 'violet-mushroom'].includes(item.kind))
    || state.decorations.some(item => item.wood?.tone !== undefined || [
      'fairy', 'gardener', 'reader', 'cat', 'dog', 'mushroom-house', 'treehouse', 'arc-lamp', 'slender-steps', 'sun', 'moon', 'star',
    ].includes(item.kind));
}
export function encodeSave(state: TerrariumState): string {
  const validated = validateState(state);
  const content = JSON.stringify(validated);
  const checksum = createHash('sha256').update(content).digest('hex');
  return JSON.stringify({ format: 'mosslight', version: 2, checksum, state: validated }, null, 2);
}
export function decodeSave(text: string): TerrariumState {
  if (Buffer.byteLength(text, 'utf8') > MAX_SAVE_BYTES) throw new Error('The save file is too large.');
  const doc: unknown = JSON.parse(text);
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw new Error('Invalid terrarium save.');
  const data = doc as Record<string, unknown>;
  if (Object.keys(data).length !== 4 || !['format', 'version', 'checksum', 'state'].every((key) => Object.hasOwn(data, key)) ||
      data.format !== 'mosslight' || ![1, 2].includes(data.version as number) || typeof data.checksum !== 'string' ||
      !/^[a-f0-9]{64}$/.test(data.checksum) || !data.state || typeof data.state !== 'object' ||
      (data.state as Record<string, unknown>).schemaVersion !== data.version) throw new Error('Unsupported save version.');
  const hash = createHash('sha256').update(JSON.stringify(data.state)).digest('hex');
  if (hash !== data.checksum) throw new Error('Save checksum verification failed. The file may be damaged.');
  // Check the ORIGINAL serialized state before migration adds or changes fields.
  return migrateSaveState(data.state);
}
function checkFile(path: string): void {
  if (!isAbsolute(path)) throw new Error('The save path must be absolute.');
  if (existsSync(path)) {
    const info = lstatSync(path);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink > 1) throw new Error('Linked or special files are not supported.');
  }
}
function readSaveText(path: string): string {
  checkFile(path);
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > MAX_SAVE_BYTES || stat.nlink > 1) throw new Error('The save file format or size is not supported.');
    const text = readFileSync(fd, 'utf8');
    if (Buffer.byteLength(text, 'utf8') > MAX_SAVE_BYTES) throw new Error('The save file is too large.');
    return text;
  } finally { closeSync(fd); }
}
export function readSaveFile(path: string): TerrariumState { return decodeSave(readSaveText(path)); }
export function writeSaveFile(path: string, state: TerrariumState): void {
  checkFile(path);
  const serialized = encodeSave(state);
  if (Buffer.byteLength(serialized) > MAX_SAVE_BYTES) throw new Error('The save contains too much data.');
  const temporary = join(dirname(path), `.mosslight-${randomUUID()}.tmp`);
  const fd = openSync(temporary, 'wx', 0o600);
  try { writeFileSync(fd, serialized, 'utf8'); fsyncSync(fd); } finally { closeSync(fd); }
  // Atomic replacement leaves the old save intact if writing fails. A failed rename
  // leaves a recoverable temporary file instead of deleting user data.
  checkFile(path);
  renameSync(temporary, path);
}
export interface LoadResult { state: TerrariumState | null; message: string }
export class LocalStore {
  readonly primary: string;
  readonly backup: string;
  private preservationFailed = false;
  private readonly preservedLegacy = new Set<string>();
  private readonly preservedDamaged = new Map<string, string>();
  constructor(readonly directory: string) {
    if (!isAbsolute(directory)) throw new Error('The data directory path must be absolute.');
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const stat = lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('The data directory cannot be a link.');
    this.primary = resolve(directory, 'terrarium.json');
    this.backup = resolve(directory, 'terrarium.backup.json');
    checkFile(this.primary); checkFile(this.backup);
  }
  private preserveDamaged(path: string): void {
    try {
      checkFile(path);
      if (lstatSync(path).size > MAX_SAVE_BYTES) throw new Error('Damaged file too large to duplicate');
      const original = readSaveText(path);
      const hash = createHash('sha256').update(original).digest('hex');
      if (this.preservedDamaged.get(path) === hash) return;
      const damaged = join(this.directory, `terrarium.recovered-${Date.now()}-${randomUUID().slice(0, 8)}.json`);
      copyFileSync(path, damaged, constants.COPYFILE_EXCL);
      if (readSaveText(damaged) !== original) throw new Error('Recovery copy verification failed.');
      this.preservedDamaged.set(path, hash);
    } catch {
      // Keep the original in place and permit recovery/export, but do not allow
      // autosave to replace data we failed to preserve.
      this.preservationFailed = true;
    }
  }
  private preserveLegacy(path: string): void {
    if (!existsSync(path)) return;
    // A read failure is not evidence that a file is non-legacy or disposable.
    // Recovery/export can continue, but no primary/backup may be overwritten.
    let text: string;
    try { text = readSaveText(path); } catch { this.preservationFailed = true; return; }
    try { decodeSave(text); } catch { this.preserveDamaged(path); return; }
    if ((JSON.parse(text) as { version: number }).version !== 1) return;
    const hash = createHash('sha256').update(text).digest('hex');
    const key = `${path}:${hash}`;
    if (this.preservedLegacy.has(key)) return;
    try {
      const target = join(this.directory, `terrarium.v1-original-${Date.now()}-${randomUUID().slice(0, 8)}.json`);
      checkFile(path);
      copyFileSync(path, target, constants.COPYFILE_EXCL);
      // A copied v1 file must exactly match what we validated, not just decode.
      if (readSaveText(target) !== text) throw new Error('Backup verification failed.');
      this.preservedLegacy.add(key);
    } catch { this.preservationFailed = true; }
  }
  /** The optional v0.3 shapes cannot be opened by the strict v0.2 reader.
   * Keep the last compatible files before the first extended state is saved.
   * Fixed exclusive-copy names preserve one original, not an autosave per stroke. */
  private preserveBeforeShapeExtension(path: string): void {
    if (!existsSync(path)) return;
    try {
      const original = readSaveText(path);
      const compatible = decodeSave(original);
      if (compatible.glassForm !== undefined || compatible.bottle === 'cat' || hasExtendedTerrain(compatible) || hasV06Features(compatible) || hasV07Features(compatible)) return;
      const target = join(this.directory, path === this.primary
        ? 'terrarium.before-v0.3-primary.json' : 'terrarium.before-v0.3-backup.json');
      if (existsSync(target)) {
        // Never replace a previous original. An unreadable/invalid preservation
        // file is not proof that a safe downgrade copy exists.
        const preserved = readSaveFile(target);
        if (preserved.glassForm !== undefined || preserved.bottle === 'cat' || hasExtendedTerrain(preserved) || hasV06Features(preserved) || hasV07Features(preserved)) throw new Error('The preserved backup is not compatible.');
        return;
      }
      checkFile(path);
      copyFileSync(path, target, constants.COPYFILE_EXCL);
      if (readSaveText(target) !== original) throw new Error('Upgrade backup verification failed.');
    } catch { this.preservationFailed = true; }
  }
  /** Preserve the last pre-0.5 compatible files before a taller landscape is saved.
   * Exclusive fixed names never replace an earlier downgrade restore point. */
  private preserveBeforeTerrainExtension(path: string): void {
    if (!existsSync(path)) return;
    try {
      const original = readSaveText(path);
      const compatible = decodeSave(original);
      if (hasExtendedTerrain(compatible) || hasV06Features(compatible) || hasV07Features(compatible)) return;
      const target = join(this.directory, path === this.primary
        ? 'terrarium.before-v0.5-primary.json' : 'terrarium.before-v0.5-backup.json');
      if (existsSync(target)) {
        const preserved = readSaveFile(target);
        if (hasExtendedTerrain(preserved) || hasV06Features(preserved) || hasV07Features(preserved)) throw new Error('The preserved terrain backup is not compatible.');
        return;
      }
      checkFile(path);
      copyFileSync(path, target, constants.COPYFILE_EXCL);
      if (readSaveText(target) !== original) throw new Error('Terrain upgrade backup verification failed.');
    } catch { this.preservationFailed = true; }
  }
  private preserveBeforeV06(path: string): void {
    if (!existsSync(path)) return;
    try {
      const original = readSaveText(path);
      if (hasV06Features(decodeSave(original)) || hasV07Features(decodeSave(original))) return;
      const target = join(this.directory, path === this.primary
        ? 'terrarium.before-v0.6-primary.json' : 'terrarium.before-v0.6-backup.json');
      if (existsSync(target)) {
        if (hasV06Features(readSaveFile(target)) || hasV07Features(readSaveFile(target))) throw new Error('The preserved v0.5 backup is not compatible.');
        return;
      }
      checkFile(path);
      copyFileSync(path, target, constants.COPYFILE_EXCL);
      if (readSaveText(target) !== original) throw new Error('Landscape upgrade backup verification failed.');
    } catch { this.preservationFailed = true; }
  }
  load(): LoadResult {
    // Preserve both generations, including an older backup, before any v2 write.
    this.preserveLegacy(this.primary); this.preserveLegacy(this.backup);
    if (!existsSync(this.primary)) {
      if (existsSync(this.backup)) {
        try { return { state: readSaveFile(this.backup), message: 'Terrarium restored from backup.' }; }
        catch { this.preserveDamaged(this.backup); }
      }
      return { state: null, message: existsSync(this.backup) ? 'The backup could not be read. Original files were kept; a new terrarium was created.' : 'Saved locally · Offline ready' };
    }
    try { return { state: readSaveFile(this.primary), message: 'Saved locally · Offline ready' }; }
    catch {
      this.preserveDamaged(this.primary);
      try { return { state: readSaveFile(this.backup), message: 'The primary save was damaged. Restored from backup; the original file was kept.' }; }
      catch {
        if (existsSync(this.backup)) this.preserveDamaged(this.backup);
        return { state: null, message: 'The save could not be read. Original files were kept; import a backup to recover.' };
      }
    }
  }
  /** Keep the last v0.6-readable originals before optional wood/condition fields appear. */
  private preserveBeforeV07(path: string): void {
    if (!existsSync(path)) return;
    try {
      const original = readSaveText(path);
      if (hasV07Features(decodeSave(original))) return;
      const target = join(this.directory, path === this.primary
        ? 'terrarium.before-v0.7-primary.json' : 'terrarium.before-v0.7-backup.json');
      if (existsSync(target)) {
        if (hasV07Features(readSaveFile(target))) throw new Error('The preserved v0.6 backup is not compatible.');
        return;
      }
      checkFile(path); copyFileSync(path, target, constants.COPYFILE_EXCL);
      if (readSaveText(target) !== original) throw new Error('Structure upgrade backup verification failed.');
    } catch { this.preservationFailed = true; }
  }
  private preserveBeforeV08(path: string): void {
    if (!existsSync(path)) return;
    try {
      const original = readSaveText(path);
      if (hasV08Features(decodeSave(original))) return;
      const target = join(this.directory, path === this.primary
        ? 'terrarium.before-v0.8-primary.json' : 'terrarium.before-v0.8-backup.json');
      if (existsSync(target)) {
        if (hasV08Features(readSaveFile(target))) throw new Error('The preserved v0.7 backup is not compatible.');
        return;
      }
      checkFile(path); copyFileSync(path, target, constants.COPYFILE_EXCL);
      if (readSaveText(target) !== original) throw new Error('Decoration upgrade backup verification failed.');
    } catch { this.preservationFailed = true; }
  }
  private preserveBeforeV09(path: string): void {
    if (!existsSync(path)) return;
    try {
      const original = readSaveText(path);
      if (hasV09Features(decodeSave(original))) return;
      const target = join(this.directory, path === this.primary
        ? 'terrarium.before-v0.9-primary.json' : 'terrarium.before-v0.9-backup.json');
      if (existsSync(target)) {
        if (hasV09Features(readSaveFile(target))) throw new Error('The preserved v0.8 backup is not compatible.');
        return;
      }
      checkFile(path); copyFileSync(path, target, constants.COPYFILE_EXCL);
      if (readSaveText(target) !== original) throw new Error('Ecology upgrade backup verification failed.');
    } catch { this.preservationFailed = true; }
  }
  /** Preserve the exact v0.9-readable files before the expanded catalog is saved.
   * Existing targets are always checked: a damaged downgrade copy is not proof
   * of successful preservation, even if the current file already uses v0.10. */
  private preserveBeforeV10(path: string): void {
    if (!existsSync(path)) return;
    try {
      const original = readSaveText(path);
      const compatible = decodeSave(original);
      const target = join(this.directory, path === this.primary
        ? 'terrarium.before-v0.10-primary.json' : 'terrarium.before-v0.10-backup.json');
      if (existsSync(target)) {
        if (hasV10Features(readSaveFile(target))) throw new Error('The preserved v0.9 backup is not compatible.');
        return;
      }
      if (hasV10Features(compatible)) return;
      checkFile(path); copyFileSync(path, target, constants.COPYFILE_EXCL);
      if (readSaveText(target) !== original) throw new Error('Catalog upgrade backup verification failed.');
    } catch { this.preservationFailed = true; }
  }
  save(state: TerrariumState): void {
    validateState(state);
    this.preserveLegacy(this.primary); this.preserveLegacy(this.backup);
    if (state.glassForm !== undefined || state.bottle === 'cat') {
      this.preserveBeforeShapeExtension(this.primary);
      this.preserveBeforeShapeExtension(this.backup);
    }
    if (hasExtendedTerrain(state)) {
      this.preserveBeforeTerrainExtension(this.primary);
      this.preserveBeforeTerrainExtension(this.backup);
    }
    if (hasV06Features(state)) {
      this.preserveBeforeV06(this.primary);
      this.preserveBeforeV06(this.backup);
    }
    if (hasV07Features(state)) {
      this.preserveBeforeV07(this.primary);
      this.preserveBeforeV07(this.backup);
    }
    if (hasV08Features(state)) {
      this.preserveBeforeV08(this.primary);
      this.preserveBeforeV08(this.backup);
    }
    if (hasV09Features(state)) {
      this.preserveBeforeV09(this.primary);
      this.preserveBeforeV09(this.backup);
    }
    if (hasV10Features(state)) {
      this.preserveBeforeV10(this.primary);
      this.preserveBeforeV10(this.backup);
    }
    if (this.preservationFailed) throw new Error('The original save could not be backed up safely. Autosave is paused. Export your current terrarium first.');
    checkFile(this.primary); checkFile(this.backup);
    if (existsSync(this.primary)) {
      let previous: TerrariumState | null = null;
      try { previous = readSaveFile(this.primary); }
      catch { /* A damaged primary must never overwrite the last good backup. */ }
      if (previous) writeSaveFile(this.backup, previous);
    }
    writeSaveFile(this.primary, state);
  }
}
