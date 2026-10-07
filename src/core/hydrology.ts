import { TERRAIN_COLUMNS, TERRAIN_MAX_HEIGHT } from '../shared/catalog';
import type { Pond, Terrain } from '../shared/types';
import { terrainColumnIndex } from './terrain';
import { validatePond, validateTerrain } from './validation';

const MAX_POTENTIAL = TERRAIN_COLUMNS * TERRAIN_MAX_HEIGHT ** 2;
/** One landscape water grain is 1/480 of the dimensionless soil reservoir.
 * This is a game calibration, not millilitres or a laboratory soil model. */
export const POND_WATER_PER_GRAIN = 1 / 480;

export function pondWater(pond: Pond | undefined): number {
  return pond ? Math.max(0, pond.depths.reduce((sum, depth) => sum + depth, 0) - (pond.exchange ?? 0)) * POND_WATER_PER_GRAIN : 0;
}

function withExchange(depths: number[], source?: Pond): Pond {
  return { depths, ...(source?.exchange !== undefined && depths.some(depth => depth > 0) ? { exchange: source.exchange } : {}) };
}

/** Withdraw exact fractional inventory from an owned, validated pond. Stored
 * depths stay integers for basin topology; exchange records its consumed fraction.
 * Highest heads recede first, so a flat basin never grows a sawtooth skyline. */
export function withdrawPondWater(terrain: Terrain, pond: Pond | undefined, requested: number): number {
  if (!pond || requested <= 0) return 0;
  const amount = Math.min(pondWater(pond), requested);
  if (amount === 0) return 0;
  let grains = (pond.exchange ?? 0) + amount / POND_WATER_PER_GRAIN;
  let whole = Math.floor(grains + 1e-10);
  grains = Math.max(0, grains - whole);
  while (whole-- > 0) {
    let selected = -1, highest = -Infinity;
    for (let index = 0; index < TERRAIN_COLUMNS; index++) if (pond.depths[index] > 0) {
      const head = terrain.columns[index].length + pond.depths[index];
      if (head > highest) { highest = head; selected = index; }
    }
    if (selected < 0) break;
    pond.depths[selected]--;
  }
  if (pond.depths.some(depth => depth > 0)) pond.exchange = grains;
  else delete pond.exchange;
  return amount;
}

function dose(amount: number): void {
  if (!Number.isInteger(amount) || amount < 1 || amount > 32) throw new TypeError('Invalid pond dose: expected an integer in 1..32');
}

function nearest(heights: readonly number[], depths: readonly number[], target: number): number | undefined {
  for (let distance = 0; distance < TERRAIN_COLUMNS; distance++) {
    const left = target - distance, right = target + distance;
    if (left >= 0 && heights[left] + depths[left] < TERRAIN_MAX_HEIGHT) return left;
    if (distance > 0 && right < TERRAIN_COLUMNS && heights[right] + depths[right] < TERRAIN_MAX_HEIGHT) return right;
  }
  return undefined;
}

/** Integer, basin-aware relaxation. Water may cross a lower/equal wet surface,
 * not a dry ridge or fluid barrier at/above the donor's head. Every transfer
 * strictly decreases sum(head²) by >=2; the explicit budget is independent of
 * timing and prevents a numerical or future-rule change from looping forever.
 * Connected stable levels differ by at most one discrete water unit. */
