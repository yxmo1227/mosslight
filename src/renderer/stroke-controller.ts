import type { TerrariumAction } from '../shared/types';

export interface PointerPoint { x: number; y: number }
export interface StrokeCallbacks {
  actionAt(point: PointerPoint): TerrariumAction | null;
  perform(action: TerrariumAction, valid: () => boolean): Promise<void>;
  finish(): Promise<void>;
  effect(point: PointerPoint | null): void;
  failed(error: unknown): void;
}
export interface StrokeScheduler {
  every(callback: () => void, intervalMs: number): unknown;
  clear(handle: unknown): void;
}
const browserScheduler: StrokeScheduler = {
  every: (callback, intervalMs) => setInterval(callback, intervalMs),
  clear: handle => clearInterval(handle as ReturnType<typeof setInterval>),
};

/** At most one dose is in flight. Holding never appends an unbounded action queue.
 * Stop prevents new doses synchronously, then flushes the last accepted dose. */
export class StrokeController {
  private timer: unknown = null;
  private point: PointerPoint | null = null;
  private pending: Promise<void> | null = null;
  private held = false;
  private disposed = false;
  private epoch = 0;
  constructor(private readonly callbacks: StrokeCallbacks, private readonly scheduler = browserScheduler) {}
  get active(): boolean { return this.held; }
  get inFlight(): boolean { return this.pending !== null; }

  start(point: PointerPoint): void {
    if (this.disposed || this.held) return;
    this.point = point; this.held = true; this.epoch++; this.tick();
    this.timer = this.scheduler.every(() => this.tick(), 125);
  }
  move(point: PointerPoint): void {
    this.point = point;
    if (this.held) this.callbacks.effect(this.callbacks.actionAt(point) ? point : null);
  }
  private tick(): void {
    if (!this.held || !this.point || this.disposed) return;
    const action = this.callbacks.actionAt(this.point);
    this.callbacks.effect(action ? this.point : null);
    if (!action || this.pending) return;
    const epoch = this.epoch;
    const valid = (): boolean => this.held && !this.disposed && this.epoch === epoch;
    const operation = Promise.resolve().then(() => valid() ? this.callbacks.perform(action, valid) : undefined);
    this.pending = operation;
    void operation.catch(error => { this.callbacks.failed(error); void this.stop(); }).finally(() => {
      if (this.pending === operation) this.pending = null;
    });
  }
  stop(): Promise<void> {
    const wasHeld = this.held; this.held = false; this.epoch++;
    if (this.timer !== null) this.scheduler.clear(this.timer); this.timer = null;
    this.callbacks.effect(null);
    if (!wasHeld) return Promise.resolve();
    const lastDose = this.pending;
    return (lastDose ?? Promise.resolve()).catch(() => undefined).then(() => this.callbacks.finish()).catch(error => this.callbacks.failed(error));
  }
  dispose(): void { this.disposed = true; void this.stop(); }
}
