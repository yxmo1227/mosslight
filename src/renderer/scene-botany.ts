import type { Decoration, DecorationKind, Plant, PlantKind } from '../shared/types';
import { woodGeometry2D, woodPathPoint2D } from './scene-2d-wood';
import { decorationBounds2D, drawObjectArt2D } from './scene-object-art';
import { foliageCondition2D, mushroomFlush2D, unitEcology } from './scene-ecology';
import type { FoliageCondition2D, MushroomFlush2D } from './scene-ecology';
export { decorationBounds2D } from './scene-object-art';

/** All coordinates are relative to a ground anchor; this module applies object.scale. */
export interface BotanicalExtent { left: number; right: number; top: number; bottom: number }

const PLANT_EXTENTS: Record<PlantKind, BotanicalExtent> = {
  'cushion-moss': { left: -0.77, right: 0.77, top: -0.40, bottom: 0.075 },
  'sheet-moss': { left: -0.94, right: 0.94, top: -0.19, bottom: 0.06 },
  'star-moss': { left: -.90, right: .90, top: -.31, bottom: .075 },
  'fern-moss': { left: -.96, right: .96, top: -.34, bottom: .075 },
  fern: { left: -0.57, right: 0.57, top: -1.03, bottom: 0.065 },
  fittonia: { left: -0.59, right: 0.59, top: -1.05, bottom: 0.075 },
  'creeping-fig': { left: -.62, right: .62, top: -.89, bottom: .075 },
  oxalis: { left: -.57, right: .57, top: -.91, bottom: .075 },
  'amber-mushroom': { left: -.48, right: .48, top: -.94, bottom: .075 },
  'ivory-mushroom': { left: -.48, right: .48, top: -.94, bottom: .075 },
  'scarlet-mushroom': { left: -.50, right: .50, top: -1.02, bottom: .075 },
  'violet-mushroom': { left: -.51, right: .51, top: -.94, bottom: .075 },
};
export function getPlantExtent(kind: PlantKind): BotanicalExtent { return { ...PLANT_EXTENTS[kind] }; }
export function getDecorationExtent(kind: DecorationKind): BotanicalExtent { return decorationBounds2D({ kind }); }

type Random = () => number;
type RGB = readonly [number, number, number];
type Point = { x: number; y: number };
interface MossShoot { x: number; y: number; z: number; length: number; tilt: number; shade: number; tip: number }

// Geometry only: bounded memory, no DOM/canvas/storage references retained here.
const mossGeometry = new Map<string, readonly MossShoot[]>();
const MAX_GEOMETRY_CACHE = 64;
const healthyDark: RGB = [52, 91, 42];
const healthyMid: RGB = [99, 143, 54];
const healthyLight: RGB = [171, 192, 89];
const dryDark: RGB = [111, 78, 31];
const dryMid: RGB = [181, 135, 48];
const dryLight: RGB = [227, 193, 92];

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, Number.isFinite(value) ? value : low));
}
function hash(value: string): number {
  let result = 2166136261;
  for (let i = 0; i < value.length; i += 1) result = Math.imul(result ^ value.charCodeAt(i), 16777619);
  return result >>> 0;
}
function randomFor(value: string): Random {
  let seed = hash(value);
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function mix(a: RGB, b: RGB, amount: number): RGB {
  return [a[0] + (b[0] - a[0]) * amount, a[1] + (b[1] - a[1]) * amount, a[2] + (b[2] - a[2]) * amount];
}
function rgba(color: RGB, alpha = 1): string {
  return `rgba(${Math.round(color[0])},${Math.round(color[1])},${Math.round(color[2])},${alpha})`;
}
function palette(health: number, wetness = 0): [RGB, RGB, RGB] {
  // Damp surfaces deepen shadows and catch fresher greens; this is visual only.
  // Low health remains muted rather than appearing healed merely by being wet.
  return [
    mix(mix(dryDark, healthyDark, health), mix([91, 67, 28], [19, 55, 27], health), wetness * 0.8),
    mix(mix(dryMid, healthyMid, health), mix([167, 129, 49], [48, 121, 48], health), wetness * 0.8),
    mix(mix(dryLight, healthyLight, health), mix([215, 182, 87], [151, 193, 97], health), wetness * 0.68),
  ];
}
function ellipse(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number): void {
  ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
}
function groundShadow(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  const shade = ctx.createRadialGradient(0, 0.018, 0.005, 0, 0.018, width);
  shade.addColorStop(0, 'rgba(15,25,14,.36)');
  shade.addColorStop(0.7, 'rgba(15,25,14,.13)');
  shade.addColorStop(1, 'rgba(15,25,14,0)');
  ctx.save(); ctx.scale(1, height / width); ctx.fillStyle = shade;
  ellipse(ctx, 0, 0.018 * width / height, width, width); ctx.restore();
}

/** A tiny refractive lens: shaded contact, transparent body, bright rim and glint. */
function drawDew(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, wetness: number, stretch = 1, rotation = 0): void {
  const strength = 0.42 + Math.sqrt(wetness) * 0.58;
  ctx.save(); ctx.translate(x, y); ctx.rotate(rotation); ctx.scale(stretch, 0.83);
  ctx.fillStyle = `rgba(8,44,29,${0.28 * strength})`;
  ellipse(ctx, 0.08 * radius, radius * 0.35, radius * 1.04, radius * 0.76);
  const lens = ctx.createRadialGradient(-radius * 0.34, -radius * 0.40, radius * 0.04, 0, 0, radius * 1.08);
  lens.addColorStop(0, `rgba(239,255,248,${0.91 * strength})`);
  lens.addColorStop(0.25, `rgba(197,241,215,${0.43 * strength})`);
  lens.addColorStop(0.64, `rgba(53,130,94,${0.16 * strength})`);
  lens.addColorStop(0.86, `rgba(19,83,58,${0.36 * strength})`);
  lens.addColorStop(1, `rgba(232,255,239,${0.65 * strength})`);
  ctx.fillStyle = lens; ellipse(ctx, 0, 0, radius, radius);
  ctx.strokeStyle = `rgba(213,250,228,${0.55 * strength})`; ctx.lineWidth = radius * 0.12;
  ctx.beginPath(); ctx.arc(0, 0, radius * 0.89, 0.2, 2.27); ctx.stroke();
  ctx.fillStyle = `rgba(247,255,250,${0.97 * strength})`;
  ellipse(ctx, -radius * 0.34, -radius * 0.37, radius * 0.24, radius * 0.16);
  ctx.restore();
}

/** unit is typically 150 px. Scale is applied here, not by the calling scene. */
export interface BotanicalOptions { groundShadow?: boolean }
export function drawPlant(ctx: CanvasRenderingContext2D, plant: Plant, x: number, y: number, unit: number, options: BotanicalOptions = {}): void {
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(unit) || unit <= 0) return;
  const scale = clamp(plant.scale, 0.1, 2.5) * Math.min(unit, 2000);
  const health = clamp(plant.health, 0, 1);
  const growth = clamp(plant.growth, 0, 1.5);
  const wetness = clamp(plant.wetness, 0, 1);
  const condition = foliageCondition2D(plant), spread = unitEcology(plant.ecology?.spread);
  ctx.save();
  ctx.translate(x, y); ctx.scale(scale, scale);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  switch (plant.kind) {
    case 'cushion-moss': drawMoss(ctx, plant.id, false, growth, condition.pigment, wetness, options.groundShadow !== false, spread, condition.wilt); break;
    case 'sheet-moss': drawMoss(ctx, plant.id, true, growth, condition.pigment, wetness, options.groundShadow !== false, spread, condition.wilt); break;
    case 'star-moss': case 'fern-moss': drawCarpetMoss(ctx, plant.id, plant.kind === 'fern-moss', growth, condition, wetness, spread, options.groundShadow !== false); break;
    case 'fern': drawFern(ctx, plant.id, growth, condition.pigment, wetness, options.groundShadow !== false, condition); break;
    case 'fittonia': drawFittonia(ctx, plant.id, growth, condition.pigment, wetness, options.groundShadow !== false, condition); break;
    case 'creeping-fig': case 'oxalis': drawGardenFoliage(ctx, plant.id, plant.kind === 'oxalis', growth, condition, wetness, options.groundShadow !== false); break;
    case 'amber-mushroom': case 'ivory-mushroom': case 'scarlet-mushroom': case 'violet-mushroom': drawMushrooms(ctx, plant.id, plant.kind, growth, health, wetness, options.groundShadow !== false, mushroomFlush2D(plant.ecology), condition); break;
  }
  ctx.restore();
}

