import type { BottleShape, MaterialKind, Terrain } from '../shared/types';
import { TERRAIN_COLUMNS, TERRAIN_GRAIN_HEIGHT } from '../shared/catalog';

/** Pure, original vessel geometry. Units are centimetre-like scene units, not a
 * physical soil simulation. The same inner wall drives glass and every deposit. */
export interface GlassProfile { lower: number; middle: number; upper: number; facets: number }
export type GlassBand = 'lower' | 'middle' | 'upper';
export const DEFAULT_GLASS_PROFILE: Readonly<GlassProfile> = { lower: .82, middle: 1, upper: .72, facets: 8 };
export interface VesselProfile { shape: BottleShape; rings: readonly (readonly [number, number])[]; depth: number; exponent: number; segments: number }
export const WORLD_GRAIN_HEIGHT = TERRAIN_GRAIN_HEIGHT / 100;
export const clamp = (value: number, low = 0, high = 1): number => Math.max(low, Math.min(high, value));
export function seededRandom(seed: number): () => number {
  let current = seed >>> 0;
  return () => { current = (Math.imul(current, 1664525) + 1013904223) >>> 0; return current / 4294967296; };
}
export function profileFor(shape: BottleShape, form: GlassProfile = DEFAULT_GLASS_PROFILE): VesselProfile {
  const common = { shape, depth: .65, exponent: 2, segments: 80 };
  if (shape === 'round') return { ...common, rings: [[.06, .91], [.14, 1.15], [.32, 1.43], [.63, 1.68], [1.15, 1.92], [1.9, 2.06], [2.8, 2.08], [3.6, 1.98], [4.25, 1.71], [4.72, 1.2], [5.18, .55], [5.72, .55]] };
  if (shape === 'square') return { ...common, exponent: 6, rings: [[.06, 1.58], [.18, 1.77], [.46, 1.86], [4.28, 1.86], [4.6, 1.69], [5.13, .53], [5.72, .53]] };
  if (shape === 'cylinder') return { ...common, rings: [[.06, 1.3], [.18, 1.51], [.42, 1.6], [4.35, 1.6], [4.69, 1.45], [5.12, .53], [5.72, .53]] };
  if (shape === 'open-cylinder') return { ...common, rings: [[.06, 1.66], [.17, 1.84], [.34, 1.91], [4.35, 1.91]] };
  if (shape === 'open-cube') return { ...common, exponent: 8, rings: [[.06, 1.81], [.19, 1.97], [4.2, 1.97]] };
  if (shape === 'cat') return { ...common, rings: [[.06, 1.1], [.19, 1.35], [.55, 1.65], [1.3, 1.89], [2.3, 1.98], [3.15, 1.88], [3.86, 1.6], [4.32, 1.01], [4.48, .65]] };
  return { ...common, segments: form.facets, rings: [[.06, 1.13 * form.lower], [.22, 1.42 * form.lower], [1.12, 2.07 * form.lower], [2.75, 2.02 * form.middle], [4.22, 1.84 * form.upper], [4.56, 1.72 * form.upper]] };
}
export function radiusAt(profile: VesselProfile, y: number): number {
  const rings = profile.rings;
  if (y <= rings[0][0]) return rings[0][1];
  for (let i = 1; i < rings.length; i++) if (y <= rings[i][0]) {
    const t = (y - rings[i - 1][0]) / (rings[i][0] - rings[i - 1][0]);
    return rings[i - 1][1] + (rings[i][1] - rings[i - 1][1]) * t;
  }
  return rings[rings.length - 1][1];
}
/** Cross-section points are used for the outer wall and scaled inner rings. */
export function ringPoint(profile: VesselProfile, y: number, angle: number, inset = 0): { x: number; y: number; z: number } {
  const radius = Math.max(.05, radiusAt(profile, y) - inset), power = 2 / profile.exponent;
  const cos = Math.cos(angle), sin = Math.sin(angle);
  return { x: Math.sign(cos) * Math.abs(cos) ** power * radius, y, z: Math.sign(sin) * Math.abs(sin) ** power * radius * profile.depth };
}
/** Exact polygon/superellipse front boundary, including faceted sculpted glass. */
export function wallDepthAt(profile: VesselProfile, x: number, y: number, inset = .045): number {
  const r = Math.max(.001, radiusAt(profile, y) - inset), normalized = clamp(Math.abs(x) / r);
  if (profile.segments > 12) return r * profile.depth * Math.max(0, 1 - normalized ** profile.exponent) ** (1 / profile.exponent);
  let depth = 0;
  for (let i = 0; i < profile.segments; i++) {
    const a = ringPoint(profile, y, i / profile.segments * Math.PI * 2, inset);
    const b = ringPoint(profile, y, (i + 1) / profile.segments * Math.PI * 2, inset);
    if (Math.abs(a.x - b.x) < 1e-8) { if (Math.abs(x - a.x) < 1e-7) depth = Math.max(depth, a.z, b.z); continue; }
    const t = (x - a.x) / (b.x - a.x);
    if (t >= 0 && t <= 1) depth = Math.max(depth, a.z + (b.z - a.z) * t);
  }
  return Math.max(0, depth);
}
/** Continuous interpolation is a visual derivative only; stored columns retain
 * exact order and volume. Smooth silhouettes must never alter persistent state. */
