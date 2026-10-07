import type { Decoration, DecorationKind, GlassBand, GlassControlPoint, GlassSideName, MaterialKind, PlantKind, SupportAttachment, TerrariumState, WoodPresetKind } from '../shared/types';
import { TERRAIN_COLUMNS } from '../shared/catalog';
import { terrainColumnIndex, terrainHeightAt } from './scene-terrain';
import { clamp2D as clamp, random2D as seededRandom } from './scene-2d-geometry';
import { CanvasTerrarium, SCENE_HEIGHT, SCENE_WIDTH } from './scene-2d';
import type { ScenePreview, SculptHandle } from './scene-2d';
import { heavyFrameDelay } from './scene-3d-cadence';

export interface Selection { type: 'plant' | 'decoration'; id: string }
export interface Position { x: number; y: number; support?: SupportAttachment }
export interface PlacementPreview { type: Selection['type']; kind: PlantKind | DecorationKind; position: Position; woodPreset?: WoodPresetKind; variant?: Decoration['variant']; pose?: Decoration['pose'] }
export interface ToolEffect { kind: 'spray' | 'pour' | 'scoop' | 'water' | 'drain'; clientX: number; clientY: number; material?: MaterialKind; radius?: number }
export interface TerrainHit { x: number; column: number; height: number; material: MaterialKind | null; surfaceClientY: number }
export interface BrushPreview { clientX: number; clientY: number; radius: number }
/** Visible downward mist and targeting use identical design coordinates. */
export function sprayConePoint(source: Position, t: number, spread: number): Position { return { x: source.x + spread * 67 * t, y: source.y + t * 123 + t * t * 12 }; }
export function sprayConeSamples(source: Position): Position[] {
  const points: Position[] = [];
  for (let ring = 1; ring <= 7; ring++) for (let lane = -3; lane <= 3; lane++) points.push(sprayConePoint(source, ring / 7, lane / 3));
  const distance = (point: Position): number => (point.x - source.x) ** 2 + (point.y - source.y) ** 2;
  return points.sort((a, b) => distance(a) - distance(b));
}
export function sampledSprayPlant(source: Position, hit: (point: Position) => Selection | null): Selection | null {
  const direct = hit(source); if (direct?.type === 'plant') return direct;
  for (const point of sprayConeSamples(source)) { const candidate = hit(point); if (candidate?.type === 'plant') return candidate; }
  return null;
}
/** General care targeting respects the first visible solid target in the mist
 * cone. The plant-only helper stays exported for older callers and tests. */
