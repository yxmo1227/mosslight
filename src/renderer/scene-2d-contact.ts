import type { Point2D } from './scene-2d-geometry';

export interface RootFoot2D extends Point2D { width: number }
export interface ContactRoot2D { x: number; top: number; bottom: number; width: number }
/** Local sprite-space roots. Each foot meets the real surface at its own x;
 * neither a shared cluster anchor nor pond height is a substitute for soil. */
export function contactRoots2D(feet: readonly RootFoot2D[], origin: Point2D, scale: number, surfaceAt: (x: number) => number | null): ContactRoot2D[] {
  if (!(scale > 0) || !Number.isFinite(scale)) return [];
  const result: ContactRoot2D[] = [];
  for (const foot of feet) {
    const target = surfaceAt(origin.x + foot.x * scale);
    if (target === null || !Number.isFinite(target)) continue;
    const bottom = (target - origin.y + .85) / scale;
    if (bottom > foot.y) result.push({ x: foot.x, top: foot.y - 2, bottom, width: foot.width });
  }
  return result;
}

/** Contiguous opaque stump footer, excluding low-alpha cast shadows. The lower
 * skirt follows this authored outline, not a rectangular sprite bounding box. */
export function stumpFeet2D(alpha: Uint8ClampedArray, width: number, height: number, originX: number, originY: number, unit: number): RootFoot2D[] {
  const feet: RootFoot2D[] = [];
  for (let x = Math.max(0, Math.floor(originX - unit * .43)); x <= Math.min(width - 1, Math.ceil(originX + unit * .43)); x++) {
    for (let y = height - 1; y >= originY - unit * .12; y--) if (alpha[y * width + x] >= 180) { feet.push({ x: x + .5 - originX, y: y + .5 - originY, width: 1.05 }); break; }
  }
  return feet;
}
