import assert from 'node:assert/strict';
import test from 'node:test';
import type { Decoration, DecorationKind, Plant, PlantKind } from '../shared/types';
import { decorationBounds2D, drawDecoration, drawPlant, getDecorationExtent, getPlantExtent } from './scene-botany';
import { WOOD_PRESETS, woodPresetForm } from '../shared/catalog';
import type { BotanicalExtent } from './scene-botany';

// This records the Canvas API contract, not pixels, appearance or botanical accuracy.
// An explicit small API surface makes newly used, unsupported drawing methods fail.
type Argument = string | number | boolean;
interface Operation { method: string; args: Argument[] }
type Style = string | RecordedGradient;
interface CanvasState {
  fillStyle: Style; strokeStyle: Style; lineWidth: number; lineCap: string; lineJoin: string;
}

class RecordedGradient {
  constructor(readonly id: number, private readonly canvas: RecordingCanvas) {}
  addColorStop(offset: number, color: string): void { this.canvas.record('addColorStop', this.id, offset, color); }
}

class RecordingCanvas {
  readonly operations: Operation[] = [];
  readonly stack: CanvasState[] = [];
  minimumStackDepth = 0;
  private gradientCount = 0;
  private state: CanvasState = {
    fillStyle: '#010203', strokeStyle: '#040506', lineWidth: 7, lineCap: 'butt', lineJoin: 'miter',
  };

  asContext(): CanvasRenderingContext2D { return this as unknown as CanvasRenderingContext2D; }
  currentState(): CanvasState { return { ...this.state }; }
  record(method: string, ...args: Argument[]): void {
    for (const value of args) {
      if (typeof value === 'number') assert.ok(Number.isFinite(value), `${method} received a non-finite number`);
    }
    this.operations.push({ method, args });
  }
  private setStyle(name: 'fillStyle' | 'strokeStyle', value: Style): void {
    this.state[name] = value;
    this.record(`set-${name}`, typeof value === 'string' ? value : `gradient:${value.id}`);
  }
  set fillStyle(value: Style) { this.setStyle('fillStyle', value); }
  get fillStyle(): Style { return this.state.fillStyle; }
  set strokeStyle(value: Style) { this.setStyle('strokeStyle', value); }
  get strokeStyle(): Style { return this.state.strokeStyle; }
  set lineWidth(value: number) { this.state.lineWidth = value; this.record('set-lineWidth', value); }
  get lineWidth(): number { return this.state.lineWidth; }
  set lineCap(value: string) { this.state.lineCap = value; this.record('set-lineCap', value); }
  get lineCap(): string { return this.state.lineCap; }
  set lineJoin(value: string) { this.state.lineJoin = value; this.record('set-lineJoin', value); }
  get lineJoin(): string { return this.state.lineJoin; }