/** Like drawPlant, decoration.scale is applied internally. */
export function drawDecoration(ctx: CanvasRenderingContext2D, decoration: Decoration, x: number, y: number, unit: number, options: BotanicalOptions = {}): void {
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(unit) || unit <= 0) return;
  const scale = clamp(decoration.scale, 0.1, 2.5) * Math.min(unit, 2000);
  ctx.save(); ctx.translate(x, y); ctx.scale(scale, scale);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  if (decoration.kind === 'wood' && decoration.pose) { ctx.rotate(clamp(decoration.pose.angle, -180, 180) * Math.PI / 180); ctx.scale(decoration.pose.flipX ? -1 : 1, 1); }
  const illustrated = decoration.kind !== 'wood' && !(decoration.kind === 'stone' && (!decoration.variant || decoration.variant === 'boulder'));
  if (illustrated) { if (options.groundShadow !== false && !['fairy', 'sun', 'moon', 'star'].includes(decoration.kind)) groundShadow(ctx, .38, .055); drawObjectArt2D(ctx, decoration); }
  else if (decoration.kind === 'stone') drawStone(ctx, decoration.id, options.groundShadow !== false);
  else if (decoration.kind === 'wood') { if (decoration.wood) drawEditableWood(ctx, decoration); else drawWood(ctx, decoration.id, options.groundShadow !== false); }
  ctx.restore();
}

/** Original illustrated mushroom clusters; growth and water are visual state,
 * not a claim about edible species or real-world cultivation. */
export function mushroomStemFeet2D(id: string, growth: number, ecology?: Plant['ecology']): { x: number; y: number; width: number }[] {
  const rng = randomFor(`mushroom:${id}`), maturity = Math.min(1.2, growth), reach = .48 + Math.sqrt(maturity / 1.2) * .52, count = 3 + Math.floor(maturity * 4);
  const flush = mushroomFlush2D(ecology), visibleCount = flush.dormant ? 2 : count;
  return Array.from({ length: visibleCount }, (_, i) => {
    const x = (i / Math.max(1, visibleCount - 1) - .5) * .53 * reach;
    // These are the four random values consumed by each authored cap record.
    rng(); rng(); rng(); rng();
    return { x, y: .018, width: .028 * reach };
  });
}
function drawMushrooms(ctx: CanvasRenderingContext2D, id: string, kind: PlantKind, growth: number, health: number, wetness: number, shadow: boolean, flush: MushroomFlush2D, condition: FoliageCondition2D): void {
  const ivory = kind === 'ivory-mushroom', scarlet = kind === 'scarlet-mushroom', violet = kind === 'violet-mushroom';
  const rng = randomFor(`mushroom:${id}`), maturity = Math.min(1.2, growth), reach = .48 + Math.sqrt(maturity / 1.2) * .52, count = 3 + Math.floor(maturity * 4);
  const visibleCount = flush.dormant ? 2 : count, droop = Math.max(flush.fading, condition.wilt * .85), size = flush.scale * (1 - condition.wilt * .48);
  if (shadow) groundShadow(ctx, .36 * reach, .052);
  const cluster = Array.from({ length: visibleCount }, (_, i) => ({ x: (i / Math.max(1, visibleCount - 1) - .5) * .53 * reach, height: (.34 + rng() * .43) * reach * size, radius: (.115 + rng() * .075) * reach * Math.sqrt(size), lean: (rng() - .5) * .075, order: rng() })).sort((a, b) => a.order - b.order);
  for (const cap of cluster) {
    const topX = cap.x + cap.lean + Math.sign(cap.x || .1) * droop * cap.height * .17, y = -cap.height;
    ctx.strokeStyle = violet ? '#bcb3bd' : scarlet ? '#e0d5b2' : ivory ? '#d7cfad' : '#d4b67b'; ctx.lineWidth = .028 * reach; ctx.beginPath(); ctx.moveTo(cap.x, .018); ctx.bezierCurveTo(cap.x - cap.lean * .3, y * .35, topX, y * .69, topX, y); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,245,210,.62)'; ctx.lineWidth = .009 * reach; ctx.beginPath(); ctx.moveTo(cap.x - .006, .003); ctx.quadraticCurveTo(topX - .006, y * .6, topX - .006, y); ctx.stroke();
    ctx.fillStyle = violet ? '#918198' : scarlet ? '#d8c6a1' : ivory ? '#b6ac84' : '#926436'; ellipse(ctx, topX, y, cap.radius, cap.radius * .22);
    const color: RGB = scarlet ? [180, 67, 45] : violet ? [154, 126, 164] : ivory ? [232, 220, 177] : [183, 117, 46], muted: RGB = violet ? [116, 102, 103] : scarlet ? [135, 91, 62] : ivory ? [149, 137, 101] : [123, 97, 54];
    const profile = scarlet ? 1.26 : violet ? .57 : 1;
    ctx.fillStyle = rgba(mix(muted, color, health * (1 - droop * .8))); ctx.beginPath(); ctx.moveTo(topX - cap.radius, y); ctx.bezierCurveTo(topX - cap.radius * .9, y - cap.radius * (.96 - droop * .65) * profile, topX + cap.radius * .83, y - cap.radius * (.96 - droop * .78) * profile, topX + cap.radius, y); ctx.bezierCurveTo(topX + cap.radius * .51, y + cap.radius * .11, topX - cap.radius * .48, y + cap.radius * .13, topX - cap.radius, y); ctx.fill();
    const dome = (1 - droop * .76) * profile;
    ctx.strokeStyle = ivory ? 'rgba(255,247,209,.44)' : 'rgba(239,182,93,.47)'; ctx.lineWidth = .011 * Math.sqrt(size); ctx.beginPath(); ctx.moveTo(topX - cap.radius * .72, y - cap.radius * .19 * dome); ctx.quadraticCurveTo(topX - cap.radius * .5, y - cap.radius * .63 * dome, topX + cap.radius * .04, y - cap.radius * .62 * dome); ctx.stroke();
    for (let dot = 0; dot < 5 + Math.floor(maturity * 4); dot++) { ctx.fillStyle = scarlet ? 'rgba(245,232,192,.85)' : violet ? 'rgba(227,211,229,.22)' : ivory ? 'rgba(157,147,111,.14)' : 'rgba(250,220,156,.25)'; ellipse(ctx, topX + (rng() - .5) * cap.radius * 1.35, y - (.17 + rng() * .34) * cap.radius * dome, (.003 + rng() * .004) * Math.sqrt(size) * (scarlet ? 1.7 : 1), (.002 + rng() * .003) * Math.sqrt(size) * (scarlet ? 1.7 : 1)); }
    if (violet) { ctx.strokeStyle = 'rgba(94,74,109,.28)'; ctx.lineWidth = .003 * reach; for (let gill = 0; gill < 9; gill++) { const t = gill / 8; ctx.beginPath(); ctx.moveTo(topX + (t - .5) * cap.radius * 1.75, y + .001); ctx.lineTo(topX + (t - .5) * cap.radius * .42, y + cap.radius * .18); ctx.stroke(); } }
    if (wetness > .001) for (let dew = 0; dew < 1 + Math.floor(wetness * 3); dew++) drawDew(ctx, topX + (dew - 1) * cap.radius * .34, y - cap.radius * (.40 + dew * .03) * dome, (.011 + wetness * .006) * Math.sqrt(size), wetness);
  }
}