function settle(heights: readonly number[], depths: number[]): void {
  const pending = Array<boolean>(TERRAIN_COLUMNS).fill(true);
  let active = TERRAIN_COLUMNS, cursor = 0, transfers = 0;
  while (active > 0) {
    while (!pending[cursor]) cursor = (cursor + 1) % TERRAIN_COLUMNS;
    const donor = cursor; pending[donor] = false; active--;
    cursor = (cursor + 1) % TERRAIN_COLUMNS;
    if (depths[donor] === 0) continue;
    const head = heights[donor] + depths[donor];
    let receiver = donor, lowest = head, bestSpillLevel = head, selectedBarrier = head;
    for (const direction of [-1, 1]) {
      let barrier = heights[donor];
      for (let index = donor + direction; index >= 0 && index < TERRAIN_COLUMNS; index += direction) {
        const candidate = heights[index] + depths[index]; barrier = Math.max(barrier, heights[index]);
        if (barrier >= head || candidate > head) break;
        if (head - candidate < 2) continue;
        // Fill lower capacity in this basin before sending a transient one-unit
        // crest across a ridge into a distant lower basin.
        const spillLevel = Math.max(barrier, candidate);
        if (spillLevel < bestSpillLevel || (spillLevel === bestSpillLevel && (candidate < lowest
          || (candidate === lowest && Math.abs(index - donor) < Math.abs(receiver - donor))))) {
          receiver = index; lowest = candidate; bestSpillLevel = spillLevel; selectedBarrier = barrier;
        }
      }
    }
    if (head - lowest < 2) continue;
    const amount = Math.min(depths[donor], Math.floor((head - lowest) / 2), head - selectedBarrier);
    depths[donor] -= amount; depths[receiver] += amount;
    if (++transfers > MAX_POTENTIAL / 2) throw new Error('Pond relaxation exceeded its finite potential bound');
    // A changed head can make a previously blocked plateau reachable from a
    // remote donor. The queue has only 48 flags, never an append-only backlog.
    for (let index = 0; index < TERRAIN_COLUMNS; index++) if (depths[index] > 0 && !pending[index]) {
      pending[index] = true; active++;
    }
  }
}

/** Preserve water after terrain changes. Displaced units find nearest remaining
 * finite capacity; only unavoidable global overflow is removed. Comparing input
 * and output inventories makes overflow observable to the caller. */
export function reconcilePond(terrain: Terrain, pond: Pond): Pond {
  const heights = validateTerrain(terrain).columns.map(column => column.length);
  const depths = validatePond(pond).depths;
  const displaced: { column: number; amount: number }[] = [];
  for (let column = 0; column < TERRAIN_COLUMNS; column++) {
    const capacity = TERRAIN_MAX_HEIGHT - heights[column];
    if (depths[column] > capacity) { displaced.push({ column, amount: depths[column] - capacity }); depths[column] = capacity; }
  }
  for (const spill of displaced) for (let grain = 0; grain < spill.amount; grain++) {
    const destination = nearest(heights, depths, spill.column);
    if (destination === undefined) break;
    depths[destination]++;
  }
  settle(heights, depths);
  return withExchange(depths, pond);
}

export function pourPond(terrain: Terrain, pond: Pond | undefined, x: number, amount: number): Pond {
  const target = terrainColumnIndex(x); dose(amount);
  const ground = validateTerrain(terrain), heights = ground.columns.map(column => column.length);
  const depths = pond === undefined ? Array<number>(TERRAIN_COLUMNS).fill(0) : validatePond(pond, ground).depths;
  for (let grain = 0; grain < amount; grain++) {
    const destination = nearest(heights, depths, target);
    if (destination === undefined) break;
    depths[destination]++;
    // Settle each unit before the next to avoid an artificial dose-sized surge
    // overtopping a ridge that the available basin volume cannot actually fill.
    settle(heights, depths);
  }
  return withExchange(depths, pond);
}

export function drainPond(terrain: Terrain, pond: Pond | undefined, x: number, amount: number, radius = 4): Pond {
  const target = terrainColumnIndex(x); dose(amount);
  if (!Number.isInteger(radius) || radius < 1 || radius > 8) throw new TypeError('Invalid pond radius: expected an integer in 1..8');
  const ground = validateTerrain(terrain), heights = ground.columns.map(column => column.length);
  const depths = pond === undefined ? Array<number>(TERRAIN_COLUMNS).fill(0) : validatePond(pond, ground).depths;
  for (let grain = 0; grain < amount; grain++) {
    let column: number | undefined;
    for (let distance = 0; distance <= radius; distance++) {
      const left = target - distance, right = target + distance;
      if (left >= 0 && depths[left] > 0) { column = left; break; }
      if (distance > 0 && right < TERRAIN_COLUMNS && depths[right] > 0) { column = right; break; }
    }
    if (column === undefined) break;
    depths[column]--;
  }
  settle(heights, depths);
  return withExchange(depths, pond);
}
