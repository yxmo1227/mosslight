import {
  MATERIAL_KINDS, TERRAIN_COLUMNS, TERRAIN_MAX_HEIGHT,
} from '../shared/catalog';
import type { MaterialKind, Terrain } from '../shared/types';

const POUR_RADIUS = 8;
const DEFAULT_SCOOP_RADIUS = 4;
const MAX_OPERATION_AMOUNT = 32;

function invalid(reason: string): never {
  throw new TypeError(`Invalid terrain operation: ${reason}`);
}

/** Read only own data descriptors, so malformed imports cannot invoke accessors. */
function denseArray(input: unknown, maximum: number): unknown[] {
  if (!Array.isArray(input) || Object.getPrototypeOf(input) !== Array.prototype) {
    invalid('expected ordinary arrays');
  }
  if (input.length > maximum || Reflect.ownKeys(input).length !== input.length + 1) {
    invalid('array is oversized, sparse, or has extra properties');
  }
  const result: unknown[] = [];
  for (let index = 0; index < input.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(input, String(index));
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) {
      invalid('expected dense enumerable data entries');
    }
    result.push(descriptor.value);
  }
  return result;
}

function material(input: unknown): MaterialKind {
  if (typeof input !== 'string' || !MATERIAL_KINDS.includes(input as MaterialKind)) {
    invalid('unsupported material');
  }
  return input as MaterialKind;
}

function copyTerrain(input: unknown): Terrain {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    invalid('expected a terrain object');
  }
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) invalid('custom terrain prototype');
  const keys = Reflect.ownKeys(input);
  if (keys.length !== 1 || keys[0] !== 'columns') invalid('expected only columns');
  const descriptor = Object.getOwnPropertyDescriptor(input, 'columns');
  if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) {
    invalid('columns must be an enumerable data property');
  }
  const columns = denseArray(descriptor.value, TERRAIN_COLUMNS);
  if (columns.length !== TERRAIN_COLUMNS) invalid(`expected ${TERRAIN_COLUMNS} columns`);
  return {
    columns: columns.map((column) => denseArray(column, TERRAIN_MAX_HEIGHT).map(material)),
  };
}

/** Uniform columns are [i / 48, (i + 1) / 48); the right endpoint belongs to column 47. */
export function terrainColumnIndex(x: number): number {
  if (typeof x !== 'number' || !Number.isFinite(x) || x < 0 || x > 1) {
    invalid('x must be finite and in 0..1');
  }
  return Math.min(TERRAIN_COLUMNS - 1, Math.floor(x * TERRAIN_COLUMNS));
}

function targetIndex(x: number, amount: number): number {
  const target = terrainColumnIndex(x);
  if (!Number.isInteger(amount) || amount < 1 || amount > MAX_OPERATION_AMOUNT) {
    invalid('amount must be an integer in 1..32');
  }
  return target;
}

/** Nearest local match, resolving equal distances to the left deterministically. */
function nearestColumn(
  columns: MaterialKind[][], target: number, radius: number,
  accepts: (column: MaterialKind[]) => boolean,
): number | undefined {
  for (let distance = 0; distance <= radius; distance++) {
    const left = target - distance;
    if (left >= 0 && accepts(columns[left])) return left;
    const right = target + distance;
    if (distance !== 0 && right < TERRAIN_COLUMNS && accepts(columns[right])) return right;
  }
  return undefined;
}

/**
 * Pour bounded grains onto the local surface, not into a global flattening pass.
 * Existing stacks never move or reorder: only each new grain can slide downhill.
 * Once the local region is full, overflow uses the nearest remaining column.
 * A dose is discarded only when the entire finite terrain is full.
 */
export function pourTerrain(terrain: Terrain, kind: MaterialKind, x: number, amount: number): Terrain {
  const target = targetIndex(x, amount);
  const grain = material(kind);
  const result = copyTerrain(terrain);
  const minimum = Math.max(0, target - POUR_RADIUS);
  const maximum = Math.min(TERRAIN_COLUMNS - 1, target + POUR_RADIUS);

  for (let count = 0; count < amount; count++) {
    const available = nearestColumn(result.columns, target, POUR_RADIUS,
      (column) => column.length < TERRAIN_MAX_HEIGHT)
      ?? nearestColumn(result.columns, target, TERRAIN_COLUMNS - 1,
        (column) => column.length < TERRAIN_MAX_HEIGHT);
    if (available === undefined) break;
    let current = available;
    const overflow = available < minimum || available > maximum;
    // Heights strictly decrease during a slide. The explicit cap also makes the
    // work bound independent of any future changes to the slide rule.
    for (let step = 0; step < TERRAIN_COLUMNS; step++) {
      const height = result.columns[current].length;
      let next: number | undefined;
      for (const neighbor of [current - 1, current + 1]) {
        if (neighbor < (overflow ? 0 : minimum) || neighbor > (overflow ? TERRAIN_COLUMNS - 1 : maximum)) continue;
        const neighborHeight = result.columns[neighbor].length;
        // One incoming grain can roll down an existing one-grain step. Leaving
        // two-grain steps in place made repeated pours form jagged thin towers.
        if (height <= neighborHeight) continue;
        if (next === undefined || neighborHeight < result.columns[next].length
          || (neighborHeight === result.columns[next].length
            && Math.abs(neighbor - target) < Math.abs(next - target))) {
          next = neighbor;
        }
      }
      if (next === undefined) break;
      current = next;
    }
    result.columns[current].push(grain);
  }
  return result;
}

/**
 * Excavate a rounded brush footprint, distributing the dose across its surface.
 * A center-weighted disk removes a little more in the middle, never exhausting a
 * single tall column before reaching its neighbors. Only top grains are removed.
 * No settling follows excavation, so intentional valleys remain in the terrain.
 * An empty local area removes only what exists, leaving distant stacks untouched.
 */
export function scoopTerrain(
  terrain: Terrain, x: number, amount: number, radius = DEFAULT_SCOOP_RADIUS,
): Terrain {
  const target = targetIndex(x, amount);
  if (!Number.isInteger(radius) || radius < 1 || radius > 8) {
    invalid('scoop radius must be an integer in 1..8');
  }
  const result = copyTerrain(terrain);
  const footprint = [];
  for (let column = Math.max(0, target - radius); column <= Math.min(TERRAIN_COLUMNS - 1, target + radius); column++) {
    const distance = Math.abs(column - target);
    footprint.push({
      column, distance, removed: 0,
      weight: Math.sqrt(1 - (distance / (radius + 0.5)) ** 2),
    });
  }
  for (let count = 0; count < amount; count++) {
    let selected: typeof footprint[number] | undefined;
    let bestScore = Infinity;
    for (const entry of footprint) {
      if (result.columns[entry.column].length === 0) continue;
      const score = (entry.removed + 0.5) / entry.weight;
      if (score < bestScore || (score === bestScore && selected !== undefined
        && entry.distance < selected.distance)) {
        selected = entry;
        bestScore = score;
      }
    }
    if (selected === undefined) break;
    result.columns[selected.column].pop();
    selected.removed++;
  }
  return result;
}
