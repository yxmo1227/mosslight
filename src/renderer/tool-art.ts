import type { MaterialKind } from '../shared/types';

export type ToolArtKind = 'sun' | 'spray' | 'scoop' | 'water' | 'drain' | MaterialKind;

type Paint = string | CanvasGradient;
type Stops = readonly (readonly [number, string])[];
type Point = readonly [number, number];

const MATERIAL_SEEDS: Record<MaterialKind, number> = {
  soil: 0x71ce82a9, clay: 0x945bed12, gravel: 0x83e5aa6b,
  coir: 0x543c19d7, bark: 0x19cdeabc, charcoal: 0x27be0421,
};
const MATERIAL_BASES: Record<MaterialKind, readonly [string, string, string]> = {
  soil: ['#796048', '#69513c', '#594432'],
  clay: ['#b58b61', '#a57b53', '#8b6647'],
  gravel: ['#a2ac94', '#909c85', '#7d8b75'],
  coir: ['#b79a68', '#a28657', '#8e754d'],
  bark: ['#966f4e', '#855d40', '#734c34'],
  charcoal: ['#596256', '#4b564a', '#3c473d'],
};

/** A small fixed-seed generator keeps the original texture stable between frames. */
function seeded(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(value ^ (value >>> 15), 1 | value);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

function linear(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, stops: Stops): CanvasGradient {
  const paint = ctx.createLinearGradient(x0, y0, x1, y1);
  for (const [offset, color] of stops) paint.addColorStop(offset, color);
  return paint;
}

function radial(ctx: CanvasRenderingContext2D, x: number, y: number, inner: number, outer: number, stops: Stops): CanvasGradient {
  const paint = ctx.createRadialGradient(x, y, inner, x, y, outer);
  for (const [offset, color] of stops) paint.addColorStop(offset, color);
  return paint;
}

function ellipse(x: number, y: number, rx: number, ry: number, angle = 0): Path2D {
  const path = new Path2D();
  path.ellipse(x, y, rx, ry, angle, 0, Math.PI * 2);
  return path;
}

function polygon(points: readonly Point[]): Path2D {
  const path = new Path2D();
  if (points.length === 0) return path;
  path.moveTo(points[0][0], points[0][1]);
  for (let index = 1; index < points.length; index += 1) path.lineTo(points[index][0], points[index][1]);
  path.closePath();
  return path;
}

function fill(ctx: CanvasRenderingContext2D, path: Path2D, paint: Paint): void {
  ctx.fillStyle = paint;
  ctx.fill(path);
}

function stroke(ctx: CanvasRenderingContext2D, path: Path2D, paint: Paint, width: number): void {
  ctx.strokeStyle = paint;
  ctx.lineWidth = width;
  ctx.stroke(path);
}

function line(ctx: CanvasRenderingContext2D, points: readonly Point[], paint: Paint, width: number): void {
  if (points.length < 2) return;
  const path = new Path2D();
  path.moveTo(points[0][0], points[0][1]);
  for (let index = 1; index < points.length; index += 1) path.lineTo(points[index][0], points[index][1]);
  stroke(ctx, path, paint, width);
}

function withState(ctx: CanvasRenderingContext2D, draw: () => void): void {
  ctx.save();
  try { draw(); } finally { ctx.restore(); }
}

function groundShadow(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number): void {
  fill(ctx, ellipse(x, y, rx, ry), radial(ctx, x, y, 0, rx, [
    [0, 'rgba(22,37,29,0.19)'], [0.5, 'rgba(22,37,29,0.09)'], [1, 'rgba(22,37,29,0)'],
  ]));
}

function drawSun(ctx: CanvasRenderingContext2D): void {
  fill(ctx, ellipse(50, 49, 45, 45), radial(ctx, 50, 49, 0, 45, [
    [0, 'rgba(255,199,68,0.34)'], [0.57, 'rgba(255,211,95,0.15)'], [1, 'rgba(255,218,121,0)'],
  ]));
  for (let index = 0; index < 12; index += 1) {
    const angle = index * Math.PI / 6 - Math.PI / 12;
    const radius = index % 2 === 0 ? 33 : 32;
    const length = index % 2 === 0 ? 6.8 : 4.8;
    const x0 = 50 + Math.cos(angle) * radius;
    const y0 = 49 + Math.sin(angle) * radius;
    const x1 = 50 + Math.cos(angle) * (radius + length);
    const y1 = 49 + Math.sin(angle) * (radius + length);
    line(ctx, [[x0, y0], [x1, y1]], linear(ctx, x0, y0, x1, y1, [
      [0, 'rgba(238,171,36,0.78)'], [1, 'rgba(247,196,88,0.21)'],
    ]), index % 2 === 0 ? 2.25 : 1.75);
  }
  const globe = ellipse(50, 49, 25, 25);
  fill(ctx, globe, linear(ctx, 33, 29, 68, 69, [
    [0, '#fff4ba'], [0.25, '#ffe181'], [0.56, '#f6bd43'], [0.84, '#d78b25'], [1, '#bd721b'],
  ]));
  fill(ctx, globe, radial(ctx, 41, 39, 1, 34, [
    [0, 'rgba(255,252,218,0.65)'], [0.48, 'rgba(255,237,160,0.12)'], [1, 'rgba(179,91,17,0.24)'],
  ]));
  stroke(ctx, globe, 'rgba(181,113,29,0.23)', 0.8);
  const highlight = new Path2D();
  highlight.moveTo(32, 44);
  highlight.bezierCurveTo(33, 35, 41, 29, 51, 29);
  stroke(ctx, highlight, 'rgba(255,253,219,0.68)', 1.45);
  const rim = new Path2D();
  rim.moveTo(42, 72);
  rim.bezierCurveTo(55, 76, 69, 66, 73, 54);
  stroke(ctx, rim, 'rgba(241,181,62,0.43)', 1.3);
  fill(ctx, ellipse(41, 36, 3.8, 2, -0.6), 'rgba(255,255,223,0.29)');
}

function sprayBody(): Path2D {
  const path = new Path2D();
  path.moveTo(45, 37);
  path.lineTo(58, 37);
  path.bezierCurveTo(58, 45, 64, 47, 69, 52);
  path.bezierCurveTo(73, 58, 74, 78, 71, 85);
  path.bezierCurveTo(68, 92, 40, 93, 35, 85);
  path.bezierCurveTo(31, 77, 33, 59, 37, 52);
  path.bezierCurveTo(41, 47, 45, 44, 45, 37);
  path.closePath();
  return path;
}

function drawSpray(ctx: CanvasRenderingContext2D): void {
  withState(ctx, () => {
  ctx.translate(50, 50);
  ctx.rotate(-0.1);
  ctx.translate(-50, -50);
  const body = sprayBody();
  fill(ctx, body, linear(ctx, 33, 60, 75, 67, [
    [0, 'rgba(63,112,80,0.64)'], [0.2, 'rgba(196,219,165,0.72)'],
    [0.49, 'rgba(138,178,108,0.39)'], [0.81, 'rgba(68,112,62,0.63)'], [1, 'rgba(37,74,50,0.76)'],
  ]));
  withState(ctx, () => {
  ctx.clip(body);
  const liquid = new Path2D();
  liquid.moveTo(28, 63);
  liquid.bezierCurveTo(42, 59, 59, 66, 80, 61);
  liquid.lineTo(80, 95);
  liquid.lineTo(28, 95);
  liquid.closePath();
  fill(ctx, liquid, linear(ctx, 34, 61, 72, 88, [
    [0, 'rgba(181,202,107,0.82)'], [0.3, 'rgba(118,151,75,0.69)'], [1, 'rgba(44,87,58,0.94)'],
  ]));
  const surface = new Path2D();
  surface.moveTo(30, 63);
  surface.bezierCurveTo(43, 59, 62, 66, 78, 62);
  stroke(ctx, surface, 'rgba(229,243,176,0.58)', 1.25);
  for (const [x, y, r] of [[41, 70, 1.05], [62, 76, 0.85], [46, 80, 0.6], [66, 66, 0.65]]) {
    stroke(ctx, ellipse(x, y, r, r), 'rgba(217,235,177,0.27)', 0.6);
  }
  fill(ctx, ellipse(54, 87, 19, 4), 'rgba(26,65,47,0.3)');
  });
  stroke(ctx, body, 'rgba(47,83,63,0.71)', 1.15);
  const leftGlint = new Path2D();
  leftGlint.moveTo(43, 50);
  leftGlint.bezierCurveTo(37, 56, 36, 72, 39, 83);
  stroke(ctx, leftGlint, 'rgba(255,255,226,0.61)', 2.2);
  const fineGlint = new Path2D();
  fineGlint.moveTo(67, 56);
  fineGlint.bezierCurveTo(70, 63, 70, 74, 68, 82);
  stroke(ctx, fineGlint, 'rgba(214,235,190,0.47)', 0.85);
  fill(ctx, ellipse(54, 87, 17.5, 1.8), 'rgba(199,219,147,0.25)');

  const collar = polygon([[43.5, 33], [59.5, 33], [60, 40], [43, 40]]);
  fill(ctx, collar, linear(ctx, 43, 36, 60, 36, [
    [0, '#365448'], [0.27, '#8f9c73'], [0.51, '#c3c7a4'], [0.75, '#687950'], [1, '#2f4c3e'],
  ]));
  line(ctx, [[44, 38.2], [59, 38.2]], 'rgba(35,57,39,0.5)', 0.8);
  for (let x = 46; x < 59; x += 2.6) line(ctx, [[x, 34], [x, 37]], 'rgba(46,69,45,0.25)', 0.55);

  const head = new Path2D();
  head.moveTo(29, 22);
  head.lineTo(51, 21);
  head.bezierCurveTo(59, 21, 64, 24, 66, 29);
  head.lineTo(60, 32);
  head.lineTo(46, 32);
  head.lineTo(43, 28);
  head.lineTo(29, 28);
  head.closePath();
  fill(ctx, head, linear(ctx, 36, 21, 55, 33, [
    [0, '#d0d3b9'], [0.23, '#97a79a'], [0.52, '#526c61'], [0.77, '#284c40'], [1, '#183c31'],
  ]));
  stroke(ctx, head, 'rgba(27,53,43,0.7)', 0.8);
  line(ctx, [[31, 22.5], [50, 22]], 'rgba(245,247,216,0.68)', 1.1);
  fill(ctx, polygon([[23, 22.2], [30.5, 22.2], [30.5, 29], [23, 29]]), linear(ctx, 23, 23, 31, 29, [
    [0, '#e3ded0'], [0.4, '#97a69e'], [0.75, '#526a61'], [1, '#d0d5c4'],
  ]));
  fill(ctx, ellipse(23, 25.6, 1.7, 3.5), '#485a51');
  fill(ctx, ellipse(22.7, 25.6, 0.62, 1.6), '#1b3028');
  line(ctx, [[25.5, 23], [25.5, 28]], 'rgba(244,243,223,0.65)', 0.65);

  const trigger = new Path2D();
  trigger.moveTo(43, 29);
  trigger.bezierCurveTo(42, 34, 37, 42, 36, 46);
  trigger.bezierCurveTo(36, 48, 39, 49, 40, 46);
  trigger.bezierCurveTo(43, 41, 47, 35, 47, 31);
  trigger.closePath();
  fill(ctx, trigger, linear(ctx, 37, 34, 46, 42, [
    [0, '#c6cdbe'], [0.34, '#8c9b87'], [0.7, '#405b4e'], [1, '#263f33'],
  ]));
  const triggerGlint = new Path2D();
  triggerGlint.moveTo(43, 32);
  triggerGlint.bezierCurveTo(42, 37, 38, 42, 38, 46);
  stroke(ctx, triggerGlint, 'rgba(242,244,220,0.55)', 0.75);

  });
}

function drawScoop(ctx: CanvasRenderingContext2D): void {
  groundShadow(ctx, 46, 90, 32, 4.5);
  const shaft = polygon([[42, 66], [47, 70], [74, 30], [69, 26]]);
  fill(ctx, shaft, linear(ctx, 46, 57, 52, 61, [
    [0, '#64736c'], [0.22, '#e2e3cf'], [0.46, '#b2bcb1'], [1, '#485e54'],
  ]));
  stroke(ctx, shaft, 'rgba(53,69,56,0.39)', 0.65);

  const handle = new Path2D();
  handle.moveTo(57, 42);
  handle.bezierCurveTo(58, 38, 66, 21, 71, 15);
  handle.bezierCurveTo(75, 11, 84, 17, 83, 22);
  handle.bezierCurveTo(81, 29, 70, 44, 66, 48);
  handle.bezierCurveTo(63, 51, 56, 46, 57, 42);
  handle.closePath();
  fill(ctx, handle, linear(ctx, 60, 32, 76, 40, [
    [0, '#d7b383'], [0.24, '#bf925b'], [0.47, '#e4c399'], [0.76, '#a97643'], [1, '#78522e'],
  ]));
  stroke(ctx, handle, '#87623e', 0.85);
  withState(ctx, () => {
  ctx.clip(handle);
  for (let index = 0; index < 6; index += 1) {
    const grain = new Path2D();
    grain.moveTo(64 + index * 2, 11);
    grain.bezierCurveTo(78 + index * 1.1, 20, 60 + index * 2.5, 34, 59 + index * 2, 52);
    stroke(ctx, grain, index % 2 === 0 ? 'rgba(114,75,36,0.28)' : 'rgba(251,224,184,0.27)', 0.65);
  }
  });
  const handleGlint = new Path2D();
  handleGlint.moveTo(73, 16);
  handleGlint.bezierCurveTo(69, 21, 63, 34, 61, 40);
  stroke(ctx, handleGlint, 'rgba(255,231,191,0.6)', 1.05);
  fill(ctx, ellipse(76.7, 20.7, 1.9, 2.5, 0.5), '#725632');
  stroke(ctx, ellipse(76.7, 20.7, 1.9, 2.5, 0.5), 'rgba(248,212,157,0.53)', 0.65);

  const socket = polygon([[42, 57], [49, 61.5], [45.5, 69], [38.3, 64]]);
  fill(ctx, socket, linear(ctx, 40, 61, 48, 66, [
    [0, '#66776d'], [0.42, '#d5dcce'], [0.64, '#a4b4a8'], [1, '#425b50'],
  ]));
  const blade = new Path2D();
  blade.moveTo(38, 60);
  blade.bezierCurveTo(33, 57, 20, 62, 18, 66);
  blade.bezierCurveTo(18, 75, 22, 87, 28, 92);
  blade.bezierCurveTo(38, 91, 50, 86, 56, 79);
  blade.bezierCurveTo(57, 74, 47, 66, 42, 63);
  blade.quadraticCurveTo(40, 63, 38, 60);
  blade.closePath();
  fill(ctx, blade, linear(ctx, 23, 63, 50, 88, [
    [0, '#8fa097'], [0.21, '#d7ddcf'], [0.42, '#bcc9bd'], [0.57, '#f0efda'], [0.75, '#7e9789'], [1, '#3e5d50'],
  ]));
  stroke(ctx, blade, 'rgba(53,77,61,0.77)', 0.9);
  const trough = new Path2D();
  trough.moveTo(39, 64);
  trough.bezierCurveTo(36, 70, 28, 79, 28, 88);
  trough.bezierCurveTo(35, 86, 44, 81, 49, 77);
  trough.bezierCurveTo(47, 73, 43, 69, 39, 64);
  fill(ctx, trough, linear(ctx, 31, 67, 43, 82, [
    [0, 'rgba(70,100,82,0.14)'], [0.5, 'rgba(66,95,81,0.24)'], [1, 'rgba(232,235,206,0.08)'],
  ]));
  const ridge = new Path2D();
  ridge.moveTo(41, 65);
  ridge.bezierCurveTo(37, 72, 31, 81, 29, 88);
  stroke(ctx, ridge, 'rgba(252,251,225,0.66)', 1.25);
  const edge = new Path2D();
  edge.moveTo(20, 69);
  edge.bezierCurveTo(20, 76, 23, 86, 28, 90);
  edge.bezierCurveTo(38, 89, 48, 83, 54, 78);
  stroke(ctx, edge, 'rgba(235,238,211,0.78)', 1.2);
  line(ctx, [[28, 68], [26, 75]], 'rgba(89,117,99,0.29)', 0.6);
  line(ctx, [[43, 78], [39, 81]], 'rgba(78,108,91,0.28)', 0.6);
}

function cupBody(): Path2D {
  const path = new Path2D();
  path.moveTo(21, 33);
  path.bezierCurveTo(21, 43, 24, 72, 26, 82);
  path.bezierCurveTo(29, 92, 71, 92, 74, 82);
  path.bezierCurveTo(76, 72, 79, 43, 79, 33);
  path.bezierCurveTo(79, 27, 21, 27, 21, 33);
  path.closePath();
  return path;
}

function fillSubstrate(ctx: CanvasRenderingContext2D, kind: MaterialKind): void {
  const colors = MATERIAL_BASES[kind];
  const contents = new Path2D();
  contents.moveTo(22, 51);
  contents.bezierCurveTo(34, 45, 64, 44, 78, 52);
  contents.lineTo(76, 87);
  contents.quadraticCurveTo(50, 96, 24, 87);
  contents.closePath();
  fill(ctx, contents, linear(ctx, 32, 48, 70, 90, [[0, colors[0]], [0.47, colors[1]], [1, colors[2]]]));
  fill(ctx, ellipse(50, 51.3, 27, 6.6), linear(ctx, 28, 47, 67, 58, [
    [0, colors[0]], [0.62, colors[1]], [1, colors[2]],
  ]));
}

function rockyGrain(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, angle: number, kind: 'gravel' | 'charcoal', random: () => number): void {
  if (kind === 'charcoal') {
    withState(ctx, () => {
      ctx.translate(x, y); ctx.rotate(angle);
      const stick = polygon([[-radius * 1.5, -radius * .3], [-radius, -radius * .45], [radius * 1.38, -radius * .27], [radius * 1.52, radius * .21], [radius * .94, radius * .45], [-radius * 1.3, radius * .3]]);
      fill(ctx, stick, random() > .5 ? '#4f5a4c' : '#465141');
      stroke(ctx, stick, 'rgba(37,49,34,0.3)', .4);
      line(ctx, [[-radius * 1.23, -radius * .12], [-radius * .35, -radius * .22], [radius * .15, -radius * .12], [radius * 1.15, -radius * .1]], 'rgba(114,125,100,.24)', .5);
    });
    return;
  }
  const points: Point[] = [];
  for (let corner = 0; corner < 6; corner += 1) {
    const theta = angle + corner * Math.PI / 3;
    const length = radius * (0.65 + random() * 0.35);
    points.push([x + Math.cos(theta) * length, y + Math.sin(theta) * length * 0.74]);
  }
  const shade = random();
  const grain = polygon(points);
  fill(ctx, grain, shade > .6 ? '#a5ad94' : shade > .25 ? '#939e84' : '#818f79');
  stroke(ctx, grain, 'rgba(65,83,56,0.24)', 0.42);
}

function clayGrain(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, angle: number, random: () => number): void {
  const ball = ellipse(x, y, radius, radius * (0.75 + random() * 0.12), angle);
  fill(ctx, ball, random() > .5 ? '#b28a5f' : '#a47c54');
  stroke(ctx, ball, 'rgba(113,79,46,0.25)', 0.42);
  for (let pore = 0; pore < 3; pore += 1) {
    const px = x + (random() - 0.5) * radius;
    const py = y + (random() - 0.4) * radius * 0.7;
    fill(ctx, ellipse(px, py, 0.3 + random() * 0.32, 0.27), 'rgba(110,75,43,0.22)');
  }
}

function barkGrain(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, angle: number, random: () => number): void {
  withState(ctx, () => {
  ctx.translate(x, y);
  ctx.rotate(angle);
  const width = radius * (0.56 + random() * 0.25);
  const grain = polygon([[-radius, -width * 0.6], [-radius * 0.15, -width], [radius * 0.75, -width * 0.75], [radius, width * 0.22], [radius * 0.3, width], [-radius * 0.7, width * 0.7]]);
  fill(ctx, grain, random() > .5 ? '#936b47' : '#815b3e');
  stroke(ctx, grain, 'rgba(77,51,32,0.25)', 0.5);
  line(ctx, [[-radius * 0.82, -width * 0.3], [-radius * 0.1, -width * 0.4], [radius * 0.62, -width * 0.18]], 'rgba(183,145,98,0.36)', 0.65);
  line(ctx, [[-radius * 0.68, width * 0.12], [-radius * 0.25, width * 0.32], [radius * 0.6, width * 0.21]], 'rgba(68,47,30,0.33)', 0.6);
  });
}

function coirFiber(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, angle: number, random: () => number): void {
  const dx = Math.cos(angle) * radius;
  const dy = Math.sin(angle) * radius * 0.65;
  const bend = (random() - 0.5) * radius;
  const fiber = new Path2D();
  fiber.moveTo(x - dx, y - dy);
  fiber.bezierCurveTo(x - dx * 0.33 - dy * 0.2, y - dy * 0.3 + bend, x + dx * 0.4 + dy * 0.2, y + dy * 0.4 - bend * 0.55, x + dx, y + dy);
  const shade = random();
  stroke(ctx, fiber, shade > 0.67 ? '#d4ae70' : shade > 0.28 ? '#ae8148' : '#60432a', 0.5 + random() * 0.65);
  if (shade > 0.6) {
    const tuft = new Path2D();
    tuft.moveTo(x - dx * 0.4, y - dy * 0.4);
    tuft.quadraticCurveTo(x + dx * 0.2, y + bend * 0.6 - 0.6, x + dx * 0.8, y + dy * 0.8 - 0.7);
    stroke(ctx, tuft, 'rgba(226,189,131,0.56)', 0.35);
  }
}

function drawMaterialGrains(ctx: CanvasRenderingContext2D, kind: MaterialKind): void {
  const random = seeded(MATERIAL_SEEDS[kind]);
  const count = kind === 'soil' ? 132 : kind === 'coir' ? 105 : kind === 'bark' ? 45 : 56;
  // Draw from the cup bottom towards its open surface so the surface grains read clearly.
  for (let index = 0; index < count; index += 1) {
    const progress = index / count;
    const y = 86 - progress * 37 + (random() - 0.5) * 4;
    const halfWidth = 22 + (86 - y) * 0.1;
    const x = 50 + (random() * 2 - 1) * halfWidth;
    const radius = kind === 'soil' ? 0.7 + random() * 1.9 : kind === 'coir' ? 2.2 + random() * 3.1 : kind === 'bark' ? 3.4 + random() * 3 : 2.2 + random() * 2.8;
    const angle = random() * Math.PI * 2;
    if (kind === 'clay') clayGrain(ctx, x, y, radius, angle, random);
    else if (kind === 'gravel' || kind === 'charcoal') rockyGrain(ctx, x, y, radius, angle, kind, random);
    else if (kind === 'bark') barkGrain(ctx, x, y, radius, angle, random);
    else if (kind === 'coir') coirFiber(ctx, x, y, radius, angle, random);
    else {
      const shade = random();
      fill(ctx, ellipse(x, y, radius, radius * (0.52 + random() * 0.36), angle), shade > .7 ? '#7b6348' : shade > .35 ? '#6c543d' : '#5d4935');
      if (index % 12 === 0) {
        const root = new Path2D();
        root.moveTo(x - 2, y);
        root.quadraticCurveTo(x, y - 2, x + 3, y - 0.5);
        stroke(ctx, root, 'rgba(178,132,75,0.66)', 0.52);
      }
    }
  }
}

function drawMaterial(ctx: CanvasRenderingContext2D, kind: MaterialKind): void {
  groundShadow(ctx, 51, 93, 33, 4);
  const body = cupBody();
  fill(ctx, body, linear(ctx, 20, 57, 80, 61, [
    [0, 'rgba(116,150,134,0.24)'], [0.17, 'rgba(231,239,217,0.36)'],
    [0.52, 'rgba(227,237,211,0.1)'], [0.83, 'rgba(178,208,189,0.23)'], [1, 'rgba(95,134,119,0.31)'],
  ]));
  fill(ctx, ellipse(50, 33, 29, 7.2), linear(ctx, 30, 27, 72, 37, [
    [0, 'rgba(159,180,160,0.33)'], [0.5, 'rgba(226,237,210,0.2)'], [1, 'rgba(94,132,111,0.23)'],
  ]));
  const rearRim = new Path2D();
  rearRim.ellipse(50, 33, 29, 7.2, 0, Math.PI, Math.PI * 2);
  stroke(ctx, rearRim, 'rgba(113,151,128,0.67)', 1.15);
  withState(ctx, () => {
  ctx.clip(body);
  fillSubstrate(ctx, kind);
  drawMaterialGrains(ctx, kind);
  // A restrained front tint suggests glass without masking the ingredient texture.
  fill(ctx, body, linear(ctx, 21, 59, 79, 61, [
    [0, 'rgba(95,131,112,0.2)'], [0.13, 'rgba(246,248,224,0.08)'],
    [0.37, 'rgba(250,248,222,0.03)'], [0.74, 'rgba(49,78,66,0.03)'], [1, 'rgba(45,82,66,0.22)'],
  ]));
  const reflection = new Path2D();
  reflection.moveTo(26, 39);
  reflection.bezierCurveTo(26, 50, 28, 69, 30, 80);
  reflection.bezierCurveTo(31, 84, 33, 84, 34, 83);
  reflection.bezierCurveTo(31, 69, 31, 48, 32, 40);
  reflection.closePath();
  fill(ctx, reflection, linear(ctx, 26, 57, 33, 57, [
    [0, 'rgba(254,255,232,0.23)'], [0.5, 'rgba(254,255,232,0.41)'], [1, 'rgba(254,255,232,0.05)'],
  ]));
  const rightGlint = new Path2D();
  rightGlint.moveTo(73.5, 40);
  rightGlint.bezierCurveTo(74, 50, 71, 73, 70, 81);
  stroke(ctx, rightGlint, 'rgba(232,244,216,0.43)', 1.1);
  });
  const side = new Path2D();
  side.moveTo(21, 34);
  side.bezierCurveTo(21, 45, 24, 73, 26, 82);
  side.bezierCurveTo(29, 92, 71, 92, 74, 82);
  side.bezierCurveTo(76, 73, 79, 45, 79, 34);
  stroke(ctx, side, 'rgba(103,139,117,0.69)', 0.95);
  const baseRim = new Path2D();
  baseRim.moveTo(28, 84);
  baseRim.bezierCurveTo(36, 91, 65, 91, 72, 84);
  stroke(ctx, baseRim, 'rgba(221,236,207,0.54)', 1.6);
  const rim = ellipse(50, 33, 29, 7.2);
  stroke(ctx, rim, 'rgba(185,207,178,0.81)', 1.75);
  const rimLight = new Path2D();
  rimLight.ellipse(50, 32.5, 28.7, 6.8, 0, 0.12, Math.PI * 0.92);
  stroke(ctx, rimLight, 'rgba(248,250,227,0.88)', 1.05);
  const innerRim = new Path2D();
  innerRim.ellipse(50, 33.2, 26.5, 5.35, 0, Math.PI * 1.04, Math.PI * 1.95);
  stroke(ctx, innerRim, 'rgba(249,252,231,0.4)', 0.65);
}

/**
 * Draw original, offline tool artwork inside [0, size] on both axes.
 * The caller owns clearing, placement and device-pixel-ratio scaling. All canvas
 * state is restored, and Path2D operations also preserve the caller's live path.
 * Invalid or non-positive sizes intentionally draw nothing.
 */
export function drawToolArt(ctx: CanvasRenderingContext2D, kind: ToolArtKind, size: number): void {
  if (!Number.isFinite(size) || size <= 0) return;
  ctx.save();
  try {
    ctx.scale(size / 100, size / 100);
    const bounds = new Path2D();
    bounds.rect(0, 0, 100, 100);
    ctx.clip(bounds);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.filter = 'none';
    ctx.shadowColor = 'rgba(0,0,0,0)';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.setLineDash([]);
    if (kind === 'sun') drawSun(ctx);
    else if (kind === 'spray') drawSpray(ctx);
    else if (kind === 'scoop') drawScoop(ctx);
    else if (kind === 'water' || kind === 'drain') drawPondTool(ctx, kind === 'drain');
    else if (Object.prototype.hasOwnProperty.call(MATERIAL_SEEDS, kind)) drawMaterial(ctx, kind);
  } finally {
    ctx.restore();
  }
}

function drawPondTool(ctx: CanvasRenderingContext2D, drain: boolean): void {
  const body = new Path2D(); body.moveTo(30, 30); body.lineTo(65, 30); body.quadraticCurveTo(69, 31, 68, 38); body.lineTo(62, 82); body.quadraticCurveTo(46, 88, 28, 80); body.lineTo(23, 35); body.quadraticCurveTo(23, 30, 30, 30); body.closePath();
  fill(ctx, body, 'rgba(173,208,186,.35)'); stroke(ctx, body, '#668979', 1.4);
  withState(ctx, () => { ctx.clip(body); const water = polygon([[18, 55], [72, 53], [72, 90], [18, 90]]); fill(ctx, water, linear(ctx, 30, 54, 56, 86, [[0, '#94c8ba'], [1, '#578f89']])); line(ctx, [[24, 55], [42, 57], [68, 54]], '#d6e8ce', 1.5); });
  const handle = new Path2D(); handle.moveTo(68, 40); handle.bezierCurveTo(90, 32, 93, 68, 65, 66); stroke(ctx, handle, '#729984', 5); stroke(ctx, handle, '#c2d1b6', 2);
  const arrow = drain ? [[47, 47], [47, 15], [38, 24], [47, 15], [56, 24]] as const : [[47, 9], [47, 40], [38, 31], [47, 40], [56, 31]] as const;
  line(ctx, arrow, '#3c7771', 3); line(ctx, [[31, 36], [35, 76]], 'rgba(248,249,224,.65)', 2);
}
