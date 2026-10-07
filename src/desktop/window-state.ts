export interface Bounds { x: number; y: number; width: number; height: number }
export const WIDGET_DIMENSIONS = {
  small: { width: 240, height: 300 },
  medium: { width: 320, height: 400 },
  large: { width: 400, height: 500 },
} as const;
export function clampToWorkArea(bounds: Bounds, area: Bounds): Bounds {
  const width = Math.min(Math.max(120, bounds.width), area.width);
  const height = Math.min(Math.max(150, bounds.height), area.height);
  return { width, height, x: Math.round(Math.min(Math.max(bounds.x, area.x), area.x + area.width - width)), y: Math.round(Math.min(Math.max(bounds.y, area.y), area.y + area.height - height)) };
}
export function onlineElapsed(previousMonotonic: number, currentMonotonic: number): { ms: number; mode: 'online' | 'offline' } {
  const ms = Math.max(0, currentMonotonic - previousMonotonic);
  // Unexpected pauses (e.g. missed system suspend) are conservatively real-time.
  return { ms, mode: ms > 30_000 ? 'offline' : 'online' };
}
/** Accept only bounded integer deltas; renderer cannot set arbitrary dimensions. */
export function validWidgetDelta(dx: unknown, dy: unknown): dx is number {
  return typeof dx === 'number' && typeof dy === 'number' && Number.isSafeInteger(dx) && Number.isSafeInteger(dy) && Math.abs(dx) <= 512 && Math.abs(dy) <= 512;
}
export function moveWidgetWithinArea(bounds: Bounds, dx: number, dy: number, area: Bounds): Bounds {
  if (!validWidgetDelta(dx, dy)) throw new RangeError('Invalid widget movement');
  return clampToWorkArea({ ...bounds, x: bounds.x + dx, y: bounds.y + dy }, area);
}