/** Separate original silhouettes, not alternate colors of the older mounds. */
function drawCarpetMoss(ctx: CanvasRenderingContext2D, id: string, feathery: boolean, growth: number, condition: FoliageCondition2D, wetness: number, spread: number, shadow: boolean): void {
  const maturity = Math.min(1, growth), rng = randomFor(`${feathery ? 'feather' : 'star'}:${id}`), [dark, mid, light] = palette(condition.pigment, wetness);
  const reach = .65 + Math.sqrt(maturity) * .35, width = .42 * reach;
  if (shadow) groundShadow(ctx, width * (1 + spread * .82), .047);
  ctx.save(); ctx.scale(1 + spread * .82, 1 - condition.wilt * .37);
  ctx.fillStyle = rgba(mix(dark, mid, .66)); ellipse(ctx, 0, -.011, width, .035 * reach);
  const count = feathery ? 17 + Math.floor(maturity * 36) : 26 + Math.floor(maturity * 74);
  const records = Array.from({ length: count }, () => ({ x: (rng() - .5) * width * 1.82, y: -.012 - rng() * .12 * reach, seed: rng(), size: rng() })).sort((a, b) => a.y - b.y);
  for (const tuft of records) {
    const local = .67 + tuft.size * .5;
    if (feathery) {
      const angle = (tuft.seed - .5) * 1.9, length = (.09 + maturity * .055) * local, dx = Math.sin(angle), dy = -Math.cos(angle);
      ctx.strokeStyle = rgba(mix(mid, light, .55)); ctx.lineWidth = .0025;
      ctx.beginPath(); ctx.moveTo(tuft.x, tuft.y); ctx.quadraticCurveTo(tuft.x + dx * length * .6, tuft.y + dy * length * .7, tuft.x + dx * length, tuft.y + dy * length); ctx.stroke();
      for (let row = 0; row < 7; row++) for (const side of [-1, 1]) {
        const t = .12 + row * .12, size = (.031 + maturity * .015) * (1 - t * .75) * local;
        const px = tuft.x + dx * length * t, py = tuft.y + dy * length * t;
        fernLeaflet(ctx, { x: px, y: py }, dx * .45 - dy * side * .82, dy * .45 + dx * side * .82, size, size * .18, rgba(mix(mid, side < 0 ? light : dark, .26 + tuft.seed * .17)), rgba(light, .48));
      }
    } else {
      for (let leaf = 0; leaf < 8; leaf++) {
        const angle = leaf / 8 * Math.PI * 2 + tuft.seed, length = (.026 + maturity * .019) * local;
        const dx = Math.cos(angle), dy = Math.sin(angle) * .54 - .40;
        ctx.fillStyle = rgba(mix(mid, leaf % 3 ? light : dark, .22 + tuft.seed * .23));
        ctx.beginPath(); ctx.moveTo(tuft.x, tuft.y); ctx.quadraticCurveTo(tuft.x + dx * length * .3 - dy * .008, tuft.y + dy * length * .3 + dx * .006, tuft.x + dx * length, tuft.y + dy * length);
        ctx.quadraticCurveTo(tuft.x + dx * length * .3 + dy * .008, tuft.y + dy * length * .3 - dx * .006, tuft.x, tuft.y); ctx.fill();
      }
      ctx.fillStyle = rgba(light, .85); ellipse(ctx, tuft.x, tuft.y - .003, .003, .003);
    }
  }
  // Fine foreground tips soften the common base instead of leaving a smooth
  // oval pedestal below the stars or tiny feather fronds.
  for (let i = 0; i < 80 + Math.floor(maturity * 100); i++) {
    const x = (rng() - .5) * width * 1.88, y = .005 - rng() * .041, length = .008 + rng() * .017;
    ctx.strokeStyle = rgba(mix(mid, light, .18 + rng() * .36), .85); ctx.lineWidth = .0021;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + .003, y - length * .65, x - .002, y - length); ctx.stroke();
  }
  if (wetness > .001) for (let i = 0; i < 3 + Math.floor(wetness * 18); i++) {
    const tuft = records[Math.floor(i / (3 + wetness * 18) * records.length)] ?? records[0];
    drawDew(ctx, tuft.x, tuft.y - .012, .007 + wetness * .004, wetness);
  }
  ctx.restore();
}

function drawGardenFoliage(ctx: CanvasRenderingContext2D, id: string, oxalis: boolean, growth: number, condition: FoliageCondition2D, wetness: number, shadow: boolean): void {
  const maturity = Math.min(1.2, growth), rng = randomFor(`garden:${id}`), [dark, mid, light] = palette(condition.pigment, wetness);
  const wilt = condition.wilt, reach = (.55 + Math.sqrt(maturity / 1.2) * .45) * (1 - wilt * .2);
  if (shadow) groundShadow(ctx, .34 * reach, .05);
  const count = 3 + Math.floor(maturity * 5);
  for (let i = 0; i < count; i++) {
    const direction = (i / Math.max(1, count - 1) - .5) * (oxalis ? .7 : .8), height = (.35 + rng() * .34) * reach, bend = (rng() - .5) * .07;
    const a = { x: (rng() - .5) * .026, y: .015 }, b = { x: direction * .3, y: -height * .52 }, c = { x: direction * reach + bend, y: -height * (1.08 - wilt * .35) }, d = { x: direction * reach, y: -height * (1 - wilt * .61) };
    ctx.strokeStyle = rgba(oxalis ? mix([147, 106, 58], [120, 89, 96], condition.pigment) : mix(dark, mid, .65)); ctx.lineWidth = oxalis ? .007 : .011;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.bezierCurveTo(b.x, b.y, c.x, c.y, d.x, d.y); ctx.stroke();
    if (oxalis) {
      for (let lobe = 0; lobe < 3; lobe++) {
        const angle = lobe / 3 * Math.PI * 2 + direction * .45 + wilt * .27;
        const length = (.112 + rng() * .033) * reach * (1 - wilt * .33), width = length * (.74 - wilt * .37);
        ctx.save(); ctx.translate(d.x, d.y); ctx.rotate(angle); ctx.fillStyle = rgba(mix([174, 136, 54], lobe === 1 ? [126, 79, 111] : [95, 83, 107], condition.pigment));
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(-width * .8, -length * .25, -width, -length * .85); ctx.quadraticCurveTo(-width * .40, -length * 1.12, 0, -length * .86); ctx.quadraticCurveTo(width * .45, -length * 1.1, width, -length * .83); ctx.quadraticCurveTo(width * .77, -length * .24, 0, 0); ctx.fill();
        ctx.strokeStyle = rgba(mix([226, 187, 87], [167, 126, 151], condition.pigment), .7); ctx.lineWidth = .003; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -length * .86); ctx.stroke();
        if (wetness > .001 && lobe === 1) drawDew(ctx, width * .3, -length * .52, .008 + wetness * .004, wetness);
        ctx.restore();
      }
    } else {
      const rows = 3 + Math.floor(maturity * 3);
      for (let row = 0; row < rows; row++) {
        const t = .22 + row / Math.max(1, rows - 1) * .78, p = cubic(a, b, c, d, t), side = row % 2 ? 1 : -1;
        const length = (.09 + rng() * .055) * reach * (1 - wilt * .24), width = length * (.54 - wilt * .25);
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(side * (.95 + wilt * .7));
        ctx.fillStyle = rgba(mix(mid, row % 3 ? dark : light, .28));
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.bezierCurveTo(-width * 1.3, -length * .12, -width, -length * .92, 0, -length); ctx.bezierCurveTo(width, -length * .88, width * 1.25, -length * .14, 0, 0); ctx.fill();
        ctx.strokeStyle = rgba(mix(mid, light, .68), .7); ctx.lineWidth = .003; ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(-width * .07, -length * .5, 0, -length * .91); ctx.stroke();
        if (wetness > .001 && row === rows - 1) drawDew(ctx, width * .25, -length * .55, .008 + wetness * .004, wetness);
        ctx.restore();
      }
    }
  }
  ctx.fillStyle = rgba(dark, .85); ellipse(ctx, 0, .014, .045, .021);
}

