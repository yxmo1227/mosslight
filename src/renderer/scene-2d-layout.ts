import { isMushroomKind, MAX_SUPPORT_DEPTH } from '../shared/catalog';
import type { Decoration, DecorationKind, PlantKind, SupportAttachment } from '../shared/types';
import type { Point2D } from './scene-2d-geometry';
import { clamp2D } from './scene-2d-geometry';

/** Local top edge is extracted once from the actual original decoration sprite,
 * not a guessed bounding box. The same data drives stacked roots and moss. */
export interface SupportProfile2D { left: number; right: number; top: Float64Array; occupied?: Uint8Array; originX: number; originY: number }
export interface SupportSurface2D { id: string; root: Point2D; scale: number; profile: SupportProfile2D }
export interface BearingProfile2D { points: Point2D[]; height: number; fallback?: Point2D[] }
export interface Grounding2D { origin: Point2D; firstContactY: number; embedding: number; samples: number }
/** Actual opaque footer pixels only. Low-alpha ground shadows, transparent
 * canvas margins, leaves and high branches cannot pretend to be a root/base. */
export function bearingProfile2D(alpha: Uint8ClampedArray, width: number, height: number, originX: number, originY: number, kind: PlantKind | DecorationKind, unit: number): BearingProfile2D {
  const bottom = new Float64Array(width).fill(NaN); let top = height, lowest = -1;
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) if (alpha[y * width + x] >= 180) { top = Math.min(top, y); break; }
    for (let y = height - 1; y >= 0; y--) if (alpha[y * width + x] >= 180) { bottom[x] = y + .5; lowest = Math.max(lowest, y + .5); break; }
  }
  const roots = ['fern', 'fittonia', 'creeping-fig', 'oxalis'].includes(kind), mushrooms = isMushroomKind(kind);
  const cutoff = roots || mushrooms || kind === 'stump' ? originY - unit * .045 : lowest - unit * (kind === 'stone' ? .115 : .10);
  const points: Point2D[] = [];
  for (let x = 0; x < width; x++) if (Number.isFinite(bottom[x]) && bottom[x] >= cutoff && (!roots || Math.abs(x + .5 - originX) <= unit * .075) && (!mushrooms || Math.abs(x + .5 - originX) <= unit * .43)) points.push({ x: x + .5 - originX, y: bottom[x] - originY });
  if (!points.length && lowest >= 0) for (let x = 0; x < width; x++) if (bottom[x] === lowest) { points.push({ x: x + .5 - originX, y: bottom[x] - originY }); break; }
  const fallback = kind === 'wood' || kind === 'stone' || kind === 'stump' ? Array.from(bottom, (y, x) => ({ x: x + .5 - originX, y: y - originY })).filter(point => Number.isFinite(point.y)) : undefined;
  return { points, height: Math.max(1, lowest - top), ...(fallback ? { fallback } : {}) };
}
/** Seat a rigid image against its real footer without stretching it. Embedding
 * closes ordinary base gaps but is capped at 24 design px / 20% body height.
 * A genuinely unsupported overhang across a deep ravine is allowed; we never
 * invent soil or bury most of the object merely to hide that physical gap. */
export function resolveGrounding2D(profile: BearingProfile2D, anchor: Point2D, scale: number, surfaceAt: (x: number) => number | null): Grounding2D {
  const candidates: number[] = [];
  const collect = (points: readonly Point2D[]): void => { for (const point of points) { const y = surfaceAt(anchor.x + point.x * scale); if (y !== null && Number.isFinite(y)) candidates.push(y - point.y * scale); } };
  collect(profile.points);
  // A long/rotated rigid object can rest on the middle of a short support even
  // when its lowest global endpoint lies outside that support's real span.
  if (!candidates.length && profile.fallback) collect(profile.fallback);
  if (!candidates.length) return { origin: { ...anchor }, firstContactY: anchor.y, embedding: 0, samples: 0 };
  const first = Math.min(...candidates), target = Math.max(...candidates) + .6 * scale, budget = Math.min(24 * scale, profile.height * scale * .2), y = Math.min(target, first + budget);
  return { origin: { x: anchor.x, y }, firstContactY: first, embedding: y - first, samples: candidates.length };
}
export function onSupportSpan2D(surface: SupportSurface2D, worldX: number): boolean { return worldX >= supportPoint2D(surface, 0).x && worldX <= supportPoint2D(surface, 1).x; }
/** A horizontal bounding span is not a solid surface. Gaps between separate
 * branches must never provide an invisible shelf for stacked objects. */
