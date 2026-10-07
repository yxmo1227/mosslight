import assert from 'node:assert/strict';
import test from 'node:test';
import type { Decoration, DecorationKind, Plant, PlantKind } from '../shared/types';
import { decorationBounds2D, drawDecoration, drawPlant } from './scene-botany';
import { woodGeometry2D, woodPathPoint2D } from './scene-2d-wood';

type Matrix = [number, number, number, number, number, number];
type P = { x: number; y: number };
class ArtCanvas {
  readonly trace: unknown[][] = []; readonly points: P[] = []; private matrix: Matrix = [1, 0, 0, 1, 0, 0];
  private readonly stack: Matrix[] = []; private last: P = { x: 0, y: 0 }; private gradient = 0;
  fillStyle: unknown; strokeStyle: unknown; lineWidth = 1; lineCap = 'round'; lineJoin = 'round';
  get context(): CanvasRenderingContext2D { return this as unknown as CanvasRenderingContext2D; }
  private rec(name: string, ...values: unknown[]): void { for (const value of values) if (typeof value === 'number') assert.ok(Number.isFinite(value), name); this.trace.push([name, ...values]); }
  private point(x: number, y: number): P { const m = this.matrix; return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] }; }
  private add(x: number, y: number): void { this.points.push(this.point(x, y)); this.last = { x, y }; }
  save(): void { this.stack.push([...this.matrix]); this.rec('save'); }
  restore(): void { const next = this.stack.pop(); assert.ok(next); this.matrix = next; this.rec('restore'); }
  translate(x: number, y: number): void { const p = this.point(x, y); this.matrix[4] = p.x; this.matrix[5] = p.y; this.rec('translate', x, y); }
  scale(x: number, y: number): void { this.matrix[0] *= x; this.matrix[1] *= x; this.matrix[2] *= y; this.matrix[3] *= y; this.rec('scale', x, y); }
  rotate(a: number): void { const [b, c, d, e, x, y] = this.matrix, co = Math.cos(a), si = Math.sin(a); this.matrix = [b * co + d * si, c * co + e * si, d * co - b * si, e * co - c * si, x, y]; this.rec('rotate', a); }
  beginPath(): void { this.rec('begin'); } closePath(): void { this.rec('close'); } clip(): void { this.rec('clip'); }
  moveTo(x: number, y: number): void { this.add(x, y); this.rec('move', x, y); }
  lineTo(x: number, y: number): void { this.add(x, y); this.rec('line', x, y); }
  quadraticCurveTo(bx: number, by: number, x: number, y: number): void {
    const a = this.last; for (let i = 1; i <= 20; i++) { const t = i / 20, u = 1 - t; this.add(u * u * a.x + 2 * u * t * bx + t * t * x, u * u * a.y + 2 * u * t * by + t * t * y); }
    this.rec('quadratic', bx, by, x, y);
  }
  bezierCurveTo(bx: number, by: number, cx: number, cy: number, x: number, y: number): void {
    const a = this.last; for (let i = 1; i <= 20; i++) { const t = i / 20, u = 1 - t; this.add(u ** 3 * a.x + 3 * u * u * t * bx + 3 * u * t * t * cx + t ** 3 * x, u ** 3 * a.y + 3 * u * u * t * by + 3 * u * t * t * cy + t ** 3 * y); }
    this.rec('bezier', bx, by, cx, cy, x, y);
  }
  ellipse(x: number, y: number, rx: number, ry: number, rotation: number, start: number, end: number): void {
    assert.ok(rx >= 0 && ry >= 0); for (let i = 0; i <= 40; i++) { const a = start + (end - start) * i / 40, px = Math.cos(a) * rx, py = Math.sin(a) * ry; this.add(x + px * Math.cos(rotation) - py * Math.sin(rotation), y + px * Math.sin(rotation) + py * Math.cos(rotation)); }
    this.rec('ellipse', x, y, rx, ry, rotation, start, end);
  }
  arc(x: number, y: number, r: number, start: number, end: number): void { this.ellipse(x, y, r, r, 0, start, end); }
  private style(value: unknown): unknown { return typeof value === 'object' && value !== null ? `gradient:${(value as { id?: number }).id}` : value; }
  fill(): void { this.rec('fill', this.style(this.fillStyle)); } stroke(): void { this.rec('stroke', this.style(this.strokeStyle), this.lineWidth); }
  fillRect(x: number, y: number, w: number, h: number): void { this.add(x, y); this.add(x + w, y + h); this.rec('fillRect', x, y, w, h, this.fillStyle); }
  createLinearGradient(...args: number[]): CanvasGradient { const id = ++this.gradient; this.rec('gradient', id, ...args); return { addColorStop: (offset: number, color: string) => this.rec('stop', offset, color), id } as unknown as CanvasGradient; }
  createRadialGradient(...args: number[]): CanvasGradient { return this.createLinearGradient(...args); }
  assertBalanced(): void { assert.equal(this.stack.length, 0); assert.deepEqual(this.matrix, [1, 0, 0, 1, 0, 0]); }
}
const plants: PlantKind[] = ['star-moss', 'fern-moss', 'creeping-fig', 'oxalis', 'scarlet-mushroom', 'violet-mushroom'];
const props: DecorationKind[] = ['fairy', 'gardener', 'reader', 'cat', 'dog', 'mushroom-house', 'treehouse', 'arc-lamp', 'slender-steps', 'sun', 'moon', 'star'];
const ecology = { drought: 0, waterlogging: 0, spread: 0, cycle: .4, generation: 0 as const };
function plant(kind: PlantKind, change: Partial<Plant> = {}): Plant { return { id: `new-${kind}`, kind, x: .5, y: .5, growth: .8, health: .9, scale: 1, wetness: 0, ageDays: 73, ecology, ...change }; }
function object(kind: DecorationKind, change: Partial<Decoration> = {}): Decoration { return { id: `new-${kind}`, kind, x: .5, y: .5, scale: 1, ...change }; }
function renderPlant(value: Plant): ArtCanvas { const ctx = new ArtCanvas(); drawPlant(ctx.context, value, 0, 0, 1, { groundShadow: false }); ctx.assertBalanced(); return ctx; }
function renderObject(value: Decoration): ArtCanvas { const ctx = new ArtCanvas(); drawDecoration(ctx.context, value, 0, 0, 1, { groundShadow: false }); ctx.assertBalanced(); return ctx; }