function drawStump(ctx: CanvasRenderingContext2D, id: string, shadow: boolean): void {
  const rng = randomFor(`stump:${id}`); if (shadow) groundShadow(ctx, .43, .07);
  ctx.fillStyle = '#795333'; ctx.beginPath(); ctx.moveTo(-.27, -.53); ctx.bezierCurveTo(-.27, -.30, -.29, -.07, -.42, .04); ctx.quadraticCurveTo(-.24, .07, -.14, .026); ctx.quadraticCurveTo(.04, .07, .18, .027); ctx.lineTo(.42, .052); ctx.quadraticCurveTo(.27, -.16, .28, -.53); ctx.closePath(); ctx.fill();
  for (let i = 0; i < 19; i++) { const x = -.255 + i / 18 * .51; ctx.strokeStyle = i % 3 ? 'rgba(62,41,28,.26)' : 'rgba(207,160,93,.23)'; ctx.lineWidth = .007 + rng() * .006; ctx.beginPath(); ctx.moveTo(x, -.52); ctx.bezierCurveTo(x + .018 * Math.sin(i), -.33, x * 1.07, -.14, x * 1.33, .028); ctx.stroke(); }
  ctx.fillStyle = '#c6a273'; ellipse(ctx, 0, -.53, .281, .078); ctx.strokeStyle = '#886140'; ctx.lineWidth = .006;
  for (let i = 1; i <= 5; i++) { ctx.beginPath(); ctx.ellipse(-.017, -.528, .043 * i, .0115 * i, -.04, 0, Math.PI * 2); ctx.stroke(); }
  ctx.strokeStyle = '#65472f'; ctx.lineWidth = .009; ctx.beginPath(); ctx.moveTo(.12, -.546); ctx.lineTo(.20, -.565); ctx.lineTo(.268, -.563); ctx.stroke();
  for (let i = 0; i < 14; i++) { ctx.fillStyle = i % 2 ? '#6c843e' : '#91a14e'; ellipse(ctx, -.22 + rng() * .41, .014 + rng() * .027, .014 + rng() * .012, .007 + rng() * .012); }
}

function mossShoots(id: string, sheet: boolean): readonly MossShoot[] {
  const key = `${sheet ? 'sheet' : 'cushion'}:${id}`;
  const cached = mossGeometry.get(key);
  if (cached) return cached;
  const random = randomFor(key);
  const shoots: MossShoot[] = [];
  const count = sheet ? 650 : 850;
  for (let i = 0; i < count; i += 1) {
    const angle = random() * Math.PI * 2;
    const radius = Math.sqrt(random());
    const px = Math.cos(angle) * radius;
    const pz = Math.sin(angle) * radius;
    const dome = Math.sqrt(Math.max(0, 1 - radius * radius));
    shoots.push({
      x: px * (sheet ? 0.455 : 0.345),
      y: pz * (sheet ? 0.058 : 0.07) - dome * (sheet ? 0.075 : 0.232),
      z: pz,
      length: (sheet ? 0.014 : 0.023) + random() * (sheet ? 0.028 : 0.043),
      tilt: (random() - 0.5) * 0.04,
      shade: random(),
      tip: random(),
    });
  }
  shoots.sort((a, b) => a.z - b.z);
  if (mossGeometry.size >= MAX_GEOMETRY_CACHE) {
    const oldest = mossGeometry.keys().next().value;
    if (oldest !== undefined) mossGeometry.delete(oldest);
  }
  mossGeometry.set(key, shoots);
  return shoots;
}

function drawMoss(ctx: CanvasRenderingContext2D, id: string, sheet: boolean, growth: number, health: number, wetness: number, shadow: boolean, colonization: number, wilt: number): void {
  const maturity = Math.min(1, growth);
  const spread = (0.74 + Math.sqrt(maturity) * 0.26) * (1 + colonization * .82);
  const density = 0.48 + maturity * 0.52;
  const [dark, mid, light] = palette(health, wetness);
  const width = sheet ? 0.46 : 0.35;
  if (shadow) groundShadow(ctx, width * spread * 1.09, 0.068);
  ctx.save(); ctx.scale(spread, (0.83 + maturity * 0.17) * (1 - wilt * .36));
  const mound = ctx.createLinearGradient(0, sheet ? -0.15 : -0.31, 0, 0.08);
  mound.addColorStop(0, rgba(mix(mid, light, 0.26)));
  mound.addColorStop(.67, rgba(mid)); mound.addColorStop(1, rgba(mix(dark, mid, .48)));
  ctx.fillStyle = mound;
  ctx.beginPath();
  ctx.moveTo(-width, 0.012);
  ctx.bezierCurveTo(-width * 1.05, sheet ? -0.08 : -0.18, -width * .7, sheet ? -0.13 : -0.29, -width * .35, sheet ? -0.10 : -0.255);
  ctx.bezierCurveTo(-width * .1, sheet ? -0.16 : -0.335, width * .28, sheet ? -0.15 : -0.31, width * .43, sheet ? -0.10 : -0.24);
  ctx.bezierCurveTo(width * .83, sheet ? -0.14 : -0.29, width * 1.05, sheet ? -0.035 : -0.12, width, 0.006);
  ctx.bezierCurveTo(width * 0.63, 0.059, -width * 0.59, 0.054, -width, 0.012);
  ctx.fill();
  const shoots = mossShoots(id, sheet);
  const count = Math.round(shoots.length * density);
  const stride = shoots.length / count;
  const colors = Array.from({ length: 10 }, (_, i) => rgba(mix(mid, i < 5 ? dark : light, i < 5 ? .10 + i * .07 : .15 + (i - 5) * .07)));
  for (let i = 0; i < count; i += 1) {
    const shoot = shoots[Math.min(shoots.length - 1, Math.floor(i * stride))];
    if (!shoot) continue;
    const length = shoot.length * (0.68 + maturity * 0.32);
    const facingLight = clamp(0.42 - shoot.x * 0.8 - shoot.z * 0.16 + shoot.shade * 0.4, 0, 0.99);
    ctx.strokeStyle = colors[Math.floor(facingLight * 10)] ?? rgba(mid);
    ctx.lineWidth = sheet ? 0.0035 : 0.0042;
    ctx.beginPath(); ctx.moveTo(shoot.x, shoot.y);
    ctx.quadraticCurveTo(shoot.x + shoot.tilt * 0.5, shoot.y - length * 0.64, shoot.x + shoot.tilt, shoot.y - length);
    ctx.stroke();
    // Restrained tiny lateral leaves make a soft, hand-drawn fuzzy carpet.
    ctx.lineWidth = 0.0021;
    ctx.beginPath();
    ctx.moveTo(shoot.x + shoot.tilt * 0.35 - 0.006, shoot.y - length * 0.49);
    ctx.lineTo(shoot.x + shoot.tilt * 0.47, shoot.y - length * 0.59);
    ctx.lineTo(shoot.x + shoot.tilt * 0.53 + 0.006, shoot.y - length * 0.48);
    ctx.stroke();
    if (shoot.tip > 0.84) {
      ctx.fillStyle = rgba(mix(light, [196, 201, 130], 0.35), 0.85);
      ellipse(ctx, shoot.x + shoot.tilt, shoot.y - length, 0.0026, 0.0036);
    }
  }
  // A few delicate, original sporophytes; not decorative icon dots.
  const random = randomFor(`spores:${id}`);
  for (let i = 0; i < (sheet ? 3 : 5) * maturity; i += 1) {
    const px = (random() - 0.5) * width * 1.3;
    const py = -0.045 - random() * (sheet ? 0.045 : 0.13);
    const length = 0.048 + random() * 0.045;
    ctx.strokeStyle = 'rgba(135,111,60,.65)'; ctx.lineWidth = 0.0018;
    ctx.beginPath(); ctx.moveTo(px, py); ctx.quadraticCurveTo(px + 0.015, py - length * 0.65, px + 0.011, py - length); ctx.stroke();
    ctx.fillStyle = 'rgba(154,133,70,.85)';
    ctx.beginPath(); ctx.ellipse(px + 0.013, py - length, 0.004, 0.009, -0.35, 0, Math.PI * 2); ctx.fill();
  }
  if (wetness > 0.001) {
    // Reuse the cached shoots as real surface anchors, rather than floating dots.
    // A separate random stream means mist never changes the underlying carpet.
    const dewRandom = randomFor(`dew-moss:${id}:${sheet}`);
    const beads = 3 + Math.floor(wetness * 33);
    for (let i = 0; i < beads; i += 1) {
      const shoot = shoots[Math.floor(shoots.length * (0.4 + dewRandom() * 0.59))];
      if (!shoot) continue;
      const length = shoot.length * (0.68 + maturity * 0.32);
      const radius = (0.009 + dewRandom() * 0.010) * (0.68 + wetness * 0.32);
      drawDew(ctx, shoot.x + shoot.tilt, shoot.y - length + radius * 0.22, radius, wetness, 1.11, (dewRandom() - 0.5) * 0.25);
    }
  }
  ctx.restore();
}

