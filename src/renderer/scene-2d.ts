import type { Decoration, DecorationKind, GlassControlPoint, GlassSideName, MaterialKind, Plant, PlantKind, SupportAttachment, TerrariumState } from '../shared/types';
import { defaultGlassSide, isFloatingDecoration, isMossKind, isMushroomKind, MATERIAL_KINDS, MAX_SUPPORT_DEPTH, woodPresetForm } from '../shared/catalog';
import { floatingPoint2D, floatingPosition2D } from './scene-floating';
import { decorationBounds2D, drawDecoration, drawPlant, mushroomStemFeet2D } from './scene-botany';
import { drawUprightStump2D } from './scene-object-art';
import { decorationEcologyKey2D, drawObjectEcology2D, foliageCondition2D, plantEcologyKey2D } from './scene-ecology';
import { contactRoots2D, stumpFeet2D } from './scene-2d-contact';
import type { ContactRoot2D, RootFoot2D } from './scene-2d-contact';
import { aboveTerrain2D, clamp2D, DEFAULT_FORM, FLOOR_Y, hash2D, inVessel2D, mossStripOffset2D, normalizedX2D, openingEnds2D, openingPolygon2D, openingY2D, pondDepth2D, pondPoint2D, random2D, root2D, SCENE_HEIGHT, SCENE_WIDTH, sculptControlPoint2D, sculptControlValue2D, sculptValue2D, soilBands2D, surfaceY2D, vessel2D, vesselRadius2D } from './scene-2d-geometry';
import { bearingProfile2D, excludedSupports2D, mossDrapeOffsets2D, nearestSupport2D, resolveGrounding2D, supportContactHeight2D, supportLocalX2D, supportOrder2D, supportPoint2D, supportProfile2D } from './scene-2d-layout';
import type { BearingProfile2D, SupportProfile2D, SupportSurface2D } from './scene-2d-layout';
import type { GlassBand2D, Point2D, Vessel2D } from './scene-2d-geometry';
import type { PlacementPreview, Position, Selection } from './scene';

