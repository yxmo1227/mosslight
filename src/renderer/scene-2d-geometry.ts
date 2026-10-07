import { defaultGlassSide, GLASS_HEIGHT_LIMITS, GLASS_WIDTH_LIMITS, TERRAIN_COLUMNS, TERRAIN_GRAIN_HEIGHT } from '../shared/catalog';
import type { BottleShape, GlassControlPoint, GlassForm, GlassSideName, MaterialKind, Pond, Terrain } from '../shared/types';
import { terrainRuns } from './scene-terrain';

export interface Point2D { x: number; y: number }
export type GlassBand2D = 'lower' | 'middle' | 'upper';
export const SCENE_WIDTH = 600, SCENE_HEIGHT = 760, FLOOR_Y = 666;
export const DEFAULT_FORM: Readonly<GlassForm> = { lower: .82, middle: 1, upper: .72, facets: 8 };
export const clamp2D = (value: number, low = 0, high = 1): number => Math.max(low, Math.min(high, Number.isFinite(value) ? value : low));
export function random2D(seed: number): () => number { let value = seed >>> 0; return () => { value = (Math.imul(value, 1664525) + 1013904223) >>> 0; return value / 4294967296; }; }
export function hash2D(value: string): number { let hash = 2166136261; for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619); return hash >>> 0; }
export interface Vessel2D { shape: BottleShape; form: GlassForm; top: number; rings: readonly (readonly [number, number])[]; leftRings: readonly (readonly [number, number])[]; rightRings: readonly (readonly [number, number])[]; outline: Point2D[] }

