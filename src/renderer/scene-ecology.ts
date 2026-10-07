import type { Decoration, Plant } from '../shared/types';

/** Render-only interpretation of the bounded ecological state. It never advances
 * the clock or mutates a save, and old v0.8 plants retain a sensible fallback. */
export function unitEcology(value: number | undefined, fallback = 0): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value!)) : fallback;
}
export interface FoliageCondition2D { drought: number; waterlogging: number; wilt: number; pigment: number }
export function foliageCondition2D(plant: Pick<Plant, 'health' | 'ecology'>): FoliageCondition2D {
  const health = unitEcology(plant.health);
  const drought = unitEcology(plant.ecology?.drought, unitEcology((.64 - health) / .52));
  const waterlogging = unitEcology(plant.ecology?.waterlogging);
  return { drought, waterlogging, wilt: Math.max(drought, waterlogging * .86), pigment: health * (1 - drought * .84) };
}
export interface MushroomFlush2D { scale: number; fading: number; dormant: boolean }
/** A persistent colony alternates developing pins, a flush, fading caps and
 * resting pinheads. It is never depicted as the same immortal mature fruit. */
export function mushroomFlush2D(ecology: Plant['ecology']): MushroomFlush2D {
  if (!ecology) return { scale: 1, fading: 0, dormant: false };
  const cycle = unitEcology(ecology.cycle);
  if (cycle < .2) return { scale: .2 + cycle * 4, fading: 0, dormant: false };
  if (cycle < .6) return { scale: 1, fading: 0, dormant: false };
  if (cycle < .85) { const fading = (cycle - .6) / .25; return { scale: 1 - fading * .76, fading, dormant: false }; }
  return { scale: .15, fading: .82, dormant: true };
}
export function plantEcologyKey2D(plant: Pick<Plant, 'ecology'>): readonly number[] {
  const e = plant.ecology;
  return e ? [Math.round(unitEcology(e.drought) * 24), Math.round(unitEcology(e.waterlogging) * 24), Math.round(unitEcology(e.spread) * 24), Math.round(unitEcology(e.cycle) * 80)] : [];
}
export function decorationEcologyKey2D(item: Pick<Decoration, 'condition' | 'colonization'>): readonly number[] {
  return [Math.round(unitEcology(item.condition?.wetness) * 30), Math.round(unitEcology(item.condition?.decay) * 30), Math.round(unitEcology(item.condition?.mold) * 30), Math.round(unitEcology(item.colonization?.moss) * 30), Math.round(unitEcology(item.colonization?.health, 1) * 30)];
}
function seedOf(value: string): number { let n = 2166136261; for (let i = 0; i < value.length; i++) n = Math.imul(n ^ value.charCodeAt(i), 16777619); return n >>> 0; }
function randomFor(value: string): () => number { let n = seedOf(value); return () => { n = Math.imul(n, 1664525) + 1013904223 | 0; return (n >>> 0) / 4294967296; }; }
function oval(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number): void { ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); ctx.fill(); }

/** Paint on the finished sprite, including a slope-extended stump. source-atop
 * preserves every existing alpha value: no new shelf, hanging moss rectangle,
 * blocked fork opening or changed collision/contact silhouette can be created. */
export function drawObjectEcology2D(ctx: CanvasRenderingContext2D, item: Decoration, width: number, height: number): void {
  if (!(width > 0 && height > 0)) return;
  const wetness = unitEcology(item.condition?.wetness), wood = item.kind === 'wood' || item.kind === 'stump';
  const decay = wood ? unitEcology(item.condition?.decay) : 0, mold = wood ? unitEcology(item.condition?.mold) : 0;
  const moss = unitEcology(item.colonization?.moss), health = unitEcology(item.colonization?.health, 1);
  if (!(wetness || decay || mold || moss)) return;
  ctx.save(); ctx.globalCompositeOperation = 'source-atop'; ctx.lineCap = 'round';
  if (wetness) { ctx.fillStyle = `rgba(18,42,29,${wetness * .24})`; ctx.fillRect(0, 0, width, height); }
  if (decay) {
    ctx.fillStyle = `rgba(25,24,20,${decay * .48})`; ctx.fillRect(0, 0, width, height);
    const rng = randomFor(`decay:${item.id}`);
    for (let i = 0; i < 40; i++) { const x = rng() * width, y = rng() * height, radius = 3 + rng() * 13;
      ctx.fillStyle = `rgba(24,29,23,${decay * (.09 + rng() * .2)})`; oval(ctx, x, y, radius, radius * .56); }
  }
  if (mold) {
    const rng = randomFor(`mold:${item.id}`);
    for (let i = 0; i < 55; i++) {
      const x = rng() * width, y = rng() * height, radius = 2 + rng() * 7;
      if (rng() > mold) continue;
      ctx.fillStyle = `rgba(213,217,182,${.22 + mold * .34})`; oval(ctx, x, y, radius, radius * .62);
      ctx.strokeStyle = `rgba(228,230,200,${.32 + mold * .34})`; ctx.lineWidth = .65;
      for (let hair = 0; hair < 7; hair++) { const angle = hair / 7 * Math.PI * 2, px = x + Math.cos(angle) * radius * .5, py = y + Math.sin(angle) * radius * .35;
        ctx.beginPath(); ctx.moveTo(px, py); ctx.quadraticCurveTo(px + Math.sin(angle) * 1.5, py - 2, px + Math.cos(angle) * 3, py - 3.5); ctx.stroke(); }
    }
  }
  if (moss) {
    const rng = randomFor(`cover:${item.id}`), size = 3 + moss * 7;
    const freshness = unitEcology((health - .2) / .65);
    const color = (dry: readonly number[], green: readonly number[], alpha: number): string =>
      `rgba(${dry.map((value, i) => Math.round(value + (green[i] - value) * freshness)).join(',')},${alpha})`;
    // The mature colony closes its gaps as a coherent carpet. Sparse early
    // islands keep the prop readable; they are not a regular grid of buttons.
    if (moss > .42) {
      ctx.fillStyle = color([163, 126, 48], [83, 118, 42], (moss - .42) / .58 * .8);
      ctx.fillRect(0, 0, width, height);
    }
    const count = Math.ceil(width * height / 43);
    for (let i = 0; i < count; i++) {
      const chance = rng(), px = rng() * width, py = rng() * height, variation = rng();
      if (chance > .10 + moss * .88) continue;
      const radius = size * (.65 + variation * .55);
      // No dark outline or displaced highlight on every island: restrained
      // pigment variations overlap rather than reading as repeated roof tiles.
      ctx.fillStyle = color([174 + variation * 12, 136 + variation * 14, 50], [86 + variation * 18, 121 + variation * 18, 43 + variation * 5], .58);
      oval(ctx, px, py, radius, radius * (.54 + variation * .2));
      ctx.strokeStyle = color([217, 181, 80], [153, 177, 76], .48); ctx.lineWidth = .62;
      for (let hair = 0; hair < 4; hair++) {
        const jitter = Math.sin(i * 2.17 + hair * 4.3), bx = px + jitter * radius * .65, by = py + Math.cos(i * 1.23 + hair) * radius * .42;
        ctx.beginPath(); ctx.moveTo(bx, by); ctx.quadraticCurveTo(bx + jitter * .9, by - 1, bx + jitter * 1.5, by - 1.4 - variation * 1.8); ctx.stroke();
      }
    }
  }
  ctx.restore();
}
