import assert from 'node:assert/strict';
import test from 'node:test';
import { MATERIAL_KINDS } from '../shared/catalog';
import { drawToolArt } from './tool-art';
import type { ToolArtKind } from './tool-art';

// This verifies the Canvas API contract, not raster appearance. The deliberately
// small mock makes newly introduced, unsupported drawing APIs fail explicitly.
type Argument = string | number | boolean;
interface Operation { method: string; args: Argument[] }
type Style = string | RecordedGradient;
interface CanvasState {
  fillStyle: Style; strokeStyle: Style; lineWidth: number; lineCap: string; lineJoin: string;
  globalAlpha: number; globalCompositeOperation: string; filter: string;
  shadowColor: string; shadowBlur: number; shadowOffsetX: number; shadowOffsetY: number;
  dash: number[]; transforms: Operation[]; clips: Operation[][];
}

function assertFinite(method: string, args: readonly Argument[]): void {
  for (const value of args) {
    if (typeof value === 'number') assert.ok(Number.isFinite(value), `${method} received a non-finite number`);
  }
}
function copyOperations(operations: readonly Operation[]): Operation[] {
  return operations.map(({ method, args }) => ({ method, args: [...args] }));
}

class RecordedPath {
  readonly operations: Operation[] = [];
  private record(method: string, ...args: Argument[]): void {
    assertFinite(`Path2D.${method}`, args);
    this.operations.push({ method, args });
  }
  rect(x: number, y: number, width: number, height: number): void { this.record('rect', x, y, width, height); }
  moveTo(x: number, y: number): void { this.record('moveTo', x, y); }
  lineTo(x: number, y: number): void { this.record('lineTo', x, y); }
  closePath(): void { this.record('closePath'); }
  bezierCurveTo(cp1x: number, cp1y: number, cp2x: number, cp2y: number, x: number, y: number): void {
    this.record('bezierCurveTo', cp1x, cp1y, cp2x, cp2y, x, y);
  }
  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void {
    this.record('quadraticCurveTo', cpx, cpy, x, y);
  }
  ellipse(x: number, y: number, rx: number, ry: number, rotation: number, start: number, end: number): void {
    assert.ok(rx >= 0 && ry >= 0, 'ellipse radii must not be negative');
    this.record('ellipse', x, y, rx, ry, rotation, start, end);
  }
}

class RecordedGradient {
  constructor(readonly id: number, private readonly canvas: RecordingCanvas) {}
  addColorStop(offset: number, color: string): void {
    assert.ok(offset >= 0 && offset <= 1, 'gradient stops must be bounded');
    this.canvas.record('addColorStop', this.id, offset, color);
  }
}

class RecordingCanvas {
  readonly operations: Operation[] = [];
  readonly stack: CanvasState[] = [];
  // The live path is deliberately NOT saved/restored: real Canvas save does not save it.
  readonly livePath: Operation[] = [{ method: 'moveTo', args: [12, 34] }, { method: 'lineTo', args: [56, 78] }];
  fillCount = 0;
  minimumStackDepth = 0;
  private gradientCount = 0;
  private state: CanvasState = {
    fillStyle: '#010203', strokeStyle: '#040506', lineWidth: 7, lineCap: 'butt', lineJoin: 'miter',
    globalAlpha: 0.37, globalCompositeOperation: 'xor', filter: 'blur(1px)',
    shadowColor: '#ff0000', shadowBlur: 4, shadowOffsetX: 2, shadowOffsetY: 1,
    dash: [2, 3], transforms: [{ method: 'translate', args: [19, 31] }, { method: 'scale', args: [2, 2] }],
    clips: [[{ method: 'rect', args: [-20, -10, 200, 210] }]],
  };

