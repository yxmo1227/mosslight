import { DEFAULT_WOOD_FORM, WOOD_ANGLE_LIMITS, WOOD_BRANCH_ANGLE_LIMITS, WOOD_BRANCH_AT_LIMITS, WOOD_BRANCH_LENGTH_LIMITS, WOOD_LENGTH_LIMITS, WOOD_MAX_BRANCHES } from '../shared/catalog';
import type { WoodForm } from '../shared/types';
import { clamp2D } from './scene-2d-geometry';
import type { Point2D } from './scene-2d-geometry';

export interface WoodPath2D { a: Point2D; b: Point2D; c: Point2D; d: Point2D; width: number; branch: number }
export interface WoodGeometry2D { paths: WoodPath2D[]; bounds: { left: number; right: number; top: number; bottom: number } }
export function woodPathPoint2D(path: WoodPath2D, t: number): Point2D {
  const u = 1 - t; return { x: u ** 3 * path.a.x + 3 * u * u * t * path.b.x + 3 * u * t * t * path.c.x + t ** 3 * path.d.x, y: u ** 3 * path.a.y + 3 * u * u * t * path.b.y + 3 * u * t * t * path.c.y + t ** 3 * path.d.y };
}
/** One bounded, non-recursive authored stick graph. Geometry, raster bounds and
 * bark strokes use these same paths, including clockwise direction changes. */
export function woodGeometry2D(form: WoodForm = DEFAULT_WOOD_FORM): WoodGeometry2D {
  const length = .76 * clamp2D(form.length, ...WOOD_LENGTH_LIMITS), angle = clamp2D(form.angle, ...WOOD_ANGLE_LIMITS) * Math.PI / 180;
  const bend = clamp2D(form.bend ?? 0, -.35, .35);
  const main: WoodPath2D = { a: { x: -length / 2, y: .006 }, b: { x: -length * .17, y: -.045 + bend }, c: { x: length * .20, y: .009 + bend }, d: { x: length / 2, y: -.014 }, width: .098, branch: -1 };
  if (form.tone === 'birch' && bend === 0) {
    // The pale spar really is straight; no inherited hidden S-curve remains.
    main.b = { x: -length / 6, y: main.a.y + (main.d.y - main.a.y) / 3 };
    main.c = { x: length / 6, y: main.a.y + (main.d.y - main.a.y) * 2 / 3 };
  }
  const paths = (form.branches ?? []).slice(0, WOOD_MAX_BRANCHES).map((branch, index): WoodPath2D => {
    const at = clamp2D(branch.at, ...WOOD_BRANCH_AT_LIMITS), size = length * clamp2D(branch.length, ...WOOD_BRANCH_LENGTH_LIMITS), root = woodPathPoint2D(main, at);
    const before = woodPathPoint2D(main, Math.max(0, at - .001)), after = woodPathPoint2D(main, Math.min(1, at + .001));
    const direction = Math.atan2(after.y - before.y, after.x - before.x) + clamp2D(branch.angle, ...WOOD_BRANCH_ANGLE_LIMITS) * Math.PI / 180, dx = Math.cos(direction), dy = Math.sin(direction);
    const along = (t: number, bend: number): Point2D => ({ x: root.x + dx * size * t - dy * bend, y: root.y + dy * size * t + dx * bend });
    return { a: root, b: along(.32, -.014), c: along(.72, .012), d: along(1, 0), width: .038 + .014 * clamp2D(branch.length, ...WOOD_BRANCH_LENGTH_LIMITS), branch: index };
  });
  paths.push(main);
  const rotate = (p: Point2D): Point2D => ({ x: p.x * Math.cos(angle) - p.y * Math.sin(angle), y: p.x * Math.sin(angle) + p.y * Math.cos(angle) });
  const transformed = paths.map(path => ({ ...path, a: rotate(path.a), b: rotate(path.b), c: rotate(path.c), d: rotate(path.d) }));
  const bounds = { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity };
  for (const path of transformed) for (const point of [path.a, path.b, path.c, path.d]) { const radius = path.width * .62 + .016; bounds.left = Math.min(bounds.left, point.x - radius); bounds.right = Math.max(bounds.right, point.x + radius); bounds.top = Math.min(bounds.top, point.y - radius); bounds.bottom = Math.max(bounds.bottom, point.y + radius); }
  return { paths: transformed, bounds };
}