export function smoothHeight(terrain: Terrain, x: number): number {
  const coordinate = clamp(x) * TERRAIN_COLUMNS - .5;
  const left = Math.floor(coordinate), t = coordinate - left;
  const a = terrain.columns[Math.max(0, Math.min(TERRAIN_COLUMNS - 1, left))]?.length ?? 0;
  const b = terrain.columns[Math.max(0, Math.min(TERRAIN_COLUMNS - 1, left + 1))]?.length ?? 0;
  return (a + (b - a) * (t * t * (3 - 2 * t))) * WORLD_GRAIN_HEIGHT;
}
export function materialAt(terrain: Terrain, x: number, level: number): MaterialKind | null {
  const column = terrain.columns[Math.min(TERRAIN_COLUMNS - 1, Math.floor(clamp(x) * TERRAIN_COLUMNS))] ?? [];
  return column[Math.max(0, Math.min(column.length - 1, Math.floor(level)))] ?? null;
}
export function groundPoint(profile: VesselProfile, terrain: Terrain, x: number, depth: number): { x: number; y: number; z: number } {
  const y = .115 + smoothHeight(terrain, x);
  const worldX = sampleContour(surfaceXs(profile, terrain), x);
  return { x: worldX, y, z: (clamp(depth) * 2 - 1) * wallDepthAt(profile, worldX, y) * .86 };
}
export function containsPoint(profile: VesselProfile, point: { x: number; y: number; z: number }, inset = .035): boolean {
  if (point.y < profile.rings[0][0] || point.y > profile.rings[profile.rings.length - 1][0]) return false;
  return Math.abs(point.x) <= radiusAt(profile, point.y) - inset + 1e-7 && Math.abs(point.z) <= wallDepthAt(profile, point.x, point.y, inset) + 1e-7;
}

/** Conservative bounding cube for an arbitrarily rotated grain's sphere. The
 * vessel is convex in each horizontal section; checking all section extrema
 * also covers corners between profile rings and every enclosed mesh vertex. */
export function containGrain(profile: VesselProfile, point: { x: number; y: number; z: number }, radius: number): { x: number; y: number; z: number } {
  const bottom = profile.rings[0][0], top = profile.rings[profile.rings.length - 1][0];
  const y = clamp(point.y, bottom + radius + .003, top - radius - .003);
  const heights = [y - radius, y + radius, ...profile.rings.filter(([height]) => height > y - radius && height < y + radius).map(([height]) => height)];
  const minWidth = Math.min(...heights.map(height => radiusAt(profile, height) - .045));
  let x = clamp(point.x, -Math.max(0, minWidth - radius), Math.max(0, minWidth - radius)), limit = 0;
  for (let attempt = 0; attempt < 24; attempt++) {
    limit = Math.min(...heights.flatMap(height => [wallDepthAt(profile, x - radius, height, .045), wallDepthAt(profile, x + radius, height, .045)])) - radius;
    if (limit >= 0) break; x *= .91;
  }
  return { x, y, z: clamp(point.z, -Math.max(0, limit), Math.max(0, limit)) };
}

