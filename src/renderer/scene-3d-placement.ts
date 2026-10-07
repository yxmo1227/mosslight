import type { VesselProfile } from './scene-3d-profile';
import { clamp, radiusAt, wallDepthAt } from './scene-3d-profile';
export interface Point3 { x: number; y: number; z: number }
export interface ContentBounds { min: Point3; max: Point3 }
export interface ContentFit { position: Point3; scale: number }

/** Translation is preferred to clipping. The plant/log keeps its complete
 * shape; only an exceptionally narrow vessel requires a uniform size reduction.
 * Roots below the soil line are intentionally omitted from the fit envelope. */
export function fitContent(profile: VesselProfile, anchor: Point3, bounds: ContentBounds): ContentFit {
  const top = profile.rings[profile.rings.length - 1][0] - .085;
  for (let attempt = 0; attempt < 17; attempt++) {
    const scale = .93 ** attempt, lowerY = anchor.y + Math.max(0, bounds.min.y) * scale, upperY = anchor.y + Math.max(0, bounds.max.y) * scale;
    if (upperY > top) continue;
    const heights = [lowerY, upperY, ...profile.rings.filter(([y]) => y > lowerY && y < upperY).map(([y]) => y)];
    const width = Math.min(...heights.map(y => radiusAt(profile, y))) - .072;
    const left = -width - bounds.min.x * scale, right = width - bounds.max.x * scale; if (left > right) continue;
    let x = clamp(anchor.x, left, right);
    // At the side wall depth tends to zero, so slide gently inward until both
    // front and back fit. This avoids slicing a whole fern at the glass face.
    for (let slide = 0; slide < 24; slide++) {
      const front = Math.min(...heights.flatMap(y => [wallDepthAt(profile, x + bounds.min.x * scale, y, .072), wallDepthAt(profile, x + bounds.max.x * scale, y, .072)]));
      const backLimit = -front - bounds.min.z * scale, frontLimit = front - bounds.max.z * scale;
      if (backLimit <= frontLimit) return { position: { x, y: anchor.y, z: clamp(anchor.z, backLimit, frontLimit) }, scale };
      x *= .91;
    }
  }
  return { position: { x: 0, y: anchor.y, z: 0 }, scale: .93 ** 16 };
}