export { SCENE_HEIGHT, SCENE_WIDTH };
export interface ScenePreview extends Position { selection: Selection }
export interface SculptHandle { side: GlassSideName; key: GlassBand2D; clientX: number; clientY: number; value: number; height: number }
export const MATERIAL_COLOR: Record<MaterialKind, string> = { soil: '#66513d', clay: '#aa7a4e', gravel: '#969f8a', coir: '#99805a', bark: '#7b5940', charcoal: '#424c42' };
interface Sprite { canvas: HTMLCanvasElement; alpha: Uint8ClampedArray; artCanvas: HTMLCanvasElement; artAlpha: Uint8ClampedArray; artOriginY: number; contactKey: string; contactRoots: ContactRoot2D[]; rootFeet: RootFoot2D[]; key: string; scale: number; originX: number; originY: number; type: Selection['type']; id: string; root: Point2D; order: number; moss: boolean; floating: boolean; minX: number; maxX: number; offsets: Float64Array; profile: SupportProfile2D; bearing: BearingProfile2D; parent: SupportSurface2D | null; depth: number }
const PLACEMENT_ID = '__mosslight_placement_preview__';
function context(canvas: HTMLCanvasElement): CanvasRenderingContext2D { const result = canvas.getContext('2d'); if (!result) throw new Error('Canvas 2D is unavailable.'); return result; }
function canvas2D(width = SCENE_WIDTH, height = SCENE_HEIGHT): HTMLCanvasElement { const result = document.createElement('canvas'); result.width = width; result.height = height; return result; }
function releaseSprite(sprite: Sprite): void { if (sprite.canvas !== sprite.artCanvas) sprite.canvas.width = sprite.canvas.height = 0; sprite.artCanvas.width = sprite.artCanvas.height = 0; sprite.alpha = sprite.artAlpha = new Uint8ClampedArray(); }
function pathPoints(ctx: CanvasRenderingContext2D, points: readonly Point2D[]): void { ctx.beginPath(); for (let i = 0; i < points.length; i++) { if (!i) ctx.moveTo(points[i].x, points[i].y); else ctx.lineTo(points[i].x, points[i].y); } ctx.closePath(); }
function vesselPath(ctx: CanvasRenderingContext2D, vessel: Vessel2D): void { pathPoints(ctx, vessel.outline); }
function ellipse(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number): void { ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); ctx.fill(); }
/** Flat, coherent pigment patterns. No per-particle specular highlights, bevels or 3D shading. */
function materialTile(material: MaterialKind): HTMLCanvasElement {
  const tile = canvas2D(96, 96), ctx = context(tile), rng = random2D(hash2D(material)); ctx.fillStyle = MATERIAL_COLOR[material]; ctx.fillRect(0, 0, 96, 96); ctx.lineCap = 'round';
  const count = material === 'clay' ? 130 : material === 'soil' ? 240 : 150;
  for (let i = 0; i < count; i++) {
    const x = rng() * 96, y = rng() * 96, radius = 1.3 + rng() * (material === 'clay' || material === 'gravel' ? 2.9 : 1.8);
    ctx.save(); ctx.translate(x, y); ctx.rotate(rng() * Math.PI);
    ctx.fillStyle = rng() < .5 ? 'rgba(40,31,22,.13)' : 'rgba(237,214,165,.12)'; ctx.strokeStyle = ctx.fillStyle;
    if (material === 'coir') { ctx.lineWidth = .6 + rng() * .6; ctx.beginPath(); ctx.moveTo(-radius * 2.5, 0); ctx.quadraticCurveTo(-radius, -radius * .6, radius * 2.5, radius * .3); ctx.stroke(); }
    else if (material === 'bark' || material === 'charcoal') { ctx.beginPath(); ctx.roundRect(-radius * 1.8, -radius * .55, radius * 3.6, radius * 1.1, radius * .32); ctx.fill(); }
    else { ellipse(ctx, 0, 0, radius, radius * (material === 'clay' ? .95 : .7)); }
    ctx.restore();
  }
  return tile;
}
/** Canvas-only living illustration. Stable offscreen layers are reused between care-effect frames. */
export class CanvasTerrarium {
  readonly canvas = canvas2D();
  readonly silhouetteCanvas = canvas2D();
  private readonly glassCanvas = canvas2D();
  private readonly terrainCanvas = canvas2D();
  private readonly patterns = new Map<MaterialKind, CanvasPattern>();
  private readonly sprites = new Map<string, Sprite>();
  private entities: Sprite[] = [];
  private readonly supports = new Map<string, SupportSurface2D>();
  private state: TerrariumState | null = null;
  private vessel = vessel2D('round');
  private preview: ScenePreview | null = null;
  private glassKey = '';
  private terrainKey = '';
  private sceneKey = '';
  private renderSizeDirty = true;
  private disposed = false;
  private counts = { terrainBuilds: 0, glassBuilds: 0, botanyBuilds: 0, contactBuilds: 0, frames: 0, silhouetteTests: 0, silhouetteBuilds: 0, spriteReadbacks: 0, frameMs: 0, maxFrameMs: 0 };
  constructor(private readonly widget = false) {
    const ctx = context(this.terrainCanvas); for (const material of MATERIAL_KINDS) { const pattern = ctx.createPattern(materialTile(material), 'repeat'); if (pattern) this.patterns.set(material, pattern); }
  }
  resize(width: number): boolean {
    const next = Math.round(clamp2D(width, this.widget ? 180 : 360, this.widget ? 480 : 1200));
    if (this.canvas.width === next) return false; this.canvas.width = next; this.canvas.height = Math.round(next * SCENE_HEIGHT / SCENE_WIDTH); this.renderSizeDirty = true; return true;
  }
  private rebuildGlass(state: TerrariumState): void {
    this.vessel = vessel2D(state.bottle, state.glassForm ?? DEFAULT_FORM); const vessel = this.vessel, ctx = context(this.glassCanvas), mask = context(this.silhouetteCanvas);
    ctx.clearRect(0, 0, SCENE_WIDTH, SCENE_HEIGHT); mask.clearRect(0, 0, SCENE_WIDTH, SCENE_HEIGHT); mask.fillStyle = '#fff'; vesselPath(mask, vessel); mask.fill();
    // Glass is transparent in the desktop companion; the warm wash remains very light.
    vesselPath(ctx, vessel); ctx.fillStyle = 'rgba(212,230,199,.075)'; ctx.fill();
    ctx.strokeStyle = 'rgba(89,111,82,.53)'; ctx.lineWidth = 2.1; ctx.lineJoin = 'round'; ctx.stroke();
    ctx.save(); vesselPath(ctx, vessel); ctx.clip();
    const wash = ctx.createLinearGradient(85, 0, 505, 0); wash.addColorStop(0, 'rgba(248,255,229,.10)'); wash.addColorStop(.27, 'rgba(246,249,215,.025)'); wash.addColorStop(.72, 'rgba(253,252,229,.01)'); wash.addColorStop(1, 'rgba(119,152,107,.07)'); ctx.fillStyle = wash; ctx.fillRect(65, vessel.top, 470, FLOOR_Y - vessel.top);
    ctx.strokeStyle = 'rgba(255,255,245,.57)'; ctx.lineWidth = 4; ctx.lineCap = 'round'; ctx.beginPath();
    const start = openingEnds2D(vessel).left.y + 45, end = Math.min(FLOOR_Y - 100, start + 145); for (let y = start; y <= end; y += 3) { const x = 300 - vesselRadius2D(vessel, y, 13, 'left'); if (y === start) ctx.moveTo(x, y); else ctx.lineTo(x, y); } ctx.stroke(); ctx.restore();
    if (state.bottle === 'glass-box') {
      ctx.strokeStyle = 'rgba(76,107,81,.34)'; ctx.lineWidth = 1.1;
      const mouth = openingPolygon2D(vessel), ends = openingEnds2D(vessel);
      for (const point of mouth.filter(point => point.y >= openingY2D(vessel, point.x))) {
        const t = (point.x - ends.left.x) / (ends.right.x - ends.left.x); if (t < .015 || t > .985) continue;
        ctx.beginPath(); ctx.moveTo(point.x, point.y); for (const y of [FLOOR_Y - 285, FLOOR_Y - 112, FLOOR_Y]) ctx.lineTo(300 - vesselRadius2D(vessel, y, 0, 'left') + t * (vesselRadius2D(vessel, y, 0, 'left') + vesselRadius2D(vessel, y)), y); ctx.stroke();
      }
    }
    const rim = vesselRadius2D(vessel, vessel.top), open = state.bottle === 'open-cylinder' || state.bottle === 'open-cube' || state.bottle === 'cat';
    ctx.strokeStyle = 'rgba(91,119,90,.62)'; ctx.lineWidth = 2.2; ctx.fillStyle = 'rgba(249,253,229,.12)';
    if (state.bottle === 'glass-box') { pathPoints(ctx, openingPolygon2D(vessel)); ctx.fill(); ctx.stroke(); }
    else { ctx.beginPath(); ctx.ellipse(300, vessel.top, rim, state.bottle === 'open-cube' ? 6 : 9, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
    if (state.bottle === 'cat') {
      for (const side of [-1, 1]) { const points = [{ x: 300 + side * 125, y: vessel.top + 37 }, { x: 300 + side * 120, y: vessel.top - 28 }, { x: 300 + side * 72, y: vessel.top + 4 }]; pathPoints(ctx, points); ctx.fillStyle = 'rgba(213,232,204,.19)'; ctx.fill(); ctx.stroke(); pathPoints(mask, points); mask.fill(); }
      // A quiet etched face; no copied character or brand imagery.
      ctx.strokeStyle = 'rgba(83,108,78,.30)'; ctx.lineWidth = 1.3;
      for (const side of [-1, 1]) { ctx.beginPath(); ctx.arc(300 + side * 43, vessel.top + 95, 8, .1, Math.PI - .1); ctx.stroke(); } ctx.beginPath(); ctx.moveTo(295, vessel.top + 109); ctx.quadraticCurveTo(300, vessel.top + 115, 305, vessel.top + 109); ctx.stroke();
    }
    if (state.closed && !open) {
      const top = vessel.top - 13;
      if (state.bottle === 'glass-box') { const lid = openingPolygon2D(vessel).map(point => ({ x: point.x, y: point.y - 9 })); ctx.fillStyle = 'rgba(215,233,207,.26)'; ctx.strokeStyle = 'rgba(91,119,90,.63)'; ctx.lineWidth = 2; pathPoints(ctx, lid); ctx.fill(); ctx.stroke(); pathPoints(mask, lid); mask.fill(); }
      else { ctx.fillStyle = '#c9b386'; ctx.beginPath(); ctx.roundRect(297 - rim, top, rim * 2 + 6, 18, 5); ctx.fill(); ctx.fillStyle = '#dbc596'; ellipse(ctx, 300, top + 3, rim + 2, 6); const rng = random2D(2918); ctx.fillStyle = '#8f78472b'; for (let i = 0; i < 50; i++) ellipse(ctx, 300 - rim + rng() * rim * 2, top + 3 + rng() * 12, .7 + rng(), .5); }
      if (state.bottle !== 'glass-box') mask.fillRect(297 - rim, top, rim * 2 + 6, 19);
    }
    this.counts.glassBuilds++; this.counts.silhouetteBuilds++;
  }
  private terrainClip(ctx: CanvasRenderingContext2D, above: boolean): void {
    if (!this.state) return; const points: Point2D[] = [];
    for (let i = 0; i <= 192; i++) points.push(root2D(this.vessel, this.state.terrain, i / 192));
    ctx.beginPath(); ctx.moveTo(0, above ? 0 : SCENE_HEIGHT); ctx.lineTo(0, points[0].y);
    for (const point of points) ctx.lineTo(point.x, point.y);
    ctx.lineTo(SCENE_WIDTH, points[points.length - 1].y); ctx.lineTo(SCENE_WIDTH, above ? 0 : SCENE_HEIGHT); ctx.closePath(); ctx.clip();
  }
  private rebuildTerrain(): void {
    if (!this.state) return; const terrain = this.state.terrain, vessel = this.vessel, ctx = context(this.terrainCanvas); ctx.clearRect(0, 0, SCENE_WIDTH, SCENE_HEIGHT);
    ctx.save(); vesselPath(ctx, vessel); ctx.clip(); this.terrainClip(ctx, false);
    const bands = soilBands2D(vessel, terrain);
    for (const material of MATERIAL_KINDS) {
      ctx.beginPath();
      for (const band of bands) {
        if (band.material !== material) continue;
        ctx.moveTo(band.top[0].x, band.top[0].y); for (const point of band.top.slice(1)) ctx.lineTo(point.x, point.y);
        for (let i = band.bottom.length - 1; i >= 0; i--) ctx.lineTo(band.bottom[i].x, band.bottom[i].y); ctx.closePath();
      }
      ctx.fillStyle = this.patterns.get(material) ?? MATERIAL_COLOR[material]; ctx.fill(); ctx.strokeStyle = ctx.fillStyle; ctx.lineWidth = .55; ctx.stroke();
    }
    ctx.restore(); this.counts.terrainBuilds++;
  }
  private sprite(item: Plant | Decoration, type: Selection['type'], position: Position): Sprite {
    const plant = item as Plant, decoration = item as Decoration, key = type === 'plant' ? JSON.stringify([type, item.kind, Math.round(plant.growth * 40), Math.round(plant.health * 30), Math.round(plant.wetness * 30), plantEcologyKey2D(plant)]) : JSON.stringify([type, item.kind, decoration.wood, decoration.variant, decoration.pose, decorationEcologyKey2D(decoration)]);
    let sprite = this.sprites.get(item.id);
    if (!sprite || sprite.key !== key) {
      // Fixed natural units make the mask invariant to desktop window size.
      const unit = 166, bounds = type === 'decoration' ? decorationBounds2D(decoration) : null;
      const originX = bounds ? Math.ceil(-bounds.left * unit) + 10 : 240, originY = bounds ? Math.ceil(-bounds.top * unit) + 10 : 400;
      const image = canvas2D(bounds ? Math.ceil((bounds.right - bounds.left) * unit) + 22 : 480, bounds ? Math.ceil((bounds.bottom - bounds.top) * unit) + 22 : 480), ctx = context(image), scale = clamp2D(item.scale, .4, 2);
      if (type === 'plant') drawPlant(ctx, { ...plant, scale: 1, growth: Math.round(plant.growth * 40) / 40, health: Math.round(plant.health * 30) / 30, wetness: Math.round(plant.wetness * 30) / 30 }, originX, originY, unit, { groundShadow: false });
      else drawDecoration(ctx, { ...(item as Decoration), scale: 1 }, originX, originY, unit, { groundShadow: false });
      if (type === 'decoration') drawObjectEcology2D(ctx, decoration, image.width, image.height);
      const pixels = ctx.getImageData(0, 0, image.width, image.height).data, alpha = new Uint8ClampedArray(image.width * image.height);
      let minX = image.width, maxX = 0;
      for (let i = 0; i < alpha.length; i++) { alpha[i] = pixels[i * 4 + 3]; if (alpha[i] > 0) { minX = Math.min(minX, i % image.width); maxX = Math.max(maxX, i % image.width); } }
      if (sprite) releaseSprite(sprite);
      const bearing = bearingProfile2D(alpha, image.width, image.height, originX, originY, item.kind, unit);
      const centralFoot = bearing.points.reduce<Point2D | null>((best, point) => !best || Math.abs(point.x) < Math.abs(best.x) ? point : best, null);
      const rootFeet = item.kind === 'stump' && decoration.variant !== 'fallen' ? stumpFeet2D(alpha, image.width, image.height, originX, originY, unit) : isMushroomKind(item.kind) ? mushroomStemFeet2D(item.id, Math.round(plant.growth * 40) / 40, plant.ecology).map(foot => ({ x: foot.x * unit, y: foot.y * unit, width: foot.width * unit })) : ['fern', 'fittonia', 'creeping-fig', 'oxalis'].includes(item.kind) && centralFoot ? [{ ...centralFoot, width: item.kind === 'fern' ? 3.5 : 4.5 }] : [];
      sprite = { canvas: image, alpha, artCanvas: image, artAlpha: alpha, artOriginY: originY, contactKey: '', contactRoots: [], rootFeet, key, scale, originX, originY, type, id: item.id, root: { x: 300, y: FLOOR_Y }, order: 0, moss: type === 'plant' && isMossKind(item.kind), floating: type === 'decoration' && isFloatingDecoration(item.kind), minX, maxX, offsets: new Float64Array(image.width), profile: supportProfile2D(alpha, image.width, image.height, originX, originY), bearing, parent: null, depth: 0 }; this.sprites.set(item.id, sprite); this.counts.botanyBuilds++; this.counts.spriteReadbacks++;
    }
    sprite.scale = clamp2D(item.scale, .4, 2);
    if (type === 'decoration' && isFloatingDecoration(item.kind)) {
      sprite.parent = null; sprite.depth = MAX_SUPPORT_DEPTH + 1; sprite.order = position.y;
      sprite.root = floatingPoint2D(this.vessel, position);
      return sprite; // No grounding, roots, ecological contact or structural surface.
    }
    sprite.parent = position.support ? this.supports.get(position.support.parentId) ?? null : null;
    sprite.depth = sprite.parent ? Math.min(MAX_SUPPORT_DEPTH, (this.sprites.get(sprite.parent.id)?.depth ?? 0) + 1) : 0;
    const anchor = sprite.parent && position.support ? supportPoint2D(sprite.parent, position.support.x) : this.rootAt({ x: position.x, y: position.y });
    sprite.root = sprite.moss || !this.state ? anchor : resolveGrounding2D(sprite.bearing, anchor, sprite.scale, x => {
      if (sprite.parent) { const y = supportContactHeight2D(sprite.parent, x); return y !== null && inVessel2D(this.vessel, { x, y }) && aboveTerrain2D(this.vessel, this.state!.terrain, { x, y }) ? y : null; }
      const y = surfaceY2D(this.vessel, this.state!.terrain, normalizedX2D(this.vessel, this.state!.terrain, x)); return inVessel2D(this.vessel, { x, y }) ? y : null;
    }).origin; sprite.order = position.y;
    if (sprite.moss && this.state) {
      if (sprite.parent) sprite.offsets = mossDrapeOffsets2D(sprite.parent, sprite.root, sprite.canvas.width, sprite.originX, sprite.scale, sprite.minX, sprite.maxX);
      else for (let x = sprite.minX; x <= sprite.maxX; x++) { const worldX = sprite.root.x + (x + .5 - sprite.originX) * sprite.scale; sprite.offsets[x] = mossStripOffset2D(this.vessel, this.state.terrain, sprite.root, worldX); }
    }
    if (sprite.rootFeet.length) this.seatRoots(sprite, item);
    if (type === 'decoration') this.supports.set(item.id, { id: item.id, root: sprite.root, scale: sprite.scale, profile: sprite.profile });
    return sprite;
  }
  private seatRoots(sprite: Sprite, item: Plant | Decoration): void {
    if (!this.state) return;
    const kind = item.kind;
    const roots = contactRoots2D(sprite.rootFeet, sprite.root, sprite.scale, x => {
      const soil = surfaceY2D(this.vessel, this.state!.terrain, normalizedX2D(this.vessel, this.state!.terrain, x));
      if (!inVessel2D(this.vessel, { x, y: soil })) return null;
      const support = sprite.parent ? supportContactHeight2D(sprite.parent, x) : null;
      // A stump perched on a branch keeps its own volume. It must not grow a
      // thin soil-reaching post through the air outside the finite support.
      if (kind === 'stump' && sprite.parent) return null;
      return Math.min(FLOOR_Y, support === null ? soil : Math.min(soil, support));
    });
    const cropTop = Math.max(0, Math.floor((this.vessel.top - 32 - sprite.root.y) / sprite.scale + sprite.artOriginY));
    const cropBottom = Math.min(Math.max(sprite.artCanvas.height, ...roots.map(root => root.bottom + sprite.artOriginY + 3)), Math.ceil((FLOOR_Y + 3 - sprite.root.y) / sprite.scale + sprite.artOriginY));
    const key = JSON.stringify([roots, cropTop, cropBottom]); if (key === sprite.contactKey) return;
    sprite.contactKey = key; sprite.contactRoots = roots;
    if (sprite.canvas !== sprite.artCanvas) sprite.canvas.width = sprite.canvas.height = 0;
    const image = canvas2D(sprite.artCanvas.width, Math.max(1, cropBottom - cropTop)), ctx = context(image);
    sprite.originY = sprite.artOriginY - cropTop; ctx.translate(sprite.originX, sprite.originY);
    if (kind === 'stump') {
      const byX = new Map(roots.map(root => [root.x, root.bottom]));
      const base = sprite.rootFeet.map(foot => ({ x: foot.x / 166, y: Math.max(foot.y, byX.get(foot.x) ?? foot.y) / 166 }));
      ctx.save(); ctx.scale(166, 166); drawUprightStump2D(ctx, base); ctx.restore();
    } else {
      ctx.lineCap = 'round';
      const leafy = ['fern', 'fittonia', 'creeping-fig', 'oxalis'].includes(kind);
      const dry = leafy && foliageCondition2D(item as Plant).drought > .45;
      for (const root of roots) { ctx.strokeStyle = leafy ? dry ? '#987b38' : '#52653b' : kind === 'ivory-mushroom' ? '#d7cfad' : '#d4b67b'; ctx.lineWidth = root.width; ctx.beginPath(); ctx.moveTo(root.x, root.top); ctx.lineTo(root.x, root.bottom); ctx.stroke(); ctx.strokeStyle = leafy ? dry ? 'rgba(219,182,83,.35)' : 'rgba(158,183,92,.35)' : 'rgba(255,245,210,.62)'; ctx.lineWidth = root.width * .32; ctx.beginPath(); ctx.moveTo(root.x - root.width * .2, root.top); ctx.lineTo(root.x - root.width * .2, root.bottom); ctx.stroke(); }
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (kind === 'stump') drawObjectEcology2D(ctx, item as Decoration, image.width, image.height);
    if (kind !== 'stump') ctx.drawImage(sprite.artCanvas, 0, -cropTop);
    const pixels = ctx.getImageData(0, 0, image.width, image.height).data, alpha = new Uint8ClampedArray(image.width * image.height);
    for (let i = 0; i < alpha.length; i++) alpha[i] = pixels[i * 4 + 3];
    sprite.canvas = image; sprite.alpha = alpha; sprite.profile = supportProfile2D(alpha, image.width, image.height, sprite.originX, sprite.originY);
    this.counts.contactBuilds++; this.counts.spriteReadbacks++;
  }
  render(state: TerrariumState, preview: ScenePreview | null, placement: PlacementPreview | null = null): boolean {
    if (this.disposed) return false; const started = performance.now();
    if (placement) {
      const shared = { id: PLACEMENT_ID, ...placement.position, scale: 1 };
      state = placement.type === 'plant' ? { ...state, plants: [...state.plants, { ...shared, kind: placement.kind as Plant['kind'], growth: .25, health: .9, wetness: 0, ageDays: 0 }] } : { ...state, decorations: [...state.decorations, { ...shared, kind: placement.kind as Decoration['kind'], ...(placement.variant ? {variant:placement.variant} : {}), ...(placement.pose ? {pose:placement.pose} : {}), ...(placement.kind === 'wood' && placement.woodPreset ? { wood: woodPresetForm(placement.woodPreset) } : {}) }] };
    }
    this.state = state; this.preview = preview;
    const glassKey = JSON.stringify([state.bottle, state.glassForm, state.closed]), terrainKey = glassKey + JSON.stringify(state.terrain);
    const plants = state.plants.map(plant => [plant.id, plant.kind, plant.x, plant.y, plant.scale, plant.support, Math.round(plant.growth * 40), Math.round(plant.health * 30), Math.round(plant.wetness * 30), plantEcologyKey2D(plant)]);
    const sceneKey = terrainKey + JSON.stringify([plants, state.decorations, state.pond, preview]); if (sceneKey === this.sceneKey && !this.renderSizeDirty) return false;
    if (glassKey !== this.glassKey) { this.glassKey = glassKey; this.rebuildGlass(state); }
    if (terrainKey !== this.terrainKey) { this.terrainKey = terrainKey; this.rebuildTerrain(); }
    const ids = new Set([...state.plants, ...state.decorations].map(item => item.id)); for (const [id, sprite] of this.sprites) if (!ids.has(id)) { releaseSprite(sprite); this.sprites.delete(id); }
    this.supports.clear();
    const decorations = state.decorations.map(item => preview?.selection.id === item.id ? { ...item, ...preview, support: preview.support ?? undefined } : item);
    this.entities = [...supportOrder2D(decorations).map(item => this.sprite(item, 'decoration', item)), ...state.plants.map(item => this.sprite(item, 'plant', preview?.selection.id === item.id ? preview : item))].sort((a, b) => a.depth - b.depth || a.order - b.order);
    const ctx = context(this.canvas), ratio = this.canvas.width / SCENE_WIDTH; ctx.setTransform(ratio, 0, 0, ratio, 0, 0); ctx.clearRect(0, 0, SCENE_WIDTH, SCENE_HEIGHT);
    ctx.save(); vesselPath(ctx, this.vessel); ctx.clip(); ctx.drawImage(this.terrainCanvas, 0, 0); ctx.save(); this.terrainClip(ctx, true);
    const highlighted = placement?.position.support ?? preview?.support;
    if (highlighted && !this.widget) this.paintSupportTarget(ctx, highlighted);
    for (const sprite of this.entities) {
      if (sprite.floating) continue;
      ctx.save();
      if (sprite.id === PLACEMENT_ID) ctx.globalAlpha = .58;
      if (sprite.parent && !sprite.moss) this.clipAboveSupport(ctx, sprite.parent);
      if (sprite.moss) {
        for (let x = sprite.minX; x <= sprite.maxX; x++) ctx.drawImage(sprite.canvas, x, 0, 1, sprite.canvas.height, sprite.root.x + (x - sprite.originX) * sprite.scale, sprite.root.y - sprite.originY * sprite.scale + sprite.offsets[x], sprite.scale + .18, sprite.canvas.height * sprite.scale);
      } else ctx.drawImage(sprite.canvas, sprite.root.x - sprite.originX * sprite.scale, sprite.root.y - sprite.originY * sprite.scale, sprite.canvas.width * sprite.scale, sprite.canvas.height * sprite.scale);
      ctx.restore();
    }
    this.paintPond(ctx);
    ctx.restore();
    // Airborne ornaments are a foreground illustration layer. They remain
    // selectable even over a tall landscape; only the glass clips their art.
    for (const sprite of this.entities) if (sprite.floating) {
      ctx.save(); if (sprite.id === PLACEMENT_ID) ctx.globalAlpha = .58;
      ctx.drawImage(sprite.canvas, sprite.root.x - sprite.originX * sprite.scale, sprite.root.y - sprite.originY * sprite.scale, sprite.canvas.width * sprite.scale, sprite.canvas.height * sprite.scale);
      ctx.restore();
    }
    ctx.restore(); ctx.drawImage(this.glassCanvas, 0, 0);
    this.sceneKey = sceneKey; this.renderSizeDirty = false; this.counts.frames++; this.counts.frameMs = performance.now() - started; this.counts.maxFrameMs = Math.max(this.counts.maxFrameMs, this.counts.frameMs); return true;
  }
  private paintSupportTarget(ctx: CanvasRenderingContext2D, attachment: SupportAttachment): void {
    const surface = this.supports.get(attachment.parentId); if (!surface) return;
    const point = supportPoint2D(surface, attachment.x), profile = surface.profile;
    ctx.save(); ctx.lineCap = 'round';
    for (const [width, color] of [[7, 'rgba(166,192,110,.25)'], [2, '#9bb668']] as const) {
      ctx.lineWidth = width; ctx.strokeStyle = color; ctx.beginPath(); let started = false;
      for (let x = profile.left; x <= profile.right; x++) { const wx = surface.root.x + (x + .5 - profile.originX) * surface.scale, wy = surface.root.y + (profile.top[x] - profile.originY) * surface.scale; if (profile.occupied && !profile.occupied[x] || Math.abs(wx - point.x) > 32) { started = false; continue; } if (started) ctx.lineTo(wx, wy - 2); else ctx.moveTo(wx, wy - 2); started = true; } ctx.stroke();
    }
    ctx.fillStyle = '#e4edc4'; ellipse(ctx, point.x, point.y - 3, 4, 4); ctx.restore();
  }
  private clipAboveSupport(ctx: CanvasRenderingContext2D, surface: SupportSurface2D): void {
    const profile = surface.profile; ctx.beginPath(); ctx.rect(0, 0, SCENE_WIDTH, SCENE_HEIGHT);
    for (let first = profile.left; first <= profile.right;) {
      if (profile.occupied && !profile.occupied[first]) { first++; continue; }
      let last = first + 1; while (last <= profile.right && (!profile.occupied || profile.occupied[last])) last++;
      const left = surface.root.x + (first - profile.originX) * surface.scale;
      ctx.moveTo(left, SCENE_HEIGHT);
      for (let x = first; x < last; x++) { const wx = surface.root.x + (x - profile.originX) * surface.scale, y = surface.root.y + (profile.top[x] - profile.originY) * surface.scale + .7; ctx.lineTo(wx, y); ctx.lineTo(wx + surface.scale, y); }
      ctx.lineTo(surface.root.x + (last - profile.originX) * surface.scale, SCENE_HEIGHT); ctx.closePath(); first = last;
    }
    ctx.clip('evenodd');
  }
  private paintPond(ctx: CanvasRenderingContext2D): void {
    if (!this.state?.pond?.depths.some(depth => depth > 0)) return; const state = this.state;
    for (let begin = 0; begin < 192;) {
      if (pondDepth2D(state.pond, (begin + .5) / 192) <= .02) { begin++; continue; } let end = begin + 1; while (end < 192 && pondDepth2D(state.pond, (end + .5) / 192) > .02) end++;
      const top: Point2D[] = [], bottom: Point2D[] = []; for (let i = begin; i <= end; i++) { top.push(pondPoint2D(this.vessel, state.terrain, state.pond, i / 192)); bottom.push(root2D(this.vessel, state.terrain, i / 192)); }
      pathPoints(ctx, [...top, ...bottom.reverse()]); ctx.fillStyle = 'rgba(84,158,155,.43)'; ctx.fill(); ctx.strokeStyle = 'rgba(224,247,218,.78)'; ctx.lineWidth = 1.3; ctx.beginPath(); top.forEach((point, i) => i ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y)); ctx.stroke();
      const center = top[Math.floor(top.length / 2)]; if (top.at(-1)!.x - top[0].x > 20) { ctx.strokeStyle = 'rgba(245,249,221,.38)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(center.x - 7, center.y + 4); ctx.lineTo(center.x + 7, center.y + 4); ctx.stroke(); }
      begin = end;
    }
  }
  isBottleAt(point: Position): boolean {
    this.counts.silhouetteTests++; if (inVessel2D(this.vessel, point)) return true;
    if (this.vessel.shape === 'glass-box') { const ends = openingEnds2D(this.vessel), roof = openingY2D(this.vessel, point.x); if (point.x >= ends.left.x && point.x <= ends.right.x && point.y >= roof - (this.state?.closed ? 21 : 12) && point.y <= roof + 12) return true; }
    const rim = vesselRadius2D(this.vessel, this.vessel.top);
    if (this.state?.closed && !['open-cylinder', 'open-cube', 'cat'].includes(this.vessel.shape) && point.y >= this.vessel.top - 13 && point.y <= this.vessel.top && Math.abs(point.x - 300) <= rim + 3) return true;
    if (this.vessel.shape === 'cat') for (const side of [-1, 1]) { const x = (point.x - 300) * side; if (point.y >= this.vessel.top - 28 && point.y <= this.vessel.top + 37 && x >= 72 && x <= 125) { const t = (point.y - this.vessel.top + 28) / 65; if (x >= 120 - 48 * t && x <= 120 + 5 * t) return true; } }
    return false;
  }
  hitTest(point: Position): Selection | null {
    if (!this.state || !inVessel2D(this.vessel, point)) return null;
    const above = aboveTerrain2D(this.vessel, this.state.terrain, point);
    for (let i = this.entities.length - 1; i >= 0; i--) { const sprite = this.entities[i], parentY = sprite.parent && !sprite.moss ? supportContactHeight2D(sprite.parent, point.x) : null; if ((!sprite.floating && !above) || sprite.id === PLACEMENT_ID || parentY !== null && point.y > parentY + .7) continue; const x = Math.floor((point.x - sprite.root.x) / sprite.scale + sprite.originX), y = Math.floor((point.y - sprite.root.y - (sprite.moss ? sprite.offsets[x] ?? 0 : 0)) / sprite.scale + sprite.originY); if (x >= 0 && y >= 0 && x < sprite.canvas.width && y < sprite.canvas.height && sprite.alpha[y * sprite.canvas.width + x] > 40) return { type: sprite.type, id: sprite.id }; }
    return null;
  }
  defaultSpraySource(): Position {
    const plants = this.entities.filter(sprite => sprite.type === 'plant' && sprite.id !== PLACEMENT_ID);
    if (!plants.length) return { x: 300, y: Math.max(this.vessel.top + 25, 390) };
    const sprite = plants[Math.floor(plants.length / 2)];
    for (let y = 0; y < sprite.canvas.height; y += 2) for (let x = 0; x < sprite.canvas.width; x += 2) if (sprite.alpha[y * sprite.canvas.width + x] > 180) { const point = { x: sprite.root.x + (x - sprite.originX) * sprite.scale, y: sprite.root.y + (y - sprite.originY) * sprite.scale + (sprite.moss ? sprite.offsets[x] : 0) }, parentY = sprite.parent && !sprite.moss ? supportContactHeight2D(sprite.parent, point.x) : null; if (this.state && aboveTerrain2D(this.vessel, this.state.terrain, point) && (parentY === null || point.y <= parentY + .7)) return { x: point.x, y: Math.max(openingY2D(this.vessel, point.x) + 3, point.y - 18) }; }
    return { x: sprite.root.x, y: Math.max(this.vessel.top + 3, sprite.root.y - 45) };
  }
  rootAt(position: Position): Position { const support = position.support && this.supports.get(position.support.parentId); if (support && position.support) return supportPoint2D(support, position.support.x); return this.state ? root2D(this.vessel, this.state.terrain, position.x) : { x: 300, y: FLOOR_Y }; }
  entityPointAt(selection: Selection): Position | null { const sprite = this.sprites.get(selection.id); return sprite && sprite.type === selection.type ? { ...sprite.root } : null; }
  positionAt(point: Position): Position | null { if (!this.state || !this.isBottleAt(point)) return null; const x = normalizedX2D(this.vessel, this.state.terrain, point.x); return { x, y: clamp2D(.5 + (point.y - surfaceY2D(this.vessel, this.state.terrain, x)) / 100) }; }
  placementAt(point: Position, excludeId?: string, kind?: PlantKind | DecorationKind): Position | null {
    const placingKind = kind ?? this.state?.decorations.find(item => item.id === excludeId)?.kind;
    if (placingKind && isFloatingDecoration(placingKind)) return this.state ? floatingPosition2D(this.vessel, point) : null;
    const ground = this.positionAt(point); if (!ground || !this.state) return null; const excluded = excludedSupports2D(this.state.decorations, excludeId); excluded.add(PLACEMENT_ID); const candidates = [...this.supports.values()].filter(surface => !excluded.has(surface.id));
    const hit = this.hitTest(point), hitSurface = hit?.type === 'decoration' && !excluded.has(hit.id) ? candidates.find(surface => surface.id === hit.id) : undefined;
    const accepts = (p: Point2D): boolean => inVessel2D(this.vessel, p) && aboveTerrain2D(this.vessel, this.state!.terrain, p);
    const directY = hitSurface ? supportContactHeight2D(hitSurface, point.x) : null;
    const support: SupportAttachment | undefined = hitSurface && directY !== null ? nearestSupport2D([hitSurface], { x: point.x, y: directY }, excluded, 42, accepts) : nearestSupport2D(candidates, point, excluded, 42, accepts);
    return support ? { ...ground, support } : ground;
  }
  movedPosition(initial: Position, dx: number, dy: number): Position { if (!this.state) return initial; return { x: normalizedX2D(this.vessel, this.state.terrain, this.rootAt(initial).x + dx), y: clamp2D(initial.y + dy / 100) }; }
  sculptHandles(): { side: GlassSideName; key: GlassBand2D; x: number; y: number; value: number; height: number }[] { if (!this.state || this.state.bottle !== 'glass-box') return []; const form = this.state.glassForm ?? DEFAULT_FORM; return (['left', 'right'] as const).flatMap(side => (['lower', 'middle', 'upper'] as const).map(key => ({ side, key, ...sculptControlPoint2D(this.vessel, side, key), value: (form.sides?.[side] ?? defaultGlassSide(form))[key].width, height: (form.sides?.[side] ?? defaultGlassSide(form))[key].height }))); }
  sculptValueAt(key: GlassBand2D, x: number): number { return sculptValue2D(key, x); }
  sculptControlAt(side: GlassSideName, key: GlassBand2D, point: Point2D): GlassControlPoint { return sculptControlValue2D(side, key, point); }
  diagnostics(): { drawCalls: number; triangles: number; geometries: number; textures: number; terrainBuilds: number; glassBuilds: number; botanyBuilds: number; contactBuilds: number; frames: number; silhouetteTests: number; raycasts: number; frameMs: number; maxFrameMs: number; silhouetteBuilds: number; renderWidth: number; renderHeight: number; spriteReadbacks: number; cachedSprites: number } { return { ...this.counts, drawCalls: this.entities.length + 2, triangles: 0, geometries: 0, textures: 0, raycasts: 0, renderWidth: this.canvas.width, renderHeight: this.canvas.height, cachedSprites: this.sprites.size }; }
  dispose(): void { if (this.disposed) return; this.disposed = true; for (const sprite of this.sprites.values()) releaseSprite(sprite); this.sprites.clear(); this.supports.clear(); this.entities = []; this.patterns.clear(); for (const canvas of [this.canvas, this.glassCanvas, this.terrainCanvas, this.silhouetteCanvas]) canvas.width = canvas.height = 0; }
}