function cubic(a: Point, b: Point, c: Point, d: Point, t: number): Point {
  const u = 1 - t;
  return { x: u ** 3 * a.x + 3 * u * u * t * b.x + 3 * u * t * t * c.x + t ** 3 * d.x,
    y: u ** 3 * a.y + 3 * u * u * t * b.y + 3 * u * t * t * c.y + t ** 3 * d.y };
}
function tangent(a: Point, b: Point, c: Point, d: Point, t: number): Point {
  const u = 1 - t;
  const x = 3 * u * u * (b.x - a.x) + 6 * u * t * (c.x - b.x) + 3 * t * t * (d.x - c.x);
  const y = 3 * u * u * (b.y - a.y) + 6 * u * t * (c.y - b.y) + 3 * t * t * (d.y - c.y);
  const length = Math.hypot(x, y) || 1;
  return { x: x / length, y: y / length };
}
function fernLeaflet(ctx: CanvasRenderingContext2D, base: Point, dx: number, dy: number, length: number, width: number, color: string, vein: string): void {
  const normalX = -dy; const normalY = dx;
  const tipX = base.x + dx * length; const tipY = base.y + dy * length;
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.moveTo(base.x, base.y);
  ctx.bezierCurveTo(base.x + dx * length * 0.17 + normalX * width, base.y + dy * length * 0.17 + normalY * width,
    base.x + dx * length * 0.64 + normalX * width * 0.56, base.y + dy * length * 0.64 + normalY * width * 0.56, tipX, tipY);
  ctx.bezierCurveTo(base.x + dx * length * 0.58 - normalX * width * 0.8, base.y + dy * length * 0.58 - normalY * width * 0.8,
    base.x + dx * length * 0.12 - normalX * width * 0.72, base.y + dy * length * 0.12 - normalY * width * 0.72, base.x, base.y);
  ctx.fill();
  ctx.strokeStyle = vein; ctx.lineWidth = 0.0015;
  ctx.beginPath(); ctx.moveTo(base.x, base.y);
  ctx.quadraticCurveTo(base.x + dx * length * 0.42 + normalX * width * 0.08, base.y + dy * length * 0.42 + normalY * width * 0.08,
    base.x + dx * length * 0.91, base.y + dy * length * 0.91); ctx.stroke();
}

function drawFern(ctx: CanvasRenderingContext2D, id: string, growth: number, health: number, wetness: number, shadow: boolean, condition: FoliageCondition2D): void {
  const maturity = Math.min(1.2, growth);
  const random = randomFor(`fern:${id}`);
  const [dark, mid, light] = palette(health, wetness);
  const dewRandom = randomFor(`dew-fern:${id}`);
  const beads: Array<{ x: number; y: number; radius: number; angle: number }> = [];
  const wilt = condition.wilt;
  const reach = (0.56 + Math.sqrt(maturity / 1.2) * 0.43) * (1 - wilt * .22);
  if (shadow) groundShadow(ctx, 0.26 * reach, 0.048);
  const count = 4 + Math.floor(maturity * 6);
  const fronds = Array.from({ length: count }, (_, i) => ({
    spread: (i / (count - 1) - 0.5) * 0.93 + (random() - 0.5) * 0.09,
    height: (0.59 + random() * 0.33) * reach,
    bend: (random() - 0.5) * 0.11,
    shade: random(),
    order: random(),
  })).sort((a, b) => a.order - b.order);
  for (const frond of fronds) {
    const a = { x: (random() - 0.5) * 0.038, y: 0.014 };
    const d = { x: frond.spread * reach, y: -frond.height * (1 - wilt * .72) };
    const b = { x: a.x + frond.spread * 0.1, y: -frond.height * 0.48 };
    const c = { x: d.x * (.51 + wilt * .44) + frond.bend, y: -frond.height * (1.11 - wilt * .25) };
    const shade = mix(dark, mid, 0.65 + frond.shade * 0.35);
    const leafColor = rgba(shade);
    const leafLight = rgba(mix(shade, light, 0.3));
    const vein = rgba(mix(mid, light, 0.53), 0.65);
    const pairs = 13 + Math.floor(frond.height * 15);
    for (let j = 0; j < pairs; j += 1) {
      const t = 0.13 + j / pairs * 0.82;
      const p = cubic(a, b, c, d, t);
      const direction = tangent(a, b, c, d, t);
      const sideSize = Math.sin(Math.PI * (t - 0.045)) ** 0.78;
      const length = (0.074 + frond.height * 0.05) * sideSize * (0.78 + random() * 0.24) * (1 - wilt * .33);
      for (const side of [-1, 1]) {
        const nx = -direction.y * side; const ny = direction.x * side;
        const dx = nx * 0.88 + direction.x * 0.46;
        const dy = ny * 0.88 + direction.y * 0.46 + wilt * .42;
        const norm = Math.hypot(dx, dy);
        fernLeaflet(ctx, p, dx / norm, dy / norm, length, length * (.16 - wilt * .07), side < 0 ? leafLight : leafColor, vein);
        if (j % 4 === 1 && side === 1) {
          const chance = dewRandom(); const size = dewRandom();
          if (wetness > 0.001 && chance < 0.28 + wetness * 0.62) {
            beads.push({ x: p.x + dx / norm * length * 0.47, y: p.y + dy / norm * length * 0.47,
              radius: (0.007 + size * 0.0045) * (0.7 + wetness * 0.3), angle: Math.atan2(dy, dx) });
          }
        }
      }
    }
    ctx.strokeStyle = rgba(mix(mid, light, 0.6), 0.9); ctx.lineWidth = 0.0037;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.bezierCurveTo(b.x, b.y, c.x, c.y, d.x, d.y); ctx.stroke();
    const p = cubic(a, b, c, d, 0.93); const direction = tangent(a, b, c, d, 0.94);
    fernLeaflet(ctx, p, direction.x, direction.y, 0.06 * reach, 0.0105, leafLight, vein);
  }
  // New fern fronds unfurl from a fine, curled crozier near the central crown.
  ctx.strokeStyle = rgba(mix(mid, light, 0.58)); ctx.lineWidth = 0.007;
  ctx.beginPath(); ctx.moveTo(0.018, 0.01); ctx.bezierCurveTo(0.043, -0.10, 0.068, -0.15 * reach, 0.041, -0.24 * reach); ctx.stroke();
  ctx.beginPath(); ctx.arc(0.018, -0.24 * reach, 0.023, 0, Math.PI * 1.83, true); ctx.stroke();
  ctx.fillStyle = rgba(dark, 0.8); ellipse(ctx, 0, 0.012, 0.044, 0.025);
  if (wetness > 0.001 && beads.length === 0) {
    // Even an unusually sparse seeded fern has an immediate visible mist cue.
    beads.push({ x: 0.018, y: -0.24 * reach, radius: 0.0085, angle: -0.25 });
  }
  for (const bead of beads) drawDew(ctx, bead.x, bead.y, bead.radius, wetness, 1.32, bead.angle);
}