/** Original flat vessel silhouettes. Ring heights are design pixels, not a 3D model. */
export function vessel2D(shape: BottleShape, form: GlassForm = DEFAULT_FORM): Vessel2D {
  let rings: readonly (readonly [number, number])[];
  if (shape === 'round') rings = [[0, 92], [16, 125], [55, 167], [120, 195], [235, 209], [340, 203], [425, 178], [474, 127], [510, 56], [562, 56]];
  else if (shape === 'square') rings = [[0, 157], [17, 179], [47, 186], [414, 186], [454, 175], [510, 54], [562, 54]];
  else if (shape === 'cylinder') rings = [[0, 128], [15, 153], [42, 161], [413, 161], [453, 150], [510, 54], [562, 54]];
  else if (shape === 'open-cylinder') rings = [[0, 145], [17, 177], [48, 187], [476, 187]];
  else if (shape === 'open-cube') rings = [[0, 178], [18, 199], [474, 199]];
  else if (shape === 'cat') rings = [[0, 112], [22, 144], [75, 175], [160, 194], [280, 197], [378, 177], [440, 135], [482, 86]];
  else rings = [[0, 113 * form.lower], [22, 147 * form.lower], [112, 207 * form.lower], [285, 202 * form.middle], [476, 184 * form.upper], [510, 172 * form.upper]];
  const sideRings = (side: GlassSideName): readonly (readonly [number, number])[] => {
    if (shape !== 'glass-box' || !form.sides) return rings;
    const controls = form.sides[side]; return [[0, 113 * controls.lower.width], [22, 147 * controls.lower.width], [controls.lower.height * 510, 207 * controls.lower.width], [controls.middle.height * 510, 202 * controls.middle.width], [controls.upper.height * 510, 172 * controls.upper.width]];
  };
  const leftRings = sideRings('left'), rightRings = sideRings('right');
  const top = FLOOR_Y - Math.max(leftRings[leftRings.length - 1][0], rightRings[rightRings.length - 1][0]), vessel: Vessel2D = { shape, form, top, rings, leftRings, rightRings, outline: [] };
  const step = shape === 'glass-box' ? 1 : 5;
  const right: Point2D[] = [];
  // Smooth curves are sampled densely; the sculpted shape intentionally retains straight facets.
  if (shape === 'glass-box') for (const [height, radius] of rightRings) right.push({ x: 300 + radius, y: FLOOR_Y - height });
  else for (let height = 0; height <= FLOOR_Y - top; height += step) right.push({ x: 300 + vesselRadius2D(vessel, FLOOR_Y - height), y: FLOOR_Y - height });
  if (shape !== 'glass-box' && right[right.length - 1].y !== top) right.push({ x: 300 + rings[rings.length - 1][1], y: top });
  const left = shape === 'glass-box' ? leftRings.map(([height, radius]) => ({ x: 300 - radius, y: FLOOR_Y - height })) : right.map(point => ({ x: 600 - point.x, y: point.y }));
  vessel.outline = [...right, ...left.reverse()];
  return vessel;
}
export function vesselRadius2D(vessel: Vessel2D, y: number, inset = 0, side: GlassSideName = 'right'): number {
  const rings = side === 'left' ? vessel.leftRings : vessel.rightRings, height = FLOOR_Y - clamp2D(y, FLOOR_Y - rings[rings.length - 1][0], FLOOR_Y);
  if (height <= rings[0][0]) return Math.max(0, rings[0][1] - inset);
  for (let i = 1; i < rings.length; i++) if (height <= rings[i][0]) {
    const [a, ra] = rings[i - 1], [b, rb] = rings[i], t = (height - a) / (b - a);
    if (vessel.shape === 'glass-box') return Math.max(0, ra + (rb - ra) * t - inset);
    // Shape-preserving Hermite slopes are shared at each knot: no repeated
    // smoothstep flattening, bulges or sharp changes along the round glass.
    const slope = (index: number): number => {
      if (index === 0) return (rings[1][1] - rings[0][1]) / (rings[1][0] - rings[0][0]);
      if (index === rings.length - 1) return (rings[index][1] - rings[index - 1][1]) / (rings[index][0] - rings[index - 1][0]);
      const before = rings[index][0] - rings[index - 1][0], after = rings[index + 1][0] - rings[index][0];
      const left = (rings[index][1] - rings[index - 1][1]) / before, right = (rings[index + 1][1] - rings[index][1]) / after;
      if (left * right <= 0) return 0;
      const w1 = 2 * after + before, w2 = after + 2 * before; return (w1 + w2) / (w1 / left + w2 / right);
    };
    const radius = (2 * t ** 3 - 3 * t ** 2 + 1) * ra + (t ** 3 - 2 * t ** 2 + t) * (b - a) * slope(i - 1) + (-2 * t ** 3 + 3 * t ** 2) * rb + (t ** 3 - t ** 2) * (b - a) * slope(i);
    return Math.max(0, radius - inset);
  }
  return Math.max(0, rings[rings.length - 1][1] - inset);
}
export function inVessel2D(vessel: Vessel2D, point: Point2D, inset = 0): boolean {
  const bounds = vesselBounds2D(vessel, point.y, inset);
  return point.y >= openingY2D(vessel, point.x) + inset && point.y <= FLOOR_Y - inset && point.x >= bounds.left && point.x <= bounds.right;
}
export function vesselBounds2D(vessel: Vessel2D, y: number, inset = 0): { left: number; right: number } { return { left: 300 - vesselRadius2D(vessel, y, inset, 'left'), right: 300 + vesselRadius2D(vessel, y, inset, 'right') }; }
export function openingEnds2D(vessel: Vessel2D): { left: Point2D; right: Point2D } { const l = vessel.leftRings.at(-1)!, r = vessel.rightRings.at(-1)!; return { left: { x: 300 - l[1], y: FLOOR_Y - l[0] }, right: { x: 300 + r[1], y: FLOOR_Y - r[0] } }; }
export function openingY2D(vessel: Vessel2D, x: number): number { const ends = openingEnds2D(vessel), t = clamp2D((x - ends.left.x) / (ends.right.x - ends.left.x)); return ends.left.y + (ends.right.y - ends.left.y) * t; }
export function openingPolygon2D(vessel: Vessel2D): Point2D[] {
  const count = Math.round(clamp2D(vessel.form.facets, 5, 16)), ends = openingEnds2D(vessel), cos = Array.from({ length: count }, (_, i) => Math.cos(i / count * Math.PI * 2)), low = Math.min(...cos), high = Math.max(...cos);
  return cos.map((value, i) => { const t = (value - low) / (high - low), x = ends.left.x + t * (ends.right.x - ends.left.x); return { x, y: openingY2D(vessel, x) + Math.sin(i / count * Math.PI * 2) * 11 }; });
}
/** Smoothly interpolate stored column centres. This function also anchors every root. */
export function smoothGrains2D(terrain: Terrain, x: number): number {
  const position = clamp2D(x) * TERRAIN_COLUMNS - .5, left = Math.floor(position), fraction = position - left;
  const a = terrain.columns[Math.max(0, Math.min(TERRAIN_COLUMNS - 1, left))]?.length ?? 0;
  const b = terrain.columns[Math.max(0, Math.min(TERRAIN_COLUMNS - 1, left + 1))]?.length ?? 0;
  return a + (b - a) * fraction * fraction * (3 - 2 * fraction);
}
function rawSurfaceY2D(vessel: Vessel2D, terrain: Terrain, x: number): number {
  const ends = openingEnds2D(vessel), roof = ends.left.y + (ends.right.y - ends.left.y) * clamp2D(x);
  return Math.max(roof + 4, FLOOR_Y - smoothGrains2D(terrain, x) * TERRAIN_GRAIN_HEIGHT);
}
/** The actual 192-segment painted surface, not an unpainted analytic approximation. */
export function surfaceY2D(vessel: Vessel2D, terrain: Terrain, x: number): number {
  const coordinate = clamp2D(x) * 192, left = Math.min(191, Math.floor(coordinate)), t = coordinate - left;
  const xs = surfaceXs2D(vessel, terrain), height = (i: number): number => Math.max(rawSurfaceY2D(vessel, terrain, i / 192), openingY2D(vessel, xs[i]) + 4);
  return height(left) * (1 - t) + height(left + 1) * t;
}
const contours = new WeakMap<Terrain, Map<string, Float64Array>>();
function constrainContour2D(vessel: Vessel2D, values: Float64Array, heights: Float64Array): void {
  // Even two individually-contained endpoints can cross a concave shoulder.
  // Keep the complete connecting segment inside its narrowest wall section.
  for (let i = 0; i < values.length - 1; i++) {
    const low = Math.min(heights[i], heights[i + 1]), high = Math.max(heights[i], heights[i + 1]);
    const sampleHeights = [low, high, ...[...vessel.leftRings, ...vessel.rightRings].map(([height]) => FLOOR_Y - height).filter(y => y > low && y < high)];
    const bounds = sampleHeights.map(y => vesselBounds2D(vessel, y, 3)), left = Math.max(...bounds.map(b => b.left)), right = Math.min(...bounds.map(b => b.right));
    values[i] = clamp2D(values[i], left, right); values[i + 1] = clamp2D(values[i + 1], left, right);
  }
  const count = values.length - 1, spacing = .008;
  for (let i = 1; i <= count / 2; i++) values[i] = Math.min(300 - (count / 2 - i) * spacing, Math.max(values[i], values[i - 1] + spacing));
  for (let i = count - 1; i >= count / 2; i--) values[i] = Math.max(300 + (i - count / 2) * spacing, Math.min(values[i], values[i + 1] - spacing));
}
/** Ordered, inward-only surface coordinates avoid crossing at steep legacy valleys. */
export function surfaceXs2D(vessel: Vessel2D, terrain: Terrain): Float64Array {
  let entries = contours.get(terrain); if (!entries) { entries = new Map(); contours.set(terrain, entries); }
  const key = JSON.stringify([vessel.leftRings, vessel.rightRings]), cached = entries.get(key); if (cached) return cached;
  const count = 192, result = new Float64Array(count + 1), heights = new Float64Array(count + 1);
  for (let i = 0; i <= count; i++) { heights[i] = rawSurfaceY2D(vessel, terrain, i / count); const bounds = vesselBounds2D(vessel, heights[i], 3); result[i] = bounds.left + i / count * (bounds.right - bounds.left); }
  for (let pass = 0; pass < 5; pass++) { for (let i = 0; i <= count; i++) heights[i] = Math.max(rawSurfaceY2D(vessel, terrain, i / count), openingY2D(vessel, result[i]) + 4); constrainContour2D(vessel, result, heights); }
  entries.set(key, result); return result;
}
export function sample2D(values: Float64Array, x: number): number { const u = clamp2D(x) * (values.length - 1), left = Math.min(values.length - 2, Math.floor(u)), t = u - left; return values[left] + (values[left + 1] - values[left]) * t; }
export function root2D(vessel: Vessel2D, terrain: Terrain, x: number): Point2D { return { x: sample2D(surfaceXs2D(vessel, terrain), x), y: surfaceY2D(vessel, terrain, x) }; }
export function normalizedX2D(vessel: Vessel2D, terrain: Terrain, worldX: number): number {
  const xs = surfaceXs2D(vessel, terrain); let low = 0, high = 1;
  for (let i = 0; i < 24; i++) { const middle = (low + high) / 2; if (sample2D(xs, middle) < worldX) low = middle; else high = middle; }
  return (low + high) / 2;
}
export function aboveTerrain2D(vessel: Vessel2D, terrain: Terrain, point: Point2D): boolean {
  return inVessel2D(vessel, point) && point.y <= surfaceY2D(vessel, terrain, normalizedX2D(vessel, terrain, point.x)) + .05;
}
/** Grain rows follow the same vessel wall as their top contour; no rectangular inset. */
const rows2D = new WeakMap<Terrain, Map<string, Float64Array>>();
function rowXs2D(vessel: Vessel2D, terrain: Terrain, level: number): Float64Array {
  let entries = rows2D.get(terrain); if (!entries) { entries = new Map(); rows2D.set(terrain, entries); }
  const key = JSON.stringify([vessel.leftRings, vessel.rightRings]) + ':' + level, cached = entries.get(key); if (cached) return cached;
  const count = 192, values = new Float64Array(count + 1), heights = new Float64Array(count + 1);
  for (let i = 0; i <= count; i++) {
    const x = i / count, total = smoothGrains2D(terrain, x), bounded = Math.min(total, Math.max(0, level));
    const y = Math.max(rawSurfaceY2D(vessel, terrain, x), FLOOR_Y - bounded * TERRAIN_GRAIN_HEIGHT); heights[i] = y;
    const topBounds = vesselBounds2D(vessel, surfaceY2D(vessel, terrain, x), 3), rawTop = topBounds.left + x * (topBounds.right - topBounds.left);
    const correction = sample2D(surfaceXs2D(vessel, terrain), x) - rawTop;
    const bounds = vesselBounds2D(vessel, y, 3); values[i] = bounds.left + x * (bounds.right - bounds.left) + correction * (total > 0 ? bounded / total : 0);
  }
  constrainContour2D(vessel, values, heights);
  entries.set(key, values); return values;
}
export function rowPoint2D(vessel: Vessel2D, terrain: Terrain, x: number, level: number): Point2D {
  const total = smoothGrains2D(terrain, x), bounded = Math.min(total, Math.max(0, level));
  const y = Math.max(rawSurfaceY2D(vessel, terrain, x), FLOOR_Y - bounded * TERRAIN_GRAIN_HEIGHT);
  return { x: sample2D(rowXs2D(vessel, terrain, level), x), y };
}
export function sculptPoint2D(vessel: Vessel2D, key: GlassBand2D): Point2D { const height = key === 'lower' ? 112 : key === 'middle' ? 285 : 476; return { x: 300 + vesselRadius2D(vessel, FLOOR_Y - height), y: FLOOR_Y - height }; }
export function sculptValue2D(key: GlassBand2D, x: number): number { return clamp2D((x - 300) / (key === 'lower' ? 207 : key === 'middle' ? 202 : 184), .55, 1.25); }
export function sculptControlPoint2D(vessel: Vessel2D, side: GlassSideName, key: GlassBand2D): Point2D { const control = (vessel.form.sides?.[side] ?? defaultGlassSide(vessel.form))[key], radius = key === 'lower' ? 207 : key === 'middle' ? 202 : 172; return { x: 300 + (side === 'left' ? -1 : 1) * radius * control.width, y: FLOOR_Y - control.height * 510 }; }
export function sculptControlValue2D(side: GlassSideName, key: GlassBand2D, point: Point2D): GlassControlPoint { const radius = key === 'lower' ? 207 : key === 'middle' ? 202 : 172; return { width: clamp2D((point.x - 300) * (side === 'left' ? -1 : 1) / radius, ...GLASS_WIDTH_LIMITS), height: clamp2D((FLOOR_Y - point.y) / 510, ...GLASS_HEIGHT_LIMITS[key]) }; }