const surfaceCache = new WeakMap<Terrain, Map<string, Float64Array>>();
/** A steep legacy column can otherwise fold its top when its wider upper wall
 * coordinate crosses a lower neighbour. Inward-only monotone projection retains
 * each outer wall endpoint and material order without editing the saved grains. */
export function surfaceXs(profile: VesselProfile, terrain: Terrain): Float64Array {
  let cache = surfaceCache.get(terrain); if (!cache) { cache = new Map(); surfaceCache.set(terrain, cache); }
  const key = JSON.stringify(profile.rings), prior = cache.get(key); if (prior) return prior;
  const count = 192, values = new Float64Array(count + 1), spacing = .00008;
  for (let i = 0; i <= count; i++) values[i] = (i / count * 2 - 1) * (radiusAt(profile, .115 + smoothHeight(terrain, i / count)) - .05);
  for (let i = 1; i <= count / 2; i++) values[i] = Math.min(-(count / 2 - i) * spacing, Math.max(values[i], values[i - 1] + spacing));
  for (let i = count - 1; i >= count / 2; i--) values[i] = Math.max((i - count / 2) * spacing, Math.min(values[i], values[i + 1] - spacing));
  cache.set(key, values); return values;
}
export function terrainWorldX(profile: VesselProfile, terrain: Terrain, x: number, y: number): number {
  const coordinate = clamp((y - .115) / WORLD_GRAIN_HEIGHT, 0, 40), low = Math.min(39, Math.floor(coordinate)), t = coordinate - low;
  const a = sampleContour(terrainRowXs(profile, terrain, low), x), b = sampleContour(terrainRowXs(profile, terrain, low + 1), x); return a + (b - a) * t;
}
function sampleContour(values: Float64Array, x: number): number {
  const coordinate = clamp(x) * (values.length - 1), low = Math.min(values.length - 2, Math.floor(coordinate)), mix = coordinate - low;
  return values[low] + (values[low + 1] - values[low]) * mix;
}
const rowCache = new WeakMap<Terrain, Map<string, Map<number, Float64Array>>>();
/** Every loft row is ordered, not just the final top. This prevents internal
 * side faces crossing when a legacy near-empty column neighbours a tall one. */
export function terrainRowXs(profile: VesselProfile, terrain: Terrain, row: number): Float64Array {
  let profiles = rowCache.get(terrain); if (!profiles) { profiles = new Map(); rowCache.set(terrain, profiles); }
  const key = JSON.stringify(profile.rings); let rows = profiles.get(key); if (!rows) { rows = new Map(); profiles.set(key, rows); }
  const index = Math.floor(clamp(row, 0, 40)), cached = rows.get(index); if (cached) return cached;
  const top = surfaceXs(profile, terrain), values = new Float64Array(top.length), count = values.length - 1, height = index * WORLD_GRAIN_HEIGHT, spacing = .00008;
  for (let i = 0; i <= count; i++) {
    const u = i / count, maximum = smoothHeight(terrain, u), local = Math.min(maximum, height), rawTop = (u * 2 - 1) * (radiusAt(profile, .115 + maximum) - .05);
    values[i] = (u * 2 - 1) * (radiusAt(profile, .115 + local) - .05) + (top[i] - rawTop) * (maximum <= Number.EPSILON ? 1 : local / maximum);
  }
  for (let i = 1; i <= count / 2; i++) values[i] = Math.min(-(count / 2 - i) * spacing, Math.max(values[i], values[i - 1] + spacing));
  for (let i = count - 1; i >= count / 2; i--) values[i] = Math.max((i - count / 2) * spacing, Math.min(values[i], values[i + 1] - spacing));
  rows.set(index, values); return values;
}
/** Exact inverse of the monotone rendered surface, also used by placement,
 * pouring and shovel targeting; never invert the obsolete uncorrected radius. */
export function normalizedAtWorldX(profile: VesselProfile, terrain: Terrain, worldX: number): number {
  let low = 0, high = 1;
  for (let i = 0; i < 22; i++) { const middle = (low + high) / 2; if (groundPoint(profile, terrain, middle, .5).x < worldX) low = middle; else high = middle; }
  return (low + high) / 2;
}