  constructor(private readonly failAtFill = Infinity) {}
  asContext(): CanvasRenderingContext2D { return this as unknown as CanvasRenderingContext2D; }
  currentState(): CanvasState {
    return { ...this.state, dash: [...this.state.dash], transforms: copyOperations(this.state.transforms),
      clips: this.state.clips.map(copyOperations) };
  }
  record(method: string, ...args: Argument[]): void {
    assertFinite(method, args);
    this.operations.push({ method, args });
  }
  private setValue<K extends keyof CanvasState>(name: K, value: CanvasState[K]): void {
    this.state[name] = value;
    if (value instanceof RecordedGradient) this.record(`set-${name}`, `gradient:${value.id}`);
    else if (typeof value === 'string' || typeof value === 'number') this.record(`set-${name}`, value);
  }
  set fillStyle(value: Style) { this.setValue('fillStyle', value); }
  get fillStyle(): Style { return this.state.fillStyle; }
  set strokeStyle(value: Style) { this.setValue('strokeStyle', value); }
  get strokeStyle(): Style { return this.state.strokeStyle; }
  set lineWidth(value: number) { this.setValue('lineWidth', value); }
  get lineWidth(): number { return this.state.lineWidth; }
  set lineCap(value: string) { this.setValue('lineCap', value); }
  get lineCap(): string { return this.state.lineCap; }
  set lineJoin(value: string) { this.setValue('lineJoin', value); }
  get lineJoin(): string { return this.state.lineJoin; }
  set globalAlpha(value: number) { this.setValue('globalAlpha', value); }
  get globalAlpha(): number { return this.state.globalAlpha; }
  set globalCompositeOperation(value: string) { this.setValue('globalCompositeOperation', value); }
  get globalCompositeOperation(): string { return this.state.globalCompositeOperation; }
  set filter(value: string) { this.setValue('filter', value); }
  get filter(): string { return this.state.filter; }
  set shadowColor(value: string) { this.setValue('shadowColor', value); }
  get shadowColor(): string { return this.state.shadowColor; }
  set shadowBlur(value: number) { this.setValue('shadowBlur', value); }
  get shadowBlur(): number { return this.state.shadowBlur; }
  set shadowOffsetX(value: number) { this.setValue('shadowOffsetX', value); }
  get shadowOffsetX(): number { return this.state.shadowOffsetX; }
  set shadowOffsetY(value: number) { this.setValue('shadowOffsetY', value); }
  get shadowOffsetY(): number { return this.state.shadowOffsetY; }

  save(): void { this.stack.push(this.currentState()); this.record('save'); }
  restore(): void {
    this.minimumStackDepth = Math.min(this.minimumStackDepth, this.stack.length - 1);
    const restored = this.stack.pop();
    assert.ok(restored, 'Canvas restore must have a preceding save');
    this.state = restored;
    this.record('restore');
  }
  private transform(method: string, ...args: number[]): void {
    this.record(method, ...args);
    this.state.transforms.push({ method, args });
  }
  translate(x: number, y: number): void { this.transform('translate', x, y); }
  scale(x: number, y: number): void { this.transform('scale', x, y); }
  rotate(angle: number): void { this.transform('rotate', angle); }
  setLineDash(value: number[]): void { this.record('setLineDash', ...value); this.state.dash = [...value]; }
  getLineDash(): number[] { return [...this.state.dash]; }

  // These methods simulate forbidden mutations of the caller's unfinished live path.
  beginPath(): void { this.record('beginPath'); this.livePath.length = 0; }
  moveTo(x: number, y: number): void { this.livePathOperation('moveTo', x, y); }
  lineTo(x: number, y: number): void { this.livePathOperation('lineTo', x, y); }
  closePath(): void { this.livePathOperation('closePath'); }
  private livePathOperation(method: string, ...args: Argument[]): void {
    this.record(method, ...args);
    this.livePath.push({ method, args });
  }
  private recordPath(method: string, path: RecordedPath): void {
    assert.ok(path instanceof RecordedPath, `${method} must use an explicit Path2D, not the caller's live path`);
    this.record(method);
    for (const operation of path.operations) this.record(`${method}-path-${operation.method}`, ...operation.args);
  }
  fill(path: RecordedPath): void {
    this.recordPath('fill', path);
    this.fillCount += 1;
    if (this.fillCount === this.failAtFill) throw new Error('injected canvas failure');
  }
  stroke(path: RecordedPath): void { this.recordPath('stroke', path); }
  clip(path: RecordedPath): void {
    this.recordPath('clip', path);
    this.state.clips.push(copyOperations(path.operations));
  }
  createLinearGradient(x0: number, y0: number, x1: number, y1: number): RecordedGradient {
    const id = ++this.gradientCount;
    this.record('createLinearGradient', id, x0, y0, x1, y1);
    return new RecordedGradient(id, this);
  }
  createRadialGradient(x0: number, y0: number, r0: number, x1: number, y1: number, r1: number): RecordedGradient {
    assert.ok(r0 >= 0 && r1 >= 0, 'gradient radii must not be negative');
    const id = ++this.gradientCount;
    this.record('createRadialGradient', id, x0, y0, r0, x1, y1, r1);
    return new RecordedGradient(id, this);
  }
}

