import type { GlassControlPoint, GlassForm, GlassSideName, MaterialKind, TerrariumAction } from '../shared/types';
import { defaultGlassSide, DEFAULT_GLASS_FORM, GLASS_HEIGHT_LIMITS, GLASS_WIDTH_LIMITS } from '../shared/catalog';

export const SCOOP_RADII = [2, 4, 7] as const;
export type ScoopRadius = typeof SCOOP_RADII[number];
export type GlassRing = 'lower' | 'middle' | 'upper';
export type TerrainTool = { kind: 'pour'; material: MaterialKind } | { kind: 'scoop' } | { kind: 'water' } | { kind: 'drain' };

/** Presentation only: do not rename existing saves when switching UI language. */
export function displayTerrariumName(name: string): string {
  return name === '\u6211\u7684\u5c0f\u68ee\u6797' ? 'My Little Forest' : name;
}

/** Movement is in screen CSS pixels so moving the native window cannot feed
 * a changed client coordinate back into another window move. */
export function widgetDragStep(start: { x: number; y: number }, last: { x: number; y: number }, point: { x: number; y: number }, moved: boolean): { moved: boolean; dx: number; dy: number } {
  if (![start.x, start.y, last.x, last.y, point.x, point.y].every(Number.isFinite)) return { moved, dx: 0, dy: 0 };
  const dragging = moved || Math.hypot(point.x - start.x, point.y - start.y) > 5;
  if (!dragging) return { moved: false, dx: 0, dy: 0 };
  const anchor = moved ? last : start;
  return { moved: true, dx: Math.round(point.x) - Math.round(anchor.x), dy: Math.round(point.y) - Math.round(anchor.y) };
}

export interface MoveScheduler {
  now(): number;
  after(callback: () => void, milliseconds: number): unknown;
  cancel(handle: unknown): void;
}
const moveScheduler: MoveScheduler = {
  now: () => performance.now(),
  after: (callback, milliseconds) => setTimeout(callback, milliseconds),
  cancel: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** Merge high-rate pointer events without dropping their displacement. The
 * desktop process accepts at most 60 messages/s and 512 px per axis/message;
 * this queue leaves headroom at 50/s and carries every chunk remainder. */
export class WidgetMoveQueue {
  private x = 0;
  private y = 0;
  private timer: unknown = null;
  private lastSent = -Infinity;
  private disposed = false;
  constructor(private readonly send: (dx: number, dy: number) => void, private readonly scheduler = moveScheduler, private readonly failed: (error: unknown) => void = () => undefined) {}
  push(dx: number, dy: number): void {
    if (this.disposed || !Number.isSafeInteger(dx) || !Number.isSafeInteger(dy)) return;
    if (!Number.isSafeInteger(this.x + dx) || !Number.isSafeInteger(this.y + dy)) return;
    this.x += dx; this.y += dy; this.schedule();
  }
  private schedule(): void {
    if (this.timer !== null || (!this.x && !this.y) || this.disposed) return;
    this.timer = this.scheduler.after(() => this.flush(), Math.max(0, 20 - (this.scheduler.now() - this.lastSent)));
  }
  private flush(): void {
    this.timer = null; if (this.disposed || (!this.x && !this.y)) return;
    const dx = Math.max(-512, Math.min(512, this.x)); const dy = Math.max(-512, Math.min(512, this.y));
    this.x -= dx; this.y -= dy; this.lastSent = this.scheduler.now();
    try { this.send(dx, dy); } catch (error) { this.cancel(); this.failed(error); return; }
    this.schedule();
  }
  /** Ordinary release does not call cancel: accepted movement drains normally. */
  cancel(): void {
    if (this.timer !== null) this.scheduler.cancel(this.timer);
    this.timer = null; this.x = 0; this.y = 0;
  }
  dispose(): void { this.disposed = true; this.cancel(); }
}

/** Dose sizes are independent of the 125 ms stroke scheduler. Keeping the broad
 * scoop as one action preserves its bounded, single-in-flight save semantics. */
export function terrainToolAction(tool: TerrainTool, x: number, radius: ScoopRadius): TerrariumAction | null {
  if (!Number.isFinite(x) || x < 0 || x > 1) return null;
  if (tool.kind === 'water') return { type: 'pour-water', x, amount: 16 };
  if (tool.kind === 'drain') return { type: 'drain-water', x, amount: 24, radius };
  return tool.kind === 'pour'
    ? { type: 'pour', material: tool.material, x, amount: 16 }
    : { type: 'scoop', x, amount: 24, radius };
}

export function glassFormDraft(form: GlassForm | undefined): GlassForm {
  const source = form ?? DEFAULT_GLASS_FORM;
  return { ...source, ...(source.sides ? { sides: {
    left: { lower: { ...source.sides.left.lower }, middle: { ...source.sides.left.middle }, upper: { ...source.sides.left.upper } },
    right: { lower: { ...source.sides.right.lower }, middle: { ...source.sides.right.middle }, upper: { ...source.sides.right.upper } },
  } } : {}) };
}

export function glassControl(form: GlassForm, side: GlassSideName, band: GlassRing): GlassControlPoint {
  return { ...(form.sides?.[side] ?? defaultGlassSide(form))[band] };
}
export function editGlassControl(form: GlassForm, side: GlassSideName, band: GlassRing, control: GlassControlPoint, linked: boolean): GlassForm {
  const result = glassFormDraft(form), fallback = glassControl(form, side, band);
  const round = (value: number, limits: readonly [number, number], original: number): number => Math.round(Math.max(limits[0], Math.min(limits[1], Number.isFinite(value) ? value : original)) * 1000) / 1000;
  const point = { width: round(control.width, GLASS_WIDTH_LIMITS, fallback.width), height: round(control.height, GLASS_HEIGHT_LIMITS[band], fallback.height) };
  result.sides ??= { left: defaultGlassSide(form), right: defaultGlassSide(form) };
  result.sides[side][band] = point;
  if (linked) result.sides[side === 'left' ? 'right' : 'left'][band] = { ...point };
  return result;
}

export function glassWidth(value: number, fallback: number): number {
  const safe = Number.isFinite(value) ? value : fallback;
  return Math.round(Math.min(1.25, Math.max(.55, safe)) * 100) / 100;
}

/** Keyboard resizing shares the same limits as mouse dragging and main's schema. */
export function keyboardGlassWidth(value: number, key: string, largeStep = false): number | null {
  if (key === 'Home') return .55;
  if (key === 'End') return 1.25;
  if (key === 'ArrowLeft' || key === 'ArrowDown') return glassWidth(value - (largeStep ? .1 : .01), value);
  if (key === 'ArrowRight' || key === 'ArrowUp') return glassWidth(value + (largeStep ? .1 : .01), value);
  return null;
}