interface FoliageLeaf { x: number; y: number; length: number; width: number; angle: number; shade: number; order: number; dewAnchor?: boolean }

function fittoniaLeaf(ctx: CanvasRenderingContext2D, leaf: FoliageLeaf, health: number, pink: boolean, wetness: number, wilt: number): void {
  const [dark, mid, light] = palette(health, wetness);
  ctx.save(); ctx.translate(leaf.x, leaf.y); ctx.rotate(leaf.angle);
  const length = leaf.length * (1 - wilt * .25); const width = leaf.width * (1 - wilt * .57);
  const leafFill = ctx.createLinearGradient(-width, -length * 0.5, width, -length * 0.45);
  leafFill.addColorStop(0, rgba(mix(mid, light, 0.18 + leaf.shade * 0.12)));
  leafFill.addColorStop(0.43, rgba(mix(dark, mid, 0.68)));
  leafFill.addColorStop(0.55, rgba(mix(dark, mid, 0.88)));
  leafFill.addColorStop(1, rgba(mix(dark, mid, 0.38)));
  ctx.fillStyle = leafFill;
  ctx.beginPath(); ctx.moveTo(0, 0);
  ctx.bezierCurveTo(-width * 0.56, -length * 0.03, -width * 1.14, -length * 0.39, -width * 0.67, -length * 0.68);
  ctx.bezierCurveTo(-width * 0.5, -length * 0.87, -width * 0.1, -length * 0.91, 0.014 * width, -length);
  ctx.bezierCurveTo(width * 0.18, -length * 0.85, width * 0.94, -length * 0.79, width * 0.9, -length * 0.45);
  ctx.bezierCurveTo(width * 0.93, -length * 0.16, width * 0.32, -length * 0.045, 0, 0);
  ctx.fill();
  ctx.strokeStyle = rgba(mix(mid, light, 0.55), 0.7); ctx.lineWidth = 0.002; ctx.stroke();
  ctx.save(); ctx.clip();
  const veinColor = pink ? mix([163, 91, 92], [226, 172, 163], health) : mix([160, 154, 119], [213, 214, 173], health);
  ctx.strokeStyle = rgba(veinColor, 0.93); ctx.lineWidth = 0.0034;
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.bezierCurveTo(-width * 0.16, -length * 0.24, width * 0.11, -length * 0.69, 0, -length * 0.96); ctx.stroke();
  for (let row = 0; row < 6; row += 1) {
    const t = 0.14 + row * 0.124;
    const nextT = t + 0.12;
    const broadness = Math.sin(Math.PI * (t + 0.075)) ** 0.8;
    const nextBroadness = Math.sin(Math.PI * (nextT + 0.075)) ** 0.8;
    for (const side of [-1, 1]) {
      const startX = Math.sin(t * 5) * width * 0.035;
      const startY = -length * t;
      const endX = side * width * broadness * (side < 0 ? 0.78 : 0.86);
      const endY = -length * (t + 0.15);
      ctx.lineWidth = 0.0023;
      ctx.beginPath(); ctx.moveTo(startX, startY);
      ctx.bezierCurveTo(side * width * 0.22, startY - length * 0.003, endX * 0.84, endY + length * 0.035, endX, endY); ctx.stroke();
      // Fine connecting veins form the characteristic irregular net, not stripes.
      ctx.lineWidth = 0.0012; ctx.strokeStyle = rgba(veinColor, 0.55);
      for (let branch = 1; branch <= 2; branch += 1) {
        const u = branch / 3;
        const bx = endX * u;
        const by = startY + (endY - startY) * u;
        const ex = side * width * nextBroadness * u * (side < 0 ? 0.78 : 0.86);
        const ey = -length * nextT - length * 0.15 * u;
        ctx.beginPath(); ctx.moveTo(bx, by);
        ctx.quadraticCurveTo(bx + side * width * 0.06, (by + ey) * 0.5, ex, ey); ctx.stroke();
      }
      ctx.strokeStyle = rgba(veinColor, 0.93);
    }
  }
  // Thin specular ridge suggests a gently folded, living leaf surface.
  ctx.strokeStyle = `rgba(221,234,188,${0.14 + wetness * 0.24})`; ctx.lineWidth = 0.008;
  ctx.beginPath(); ctx.moveTo(-width * 0.42, -length * 0.21);
  ctx.bezierCurveTo(-width * 0.7, -length * 0.46, -width * 0.46, -length * 0.69, -width * 0.14, -length * 0.84); ctx.stroke();
  if (wetness > 0.001) {
    const sheen = ctx.createLinearGradient(-width, -length * 0.57, width * 0.3, -length * 0.47);
    sheen.addColorStop(0, 'rgba(227,255,231,0)');
    sheen.addColorStop(0.34, `rgba(227,255,231,${wetness * 0.16})`);
    sheen.addColorStop(0.56, `rgba(227,255,231,${wetness * 0.035})`);
    sheen.addColorStop(1, 'rgba(227,255,231,0)');
    ctx.fillStyle = sheen; ctx.fillRect(-width * 1.2, -length, width * 2.4, length);
    if (leaf.dewAnchor || leaf.shade < 0.25 + wetness * 0.75) {
      const dewRandom = randomFor(`dew-fittonia:${leaf.x}:${leaf.y}:${leaf.angle}`);
      const count = 1 + Math.floor(wetness * 2);
      for (let i = 0; i < count; i += 1) {
        const px = (dewRandom() - 0.5) * width * 0.94;
        const py = -length * (0.25 + dewRandom() * 0.42);
        const radius = Math.min(width * 0.28, 0.009 + dewRandom() * 0.006) * (0.72 + wetness * 0.28);
        drawDew(ctx, px, py, radius, wetness, 1.03, -0.22);
      }
    }
  }
  ctx.restore(); ctx.restore();
}