export function supportContactHeight2D(surface: SupportSurface2D, worldX: number): number | null {
  if (!onSupportSpan2D(surface, worldX)) return null;
  const profile = surface.profile, pixel = Math.floor((worldX - surface.root.x) / surface.scale + profile.originX);
  if (profile.occupied && !profile.occupied[pixel]) return null;
  return surface.root.y + (profile.top[Math.max(profile.left, Math.min(profile.right, pixel))] - profile.originY) * surface.scale;
}
/** Attached moss conforms only where a physical support exists. Its rounded
 * canopy may drape beyond the tips; that bounded overhang relaxes toward the
 * authored shape instead of extending a flat, invisible support shelf. */
export function mossAttachmentOffset2D(surface: SupportSurface2D, anchor: Point2D, worldX: number, footprintLeft: number, footprintRight: number): number {
  const contact = supportContactHeight2D(surface, worldX);
  if (contact !== null) return supportHeight2D(surface, worldX) - anchor.y;
  if (onSupportSpan2D(surface, worldX)) return 0; // authored canopy bridges air, not an imaginary horizontal shelf
  const left = supportPoint2D(surface, 0), right = supportPoint2D(surface, 1), outsideLeft = worldX < left.x, end = outsideLeft ? left : right;
  const span = Math.max(1, outsideLeft ? left.x - footprintLeft : footprintRight - right.x), distance = Math.abs(worldX - end.x), t = clamp2D(distance / span), blend = t * t * (3 - 2 * t);
  return (end.y - anchor.y) * (1 - blend) + Math.min(12, span * .18) * Math.sin(t * Math.PI / 2);
}
/** A soft canopy can bridge a fork gap without inheriting a hard vertical cut.
 * Nearby prongs influence a bounded smooth drape; they never become a solid
 * shelf in supportContactHeight2D. Draw, alpha hit and spray use this field. */