/** Moss is a ground-cover, not a rigid cutout. Each horizontal sprite strip is
 * translated onto the local surface. Drawing and hit/spray mapping share this. */
export function mossStripOffset2D(vessel: Vessel2D, terrain: Terrain, anchor: Point2D, worldX: number): number {
  return surfaceY2D(vessel, terrain, normalizedX2D(vessel, terrain, worldX)) - anchor.y;
}
export interface AlignedRun2D { material: MaterialKind; left: number; right: number }
/** Order-preserving run alignment. Missing deposits taper to zero, never replace
 * buried material or merge non-contiguous deposits of the same material. */
export function alignedRuns2D(left: readonly MaterialKind[], right: readonly MaterialKind[]): AlignedRun2D[] {
  const a = terrainRuns(left), b = terrainRuns(right), rows = a.length + 1, columns = b.length + 1;
  const table = new Uint16Array(rows * columns);
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) table[i * columns + j] = a[i].material === b[j].material ? table[(i + 1) * columns + j + 1] + 1 : Math.max(table[(i + 1) * columns + j], table[i * columns + j + 1]);
  const result: AlignedRun2D[] = []; let i = 0, j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i].material === b[j].material) { result.push({ material: a[i].material, left: a[i].count, right: b[j].count }); i++; j++; }
    else if (i < a.length && (j >= b.length || table[(i + 1) * columns + j] >= table[i * columns + j + 1])) { result.push({ material: a[i].material, left: a[i].count, right: 0 }); i++; }
    else { result.push({ material: b[j].material, left: 0, right: b[j].count }); j++; }
  }
  return result;
}
export interface SoilBand2D { material: MaterialKind; interval: number; top: Point2D[]; bottom: Point2D[] }
/** Complete opaque, continuous strata, using the same sample knots as the
 * surface. Horizontal paint coordinates never fold. Side bands extend to the
 * vessel mask; thus rounded bottles cannot leave rectangular side gaps. */