function drawFittonia(ctx: CanvasRenderingContext2D, id: string, growth: number, health: number, wetness: number, shadow: boolean, condition: FoliageCondition2D): void {
  const maturity = Math.min(1.2, growth);
  const random = randomFor(`fittonia:${id}`);
  const pink = hash(id) % 3 !== 0;
  const [dark, mid, light] = palette(health, wetness);
  const wilt = condition.wilt;
  const reach = (0.56 + Math.sqrt(maturity / 1.2) * 0.44) * (1 - wilt * .2);
  if (shadow) groundShadow(ctx, 0.31 * reach, 0.058);
  const stems = 3 + Math.floor(maturity * 4);
  const leaves: FoliageLeaf[] = [];
  for (let i = 0; i < stems; i += 1) {
    const direction = (i / Math.max(1, stems - 1) - 0.5) * 0.49;
    const height = (0.43 + random() * 0.31) * reach;
    const baseX = (random() - 0.5) * 0.045;
    const topX = direction * reach * (1 + wilt * .35);
    const bend = (random() - 0.5) * 0.055;
    const a = { x: baseX, y: 0.016 };
    const b = { x: baseX + direction * 0.26, y: -height * 0.3 };
    const c = { x: topX + bend, y: -height * (.67 + wilt * .12) };
    const d = { x: topX, y: -height * (1 - wilt * .62) };
    ctx.strokeStyle = rgba(mix(dark, [117, 139, 72], health * 0.75)); ctx.lineWidth = 0.010;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.bezierCurveTo(b.x, b.y, c.x, c.y, d.x, d.y); ctx.stroke();
    ctx.strokeStyle = rgba(mix(mid, light, 0.36), 0.62); ctx.lineWidth = 0.0033;
    ctx.beginPath(); ctx.moveTo(a.x - 0.002, a.y); ctx.bezierCurveTo(b.x - 0.002, b.y, c.x - 0.002, c.y, d.x - 0.002, d.y); ctx.stroke();
    const rows = 2 + Math.floor(maturity * 1.7);
    for (let row = 0; row < rows; row += 1) {
      const t = 0.32 + row / Math.max(1, rows - 1) * 0.60;
      const p = cubic(a, b, c, d, t);
      for (const side of [-1, 1]) {
        const angle = side * (0.79 + random() * 0.43 + wilt * .95) + direction * 0.2;
        const petiole = (0.020 + random() * 0.022) * reach;
        const lx = p.x + Math.sin(angle) * petiole;
        const ly = p.y - Math.cos(angle) * petiole;
        ctx.strokeStyle = rgba(mix(mid, light, 0.24)); ctx.lineWidth = 0.004;
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(lx, ly); ctx.stroke();
        const length = (0.16 + random() * 0.073) * reach * (row === rows - 1 ? 0.82 : 1);
        leaves.push({ x: lx, y: ly, angle, length, width: length * (0.33 + random() * 0.08), shade: random(), order: ly + random() * 0.09 });
      }
    }
    leaves.push({ x: d.x, y: d.y, length: 0.13 * reach, width: 0.047 * reach, angle: direction * .7 + Math.sign(direction || .1) * wilt * 1.7, shade: 0.7, order: d.y - .05, dewAnchor: true });
  }
  leaves.sort((a, b) => a.order - b.order);
  for (const leaf of leaves) fittoniaLeaf(ctx, leaf, health, pink, wetness, wilt);
  ctx.fillStyle = rgba(dark, 0.78); ellipse(ctx, 0, 0.013, 0.046, 0.021);
}

function stoneOutline(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath(); ctx.moveTo(-0.35, 0.018);
  ctx.bezierCurveTo(-0.384, -0.054, -0.297, -0.185, -0.22, -0.209);
  ctx.bezierCurveTo(-0.178, -0.298, -0.041, -0.315, 0.052, -0.278);
  ctx.bezierCurveTo(0.17, -0.287, 0.32, -0.174, 0.346, -0.087);
  ctx.bezierCurveTo(0.387, 0.014, 0.303, 0.046, 0.19, 0.052);
  ctx.bezierCurveTo(0.018, 0.067, -0.204, 0.074, -0.35, 0.018);
  ctx.closePath();
}
function drawStone(ctx: CanvasRenderingContext2D, id: string, shadow: boolean): void {
  const random = randomFor(`stone:${id}`);
  if (shadow) groundShadow(ctx, 0.40, 0.072);
  const fill = ctx.createLinearGradient(-0.16, -0.3, 0.11, 0.075);
  fill.addColorStop(0, '#aaa99a'); fill.addColorStop(0.35, '#878e7e'); fill.addColorStop(0.62, '#707766'); fill.addColorStop(1, '#4c5144');
  stoneOutline(ctx); ctx.fillStyle = fill; ctx.fill();
  ctx.save(); ctx.clip();
  const soft = ctx.createRadialGradient(-0.13, -0.215, 0, -0.1, -0.18, 0.23);
  soft.addColorStop(0, 'rgba(218,219,199,.25)'); soft.addColorStop(1, 'rgba(218,219,199,0)');
  ctx.fillStyle = soft; ctx.fillRect(-0.4, -0.35, 0.8, 0.43);
  // Mineral grain is stable per object and entirely procedurally authored.
  for (let i = 0; i < 205; i += 1) {
    const x = (random() - 0.5) * 0.78; const y = -0.31 + random() * 0.39;
    const radius = 0.0015 + random() * 0.0045;
    ctx.fillStyle = random() > 0.53 ? 'rgba(229,229,201,.22)' : 'rgba(24,36,24,.20)';
    ellipse(ctx, x, y, radius * 1.4, radius);
  }
  ctx.strokeStyle = 'rgba(40,51,37,.23)'; ctx.lineWidth = 0.0028;
  ctx.beginPath(); ctx.moveTo(-0.22, -0.21); ctx.bezierCurveTo(-0.15, -0.135, -0.072, -0.14, -0.057, -0.064); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0.05, -0.274); ctx.bezierCurveTo(0.09, -0.199, 0.19, -0.19, 0.245, -0.123); ctx.stroke();
  ctx.strokeStyle = 'rgba(229,230,208,.19)'; ctx.lineWidth = 0.005;
  ctx.beginPath(); ctx.moveTo(-0.32, -0.09); ctx.bezierCurveTo(-0.30, -0.16, -0.25, -0.177, -0.21, -0.198); ctx.stroke();
  // Pale lichen patches sit on the upper, lit stone surface.
  for (let i = 0; i < 26; i += 1) {
    const x = -0.20 + random() * 0.19; const y = -0.232 + random() * 0.065;
    ctx.fillStyle = i % 3 === 0 ? 'rgba(170,180,121,.42)' : 'rgba(191,197,153,.32)';
    ellipse(ctx, x, y, 0.003 + random() * 0.008, 0.0025 + random() * 0.005);
  }
  ctx.restore();
}

