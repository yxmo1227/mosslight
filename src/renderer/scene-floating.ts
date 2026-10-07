import { clamp2D, FLOOR_Y, inVessel2D, openingY2D, SCENE_HEIGHT, SCENE_WIDTH, vesselRadius2D } from './scene-2d-geometry';
import type { Point2D, Vessel2D } from './scene-2d-geometry';

/** Floating ornaments store normalized design-canvas coordinates, never a
 * landscape-relative depth. Soil edits therefore cannot move an airborne fairy. */
export function floatingPosition2D(vessel: Vessel2D, point: Point2D): Point2D | null {
  return inVessel2D(vessel, point) ? { x: point.x / SCENE_WIDTH, y: point.y / SCENE_HEIGHT } : null;
}
/** A changed vessel may be narrower. Clamp the displayed anchor into the new
 * glass without changing the saved arrangement or inventing a physical support. */
export function floatingPoint2D(vessel: Vessel2D, position: Point2D): Point2D {
  let y = clamp2D(position.y * SCENE_HEIGHT, vessel.top + 2, FLOOR_Y - 2);
  let x = position.x * SCENE_WIDTH;
  for (let pass = 0; pass < 3; pass++) {
    x = clamp2D(x, 300 - vesselRadius2D(vessel, y, 2, 'left'), 300 + vesselRadius2D(vessel, y, 2, 'right'));
    y = Math.max(y, openingY2D(vessel, x) + 2);
  }
  return { x, y };
}