for (const kind of plants) test(`${kind}: original new art is finite, deterministic, growing and responsive to care`, () => {
  const value = plant(kind), before = structuredClone(value), normal = renderPlant(value);
  assert.deepEqual(normal.trace, renderPlant(value).trace); assert.deepEqual(value, before);
  assert.ok(normal.trace.filter(op => op[0] === 'fill' || op[0] === 'stroke').length > 20);
  for (const change of [{ growth: .01 }, { wetness: .8 }, { ecology: { ...ecology, drought: 1 } }]) assert.notDeepEqual(normal.trace, renderPlant(plant(kind, change)).trace);
  if (kind.endsWith('moss')) assert.notDeepEqual(normal.trace, renderPlant(plant(kind, { ecology: { ...ecology, spread: 1 } })).trace);
  if (kind.endsWith('mushroom')) assert.notDeepEqual(normal.trace, renderPlant(plant(kind, { ecology: { ...ecology, cycle: .94 } })).trace);
  for (const p of normal.points) assert.ok(Math.abs(p.x) < 1 && p.y > -.99 && p.y < .15, `${kind} bounded local art ${JSON.stringify(p)}`);
});
for (const kind of props) test(`${kind}: object is distinct, seeded, balanced, and fits declared sprite bounds`, () => {
  const value = object(kind), before = structuredClone(value), ctx = renderObject(value), bounds = decorationBounds2D(value);
  assert.deepEqual(ctx.trace, renderObject(value).trace); assert.deepEqual(value, before); assert.ok(ctx.trace.some(op => op[0] === 'fill'), 'every prop must paint its silhouette');
  for (const p of ctx.points) assert.ok(p.x >= bounds.left - .012 && p.x <= bounds.right + .012 && p.y >= bounds.top - .012 && p.y <= bounds.bottom + .012, `${kind} clipped at ${JSON.stringify(p)} ${JSON.stringify(bounds)}`);
});
test('all new sprites have different silhouettes/traces rather than only different names', () => {
  assert.equal(new Set(plants.map(kind => JSON.stringify(renderPlant(plant(kind)).trace))).size, plants.length);
  assert.equal(new Set(props.map(kind => JSON.stringify(renderObject(object(kind)).trace))).size, props.length);
});
test('floating fairy and sky ornaments never gain a flat catalog floor shadow', () => {
  for (const kind of ['fairy', 'sun', 'moon', 'star'] as const) {
    const expected = renderObject(object(kind)), actual = new ArtCanvas(); drawDecoration(actual.context, object(kind), 0, 0, 1); actual.assertBalanced(); assert.deepEqual(actual.trace, expected.trace);
  }
});
test('birch is truly straight and tonal variants visibly differ while old natural forms remain unchanged', () => {
  const form = { length: 1.6, angle: -16, bend: 0, branches: [{ at: .3, length: .22, angle: -58 }] };
  const birch = { ...form, tone: 'birch' as const }, paths = woodGeometry2D(birch).paths, main = paths.at(-1)!;
  for (let i = 0; i <= 30; i++) { const t = i / 30, p = woodPathPoint2D(main, t); assert.ok(Math.hypot(p.x - (main.a.x + (main.d.x - main.a.x) * t), p.y - (main.a.y + (main.d.y - main.a.y) * t)) < 1e-12); }
  const old = renderObject(object('wood', { wood: form }));
  assert.deepEqual(old.trace, renderObject(object('wood', { wood: { ...form, tone: 'natural' } })).trace);
  assert.notDeepEqual(old.trace, renderObject(object('wood', { wood: birch })).trace);
  assert.notDeepEqual(old.trace, renderObject(object('wood', { wood: { ...form, tone: 'charred' } })).trace);
});