export function sampledSprayTarget(source: Position, hit: (point: Position) => Selection | null): Selection | null {
  const direct = hit(source); if (direct) return direct;
  for (const point of sprayConeSamples(source)) { const candidate = hit(point); if (candidate) return candidate; }
  return null;
}
const GRAIN_COLORS: Record<MaterialKind, [string, string, string]> = { soil: ['#584331', '#38291e', '#251e18'], clay: ['#96704b', '#6f4b31', '#493422'], gravel: ['#959989', '#6c7466', '#4b554a'], coir: ['#91704b', '#64472d', '#402f22'], bark: ['#805b39', '#573e29', '#30251c'], charcoal: ['#515d51', '#303b31', '#19231c'] };
function fallingGrain(ctx: CanvasRenderingContext2D, material: MaterialKind, x: number, y: number, radius: number, angle: number): void {
  const colors = GRAIN_COLORS[material]; ctx.save(); ctx.translate(x, y); ctx.rotate(angle);
  if (material === 'coir') { ctx.strokeStyle = colors[1]; ctx.lineWidth = Math.max(.6, radius * .2); ctx.beginPath(); ctx.moveTo(-radius * 1.6, radius * .25); ctx.quadraticCurveTo(0, -radius * .5, radius * 1.5, radius * .25); ctx.stroke(); ctx.restore(); return; }
  ctx.fillStyle = colors[1]; ctx.beginPath();
  if (material === 'charcoal' || material === 'bark') { const thickness = material === 'bark' ? .35 : .52; ctx.moveTo(-radius * 1.7, -radius * thickness); ctx.lineTo(radius * 1.2, -radius * thickness * .8); ctx.lineTo(radius * 1.65, radius * thickness * .5); ctx.lineTo(-radius * 1.3, radius * thickness); ctx.closePath(); }
  else ctx.ellipse(0, 0, radius, radius * (material === 'clay' ? .97 : .72), 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
}

/** Canvas-only illustration and effects, with cached CPU whole-glass hit testing. */
export class TerrariumScene {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly hitCanvas = document.createElement('canvas');
  private readonly hitCtx: CanvasRenderingContext2D;
  private readonly observer: ResizeObserver;
  private engine: CanvasTerrarium | null = null;
  private state: TerrariumState | null = null;
  private selection: Selection | null = null;
  private preview: ScenePreview | null = null;
  private placementPreview: PlacementPreview | null = null;
  private effect: ToolEffect | null = null;
  private brush: BrushPreview | null = null;
  private effectAt = 0;
  private sprayAt = -10000;
  private sunAt = -10000;
  private readonly sunCanvas = document.createElement('canvas');
  private readonly effectsCanvas = document.createElement('canvas');
  private imageDirty = true;
  private pixelReadbacks = 0;
  private heavyTimer: number | undefined;
  private lastHeavyAt = -Infinity;
  private presentedState: TerrariumState | null = null;
  private presentedPreview: ScenePreview | null = null;
  private presentedPlacement: PlacementPreview | null = null;
  private transform = { scale: 1, x: 0, y: 0 };
  private frameTimer: number | undefined;
  private animationFrame: number | undefined;
  private destroyed = false;
  private visible = !document.hidden;
  private readonly onVisibility = (): void => { this.visible = !document.hidden; if (!this.visible) this.effect = null; this.requestDraw(); };
  private readonly onBlur = (): void => { this.effect = null; this.brush = null; this.requestDraw(); };
  constructor(readonly canvas: HTMLCanvasElement, private readonly widget = false) {
    const ctx = canvas.getContext('2d'), hitCtx = this.hitCanvas.getContext('2d', { willReadFrequently: true });
    if (!ctx || !hitCtx) throw new Error('A drawing canvas is not available on this device.'); this.ctx = ctx; this.hitCtx = hitCtx;
    try { this.engine = new CanvasTerrarium(widget); canvas.dataset.renderer = 'canvas2d'; }
    catch (error) { canvas.dataset.renderer = 'unavailable'; canvas.dataset.rendererError = error instanceof Error ? error.message.slice(0, 180) : 'Canvas 2D unavailable'; }
    this.observer = new ResizeObserver(() => this.requestDraw()); this.observer.observe(canvas); document.addEventListener('visibilitychange', this.onVisibility); window.addEventListener('blur', this.onBlur);
  }
  setState(state: TerrariumState): void { if (this.state && state.care.sunlight > this.state.care.sunlight + .025) this.sunAt = performance.now(); this.state = state; this.requestDraw(); }
  setSelection(selection: Selection | null): void { if (selection?.id === this.selection?.id && selection?.type === this.selection?.type) return; this.selection = selection; this.requestDraw(); }
  setDragPreview(selection: Selection | null, position?: Position): void { this.preview = selection && position ? { selection, ...position } : null; this.requestDraw(); }
  setPlacementPreview(preview: PlacementPreview | null): void { this.placementPreview = preview; this.requestDraw(); }
  setEffect(effect: ToolEffect | null): void { if (!effect && !this.effect) return; if (effect && this.effect?.kind !== effect.kind) this.effectAt = performance.now(); this.effect = effect ? { ...effect } : null; this.requestDraw(); }
  setBrushPreview(value: BrushPreview | null): void { if (!value && !this.brush) return; this.brush = value; this.requestDraw(); }
  spray(): void { if (!this.state?.preferences.reducedMotion) this.sprayAt = performance.now(); this.requestDraw(); }
  sunlight(): void { this.sunAt = performance.now(); this.requestDraw(); }
  private requestDraw(): void {
    if (this.destroyed) return; if (this.frameTimer !== undefined) { window.clearTimeout(this.frameTimer); this.frameTimer = undefined; }
    if (this.animationFrame === undefined) this.animationFrame = requestAnimationFrame(() => { this.animationFrame = undefined; this.draw(performance.now()); });
  }
  private draw(now: number): void {
    if (!this.state || this.destroyed) return; const rect = this.canvas.getBoundingClientRect(); if (rect.width < 1 || rect.height < 1) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2), width = Math.round(rect.width * ratio), height = Math.round(rect.height * ratio);
    if (this.canvas.width !== width || this.canvas.height !== height) { this.canvas.width = width; this.canvas.height = height; this.imageDirty = true; }
    if (this.hitCanvas.width !== width || this.hitCanvas.height !== height) { this.hitCanvas.width = width; this.hitCanvas.height = height; this.imageDirty = true; }
    const padding = this.widget ? 2 : 4, scale = Math.min((rect.width - padding * 2) / SCENE_WIDTH, (rect.height - padding * 2) / SCENE_HEIGHT);
    this.transform = { scale, x: (rect.width - SCENE_WIDTH * scale) / 2, y: (rect.height - SCENE_HEIGHT * scale) / 2 };
    this.ctx.setTransform(1, 0, 0, 1, 0, 0); this.ctx.clearRect(0, 0, width, height);
    if (!this.engine) { this.ctx.scale(ratio, ratio); this.ctx.fillStyle = '#849f79'; this.ctx.font = '14px system-ui'; this.ctx.textAlign = 'center'; this.ctx.fillText('Canvas graphics are unavailable.', rect.width / 2, rect.height / 2); return; }
    const resized = this.engine.resize(SCENE_WIDTH * scale * ratio), needsHeavy = resized || this.state !== this.presentedState || this.preview !== this.presentedPreview || this.placementPreview !== this.presentedPlacement;
    let changed = false;
    if (needsHeavy) {
      const delay = heavyFrameDelay(this.widget, this.lastHeavyAt, now, this.imageDirty || resized || this.state.bottle !== this.presentedState?.bottle || this.state.closed !== this.presentedState?.closed);
      if (delay <= 0) {
        if (this.heavyTimer !== undefined) { window.clearTimeout(this.heavyTimer); this.heavyTimer = undefined; }
        changed = this.engine.render(this.state, this.preview, this.placementPreview); this.lastHeavyAt = now; this.presentedState = this.state; this.presentedPreview = this.preview; this.presentedPlacement = this.placementPreview;
      } else if (this.heavyTimer === undefined) this.heavyTimer = window.setTimeout(() => { this.heavyTimer = undefined; this.requestDraw(); }, delay);
    }
    const diagnostics = this.engine.diagnostics();
    this.canvas.dataset.drawCalls = String(diagnostics.drawCalls); this.canvas.dataset.triangles = String(diagnostics.triangles); this.canvas.dataset.geometries = String(diagnostics.geometries); this.canvas.dataset.textures = String(diagnostics.textures);
    this.canvas.dataset.terrainBuilds = String(diagnostics.terrainBuilds); this.canvas.dataset.glassBuilds = String(diagnostics.glassBuilds); this.canvas.dataset.botanyBuilds = String(diagnostics.botanyBuilds); this.canvas.dataset.frames = String(diagnostics.frames);
    this.canvas.dataset.renderWidth = String(diagnostics.renderWidth); this.canvas.dataset.renderHeight = String(diagnostics.renderHeight); this.canvas.dataset.frameMs = diagnostics.frameMs.toFixed(2); this.canvas.dataset.maxFrameMs = diagnostics.maxFrameMs.toFixed(2); this.canvas.dataset.silhouetteBuilds = String(diagnostics.silhouetteBuilds);
    this.canvas.dataset.raycasts = String(diagnostics.raycasts); this.canvas.dataset.pixelReadbacks = String(this.pixelReadbacks); this.canvas.dataset.silhouetteTests = String(diagnostics.silhouetteTests);
    this.canvas.dataset.spriteReadbacks = String(diagnostics.spriteReadbacks); this.canvas.dataset.cachedSprites = String(diagnostics.cachedSprites); this.canvas.dataset.contactBuilds = String(diagnostics.contactBuilds);
    if (changed || this.imageDirty) { this.hitCtx.setTransform(1, 0, 0, 1, 0, 0); this.hitCtx.clearRect(0, 0, width, height); this.hitCtx.setTransform(ratio * scale, 0, 0, ratio * scale, ratio * this.transform.x, ratio * this.transform.y); this.hitCtx.drawImage(this.engine.canvas, 0, 0, SCENE_WIDTH, SCENE_HEIGHT); this.imageDirty = false; }
    this.ctx.drawImage(this.hitCanvas, 0, 0);
    this.ctx.setTransform(ratio * scale, 0, 0, ratio * scale, ratio * this.transform.x, ratio * this.transform.y);
    this.paintSelection(); this.paintSunlight(now); this.paintEffects(now); this.paintBrush();
    if (this.visible && (this.effect || now - this.sprayAt < 1500 || now - this.sunAt < 5200)) this.frameTimer = window.setTimeout(() => { this.frameTimer = undefined; this.requestDraw(); }, this.state.preferences.reducedMotion ? 500 : this.widget ? 66 : 40);
  }
  private paintSunlight(now: number): void {
    if (!this.engine || !this.state) return; const age = now - this.sunAt; if (age < 0 || age > 5200) return;
    if (this.sunCanvas.width !== SCENE_WIDTH) { this.sunCanvas.width = SCENE_WIDTH; this.sunCanvas.height = SCENE_HEIGHT; }
    const context = this.sunCanvas.getContext('2d'); if (!context) return; context.clearRect(0, 0, SCENE_WIDTH, SCENE_HEIGHT);
    const strength = this.state.preferences.reducedMotion ? .8 : Math.min(1, age / 240) * Math.min(1, (5200 - age) / 1700);
    const beam = context.createLinearGradient(100, 120, 440, 650); beam.addColorStop(0, `rgba(255,230,156,${.08 * strength})`); beam.addColorStop(.42, `rgba(255,218,118,${.27 * strength})`); beam.addColorStop(1, '#ffde9200'); context.fillStyle = beam;
    context.beginPath(); context.moveTo(135, 90); context.lineTo(200, 70); context.lineTo(475, 705); context.lineTo(295, 720); context.closePath(); context.fill();
    const glow = context.createRadialGradient(338, 540, 8, 338, 540, 170); glow.addColorStop(0, `rgba(255,219,131,${.17 * strength})`); glow.addColorStop(1, '#ffdf9c00'); context.fillStyle = glow; context.fillRect(160, 365, 350, 350);
    context.globalCompositeOperation = 'destination-in'; context.drawImage(this.engine.silhouetteCanvas, 0, 0); context.globalCompositeOperation = 'source-over'; this.ctx.drawImage(this.sunCanvas, 0, 0);
  }
  private paintSelection(): void {
    if (!this.selection || !this.state || this.widget || !this.engine) return;
    const selected = this.selection.type === 'plant' ? this.state.plants.find(p => p.id === this.selection!.id) : this.state.decorations.find(p => p.id === this.selection!.id);
    if (!selected) return; const root = this.engine.entityPointAt(this.selection) ?? this.engine.rootAt(this.preview ?? selected), ctx = this.ctx; ctx.save(); ctx.strokeStyle = '#849d53c0'; ctx.lineWidth = 1.2; ctx.setLineDash([3, 4]); ctx.beginPath(); ctx.ellipse(root.x, root.y + 3, 28 * selected.scale, 7, 0, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
  }
  private paintBrush(): void {
    if (!this.brush || !this.state || !this.engine) return; const point = this.clientToWorld(this.brush.clientX, this.brush.clientY), position = this.engine.positionAt(point); if (!position) return;
    const radius = clamp(this.brush.radius, 1, 10), left = this.engine.rootAt({ x: clamp(position.x - radius / TERRAIN_COLUMNS), y: .5 }), right = this.engine.rootAt({ x: clamp(position.x + radius / TERRAIN_COLUMNS), y: .5 });
    const ctx = this.ctx, size = Math.max(6, (right.x - left.x) / 2); ctx.save(); ctx.strokeStyle = '#4b633ab0'; ctx.fillStyle = '#edf2d927'; ctx.lineWidth = 1.2; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.ellipse(point.x, point.y, size, Math.max(8, size * .57), 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.restore();
  }
  private paintMist(source: Position, phase: number, amount: number, ctx = this.ctx): void {
    const rng = seededRandom(4921);
    const mist = ctx.createRadialGradient(source.x, source.y + 50, 3, source.x, source.y + 53, 76); mist.addColorStop(0, `rgba(211,236,227,${amount * .15})`); mist.addColorStop(1, '#e8ffee00'); ctx.fillStyle = mist; ctx.fillRect(source.x - 80, source.y - 10, 160, 158);
    for (let i = 0; i < 70; i++) { const t = (phase * (.6 + rng() * .7) + rng()) % 1, p = sprayConePoint(source, t, rng() * 2 - 1); ctx.fillStyle = `rgba(205,232,225,${(1 - t) * amount * .75})`; ctx.beginPath(); ctx.ellipse(p.x, p.y, .55 + rng(), 1.3 + rng() * 1.5, -.1, 0, Math.PI * 2); ctx.fill(); }
  }
  private paintEffects(now: number): void {
    if (!this.state || !this.engine) return;
    if (!this.effect && (now - this.sprayAt < 0 || now - this.sprayAt > 1500)) return;
    if (this.effectsCanvas.width !== SCENE_WIDTH) { this.effectsCanvas.width = SCENE_WIDTH; this.effectsCanvas.height = SCENE_HEIGHT; }
    const context = this.effectsCanvas.getContext('2d'); if (!context) return; context.clearRect(0, 0, SCENE_WIDTH, SCENE_HEIGHT);
    this.paintToolEffects(context, now); context.globalCompositeOperation = 'destination-in'; context.drawImage(this.engine.silhouetteCanvas, 0, 0); context.globalCompositeOperation = 'source-over'; this.ctx.drawImage(this.effectsCanvas, 0, 0);
  }
  private paintToolEffects(ctx: CanvasRenderingContext2D, now: number): void {
    if (!this.state || !this.engine) return; const legacy = (now - this.sprayAt) / 1500;
    if (!this.effect) { if (legacy >= 0 && legacy < 1) this.paintMist({ x: 300, y: 225 }, legacy * 1.4, Math.sin(legacy * Math.PI), ctx); return; }
    const source = this.clientToWorld(this.effect.clientX, this.effect.clientY), phase = this.state.preferences.reducedMotion ? .32 : (now - this.effectAt) / 530;
    if (this.effect.kind === 'spray') { this.paintMist(source, phase, .95, ctx); return; }
    const position = this.engine.positionAt(source); if (!position) return; const root = this.engine.rootAt({ x: position.x, y: .5 }), column = this.state.terrain.columns[terrainColumnIndex(position.x)] ?? [], material = this.effect.material ?? column[column.length - 1] ?? 'soil', rng = seededRandom(8529);
    if (this.effect.kind === 'water' || this.effect.kind === 'drain') {
      for (let i = 0; i < 35; i++) { const t = (phase + rng()) % 1, outward = (rng() - .5) * 23, x = source.x + outward * t, y = this.effect.kind === 'water' ? source.y + Math.max(12, root.y - source.y) * t * t : root.y + (source.y - root.y) * t; ctx.fillStyle = `rgba(91,168,164,${.6 * (1 - t * .45)})`; ctx.beginPath(); ctx.ellipse(x, y, 1.1 + rng(), 2 + rng() * 2, .1, 0, Math.PI * 2); ctx.fill(); }
      return;
    }
    for (let i = 0; i < (this.effect.kind === 'pour' ? 60 : 32); i++) {
      const t = (phase * (.7 + rng() * .6) + rng()) % 1, radius = material === 'soil' ? 1.1 + rng() * 1.3 : 2.1 + rng() * 1.7;
      if (this.effect.kind === 'pour') fallingGrain(ctx, material, source.x + (rng() - .5) * (7 + t * 15), source.y + Math.max(10, root.y - source.y) * t * t, radius, t * 4 + rng() * 6);
      else { ctx.save(); ctx.globalAlpha = .8 * (1 - t); fallingGrain(ctx, material, source.x + (rng() - .5) * 72 * t, source.y - (12 + rng() * 40) * Math.sin(t * Math.PI), radius, t * 5 + rng() * 6); ctx.restore(); }
    }
  }
  private clientToWorld(clientX: number, clientY: number): Position { const rect = this.canvas.getBoundingClientRect(); return { x: (clientX - rect.left - this.transform.x) / this.transform.scale, y: (clientY - rect.top - this.transform.y) / this.transform.scale }; }
  private worldToClient(position: Position): Position { const rect = this.canvas.getBoundingClientRect(); return { x: rect.left + this.transform.x + position.x * this.transform.scale, y: rect.top + this.transform.y + position.y * this.transform.scale }; }
  isBottleAt(clientX: number, clientY: number): boolean { return !!this.engine?.isBottleAt(this.clientToWorld(clientX, clientY)); }
  movedPosition(initial: Position, dx: number, dy: number): Position { return this.engine?.movedPosition(initial, dx / this.transform.scale, dy / this.transform.scale) ?? initial; }
  positionAt(clientX: number, clientY: number): Position | null { return this.engine?.positionAt(this.clientToWorld(clientX, clientY)) ?? null; }
  placementAt(clientX: number, clientY: number, excludeId?: string, kind?: PlantKind | DecorationKind): Position | null { return this.engine?.placementAt(this.clientToWorld(clientX, clientY), excludeId, kind) ?? null; }
  entityPointAt(selection: Selection): Position | null { const point = this.engine?.entityPointAt(selection); return point ? this.worldToClient(point) : null; }
  terrainAt(clientX: number, clientY: number): TerrainHit | null {
    const position = this.positionAt(clientX, clientY); if (!position || !this.state || !this.engine) return null; const column = terrainColumnIndex(position.x), saved = this.state.terrain.columns[column] ?? [], root = this.worldToClient(this.engine.rootAt({ x: position.x, y: .5 }));
    return { x: position.x, column, height: terrainHeightAt(this.state.terrain, position.x), material: saved[saved.length - 1] ?? null, surfaceClientY: root.y };
  }
  hitTest(clientX: number, clientY: number): Selection | null { if (!this.isBottleAt(clientX, clientY)) return null; return this.engine?.hitTest(this.clientToWorld(clientX, clientY)) ?? null; }
  sprayTargetAt(clientX: number, clientY: number): Selection | null {
    if (!this.isBottleAt(clientX, clientY) || !this.engine) return null; const source = this.clientToWorld(clientX, clientY); return sampledSprayTarget(source, point => this.engine!.isBottleAt(point) ? this.engine!.hitTest(point) : null);
  }
  defaultSpraySource(): Position { return this.worldToClient(this.engine?.defaultSpraySource() ?? { x: 300, y: 390 }); }
  diagnostics(): ReturnType<CanvasTerrarium['diagnostics']> & { pixelReadbacks: number } | null { return this.engine ? { ...this.engine.diagnostics(), pixelReadbacks: this.pixelReadbacks } : null; }
  /** Only persistent physical geometry participates in desktop passthrough. */
  alphaAt(clientX: number, clientY: number): number {
    const rect = this.canvas.getBoundingClientRect(); if (rect.width <= 0 || rect.height <= 0 || !this.isBottleAt(clientX, clientY)) return 0;
    const x = Math.floor((clientX - rect.left) * this.hitCanvas.width / rect.width), y = Math.floor((clientY - rect.top) * this.hitCanvas.height / rect.height);
    if (x < 0 || y < 0 || x >= this.hitCanvas.width || y >= this.hitCanvas.height) return 0; this.pixelReadbacks++; return this.hitCtx.getImageData(x, y, 1, 1).data[3] ?? 0;
  }
  sculptHandles(): SculptHandle[] { return (this.engine?.sculptHandles() ?? []).map(({ side, key, x, y, value, height }) => { const client = this.worldToClient({ x, y }); return { side, key, clientX: client.x, clientY: client.y, value, height }; }); }
  sculptValueAt(key: GlassBand, clientX: number): number { return this.engine?.sculptValueAt(key, this.clientToWorld(clientX, 0).x) ?? 1; }
  sculptControlAt(side: GlassSideName, key: GlassBand, clientX: number, clientY: number): GlassControlPoint { return this.engine?.sculptControlAt(side, key, this.clientToWorld(clientX, clientY)) ?? { width: 1, height: .5 }; }
  destroy(): void {
    this.destroyed = true; this.observer.disconnect(); if (this.frameTimer !== undefined) clearTimeout(this.frameTimer); if (this.heavyTimer !== undefined) clearTimeout(this.heavyTimer); if (this.animationFrame !== undefined) cancelAnimationFrame(this.animationFrame); document.removeEventListener('visibilitychange', this.onVisibility); window.removeEventListener('blur', this.onBlur); this.engine?.dispose(); this.engine = null; this.hitCanvas.width = this.hitCanvas.height = 0;
  }
}