  save(): void { this.stack.push(this.currentState()); this.record('save'); }
  restore(): void {
    this.minimumStackDepth = Math.min(this.minimumStackDepth, this.stack.length - 1);
    const restored = this.stack.pop();
    assert.ok(restored, 'Canvas restore must have a preceding save');
    this.state = restored;
    this.record('restore');
  }
  translate(x: number, y: number): void { this.record('translate', x, y); }
  scale(x: number, y: number): void { this.record('scale', x, y); }
  rotate(angle: number): void { this.record('rotate', angle); }
  beginPath(): void { this.record('beginPath'); }
  closePath(): void { this.record('closePath'); }
  moveTo(x: number, y: number): void { this.record('moveTo', x, y); }
  lineTo(x: number, y: number): void { this.record('lineTo', x, y); }
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
  arc(x: number, y: number, radius: number, start: number, end: number, anticlockwise = false): void {
    assert.ok(radius >= 0, 'arc radius must not be negative');
    this.record('arc', x, y, radius, start, end, anticlockwise);
  }
  fill(): void { this.record('fill'); }
  stroke(): void { this.record('stroke'); }
  clip(): void { this.record('clip'); }
  fillRect(x: number, y: number, width: number, height: number): void { this.record('fillRect', x, y, width, height); }
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

const plantKinds: PlantKind[] = ['cushion-moss', 'sheet-moss', 'fern', 'fittonia', 'amber-mushroom', 'ivory-mushroom'];
const decorationKinds: DecorationKind[] = ['stone', 'wood', 'stump', 'pavilion', 'statue', 'traveler', 'cottage', 'lantern', 'steps', 'path'];
function plant(kind: PlantKind, overrides: Partial<Plant> = {}): Plant {
  return { id: `recorded-${kind}`, kind, x: 0.5, y: 0.7, scale: 1, growth: 0.65, health: 0.85, ageDays: 3, wetness: 0, ...overrides };
}
function decoration(kind: DecorationKind): Decoration {
  return { id: `recorded-${kind}`, kind, x: 0.5, y: 0.7, scale: 1 };
}
function renderPlant(value: Plant): RecordingCanvas {
  const canvas = new RecordingCanvas();
  drawPlant(canvas.asContext(), value, 120, 340, 150);
  return canvas;
}
function renderDecoration(value: Decoration): RecordingCanvas {
  const canvas = new RecordingCanvas();
  drawDecoration(canvas.asContext(), value, 120, 340, 150);
  return canvas;
}
function isColor(operation: Operation): boolean {
  return operation.method === 'set-fillStyle' || operation.method === 'set-strokeStyle' || operation.method === 'addColorStop';
}
function geometry(canvas: RecordingCanvas): Operation[] { return canvas.operations.filter((operation) => !isColor(operation)); }
function colors(canvas: RecordingCanvas): Operation[] { return canvas.operations.filter(isColor); }
function paintCount(canvas: RecordingCanvas): number {
  return canvas.operations.filter((operation) => operation.method === 'fill' || operation.method === 'stroke').length;
}
function assertBalanced(canvas: RecordingCanvas, initial: CanvasState): void {
  assert.equal(canvas.stack.length, 0);
  assert.equal(canvas.minimumStackDepth, 0);
  assert.deepEqual(canvas.currentState(), initial, 'drawing must leave the caller styles intact');
  assert.equal(canvas.operations.filter((operation) => operation.method === 'save').length,
    canvas.operations.filter((operation) => operation.method === 'restore').length);
}
function assertRootExtent(extent: BotanicalExtent): void {
  for (const coordinate of Object.values(extent)) assert.ok(Number.isFinite(coordinate));
  assert.ok(extent.left < 0 && extent.right > 0, 'signed horizontal bounds must bracket the ground anchor');
  assert.ok(extent.top < 0 && extent.bottom >= 0, 'signed vertical bounds must bracket the ground anchor');
  assert.ok(extent.right - extent.left >= 0.2 && extent.right - extent.left <= 2, 'width must be reasonable relative to unit');
  assert.ok(extent.bottom - extent.top >= 0.1 && extent.bottom - extent.top <= 2, 'height must be reasonable relative to unit');
}

for (const kind of plantKinds) {
  test(`${kind}: repeated drawing is deterministic, including cached moss geometry`, () => {
    const value = plant(kind);
    const original = structuredClone(value);
    const first = renderPlant(value);
    const second = renderPlant(value);
    assert.deepEqual(first.operations, second.operations);
    assert.ok(paintCount(first) > 0);
    assert.deepEqual(value, original, 'drawing must not mutate authoritative plant data');
  });

  test(`${kind}: growth changes geometry and increases drawn foliage`, () => {
    const juvenile = renderPlant(plant(kind, { growth: 0.05 }));
    const mature = renderPlant(plant(kind, { growth: 1 }));
    assert.notDeepEqual(geometry(juvenile), geometry(mature));
    assert.ok(paintCount(mature) > paintCount(juvenile), 'mature plants must draw more foliage, not only change a label');
  });

  test(`${kind}: severe ill health visibly changes color and shrivels the seeded plant`, () => {
    const stressed = renderPlant(plant(kind, { health: 0 }));
    const healthy = renderPlant(plant(kind, { health: 1 }));
    assert.notDeepEqual(colors(stressed), colors(healthy));
    assert.notDeepEqual(geometry(stressed), geometry(healthy), 'stress must visibly wilt rather than only recolor');
    assert.deepEqual(stressed.operations, renderPlant(plant(kind, { health: 0 })).operations, 'wilting stays deterministic');
  });

  test(`${kind}: wetness visibly adds refractive beads as well as changing colors`, () => {
    const dry = renderPlant(plant(kind, { wetness: 0 }));
    const wet = renderPlant(plant(kind, { wetness: 0.75 }));
    assert.notDeepEqual(colors(dry), colors(wet));
    assert.notDeepEqual(geometry(dry), geometry(wet), 'wet feedback must include drawn details, not only color changes');
    assert.ok(paintCount(wet) > paintCount(dry));
    const glint = (operation: Operation): boolean => operation.method === 'set-fillStyle'
      && operation.args.some((value) => typeof value === 'string' && value.startsWith('rgba(247,255,250,'));
    assert.equal(dry.operations.some(glint), false);
    assert.equal(wet.operations.some(glint), true, 'wet surfaces must draw the bright water-bead highlight');
  });

  test(`${kind}: small doses already draw water highlights without mutating ecology data`, () => {
    const value = plant(kind, { wetness: 0.02 });
    const original = structuredClone(value);
    const canvas = renderPlant(value);
    assert.ok(canvas.operations.some((operation) => operation.method === 'set-fillStyle'
      && operation.args.some((argument) => typeof argument === 'string' && argument.startsWith('rgba(247,255,250,'))));
    assert.deepEqual(value, original, 'visual wetness must not alter health, growth, wetness or other authoritative fields');
  });

  test(`${kind}: wet rendering remains seeded, finite and Canvas-balanced`, () => {
    for (const wetness of [0, 0.02, 0.5, 1]) {
      const value = plant(kind, { wetness });
      const first = renderPlant(value);
      const second = renderPlant(value);
      assert.deepEqual(first.operations, second.operations);
      assertBalanced(first, new RecordingCanvas().currentState());
      assertBalanced(second, new RecordingCanvas().currentState());
      for (const operation of first.operations) {
        for (const argument of operation.args) if (typeof argument === 'number') assert.ok(Number.isFinite(argument));
      }
    }
  });

  test(`${kind}: defensive wetness bounds neither create invalid geometry nor boost simulation`, () => {
    const dry = renderPlant(plant(kind, { wetness: 0 }));
    for (const wetness of [-1, NaN, Infinity, -Infinity]) {
      assert.deepEqual(renderPlant(plant(kind, { wetness })).operations, dry.operations);
    }
    assert.deepEqual(renderPlant(plant(kind, { wetness: 100 })).operations,
      renderPlant(plant(kind, { wetness: 1 })).operations);
  });

  test(`${kind}: growth/health boundary draws stay finite and preserve Canvas state`, () => {
    for (const growth of [0, 0.25, 1, 1.5]) {
      for (const health of [0, 1]) {
        const canvas = new RecordingCanvas();
        const initial = canvas.currentState();
        drawPlant(canvas.asContext(), plant(kind, { growth, health }), -120, 340, 150);
        assertBalanced(canvas, initial);
        assert.ok(canvas.operations.length > 0);
        for (const operation of canvas.operations) {
          for (const value of operation.args) if (typeof value === 'number') assert.ok(Number.isFinite(value));
        }
      }
    }
  });

  test(`${kind}: extent uses signed unit-relative bounds and returns a detached copy`, () => {
    const original = getPlantExtent(kind);
    assertRootExtent(original);
    const changed = getPlantExtent(kind);
    changed.left = -999;
    assert.deepEqual(getPlantExtent(kind), original);
  });
}

const ecology = { drought: 0, waterlogging: 0, spread: 0, cycle: .4, generation: 0 as const };
for (const kind of ['fern', 'fittonia'] as const) {
  test(`${kind}: drought curls and shrinks foliage without moving its planted crown; recovery restores it`, () => {
    const healthy = plant(kind, { health: .9, ecology }), original = renderPlant(healthy);
    const dry = renderPlant({ ...healthy, ecology: { ...ecology, drought: 1 } });
    assert.notDeepEqual(geometry(original), geometry(dry));
    assert.notDeepEqual(colors(original), colors(dry));
    assert.deepEqual(original.operations.find(op => op.method === 'translate'), dry.operations.find(op => op.method === 'translate'), 'root/world anchor must stay unchanged');
    assert.deepEqual(original.operations, renderPlant({ ...healthy, ecology: { ...ecology, drought: 0 } }).operations);
    assertBalanced(dry, new RecordingCanvas().currentState());
  });
}
test('established moss expands its actual drawn footprint substantially without changing user scale', () => {
  const source = plant('sheet-moss', { health: .9, growth: 1, ecology });
  const young = renderPlant(source), spread = renderPlant({ ...source, ecology: { ...ecology, spread: 1 } });
  const innerScale = (canvas: RecordingCanvas): number => Number(canvas.operations.filter(op => op.method === 'scale').at(-1)!.args[0]);
  assert.ok(innerScale(spread) / innerScale(young) > 1.7, 'ecological spread must expand the local carpet conspicuously');
  assert.equal(source.scale, 1);
});
test('mushroom flushes draw pins, full fruit, withering fruit and resting remnants independently of colony growth', () => {
  for (const kind of ['amber-mushroom', 'ivory-mushroom'] as const) {
    const stages = [.03, .4, .78, .94].map(cycle => renderPlant(plant(kind, { growth: 1, health: .9, ecology: { ...ecology, cycle } })));
    for (let i = 1; i < stages.length; i++) assert.notDeepEqual(geometry(stages[i - 1]), geometry(stages[i]));
    assert.ok(paintCount(stages[3]) < paintCount(stages[1]), 'resting colony is not the same permanent full mushroom bouquet');
    for (const stage of stages) assertBalanced(stage, new RecordingCanvas().currentState());
  }
});

for (const kind of decorationKinds) {
  test(`${kind}: repeated decoration drawing is deterministic, finite and balanced`, () => {
    const value = decoration(kind);
    const original = structuredClone(value);
    const first = new RecordingCanvas();
    const initial = first.currentState();
    drawDecoration(first.asContext(), value, 120, 340, 150);
    const second = renderDecoration(value);
    assert.deepEqual(first.operations, second.operations);
    assert.ok(paintCount(first) > 0);
    assertBalanced(first, initial);
    assertBalanced(second, initial);
    assert.deepEqual(value, original);
  });

  test(`${kind}: extent uses signed unit-relative bounds and returns a detached copy`, () => {
    const original = getDecorationExtent(kind);
    assertRootExtent(original);
    const changed = getDecorationExtent(kind);
    changed.top = -999;
    assert.deepEqual(getDecorationExtent(kind), original);
  });
}

test('very young plants show low-dose water beads across different seeded shapes', () => {
  for (const kind of plantKinds) {
    for (let seed = 0; seed < 12; seed += 1) {
      const canvas = renderPlant(plant(kind, { id: `young-wet-${seed}`, growth: 0, wetness: 0.02 }));
      assert.ok(canvas.operations.some((operation) => operation.method === 'set-fillStyle'
        && operation.args.some((argument) => typeof argument === 'string' && argument.startsWith('rgba(247,255,250,'))),
      `${kind} seed ${seed} must show a low-dose water bead rather than relying only on a subtle color change`);
      assertBalanced(canvas, new RecordingCanvas().currentState());
    }
  }
});

const invalidInputs: Array<{ label: string; x: number; y: number; unit: number }> = [
  { label: 'NaN x', x: NaN, y: 340, unit: 150 },
  { label: 'positive infinite x', x: Infinity, y: 340, unit: 150 },
  { label: 'negative infinite x', x: -Infinity, y: 340, unit: 150 },
  { label: 'NaN y', x: 120, y: NaN, unit: 150 },
  { label: 'positive infinite y', x: 120, y: Infinity, unit: 150 },
  { label: 'negative infinite y', x: 120, y: -Infinity, unit: 150 },
  { label: 'NaN unit', x: 120, y: 340, unit: NaN },
  { label: 'positive infinite unit', x: 120, y: 340, unit: Infinity },
  { label: 'negative infinite unit', x: 120, y: 340, unit: -Infinity },
  { label: 'zero unit', x: 120, y: 340, unit: 0 },
  { label: 'negative unit', x: 120, y: 340, unit: -150 },
];

test('invalid units and coordinates are no-ops for every plant and decoration', () => {
  for (const input of invalidInputs) {
    for (const kind of plantKinds) {
      const canvas = new RecordingCanvas();
      const initial = canvas.currentState();
      drawPlant(canvas.asContext(), plant(kind), input.x, input.y, input.unit);
      assert.deepEqual(canvas.operations, [], `${kind}: ${input.label}`);
      assertBalanced(canvas, initial);
    }
    for (const kind of decorationKinds) {
      const canvas = new RecordingCanvas();
      const initial = canvas.currentState();
      drawDecoration(canvas.asContext(), decoration(kind), input.x, input.y, input.unit);
      assert.deepEqual(canvas.operations, [], `${kind}: ${input.label}`);
      assertBalanced(canvas, initial);
    }
  }
});

test('object scale is applied once internally and excessive finite units are bounded', () => {
  for (const kind of plantKinds) {
    const canvas = new RecordingCanvas();
    drawPlant(canvas.asContext(), plant(kind, { scale: 1.5 }), 120, 340, 150);
    assert.deepEqual(canvas.operations.find((operation) => operation.method === 'scale')?.args, [225, 225]);
  }
  for (const kind of decorationKinds) {
    const canvas = new RecordingCanvas();
    drawDecoration(canvas.asContext(), { ...decoration(kind), scale: 1.5 }, 120, 340, 150);
    assert.deepEqual(canvas.operations.find((operation) => operation.method === 'scale')?.args, [225, 225]);
  }
  const canvas = new RecordingCanvas();
  drawPlant(canvas.asContext(), plant('fern', { scale: 10 }), 120, 340, Number.MAX_VALUE);
  assert.deepEqual(canvas.operations.find((operation) => operation.method === 'scale')?.args, [5000, 5000]);
  assertBalanced(canvas, new RecordingCanvas().currentState());
});

test('edited driftwood paints its exact bounded stick and branch graph with repeatable finite strokes', () => {
  for (const angle of [-160, -90, 0, 90, 160]) for (const length of [.5, 2]) for (const count of [0, 1, 3]) {
    const value: Decoration = { ...decoration('wood'), wood: { length, angle, branches: Array.from({ length: count }, (_, i) => ({ at: .2 + i * .325, length: i % 2 ? .2 : .8, angle: i % 2 ? 80 : -80 })) } }, original = structuredClone(value);
    const first = renderDecoration(value), second = renderDecoration(value); assert.deepEqual(first.operations, second.operations); assert.deepEqual(value, original); assertBalanced(first, new RecordingCanvas().currentState()); assert(paintCount(first) > 0);
  }
  const stick = renderDecoration({ ...decoration('wood'), wood: { length: 1, angle: 0, branches: [] } });
  const fork = renderDecoration({ ...decoration('wood'), wood: { length: 1, angle: 0, branches: [{ at: .5, length: .6, angle: -65 }] } });
  assert(paintCount(fork) > paintCount(stick)); assert.notDeepEqual(geometry(stick), geometry(fork));
});

test('terrain-contact sprites can omit the flat catalog shadow without removing object art', () => {
  const hasGroundShadow = (canvas: RecordingCanvas): boolean => canvas.operations.some(operation => operation.method === 'addColorStop' && operation.args.includes('rgba(15,25,14,.36)'));
  for (const kind of plantKinds) {
    const withShadow = renderPlant(plant(kind)), scene = new RecordingCanvas();
    drawPlant(scene.asContext(), plant(kind), 120, 340, 150, { groundShadow: false });
    assert(hasGroundShadow(withShadow), `${kind} catalog preview keeps its intentional local shadow`);
    assert.equal(hasGroundShadow(scene), false, `${kind} contact extension must not leave an airborne flat shadow`);
    assert(paintCount(scene) > 0); assertBalanced(scene, new RecordingCanvas().currentState());
  }
  for (const kind of decorationKinds) {
    const withShadow = renderDecoration(decoration(kind)), scene = new RecordingCanvas();
    drawDecoration(scene.asContext(), decoration(kind), 120, 340, 150, { groundShadow: false });
    assert(hasGroundShadow(withShadow)); assert.equal(hasGroundShadow(scene), false);
    assert(paintCount(scene) > 0); assertBalanced(scene, new RecordingCanvas().currentState());
  }
});

test('four stone variants and both trunk volumes have genuinely distinct repeatable drawing', () => {
  const stones = ['boulder', 'flat', 'spire', 'pebbles'] as const, stumps = ['upright', 'fallen'] as const;
  for (const [kind, variants] of [['stone', stones], ['stump', stumps]] as const) {
    const drawings = variants.map(variant => { const item: Decoration = {...decoration(kind),variant}, first=renderDecoration(item); assert.deepEqual(first.operations,renderDecoration(item).operations);assertBalanced(first,new RecordingCanvas().currentState());return JSON.stringify(geometry(first)); });
    assert.equal(new Set(drawings).size, variants.length);
  }
  assert(decorationBounds2D({...decoration('stone'),variant:'spire'}).top < -.7);
  assert(decorationBounds2D({...decoration('stump'),variant:'fallen'}).right > .6);
});

test('wood pose rotates and flips the entire saved form, without changing authored branches', () => {
  for(const preset of WOOD_PRESETS)for(const angle of[-180,-90,37,180])for(const flipX of[false,true]){
    const value:Decoration={...decoration('wood'),wood:woodPresetForm(preset.id),pose:{angle,flipX}},before=structuredClone(value),canvas=renderDecoration(value),bounds=decorationBounds2D(value);
    assert(canvas.operations.some(op=>op.method==='rotate'&&op.args[0]===angle*Math.PI/180));
    assert(canvas.operations.some(op=>op.method==='scale'&&op.args[0]===(flipX?-1:1)&&op.args[1]===1));
    assert(Object.values(bounds).every(Number.isFinite));assert(bounds.right>bounds.left&&bounds.bottom>bounds.top);assert.deepEqual(value,before);assertBalanced(canvas,new RecordingCanvas().currentState());
  }
});