export function mossDrapeOffsets2D(surface: SupportSurface2D, anchor: Point2D, width: number, originX: number, scale: number, minX: number, maxX: number): Float64Array {
  const raw = new Float64Array(width), result = new Float64Array(width), limit = Math.min(24, (maxX - minX) * scale * .2);
  for (let x = minX; x <= maxX; x++) {
    const worldX = anchor.x + (x + .5 - originX) * scale, y = supportContactHeight2D(surface, worldX);
    raw[x] = y === null ? 0 : clamp2D(y - anchor.y, -limit, limit);
  }
  const radius = Math.max(2, Math.round(7 / Math.max(.4, scale)));
  for (let x = minX; x <= maxX; x++) {
    let sum = 0, weights = 0;
    for (let dx = -radius; dx <= radius; dx++) { const sample = Math.max(minX, Math.min(maxX, x + dx)), weight = radius + 1 - Math.abs(dx); sum += raw[sample] * weight; weights += weight; }
    result[x] = sum / weights;
  }
  return result;
}
export function supportProfile2D(alpha: Uint8ClampedArray, width: number, height: number, originX: number, originY: number): SupportProfile2D {
  const top = new Float64Array(width).fill(NaN), occupied = new Uint8Array(width); let left = width, right = -1;
  for (let x = 0; x < width; x++) for (let y = 0; y < height; y++) if (alpha[y * width + x] >= 180) { top[x] = y + .5; occupied[x] = 1; left = Math.min(left, x); right = Math.max(right, x); break; }
  if (right < left) { left = right = Math.max(0, Math.min(width - 1, Math.round(originX))); top.fill(originY); }
  let previous = left;
  for (let x = 0; x < width; x++) {
    if (Number.isFinite(top[x])) { previous = x; continue; }
    let next = Math.max(x, left); while (next <= right && !Number.isFinite(top[next])) next++;
    top[x] = x <= left ? top[left] : x >= right || next > right ? top[right] : top[previous] + (top[next] - top[previous]) * (x - previous) / (next - previous);
  }
  return { left, right, top, occupied, originX, originY };
}
export function supportPoint2D(surface: SupportSurface2D, x: number): Point2D {
  const profile = surface.profile, pixel = profile.left + clamp2D(x) * (profile.right - profile.left), left = Math.floor(pixel), right = Math.min(profile.top.length - 1, left + 1), t = pixel - left;
  return { x: surface.root.x + (pixel + .5 - profile.originX) * surface.scale, y: surface.root.y + (profile.top[left] + (profile.top[right] - profile.top[left]) * t - profile.originY) * surface.scale };
}
export function supportLocalX2D(surface: SupportSurface2D, worldX: number): number {
  const profile = surface.profile; return clamp2D(((worldX - surface.root.x) / surface.scale + profile.originX - .5 - profile.left) / Math.max(1, profile.right - profile.left));
}
export function supportHeight2D(surface: SupportSurface2D, worldX: number): number { return supportPoint2D(surface, supportLocalX2D(surface, worldX)).y; }
export function excludedSupports2D(decorations: readonly Decoration[], id?: string): Set<string> {
  const result = new Set<string>(); if (!id) return result; result.add(id);
  for (let pass = 0; pass <= MAX_SUPPORT_DEPTH; pass++) for (const item of decorations) if (item.support && result.has(item.support.parentId)) result.add(item.id);
  return result;
}
export function supportOrder2D(decorations: readonly Decoration[]): Decoration[] {
  const byId = new Map(decorations.map(item => [item.id, item])), visited = new Set<string>(), result: Decoration[] = [];
  const visit = (item: Decoration, stack: Set<string>, depth: number): void => { if (visited.has(item.id) || stack.has(item.id) || depth > MAX_SUPPORT_DEPTH) return; const next = new Set(stack); next.add(item.id); const parent = item.support && byId.get(item.support.parentId); if (parent) visit(parent, next, depth + 1); visited.add(item.id); result.push(item); };
  for (const item of decorations) visit(item, new Set(), 0); return result;
}
export function nearestSupport2D(surfaces: readonly SupportSurface2D[], point: Point2D, excluded: ReadonlySet<string>, distance = 42, accepts: (point: Point2D) => boolean = () => true): SupportAttachment | undefined {
  let result: SupportAttachment | undefined, best = Infinity;
  for (const surface of surfaces) {
    if (excluded.has(surface.id)) continue;
    const profile = surface.profile;
    for (let pixel = profile.left; pixel <= profile.right; pixel++) {
      if (profile.occupied && !profile.occupied[pixel]) continue;
      const x = surface.root.x + (pixel + .5 - profile.originX) * surface.scale, horizontal = Math.abs(point.x - x);
      if (horizontal > 22) continue;
      const y = surface.root.y + (profile.top[pixel] - profile.originY) * surface.scale, vertical = Math.abs(point.y - y), score = Math.hypot(horizontal * 1.3, vertical);
      if (point.y - y > Math.min(26, distance) || !accepts({ x, y })) continue;
      if (score <= distance && score < best) { best = score; result = { parentId: surface.id, x: (pixel - profile.left) / Math.max(1, profile.right - profile.left) }; }
    }
  }
  return result;
}