export function soilBands2D(vessel: Vessel2D, terrain: Terrain): SoilBand2D[] {
  const result: SoilBand2D[] = [];
  for (let interval = -1; interval < TERRAIN_COLUMNS; interval++) {
    const first = Math.max(0, interval), second = Math.min(TERRAIN_COLUMNS - 1, interval + 1), aligned = alignedRuns2D(terrain.columns[first] ?? [], terrain.columns[second] ?? []);
    const edge = interval === -1 || interval === TERRAIN_COLUMNS - 1, samples = edge ? 1 : 4;
    let leftBelow = 0, rightBelow = 0;
    for (const run of aligned) {
      const band: SoilBand2D = { material: run.material, interval, top: [], bottom: [] };
      for (let sample = 0; sample <= samples; sample++) {
        const t = sample / samples, blend = t * t * (3 - 2 * t);
        const u = interval === -1 ? .5 / TERRAIN_COLUMNS * t : interval === TERRAIN_COLUMNS - 1 ? (TERRAIN_COLUMNS - .5 + .5 * t) / TERRAIN_COLUMNS : (interval + .5 + t) / TERRAIN_COLUMNS;
        const x = interval === -1 && sample === 0 ? 0 : interval === TERRAIN_COLUMNS - 1 && sample === samples ? SCENE_WIDTH : root2D(vessel, terrain, u).x;
        const lower = leftBelow + (rightBelow - leftBelow) * blend, upper = lower + run.left + (run.right - run.left) * blend;
        const roof = surfaceY2D(vessel, terrain, u);
        band.bottom.push({ x, y: Math.max(roof, FLOOR_Y - lower * TERRAIN_GRAIN_HEIGHT) });
        band.top.push({ x, y: Math.max(roof, FLOOR_Y - upper * TERRAIN_GRAIN_HEIGHT) });
      }
      result.push(band); leftBelow += run.left; rightBelow += run.right;
    }
  }
  return result;
}
export function pondDepth2D(pond: Pond | undefined, u: number): number {
  if (!pond) return 0; const x = clamp2D(u) * TERRAIN_COLUMNS - .5, left = Math.floor(x), t = x - left;
  const a = pond.depths[Math.max(0, Math.min(TERRAIN_COLUMNS - 1, left))] ?? 0, b = pond.depths[Math.max(0, Math.min(TERRAIN_COLUMNS - 1, left + 1))] ?? 0;
  return Math.max(0, a + (b - a) * t * t * (3 - 2 * t));
}
export function pondPoint2D(vessel: Vessel2D, terrain: Terrain, pond: Pond | undefined, u: number): Point2D {
  const ground = root2D(vessel, terrain, u); return { x: ground.x, y: Math.max(openingY2D(vessel, ground.x) + 4, FLOOR_Y - (smoothGrains2D(terrain, u) + pondDepth2D(pond, u)) * TERRAIN_GRAIN_HEIGHT) };
}