function woodBranch(ctx: CanvasRenderingContext2D, a: Point, b: Point, c: Point, d: Point, width: number, tone: 'natural' | 'birch' | 'charred' = 'natural'): void {
  const fill = ctx.createLinearGradient(a.x, a.y - width, d.x, d.y + width);
  const colors = tone === 'birch' ? ['#d8d3bb', '#c9c7b2', '#b4b49e', '#989f8b'] : tone === 'charred' ? ['#686453', '#555549', '#484c41', '#3d453b'] : ['#a89978', '#8a7759', '#64583f', '#514a37'];
  fill.addColorStop(0, colors[0]); fill.addColorStop(0.38, colors[1]); fill.addColorStop(0.7, colors[2]); fill.addColorStop(1, colors[3]);
  ctx.strokeStyle = tone === 'birch' ? '#939986' : tone === 'charred' ? '#343e35' : '#3d3a2b'; ctx.lineWidth = width * 1.09;
  ctx.beginPath(); ctx.moveTo(a.x, a.y + 0.008); ctx.bezierCurveTo(b.x, b.y + 0.008, c.x, c.y + 0.008, d.x, d.y + 0.008); ctx.stroke();
  ctx.strokeStyle = fill; ctx.lineWidth = width;
  ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.bezierCurveTo(b.x, b.y, c.x, c.y, d.x, d.y); ctx.stroke();
  ctx.strokeStyle = tone === 'birch' ? 'rgba(249,244,216,.24)' : tone === 'charred' ? 'rgba(169,171,141,.13)' : 'rgba(222,206,162,.26)'; ctx.lineWidth = width * 0.16;
  ctx.beginPath(); ctx.moveTo(a.x, a.y - width * 0.23); ctx.bezierCurveTo(b.x, b.y - width * 0.23, c.x, c.y - width * 0.23, d.x, d.y - width * 0.23); ctx.stroke();
}
function drawEditableWood(ctx: CanvasRenderingContext2D, decoration: Decoration): void {
  const geometry = woodGeometry2D(decoration.wood), random = randomFor(`editable-wood:${decoration.id}`);
  const tone = decoration.wood?.tone ?? 'natural';
  for (const path of geometry.paths) {
    woodBranch(ctx, path.a, path.b, path.c, path.d, path.width, tone);
    const rows = tone === 'natural' ? path.branch < 0 ? 11 : 5 : path.branch < 0 ? 5 : 3;
    for (let row = 0; row < rows; row++) {
      const offset = (row / Math.max(1, rows - 1) - .5) * path.width * .77;
      ctx.strokeStyle = tone === 'birch' ? 'rgba(80,89,74,.13)' : tone === 'charred' ? 'rgba(154,156,132,.12)' : row % 3 ? 'rgba(46,40,27,.22)' : 'rgba(225,207,164,.18)'; ctx.lineWidth = .002 + random() * .001;
      ctx.beginPath();
      for (let sample = 0; sample <= 24; sample++) {
        const t = sample / 24, p = woodPathPoint2D(path, t), a = woodPathPoint2D(path, Math.max(0, t - .002)), b = woodPathPoint2D(path, Math.min(1, t + .002)), length = Math.max(.001, Math.hypot(b.x - a.x, b.y - a.y));
        const wave = offset + Math.sin(t * 17 + row) * .0015, x = p.x - (b.y - a.y) / length * wave, y = p.y + (b.x - a.x) / length * wave;
        if (sample) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      }
      ctx.stroke();
    }
    if (tone === 'birch') for (let mark = 0; mark < (path.branch < 0 ? 13 : 4); mark++) {
      const t = .04 + mark / (path.branch < 0 ? 13 : 4) * .9, p = woodPathPoint2D(path, t), a = woodPathPoint2D(path, Math.max(0, t - .003)), b = woodPathPoint2D(path, Math.min(1, t + .003)), length = Math.max(.001, Math.hypot(b.x - a.x, b.y - a.y)), nx = -(b.y - a.y) / length, ny = (b.x - a.x) / length;
      const side = mark % 2 ? 1 : -1, start = .06 * side, end = (.2 + random() * .22) * side;
      ctx.strokeStyle = 'rgba(72,79,66,.42)'; ctx.lineWidth = .005; ctx.beginPath(); ctx.moveTo(p.x + nx * path.width * start, p.y + ny * path.width * start); ctx.lineTo(p.x + nx * path.width * end, p.y + ny * path.width * end); ctx.stroke();
    }
    const tangent = Math.atan2(path.b.y - path.a.y, path.b.x - path.a.x);
    ctx.save(); ctx.translate(path.a.x, path.a.y); ctx.rotate(tangent); ctx.fillStyle = tone === 'birch' ? '#c9b792' : tone === 'charred' ? '#716c57' : '#aa9067'; ellipse(ctx, 0, 0, path.width * .19, path.width * .45); ctx.strokeStyle = tone === 'natural' ? 'rgba(69,52,31,.55)' : 'rgba(69,52,31,.42)'; ctx.lineWidth = .0025;
    for (let ring = 1; ring <= 3; ring++) { ctx.beginPath(); ctx.ellipse(0, 0, path.width * .04 * ring, path.width * .1 * ring, 0, 0, Math.PI * 2); ctx.stroke(); } ctx.restore();
  }
}
function drawWood(ctx: CanvasRenderingContext2D, id: string, shadow: boolean): void {
  const random = randomFor(`wood:${id}`);
  if (shadow) groundShadow(ctx, 0.47, 0.065);
  woodBranch(ctx, { x: 0.045, y: -0.065 }, { x: 0.087, y: -0.15 }, { x: 0.019, y: -0.261 }, { x: 0.071, y: -0.336 }, 0.043);
  woodBranch(ctx, { x: -0.08, y: -0.02 }, { x: -0.23, y: -0.071 }, { x: -0.24, y: -0.189 }, { x: -0.345, y: -0.211 }, 0.036);
  woodBranch(ctx, { x: 0.18, y: -0.108 }, { x: 0.26, y: -0.11 }, { x: 0.293, y: -0.049 }, { x: 0.414, y: -0.058 }, 0.022);
  const a = { x: -0.40, y: 0.012 }; const b = { x: -0.17, y: -0.043 };
  const c = { x: 0.026, y: -0.025 }; const d = { x: 0.31, y: -0.18 };
  woodBranch(ctx, a, b, c, d, 0.106);
  // Longitudinal grain follows the actual curved log, rather than a flat texture.
  for (let i = 0; i < 17; i += 1) {
    const offset = (i / 16 - 0.5) * 0.095;
    ctx.strokeStyle = i % 3 === 0 ? 'rgba(41,37,26,.39)' : 'rgba(225,207,164,.16)';
    ctx.lineWidth = 0.0018 + random() * 0.0018;
    ctx.beginPath();
    for (let j = 0; j <= 24; j += 1) {
      const t = j / 24; const p = cubic(a, b, c, d, t);
      const wave = Math.sin(t * 17 + i * 1.73) * 0.0028 + Math.sin(t * 31 + i) * 0.0014;
      const py = p.y + offset * (0.85 + Math.sin(t * Math.PI) * 0.15) + wave;
      if (j === 0) ctx.moveTo(p.x, py); else ctx.lineTo(p.x, py);
    }
    ctx.stroke();
  }
  // End grain, knots, broken bark and moss at the damp underside.
  ctx.save(); ctx.translate(-0.4, 0.012); ctx.rotate(-0.17);
  ctx.fillStyle = '#9a8765'; ellipse(ctx, 0, 0, 0.018, 0.050);
  ctx.strokeStyle = 'rgba(58,48,32,.55)'; ctx.lineWidth = 0.002;
  for (let i = 1; i <= 3; i += 1) { ctx.beginPath(); ctx.ellipse(0, 0, 0.004 * i, 0.012 * i, 0, 0, Math.PI * 2); ctx.stroke(); }
  ctx.restore();
  ctx.strokeStyle = 'rgba(40,35,23,.6)'; ctx.lineWidth = 0.003;
  ctx.beginPath(); ctx.ellipse(-0.09, -0.038, 0.025, 0.010, -0.14, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0.19, -0.109); ctx.lineTo(0.236, -0.138); ctx.lineTo(0.248, -0.157); ctx.stroke();
  for (let i = 0; i < 37; i += 1) {
    const t = 0.09 + random() * 0.59; const p = cubic(a, b, c, d, t);
    ctx.fillStyle = i % 3 ? 'rgba(80,100,43,.7)' : 'rgba(138,152,68,.8)';
    ellipse(ctx, p.x, p.y + 0.031 + random() * 0.019, 0.002 + random() * 0.006, 0.003 + random() * 0.005);
  }
}
