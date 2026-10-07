export interface ScreenPoint { x: number; y: number }

/** A shape-only CPU stencil. Its values deliberately do not depend on glass
 * opacity, GPU pixels, soil, plants or transient sunlight/water effects. */
export class ProjectedSilhouette {
  readonly pixels: Uint8Array;
  constructor(readonly width: number, readonly height: number) { this.pixels = new Uint8Array(width * height); }
  clear(): void { this.pixels.fill(0); }
  triangle(a: ScreenPoint, b: ScreenPoint, c: ScreenPoint): void {
    const low = Math.max(0, Math.ceil(Math.min(a.y, b.y, c.y) - .5)), high = Math.min(this.height - 1, Math.floor(Math.max(a.y, b.y, c.y) - .5));
    for (let row = low; row <= high; row++) {
      const y = row + .5, intersections: number[] = [];
      for (const [from, to] of [[a, b], [b, c], [c, a]]) {
        if (from.y === to.y || y < Math.min(from.y, to.y) || y > Math.max(from.y, to.y)) continue;
        intersections.push(from.x + (to.x - from.x) * (y - from.y) / (to.y - from.y));
      }
      if (intersections.length < 2) continue;
      const left = Math.max(0, Math.ceil(Math.min(...intersections) - .5)), right = Math.min(this.width - 1, Math.floor(Math.max(...intersections) - .5));
      if (right >= left) this.pixels.fill(1, row * this.width + left, row * this.width + right + 1);
    }
  }
  contains(point: ScreenPoint): boolean {
    const x = Math.floor(point.x), y = Math.floor(point.y); return x >= 0 && y >= 0 && x < this.width && y < this.height && this.pixels[y * this.width + x] === 1;
  }
}
