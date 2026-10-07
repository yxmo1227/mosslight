import { TERRAIN_COLUMNS, TERRAIN_GRAIN_HEIGHT } from '../shared/catalog';
import type { BottleShape, MaterialKind, Terrain } from '../shared/types';

/** Design-space bounds for the terrain cross-section and its shallow depth plane. */
export interface TerrainBounds { left: number; right: number; bottom: number; depthSpan: number }

export const TERRAIN_BOUNDS: Record<BottleShape, TerrainBounds> = {
  round: { left: 139, right: 461, bottom: 645, depthSpan: 36 },
  square: { left: 121, right: 479, bottom: 651, depthSpan: 36 },
  cylinder: { left: 149, right: 451, bottom: 651, depthSpan: 34 },
  'open-cylinder': { left: 115, right: 485, bottom: 651, depthSpan: 35 },
  'open-cube': { left: 97, right: 503, bottom: 654, depthSpan: 35 },
  'glass-box': { left: 65, right: 535, bottom: 653, depthSpan: 35 },
  cat: { left: 139, right: 461, bottom: 645, depthSpan: 36 },
};

function clampUnit(value: number): number {
  return Number.isNaN(value) ? 0 : Math.max(0, Math.min(1, value));
}

/** Select the actual column, including the rightmost endpoint, without interpolation. */
export function terrainColumnIndex(x: number): number {
  return Math.min(TERRAIN_COLUMNS - 1, Math.floor(clampUnit(x) * TERRAIN_COLUMNS));
}

/** Undo canvas transforms without falling into the previous column through a tiny
 * floating-point error at an exact boundary. General positions are not quantized. */
export function terrainNormalizedX(bounds: TerrainBounds, worldX: number): number {
  const x = clampUnit((worldX - bounds.left) / (bounds.right - bounds.left));
  const boundary = Math.round(x * TERRAIN_COLUMNS) / TERRAIN_COLUMNS;
  return Math.abs(x - boundary) < 1e-12 ? boundary : x;
}

/** Authoritative terrain enforces a finite grain bound; never flatten local relief. */
export function terrainHeightAt(terrain: Terrain, x: number): number {
  return (terrain.columns[terrainColumnIndex(x)]?.length ?? 0) * TERRAIN_GRAIN_HEIGHT;
}

/** Position.y is ground-plane depth, not an independent height above the terrain. */
export function terrainRootAt(terrain: Terrain, shape: BottleShape, position: { x: number; y: number }): { x: number; y: number } {
  const bounds = TERRAIN_BOUNDS[shape];
  const x = clampUnit(position.x);
  return {
    x: bounds.left + x * (bounds.right - bounds.left),
    y: bounds.bottom - terrainHeightAt(terrain, x) + (clampUnit(position.y) - 0.5) * bounds.depthSpan,
  };
}

/** Column indices are zero-based; adjacent columns share an exact boundary. */
export function terrainColumnBounds(bounds: TerrainBounds, index: number): { left: number; right: number } {
  const column = Number.isNaN(index) ? 0 : Math.max(0, Math.min(TERRAIN_COLUMNS - 1, Math.floor(index)));
  const width = bounds.right - bounds.left;
  return {
    left: bounds.left + column / TERRAIN_COLUMNS * width,
    right: bounds.left + (column + 1) / TERRAIN_COLUMNS * width,
  };
}

/** Runs remain bottom-to-top; separated deposits of the same material never merge. */
export function terrainRuns(column: readonly MaterialKind[]): { material: MaterialKind; start: number; count: number }[] {
  const runs: { material: MaterialKind; start: number; count: number }[] = [];
  for (let index = 0; index < column.length; index += 1) {
    const material = column[index];
    const previous = runs[runs.length - 1];
    if (previous?.material === material) previous.count += 1;
    else runs.push({ material, start: index, count: 1 });
  }
  return runs;
}