// A scoped replacement avoids leaking DOM mocks beyond each synchronous test.
function withPath2D<T>(draw: () => T): T {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'Path2D');
  Object.defineProperty(globalThis, 'Path2D', { value: RecordedPath, configurable: true, writable: true });
  try { return draw(); } finally {
    if (original) Object.defineProperty(globalThis, 'Path2D', original);
    else Reflect.deleteProperty(globalThis, 'Path2D');
  }
}
const kinds: readonly ToolArtKind[] = ['sun', 'spray', 'scoop', 'water', 'drain', ...MATERIAL_KINDS];
const sizes = [64, 80, 128];
function render(kind: ToolArtKind, size: number): RecordingCanvas {
  const canvas = new RecordingCanvas();
  drawToolArt(canvas.asContext(), kind, size);
  return canvas;
}
function assertRestored(canvas: RecordingCanvas, initial: CanvasState, callerPath: readonly Operation[]): void {
  assert.equal(canvas.stack.length, 0, 'every saved state must be restored');
  assert.equal(canvas.minimumStackDepth, 0, 'drawing must not restore a caller-owned saved state');
  assert.deepEqual(canvas.currentState(), initial, 'styles, transforms, dashes and clipping must be unchanged');
  assert.deepEqual(canvas.livePath, callerPath, 'the caller live path is not protected by Canvas save/restore');
  assert.equal(canvas.operations.filter(({ method }) => method === 'save').length,
    canvas.operations.filter(({ method }) => method === 'restore').length);
}

for (const kind of kinds) {
  test(`${kind}: geometry and painting numbers are finite at 64, 80 and 128`, () => withPath2D(() => {
    for (const size of sizes) {
      const canvas = render(kind, size);
      assert.ok(canvas.fillCount > 0, 'an icon must actually paint');
      assert.ok(canvas.operations.some(({ method }) => method.includes('-path-')), 'geometry must be recorded');
      for (const { method, args } of canvas.operations) assertFinite(method, args);
      assert.deepEqual(canvas.operations.find(({ method }) => method === 'scale')?.args, [size / 100, size / 100]);
      assert.ok(canvas.operations.some(({ method, args }) => method === 'clip-path-rect'
        && args.join(',') === '0,0,100,100'), 'icon painting must be clipped to its normalized bounds');
    }
  }));

  test(`${kind}: repeated drawing is deterministic at every supported test size`, () => withPath2D(() => {
    for (const size of sizes) {
      const first = render(kind, size);
      // Drawing another icon in between must not advance a shared random generator.
      render(kind === 'soil' ? 'bark' : 'soil', size);
      const second = render(kind, size);
      assert.deepEqual(first.operations, second.operations, `${kind} must retain its seeded artwork`);
    }
  }));

  test(`${kind}: drawing preserves caller state, saved states and unfinished path`, () => withPath2D(() => {
    for (const size of sizes) {
      const canvas = new RecordingCanvas();
      canvas.save();
      const callerSavedState = canvas.currentState();
      const callerPath = copyOperations(canvas.livePath);
      const precedingOperations = canvas.operations.length;
      drawToolArt(canvas.asContext(), kind, size);
      assert.equal(canvas.stack.length, 1, 'the caller saved state must stay on the stack');
      assert.deepEqual(canvas.currentState(), callerSavedState);
      assert.deepEqual(canvas.livePath, callerPath);
      assert.equal(canvas.operations.slice(precedingOperations).some(({ method }) => method === 'beginPath'
        || method === 'moveTo' || method === 'lineTo' || method === 'closePath'), false);
      canvas.restore();
      assertRestored(canvas, callerSavedState, callerPath);
    }
  }));
}

test('non-finite, zero and negative sizes are true no-ops for all eleven icons', () => withPath2D(() => {
  for (const size of [NaN, Infinity, -Infinity, 0, -0, -1, -128]) {
    for (const kind of kinds) {
      const canvas = new RecordingCanvas();
      const initial = canvas.currentState();
      const callerPath = copyOperations(canvas.livePath);
      drawToolArt(canvas.asContext(), kind, size);
      assert.deepEqual(canvas.operations, [], `${kind} at ${String(size)} must not touch the canvas`);
      assertRestored(canvas, initial, callerPath);
    }
  }
}));

test('nested canvas states and caller path are restored after a painting exception', () => withPath2D(() => {
  for (const kind of kinds) {
    const totalFills = render(kind, 80).fillCount;
    for (const failAt of new Set([1, Math.ceil(totalFills / 2), totalFills])) {
      const canvas = new RecordingCanvas(failAt);
      const initial = canvas.currentState();
      const callerPath = copyOperations(canvas.livePath);
      assert.throws(() => drawToolArt(canvas.asContext(), kind, 80), /injected canvas failure/);
      assertRestored(canvas, initial, callerPath);
    }
  }
}));

test('each material has its own repeatable drawing trace without Math.random', () => withPath2D(() => {
  const originalRandom = Math.random;
  Math.random = () => { throw new Error('material artwork must use its own seeded generator'); };
  try {
    const traces = MATERIAL_KINDS.map((kind) => JSON.stringify(render(kind, 80).operations));
    assert.equal(new Set(traces).size, MATERIAL_KINDS.length, 'all six material artworks must be distinguishable');
  } finally { Math.random = originalRandom; }
}));
