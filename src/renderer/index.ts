import type { Decoration, DecorationKind, DecorationVariant, GlassForm, GlassSideName, MaterialKind, Plant, PlantKind, Snapshot, Speed, TerrariumAction, TerrariumBridge, TerrariumState, WoodPresetKind } from '../shared/types';
import { TerrariumScene, type Position, type Selection } from './scene';
import { decorationBounds2D, drawDecoration, drawPlant, getPlantExtent } from './scene-botany';
import { DECORATION_ITEMS, GLASS_FACETS, GLASS_HEIGHT_LIMITS, hasLid, isFloatingDecoration, MATERIAL_NAMES, PLANT_ITEMS, STONE_VARIANTS, STUMP_VARIANTS, WOOD_PRESETS, woodPresetForm } from '../shared/catalog';
import { installCatalogGroups } from './catalog-groups';
import { drawToolArt, type ToolArtKind } from './tool-art';
import { EntityEditor } from './entity-editor';
import { CatalogPicker } from './catalog-picker';
import { StrokeController, type PointerPoint } from './stroke-controller';
import { displayTerrariumName, editGlassControl, glassControl, glassFormDraft, SCOOP_RADII, terrainToolAction, widgetDragStep, WidgetMoveQueue, type GlassRing, type ScoopRadius } from './interaction-controls';

const plantNames = Object.fromEntries(PLANT_ITEMS.map(item => [item.id, item.label])) as Record<PlantKind, string>;
const decorationNames = { stone: 'Stone', wood: 'Driftwood', stump: 'Little stump', path: 'Crossing path', ...Object.fromEntries(DECORATION_ITEMS.map(item => [item.id, item.label])) } as Record<DecorationKind, string>;
const clamp = (value: number, min = 0, max = 1): number => Math.max(min, Math.min(max, value));
const percent = (value: number): string => `${Math.round(clamp(value) * 100)}%`;
const isWidget = new URLSearchParams(window.location.search).get('mode') === 'widget';
if (isWidget) document.documentElement.classList.add('widget-mode');
function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id); if (!found) throw new Error(`Missing interface element: ${id}`); return found as T;
}
function text(id: string, value: string): void { element(id).textContent = value; }
function checked(id: string, value: boolean): void { element(id).setAttribute('aria-checked', String(value)); }
const bridge: TerrariumBridge | undefined = window.terrarium;
const loading = element('loading');
let snapshot: Snapshot | null = null;
let scene: TerrariumScene | null = null;
let selected: Selection | null = null;
let entityEditor: EntityEditor | null = null;
let catalogPicker: CatalogPicker | null = null;
let toastTimer: number | undefined;
let queue: Promise<void> = Promise.resolve();
let unsubscribe: (() => void) | undefined;
let disposed = false;
let busyFile = false;
const drafts = new Set<string>();
type ActiveTool = { kind: 'spray' } | { kind: 'pour'; material: MaterialKind } | { kind: 'scoop' } | { kind: 'water' } | { kind: 'drain' };
let activeTool: ActiveTool | null = null;
let stroke: StrokeController | null = null;
let strokePointer: number | null = null;
let lastPointer: PointerPoint | null = null;
let refreshWidgetHit: (() => void) | undefined;
let widgetSprayKey: string | null = null;
let suppressToolClick = false;
let widgetMoveQueue: WidgetMoveQueue | null = null;
let scoopRadius: ScoopRadius = 4;
let activeWorkshopTab = 'build';
let formDraft: GlassForm | null = null;
let pendingGlassForm: GlassForm | null = null;
let formDrag: { button: HTMLButtonElement; pointerId: number; key: GlassRing; side: GlassSideName; changed: boolean } | null = null;
let editedGlassSide: GlassSideName = 'right';
let linkGlassSides = false;
let lastCapacityNotice = -Infinity;
let sculptResizeObserver: ResizeObserver | null = null;
let sculptFrame: number | undefined;
const glassRings: readonly GlassRing[] = ['lower', 'middle', 'upper'];

function syncSculptHandles(): void {
  if (isWidget) return;
  const layer = element('glass-sculpt-handles');
  layer.hidden = !scene || !snapshot || snapshot.state.bottle !== 'glass-box' || activeWorkshopTab !== 'build' || Boolean(activeTool);
  if (layer.hidden || !scene) { if (sculptFrame !== undefined) cancelAnimationFrame(sculptFrame); sculptFrame = undefined; return; }
  if (sculptFrame !== undefined) return;
  // setState queues the vessel drawing first. Read handles after that frame has
  // rebuilt its geometry, not from the previous bottle width or canvas size.
  sculptFrame = requestAnimationFrame(() => {
    sculptFrame = undefined; if (disposed || layer.hidden || !scene) return;
    for (const handle of scene.sculptHandles()) {
      const button = layer.querySelector<HTMLButtonElement>(`[data-sculpt-ring="${handle.key}"][data-sculpt-side="${handle.side}"]`);
      if (!button) continue;
      button.style.left = `${handle.clientX}px`; button.style.top = `${handle.clientY}px`;
      button.setAttribute('aria-valuenow', String(Math.round(handle.value * 100)));
      button.setAttribute('aria-valuetext', `${Math.round(handle.value * 100)}% width, ${Math.round((handle.height ?? 0) * 100)}% height`);
    }
  });
}
function syncGlassControls(): void {
  if (isWidget || !snapshot) return;
  element('glass-form-controls').hidden = snapshot.state.bottle !== 'glass-box';
  const form = formDraft ?? pendingGlassForm ?? glassFormDraft(snapshot.state.glassForm);
  for (const key of glassRings) {
    const point = glassControl(form, editedGlassSide, key);
    syncInput(`glass-${key}`, String(point.width), !drafts.has(`glass-${key}`));
    syncInput(`glass-${key}-height`, String(point.height), !drafts.has(`glass-${key}-height`));
    text(`glass-${key}-value`, `${Math.round(point.width * 100)}%`);
    text(`glass-${key}-height-value`, `${Math.round(point.height * 100)}%`);
  }
  syncInput('glass-side', editedGlassSide);
  syncInput('glass-facets', String(form.facets));
  syncSculptHandles();
}
function previewGlassForm(): void {
  if (!scene || !snapshot || !formDraft) return;
  scene.setState({ ...snapshot.state, glassForm: formDraft }); syncGlassControls();
}
function finishGlassForm(commit: boolean): void {
  const drag = formDrag; formDrag = null;
  const value = formDraft; formDraft = null;
  for (const key of glassRings) { drafts.delete(`glass-${key}`); drafts.delete(`glass-${key}-height`); }
  if (drag && drag.button.hasPointerCapture(drag.pointerId)) drag.button.releasePointerCapture(drag.pointerId);
  if (commit && value && snapshot?.state.bottle === 'glass-box') {
    // A following width/facet edit must extend the latest intended form even
    // while main is still acknowledging the prior edit through the IPC queue.
    pendingGlassForm = value;
    void dispatch({ type: 'glass-form', value }).then(() => {
      if (disposed) return;
      if (pendingGlassForm === value) pendingGlassForm = null;
      if (!formDraft && snapshot) { scene?.setState(pendingGlassForm && snapshot.state.bottle === 'glass-box' ? { ...snapshot.state, glassForm: pendingGlassForm } : snapshot.state); syncGlassControls(); }
    });
  } else if (value && snapshot) { scene?.setState(pendingGlassForm && snapshot.state.bottle === 'glass-box' ? { ...snapshot.state, glassForm: pendingGlassForm } : snapshot.state); syncGlassControls(); }
}

function uiAt(point: PointerPoint): boolean { return Boolean(document.elementFromPoint(point.x, point.y)?.closest('[data-ui-hit]')); }
function finishInteraction(): Promise<void> {
  if (!bridge) return Promise.resolve();
  const operation = queue.then(async () => { const value = await bridge.finishInteraction(); if (!disposed) receive(value); });
  queue = operation.catch(error => { toast(errorMessage(error), true); }); return queue;
}
function performStroke(action: TerrariumAction, valid: () => boolean): Promise<void> {
  if (!bridge) return Promise.resolve();
  const operation = queue.then(async () => {
    if (!valid()) return;
    const previous = snapshot?.state;
    const value = await bridge.dispatch(action);
    if (!disposed) {
      receive(value);
      if (previous && (action.type === 'pour' || action.type === 'pour-water' || action.type === 'drain-water') && performance.now() - lastCapacityNotice > 3500) {
        const grains = (state: TerrariumState): number => state.terrain.columns.reduce((sum, column) => sum + column.length, 0);
        const waterVolume = (state: TerrariumState): number => state.pond?.depths.reduce((sum, depth) => sum + depth, 0) ?? 0;
        const before = action.type === 'pour' ? grains(previous) : waterVolume(previous);
        const after = action.type === 'pour' ? grains(value.state) : waterVolume(value.state);
        if (before === after) {
          lastCapacityNotice = performance.now();
          toast(action.type === 'pour' ? 'The landscape is full. Scoop some material out to make room.' : action.type === 'pour-water' ? 'No more water fits here. Shape a basin or drain some water.' : 'There is no pond water here to drain.');
        }
      }
    }
  });
  queue = operation.catch(() => undefined); return operation;
}
function updateToolPointer(point: PointerPoint): void {
  lastPointer = point; const cursor = element('cursor-tool');
  if (!isWidget && activeTool) text('workshop-tool-status', scene?.isBottleAt(point.x, point.y) && !uiAt(point) ? stroke?.active ? 'Working…' : 'Hold to begin' : 'Move inside glass');
  if (!activeTool || !scene || uiAt(point)) { cursor.hidden = true; scene?.setBrushPreview(null); return; }
  const rect = scene.canvas.getBoundingClientRect();
  cursor.hidden = point.x < rect.left || point.x > rect.right || point.y < rect.top || point.y > rect.bottom;
  cursor.style.left = `${clamp(point.x + 9, 0, Math.max(0, innerWidth - (isWidget ? 66 : 80)))}px`;
  cursor.style.top = `${clamp(point.y - 52, 0, Math.max(0, innerHeight - (isWidget ? 66 : 80)))}px`;
  scene.setBrushPreview(activeTool.kind === 'scoop' && !cursor.hidden && scene.isBottleAt(point.x, point.y) ? { clientX: point.x, clientY: point.y, radius: scoopRadius } : null);
}
function setTool(value: ActiveTool | null): void {
  catalogPicker?.cancel(); entityEditor?.finish(false);
  finishGlassForm(false);
  if (!value) widgetSprayKey = null;
  void stroke?.stop(); activeTool = value;
  if (scene && strokePointer !== null && scene.canvas.hasPointerCapture(strokePointer)) scene.canvas.releasePointerCapture(strokePointer);
  strokePointer = null;
  const name = value?.kind === 'spray' ? 'Mister' : value?.kind === 'scoop' ? 'Scoop' : value?.kind === 'water' ? 'Pond water' : value?.kind === 'drain' ? 'Drain' : value ? MATERIAL_NAMES[value.material] : '';
  const instruction = value?.kind === 'spray' ? 'Hold over plants; release to finish' : value?.kind === 'scoop' ? 'Hold to sculpt a valley' : value?.kind === 'water' ? 'Hold inside a basin to fill it' : value?.kind === 'drain' ? 'Hold over water to drain it' : 'Hold to pour; move to build a hill';
  element('workshop-tool-hud').hidden = !value || isWidget; text('workshop-tool-name', `${name} · ${instruction}`);
  element('widget-quick').hidden = true;
  document.querySelector('[data-widget-control=spray]')?.setAttribute('aria-pressed', String(value?.kind === 'spray'));
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-material]')) { const selected = value?.kind === 'pour' && value.material === button.dataset.material || value?.kind === 'water' && button.dataset.material === 'water'; button.classList.toggle('active', selected); button.setAttribute('aria-pressed', String(selected)); }
  element('scoop-tool').classList.toggle('active', value?.kind === 'scoop'); element('scoop-tool').setAttribute('aria-pressed', String(value?.kind === 'scoop'));
  element('scoop-brush-controls').hidden = value?.kind !== 'scoop';
  element('drain-tool').setAttribute('aria-pressed', String(value?.kind === 'drain'));
  element('water-button').classList.toggle('tool-active', value?.kind === 'spray');
  scene?.canvas.classList.toggle('tool-mode', Boolean(value));
  scene?.setBrushPreview(null);
  const cursor = element('cursor-tool'); cursor.hidden = !value; cursor.classList.remove('spraying', 'pouring', 'scooping');
  if (value) {
    const canvas = element<HTMLCanvasElement>('cursor-tool-art'); const ctx = canvas.getContext('2d');
    if (ctx) { ctx.clearRect(0, 0, canvas.width, canvas.height); drawToolArt(ctx, value.kind === 'pour' ? value.material : value.kind, canvas.width); }
    text('cursor-tool-label', name); if (lastPointer) updateToolPointer(lastPointer); else cursor.hidden = true;
    if (!isWidget) select(null);
  }
  syncSculptHandles();
  refreshWidgetHit?.();
}
function installToolInteraction(canvas: HTMLCanvasElement): void {
  stroke = new StrokeController({
    actionAt: point => {
      if (!activeTool || !scene || uiAt(point) || !scene.isBottleAt(point.x, point.y)) return null;
      if (activeTool.kind === 'spray') { const target = scene.sprayTargetAt(point.x, point.y); return target?.type === 'decoration' ? { type: 'spray-decoration', decorationId: target.id, amount: .012 } : { type: 'spray', plantId: target?.type === 'plant' ? target.id : null, amount: .012 }; }
      const placement = scene.positionAt(point.x, point.y); if (!placement) return null;
      return terrainToolAction(activeTool, placement.x, scoopRadius);
    },
    perform: performStroke, finish: finishInteraction,
    effect: point => {
      scene?.setEffect(point && activeTool ? { kind: activeTool.kind, clientX: point.x, clientY: point.y, ...(activeTool.kind === 'pour' ? { material: activeTool.material } : {}), ...(activeTool.kind === 'scoop' ? { radius: scoopRadius } : {}) } : null);
      const cursor = element('cursor-tool'); cursor.classList.toggle('spraying', Boolean(point && activeTool?.kind === 'spray')); cursor.classList.toggle('pouring', Boolean(point && (activeTool?.kind === 'pour' || activeTool?.kind === 'water'))); cursor.classList.toggle('scooping', Boolean(point && activeTool?.kind === 'scoop'));
      if (!isWidget && activeTool) text('workshop-tool-status', point ? 'Working…' : 'Hold to begin');
    }, failed: error => toast(errorMessage(error), true),
  });
  const stop = (): void => {
    const finishMister = activeTool?.kind === 'spray' && (strokePointer !== null || Boolean(stroke?.active) || widgetSprayKey !== null);
    void stroke?.stop(); const pointer = strokePointer; strokePointer = null;
    if (pointer !== null && canvas.hasPointerCapture(pointer)) canvas.releasePointerCapture(pointer);
    if (finishMister) { suppressToolClick = true; setTool(null); }
    refreshWidgetHit?.();
  };
  canvas.addEventListener('pointerdown', event => {
    if (!activeTool || event.button !== 0) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (!scene?.isBottleAt(event.clientX, event.clientY)) return;
    strokePointer = event.pointerId; canvas.setPointerCapture(event.pointerId); updateToolPointer({ x: event.clientX, y: event.clientY }); stroke?.start({ x: event.clientX, y: event.clientY });
  });
  canvas.addEventListener('pointermove', event => { if (!activeTool) return; const point = { x: event.clientX, y: event.clientY }; updateToolPointer(point); if (stroke?.active) { stroke.move(point); event.stopImmediatePropagation(); } });
  canvas.addEventListener('pointerup', event => { if (strokePointer === event.pointerId) { updateToolPointer({ x: event.clientX, y: event.clientY }); stop(); event.stopImmediatePropagation(); } });
  canvas.addEventListener('pointercancel', stop); canvas.addEventListener('lostpointercapture', stop);
  window.addEventListener('pointerup', event => { if (stroke?.active) { updateToolPointer({ x: event.clientX, y: event.clientY }); stop(); } });
  document.addEventListener('mousemove', event => { if (activeTool) updateToolPointer({ x: event.clientX, y: event.clientY }); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && activeTool) { event.preventDefault(); setTool(null); } });
  window.addEventListener('blur', () => { if (activeTool) setTool(null); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && activeTool) setTool(null); });
  canvas.addEventListener('contextmenu', event => { if (activeTool && !isWidget) { event.preventDefault(); event.stopImmediatePropagation(); setTool(null); } });
  document.addEventListener('click', event => { if (event.target instanceof Element && event.target.closest('[data-exit-tool]')) setTool(null); });
}

function toast(message: string, error = false): void {
  if (disposed) return; const output = element('toast'); output.textContent = message;
  output.setAttribute('role', error ? 'alert' : 'status'); output.hidden = false;
  if (toastTimer !== undefined) clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { output.hidden = true; }, error ? 6500 : 3500);
}
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : 'That did not work. Please try again.'; }

/** All persistent edits cross the validated main-process bridge. The queue avoids
 * reordering independent interactions; snapshots never rebuild live DOM controls. */
function dispatch(action: TerrariumAction, success?: () => void): Promise<void> {
  if (!bridge) return Promise.resolve();
  const operation = queue.then(async () => {
    const result = await bridge.dispatch(action); if (!disposed) { receive(result); success?.(); }
  });
  queue = operation.catch(error => { toast(errorMessage(error), true); }); return queue;
}

function syncInput(id: string, value: string, force = false): void {
  const input = element<HTMLInputElement | HTMLSelectElement>(id);
  if (force || (!drafts.has(id) && document.activeElement !== input)) input.value = value;
}
function currentEntity(selection = selected): Plant | Decoration | undefined {
  if (!snapshot || !selection) return undefined;
  return selection.type === 'plant' ? snapshot.state.plants.find(plant => plant.id === selection.id) : snapshot.state.decorations.find(item => item.id === selection.id);
}
function select(selection: Selection | null): void {
  if (selected?.id !== selection?.id) entityEditor?.finish(false);
  selected = selection; scene?.setSelection(selection); updateSelection();
}
function updateSelection(): void {
  if (isWidget) return; const item = currentEntity(); const bar = element('selection-bar');
  bar.hidden = !item;
  if (item && selected) text('selection-name', selected.type === 'plant' ? plantNames[(item as Plant).kind] : decorationNames[(item as Decoration).kind]);
  entityEditor?.sync();
}
function renderVisibleState(): void {
  if (!snapshot) return;
  const state = entityEditor?.visibleState(snapshot.state) ?? snapshot.state;
  const visibleForm = formDraft ?? pendingGlassForm;
  scene?.setState(visibleForm && state.bottle === 'glass-box' ? { ...state, glassForm: visibleForm } : state);
}

function receive(value: Snapshot): void {
  // The main-process revision, not a wall clock, determines snapshot freshness.
  // Clock changes and cross-machine imports can legitimately lower updatedAt.
  if (snapshot && value.meta.revision < snapshot.meta.revision) return;
  snapshot = value; const state = value.state;
  document.documentElement.classList.toggle('reduced-motion', state.preferences.reducedMotion);
  renderVisibleState();
  if (selected && !currentEntity()) select(null);
  if (isWidget) {
    text('widget-tooltip', `${displayTerrariumName(state.name)} · ${state.paused ? 'Paused' : state.vacation ? 'Vacation mode' : 'Growing quietly'}`);
    return;
  }
  syncInput('bottle-name', displayTerrariumName(state.name));
  syncInput('widget-size', state.preferences.widgetSize);
  text('soil-stat', percent(state.ecology.moisture)); text('humidity-stat', percent(state.ecology.humidity));
  element('soil-track').style.width = percent(state.ecology.moisture); element('humidity-track').style.width = percent(state.ecology.humidity);
  text('day-stat', `${state.ecology.simulatedDays.toFixed(1)} days`);
  text('time-context', state.paused ? 'Ecological time is paused' : `${state.vacation ? 'Vacation protection · ' : ''}Online · ${state.speed}× speed`);
  const health = state.plants.length ? state.plants.reduce((sum, plant) => sum + plant.health, 0) / state.plants.length : 1;
  const badge = state.paused ? 'Paused in this moment' : state.vacation ? 'Away, in good hands' : state.plants.length === 0 ? 'Ready for new life' : health < .4 ? 'A little care needed' : 'Growing quietly';
  text('ecosystem-badge', badge);
  text('scene-caption', state.plants.length === 0 ? 'Choose a plant to begin your landscape' : 'Select · Arrange · Watch it grow');
  const care = state.ecology.moisture > .82 ? 'The soil is wet. Let it breathe before misting again.' : state.ecology.moisture < .25 ? 'The soil is drying. A gentle mist would help.' : state.environment.light < .22 ? 'A little more indirect light would help your forest.' : 'Water, soil and new leaves are finding their rhythm.';
  text('care-note', care); text('care-guidance', `${care} Growth is a playful ecological approximation, not scientific or horticultural advice.`);
  text('save-status', value.meta.storageStatus || 'Saved locally');
  text('offline-label', value.meta.offlineHours > .01 ? `Last away: ${value.meta.offlineHours.toFixed(1)} hours` : 'Local · No cloud');
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-shape]')) { const active = button.dataset.shape === state.bottle; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active)); }
  syncGlassControls();
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-speed]')) { const active = Number(button.dataset.speed) === state.speed; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active)); }
  syncInput('temperature', String(state.environment.temperature)); syncInput('light', String(Math.round(state.environment.light * 100)));
  if (!drafts.has('temperature')) text('temperature-value', `${state.environment.temperature.toFixed(1)}°C`);
  if (!drafts.has('light')) text('light-value', percent(state.environment.light));
  checked('lid-switch', state.closed); element<HTMLButtonElement>('lid-switch').disabled = !hasLid(state.bottle); checked('pause-switch', state.paused); checked('vacation-switch', state.vacation);
  checked('top-switch', state.preferences.alwaysOnTop); checked('login-switch', state.preferences.launchAtLogin); checked('motion-switch', state.preferences.reducedMotion);
  text('lid-title', !hasLid(state.bottle) ? 'Open vessel · No lid' : state.closed ? 'Lid closed' : 'Lid open'); text('lid-description', !hasLid(state.bottle) ? 'Open to the room' : state.closed ? 'Moisture cycles within the glass' : 'Let excess moisture escape');
  text('journal-days', `${state.ecology.simulatedDays.toFixed(1)} days`); text('journal-count', `${state.plants.length} plants · ${state.decorations.length} objects`);
  text('journal-health', state.paused ? 'Your forest is paused until you return.' : state.vacation ? 'Gentler growth and slower drying while you are away.' : health < .4 ? 'Check moisture and light; your forest needs some care.' : 'Every new leaf is worth the wait.');
  text('app-version', `v${value.meta.version} · ${value.meta.platform} · MIT`); updateSelection();
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-plant]')) button.disabled = state.plants.length >= 24;
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-decoration]')) button.disabled = state.decorations.length >= 20;
}

function switchTab(tab: string): void {
  const allowed = new Set(['build', 'care', 'time', 'settings']); if (!allowed.has(tab)) return;
  catalogPicker?.cancel(); entityEditor?.finish(false); select(null);
  finishGlassForm(false); activeWorkshopTab = tab; syncSculptHandles();
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-tab]')) { const active = button.dataset.tab === tab; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active)); }
  for (const panel of document.querySelectorAll<HTMLElement>('.tool-panel')) panel.hidden = panel.id !== `panel-${tab}`;
  element('panel-' + tab).parentElement?.scrollTo({ top: 0 });
}

function installGlassControls(): void {
  element<HTMLSelectElement>('glass-side').addEventListener('change', event => {
    finishGlassForm(false); editedGlassSide = (event.target as HTMLSelectElement).value === 'left' ? 'left' : 'right'; syncGlassControls();
  });
  element<HTMLInputElement>('glass-linked').addEventListener('change', event => { finishGlassForm(false); linkGlassSides = (event.target as HTMLInputElement).checked; });
  for (const input of document.querySelectorAll<HTMLInputElement>('[data-glass-ring], [data-glass-height]')) {
    const key = (input.dataset.glassRing ?? input.dataset.glassHeight) as GlassRing;
    input.addEventListener('input', () => {
      if (!snapshot || snapshot.state.bottle !== 'glass-box') return;
      if (!formDraft) { setTool(null); formDraft = glassFormDraft(pendingGlassForm ?? snapshot.state.glassForm); }
      drafts.add(input.id); const point = glassControl(formDraft, editedGlassSide, key);
      if (input.dataset.glassHeight) point.height = Number(input.value); else point.width = Number(input.value);
      formDraft = editGlassControl(formDraft, editedGlassSide, key, point, linkGlassSides); previewGlassForm();
    });
    input.addEventListener('change', () => finishGlassForm(true));
    input.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); finishGlassForm(false); } });
    input.addEventListener('blur', () => { drafts.delete(input.id); if (formDraft) finishGlassForm(false); });
  }
  element<HTMLSelectElement>('glass-facets').addEventListener('change', event => {
    if (!snapshot || snapshot.state.bottle !== 'glass-box') return;
    const facets = Number((event.target as HTMLSelectElement).value);
    if (!(GLASS_FACETS as readonly number[]).includes(facets)) return;
    setTool(null); formDraft = { ...glassFormDraft(pendingGlassForm ?? snapshot.state.glassForm), facets }; finishGlassForm(true);
  });
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-sculpt-ring]')) {
    const key = button.dataset.sculptRing as GlassRing;
    const side: GlassSideName = button.dataset.sculptSide === 'left' ? 'left' : 'right';
    button.addEventListener('pointerdown', event => {
      if (event.button !== 0 || !snapshot || snapshot.state.bottle !== 'glass-box') return;
      event.preventDefault(); setTool(null); button.focus({ preventScroll: true }); formDraft = glassFormDraft(pendingGlassForm ?? snapshot.state.glassForm);
      editedGlassSide = side; formDrag = { button, key, side, pointerId: event.pointerId, changed: false }; button.setPointerCapture(event.pointerId); syncGlassControls();
    });
    button.addEventListener('pointermove', event => {
      if (!formDrag || formDrag.button !== button || formDrag.pointerId !== event.pointerId || !formDraft || !scene) return;
      const value = scene.sculptControlAt(side, key, event.clientX, event.clientY);
      const previous = glassControl(formDraft, side, key);
      if (Math.abs(value.width - previous.width) < .001 && Math.abs(value.height - previous.height) < .001) return;
      formDrag.changed = true; formDraft = editGlassControl(formDraft, side, key, value, linkGlassSides); previewGlassForm();
    });
    button.addEventListener('pointerup', event => { if (formDrag?.pointerId === event.pointerId) finishGlassForm(formDrag.changed); });
    button.addEventListener('pointercancel', () => finishGlassForm(false));
    button.addEventListener('lostpointercapture', () => { if (formDrag?.button === button) finishGlassForm(false); });
    button.addEventListener('keydown', event => {
      if (!snapshot || snapshot.state.bottle !== 'glass-box') return;
      if (event.key === 'Escape') { event.preventDefault(); finishGlassForm(false); return; }
      const form = glassFormDraft(pendingGlassForm ?? snapshot.state.glassForm), value = glassControl(form, side, key), step = event.shiftKey ? .05 : .01;
      if (event.key === 'ArrowLeft') value.width += side === 'left' ? step : -step;
      else if (event.key === 'ArrowRight') value.width += side === 'left' ? -step : step;
      else if (event.key === 'ArrowUp') value.height += step;
      else if (event.key === 'ArrowDown') value.height -= step;
      else if (event.key === 'Home') { value.width = .4; value.height = GLASS_HEIGHT_LIMITS[key][0]; }
      else if (event.key === 'End') { value.width = 1.35; value.height = GLASS_HEIGHT_LIMITS[key][1]; }
      else return;
      event.preventDefault(); setTool(null); editedGlassSide = side; formDraft = editGlassControl(form, side, key, value, linkGlassSides); finishGlassForm(true);
    });
  }
  window.addEventListener('blur', () => finishGlassForm(false));
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && (formDrag || formDraft)) { event.preventDefault(); finishGlassForm(false); }
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) finishGlassForm(false); });
  const resize = (): void => { requestAnimationFrame(() => { if (!disposed) syncSculptHandles(); }); };
  sculptResizeObserver = new ResizeObserver(resize); sculptResizeObserver.observe(element('stage'));
  window.addEventListener('resize', resize);
}

let confirmation: ((accepted: boolean) => void) | null = null;
function confirm(title: string, description: string, label: string): Promise<boolean> {
  if (confirmation) return Promise.resolve(false);
  text('confirm-title', title); text('confirm-description', description); text('confirm-accept', label);
  const dialog = element<HTMLDialogElement>('confirm-dialog'); dialog.showModal(); element('confirm-cancel').focus();
  return new Promise(resolve => { confirmation = resolve; });
}
function completeConfirmation(accepted: boolean): void {
  const resolve = confirmation; confirmation = null; element<HTMLDialogElement>('confirm-dialog').close(); resolve?.(accepted);
}
async function fileCommand(type: 'export' | 'import'): Promise<void> {
  if (!bridge || busyFile) return;
  setTool(null);
  busyFile = true;
  try {
    if (type === 'import' && !await confirm('Import another forest?', 'Importing replaces this terrarium. Export a backup first. Invalid or damaged files will not overwrite your forest.', 'Choose a save')) return;
    await queue;
    const result = type === 'export' ? await bridge.exportSave() : await bridge.importSave();
    toast(result.message, !result.ok);
    if (type === 'import' && result.ok) { select(null); receive(await bridge.getSnapshot()); }
  } catch (error) { toast(errorMessage(error), true); } finally { busyFile = false; }
}

function removeSelection(): void {
  if (!selected) return; const target = selected;
  void dispatch(target.type === 'plant' ? { type: 'remove-plant', id: target.id } : { type: 'remove-decoration', id: target.id }, () => { select(null); toast('Removed. A little room for new growth.'); });
}
function water(): void { setTool({ kind: 'spray' }); }
function addItem(kind: PlantKind | DecorationKind, type: Selection['type'], position: Position, woodPreset?: WoodPresetKind, variant?: DecorationVariant): void {
  if (!snapshot) return;
  const count = type === 'plant' ? snapshot.state.plants.length : snapshot.state.decorations.length;
  if (count >= (type === 'plant' ? 24 : 20)) { toast(type === 'plant' ? 'This vessel holds up to 24 plants. Make a little room first.' : 'This vessel holds up to 20 objects. Make a little room first.'); return; }
  const point = position;
  const oldIds = new Set((type === 'plant' ? snapshot.state.plants : snapshot.state.decorations).map(item => item.id));
  void dispatch(type === 'plant' ? { type: 'add-plant', kind: kind as PlantKind, ...point } : { type: 'add-decoration', kind: kind as DecorationKind, ...point, ...(woodPreset ? { woodPreset } : {}), ...(variant ? { variant } : {}) }, () => {
    if (!snapshot) return; const newItem = (type === 'plant' ? snapshot.state.plants : snapshot.state.decorations).find(item => !oldIds.has(item.id));
    if (newItem) select({ type, id: newItem.id }); toast('Added to your forest. Drag to arrange it.');
  });
}

function renderCatalog(): void {
  const paintObject = (canvas: HTMLCanvasElement, decoration: Decoration): void => {
    canvas.width = 240; canvas.height = 140; const ctx = canvas.getContext('2d'); if (!ctx) return;
    const bounds = decorationBounds2D(decoration), unit = Math.min(212 / (bounds.right - bounds.left), 112 / (bounds.bottom - bounds.top));
    drawDecoration(ctx, decoration, 120 - (bounds.left + bounds.right) * unit / 2, 70 - (bounds.top + bounds.bottom) * unit / 2, unit);
  };
  for (const canvas of document.querySelectorAll<HTMLCanvasElement>('canvas[data-category-preview]')) {
    canvas.width = 80; canvas.height = 66; const ctx = canvas.getContext('2d'); if (!ctx) continue;
    if (canvas.dataset.categoryPreview === 'plant') {
      const plant: Plant = { id: `category-${canvas.dataset.categoryKind}`, kind: canvas.dataset.categoryKind as PlantKind, x: .5, y: .5, scale: 1, growth: .85, health: .92, ageDays: 0, wetness: .12 };
      const bounds = getPlantExtent(plant.kind), unit = Math.min(72 / (bounds.right - bounds.left), 56 / (bounds.bottom - bounds.top));
      drawPlant(ctx, plant, 40 - (bounds.left + bounds.right) * unit / 2, 33 - (bounds.top + bounds.bottom) * unit / 2, unit);
    } else {
      const decoration: Decoration = { id: `category-${canvas.dataset.categoryKind}`, kind: canvas.dataset.categoryKind as DecorationKind, x: .5, y: .5, scale: 1 };
      const bounds = decorationBounds2D(decoration), unit = Math.min(72 / (bounds.right - bounds.left), 56 / (bounds.bottom - bounds.top));
      drawDecoration(ctx, decoration, 40 - (bounds.left + bounds.right) * unit / 2, 33 - (bounds.top + bounds.bottom) * unit / 2, unit);
    }
  }
  for (const canvas of document.querySelectorAll<HTMLCanvasElement>('canvas[data-preview]')) {
    canvas.width = 220; canvas.height = 140; const ctx = canvas.getContext('2d'); if (!ctx) continue; ctx.scale(2, 2);
    const plant: Plant = { id: `catalog-${canvas.dataset.preview}`, kind: canvas.dataset.preview as PlantKind, x: .5, y: .5, scale: 1, growth: .85, health: .92, ageDays: 0, wetness: .12 };
    drawPlant(ctx, plant, 55, plant.kind.endsWith('moss') ? 46 : 66, ['fern', 'creeping-fig', 'oxalis'].includes(plant.kind) ? 48 : plant.kind === 'fittonia' ? 60 : 86);
  }
  for (const canvas of document.querySelectorAll<HTMLCanvasElement>('canvas[data-decoration-preview]')) {
    canvas.width = 80; canvas.height = 66; const ctx = canvas.getContext('2d'); if (!ctx) continue; ctx.scale(2, 2);
    drawDecoration(ctx, { id: `catalog-${canvas.dataset.decorationPreview}`, kind: canvas.dataset.decorationPreview as DecorationKind, x: .5, y: .5, scale: 1 }, 20, 27, 42);
  }
  for (const preset of WOOD_PRESETS) {
    const button = document.querySelector<HTMLButtonElement>(`[data-wood-preset="${preset.id}"]`);
    const canvas = button?.querySelector<HTMLCanvasElement>('canvas'); if (!button || !canvas) continue;
    button.setAttribute('aria-label', `${preset.label} driftwood. Drag into the glass, or click then place.`);
    const label = button.querySelector('.wood-preset-label'); if (label) label.textContent = preset.label;
    paintObject(canvas, { id: `catalog-wood-${preset.id}`, kind: 'wood', x: .5, y: .5, scale: 1, wood: woodPresetForm(preset.id) });
  }
  for (const kind of ['stone', 'stump'] as const) {
    for (const variant of kind === 'stone' ? STONE_VARIANTS : STUMP_VARIANTS) {
      const button = document.querySelector<HTMLButtonElement>(`[data-decoration="${kind}"][data-variant="${variant.id}"]`);
      const canvas = button?.querySelector<HTMLCanvasElement>('canvas'); if (!button || !canvas) continue;
      button.setAttribute('aria-label', `${variant.label}. Drag into the glass, or click then place.`);
      const label = button.querySelector('span'); if (label) label.textContent = variant.label;
      paintObject(canvas, { id: `catalog-${kind}-${variant.id}`, kind, variant: variant.id, x: .5, y: .5, scale: 1 });
    }
  }
  for (const item of DECORATION_ITEMS) {
    const button = document.querySelector<HTMLButtonElement>(`[data-decoration="${item.id}"]`);
    const canvas = button?.querySelector<HTMLCanvasElement>('canvas'); if (!button || !canvas) continue;
    button.setAttribute('aria-label', `${item.label}. ${isFloatingDecoration(item.id) ? 'Floats freely inside the glass.' : 'Drag into the glass, or click then place.'}`);
    const label = button.querySelector('span'); if (label) label.textContent = item.label;
    paintObject(canvas, { id: `catalog-${item.id}`, kind: item.id, x: .5, y: .5, scale: 1 });
  }
}

function installWorkshop(): void {
  installCatalogGroups();
  const name = element<HTMLInputElement>('bottle-name');
  const commitName = (): void => {
    if (!drafts.has(name.id)) return;
    drafts.delete(name.id); const value = name.value.trim();
    if (!value) { if (snapshot) name.value = displayTerrariumName(snapshot.state.name); toast('Give your forest a name.'); return; }
    if (value !== snapshot?.state.name) void dispatch({ type: 'rename', name: value });
  };
  name.addEventListener('input', () => drafts.add(name.id)); name.addEventListener('blur', commitName);
  name.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.isComposing) name.blur(); if (event.key === 'Escape') { if (snapshot) name.value = displayTerrariumName(snapshot.state.name); drafts.delete(name.id); name.blur(); } });
  for (const range of document.querySelectorAll<HTMLInputElement>('#temperature, #light')) {
    // Controls keep their local draft while editing, including during snapshot pushes.
    range.addEventListener('input', () => { drafts.add(range.id);
      text(`${range.id}-value`, range.id === 'temperature' ? `${Number(range.value).toFixed(1)}°C` : `${range.value}%`);
    });
    range.addEventListener('change', () => {
      drafts.delete(range.id);
      if (snapshot) void dispatch({ type: 'environment', temperature: Number(element<HTMLInputElement>('temperature').value), light: Number(element<HTMLInputElement>('light').value) / 100 });
    });
    range.addEventListener('blur', () => { drafts.delete(range.id); if (snapshot) syncInput(range.id, range.id === 'temperature' ? String(snapshot.state.environment.temperature) : String(Math.round(snapshot.state.environment.light * 100)), true); });
  }
  element<HTMLSelectElement>('widget-size').addEventListener('change', event => { void dispatch({ type: 'preferences', value: { widgetSize: (event.target as HTMLSelectElement).value as TerrariumState['preferences']['widgetSize'] } }); });
  document.addEventListener('click', event => {
    const button = (event.target as Element).closest<HTMLButtonElement>('button'); if (!button || button.disabled || !snapshot) return;
    const state = snapshot.state;
    if (button.dataset.tab) switchTab(button.dataset.tab);
    else if (button.dataset.material) setTool(button.dataset.material === 'water' ? { kind: 'water' } : { kind: 'pour', material: button.dataset.material as MaterialKind });
    else if (button.dataset.scoopRadius) {
      const radius = Number(button.dataset.scoopRadius);
      if (SCOOP_RADII.includes(radius as ScoopRadius)) {
        void stroke?.stop(); scoopRadius = radius as ScoopRadius;
        for (const choice of document.querySelectorAll<HTMLButtonElement>('[data-scoop-radius]')) choice.setAttribute('aria-pressed', String(Number(choice.dataset.scoopRadius) === scoopRadius));
        if (lastPointer) updateToolPointer(lastPointer);
      }
    }
    else if (button.dataset.shape) { setTool(null); void dispatch({ type: 'bottle', shape: button.dataset.shape as TerrariumState['bottle'] }); }
    else if (button.dataset.speed) void dispatch({ type: 'speed', speed: Number(button.dataset.speed) as Speed });
    else if (button.dataset.command) {
      document.querySelectorAll<HTMLDetailsElement>('.file-menu').forEach(menu => { menu.open = false; });
      if (button.dataset.command === 'export' || button.dataset.command === 'import') void fileCommand(button.dataset.command);
      else if (button.dataset.command === 'starter') void dispatch({ type: 'starter' }, () => { toast('Starter plants added. Your existing landscape is preserved.'); });
      else if (button.dataset.command === 'reset') void (async () => { setTool(null); if (await confirm('Start with an empty bottle?', 'This removes all soil, water, plants and objects and resets care settings. Your preferences stay. It cannot be undone. Export a backup first.', 'Empty bottle')) await dispatch({ type: 'reset' }, () => { select(null); toast('An empty bottle, ready for a new forest.'); }); })();
    } else {
      switch (button.id) {
        case 'water-button': water(); break;
        case 'scoop-tool': setTool({ kind: 'scoop' }); break;
        case 'drain-tool': setTool({ kind: 'drain' }); break;
        case 'lid-switch': void dispatch({ type: 'lid', closed: !state.closed }); break;
        case 'pause-switch': void dispatch({ type: 'pause', paused: !state.paused }); break;
        case 'vacation-switch': void dispatch({ type: 'vacation', enabled: !state.vacation }); break;
        case 'top-switch': void dispatch({ type: 'preferences', value: { alwaysOnTop: !state.preferences.alwaysOnTop } }); break;
        case 'login-switch': void dispatch({ type: 'preferences', value: { launchAtLogin: !state.preferences.launchAtLogin } }); break;
        case 'motion-switch': void dispatch({ type: 'preferences', value: { reducedMotion: !state.preferences.reducedMotion } }); break;
        case 'remove-selection': removeSelection(); break;
      }
    }
  });
  const canvas = element<HTMLCanvasElement>('workshop-canvas');
  entityEditor = new EntityEditor({ state: () => snapshot?.state, selection: () => selected, commit: dispatch, render: renderVisibleState, close: () => select(null) });
  if (scene) catalogPicker = new CatalogPicker({ scene, prepare: () => { setTool(null); select(null); }, add: (pick, position) => addItem(pick.kind, pick.type, position, pick.woodPreset, pick.variant), notice: toast });
  element('water-button').textContent = 'Pick up mister · Hold over plants';
  canvas.setAttribute('aria-label', 'Terrarium studio. Enter or Space selects the next object. Drag or use arrow keys to move it; hold Shift for larger steps. Delete removes and Escape deselects.');
  let dragging: { selection: Selection; initial: Position; clientX: number; clientY: number; moved: boolean; pointerId: number; final: Position } | null = null;
  canvas.addEventListener('pointerdown', event => {
    if (activeTool || event.button !== 0 || !scene) return; const target = scene.hitTest(event.clientX, event.clientY); select(target); canvas.focus();
    const item = currentEntity(target); if (!target || !item) return;
    dragging = { selection: target, initial: { x: item.x, y: item.y }, final: { x: item.x, y: item.y }, clientX: event.clientX, clientY: event.clientY, moved: false, pointerId: event.pointerId };
    canvas.setPointerCapture(event.pointerId); event.preventDefault();
  });
  canvas.addEventListener('pointermove', event => {
    if (!dragging || !scene) return; const dx = event.clientX - dragging.clientX; const dy = event.clientY - dragging.clientY;
    if (!dragging.moved && Math.hypot(dx, dy) < 3) return; dragging.moved = true;
    const placement = scene.placementAt(event.clientX, event.clientY, dragging.selection.id);
    if (placement) { dragging.final = placement; scene.setDragPreview(dragging.selection, dragging.final); }
  });
  const finishDrag = (commit: boolean): void => {
    const previous = dragging; dragging = null; scene?.setDragPreview(null);
    if (!previous) return;
    if (canvas.hasPointerCapture(previous.pointerId)) canvas.releasePointerCapture(previous.pointerId);
    if (commit && previous.moved) void dispatch(previous.selection.type === 'plant' ? { type: 'move-plant', id: previous.selection.id, ...previous.final, support: previous.final.support ?? null } : { type: 'move-decoration', id: previous.selection.id, ...previous.final, support: previous.final.support ?? null });
  };
  canvas.addEventListener('pointerup', () => finishDrag(true)); canvas.addEventListener('pointercancel', () => finishDrag(false));
  canvas.addEventListener('lostpointercapture', () => { if (dragging) finishDrag(false); });
  canvas.addEventListener('keydown', event => {
    if (activeTool) return;
    if (event.key === 'Escape') { finishDrag(false); select(null); return; }
    if (event.key === 'Delete' || event.key === 'Backspace') { if (selected) { event.preventDefault(); removeSelection(); } return; }
    if (event.key === 'Tab') return;
    if (event.key === 'Enter' || event.key === ' ') {
      const entities = snapshot ? [...snapshot.state.plants.map(item => ({ item, type: 'plant' as const })), ...snapshot.state.decorations.map(item => ({ item, type: 'decoration' as const }))] : [];
      if (entities.length) { event.preventDefault(); const index = entities.findIndex(({ item }) => item.id === selected?.id); const next = entities[(index + 1) % entities.length]; select({ type: next.type, id: next.item.id }); toast(`${next.type === 'plant' ? plantNames[(next.item as Plant).kind] : decorationNames[(next.item as Decoration).kind]} selected. Use the arrow keys to move it.`); }
      return;
    }
    const entity = currentEntity(); if (!selected || !entity || !event.key.startsWith('Arrow')) return;
    event.preventDefault(); const step = event.shiftKey ? .05 : .015; const x = clamp(entity.x + (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0), .07, .93); const y = clamp(entity.y + (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0), .07, .93);
    // Attached items use a local horizontal coordinate on their parent. Updating
    // the ground fallback alone would make arrow nudges appear to do nothing.
    const support = entity.support ? { ...entity.support, x: clamp(entity.support.x + (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0)) } : undefined;
    void dispatch(selected.type === 'plant' ? { type: 'move-plant', id: selected.id, x, y, ...(support ? { support } : {}) } : { type: 'move-decoration', id: selected.id, x, y, ...(support ? { support } : {}) });
  });
  installGlassControls(); renderCatalog();
}

function installWidget(): void {
  if (!bridge) return; const widget = element('widget'); const canvas = element<HTMLCanvasElement>('widget-canvas');
  let passthrough: boolean | null = null;
  let lastPassthroughSent = 0;
  let dragging: { pointerId: number; start: PointerPoint; last: PointerPoint; moved: boolean } | null = null;
  let suppressClick = false;
  widgetMoveQueue = new WidgetMoveQueue((dx, dy) => bridge.moveWidget(dx, dy), undefined, error => toast(errorMessage(error), true));
  const updatePassthrough = (ignore: boolean): void => {
    widget.classList.toggle('hit', !ignore);
    // Tray rescue may reset the native ignore state. An infrequent refresh keeps
    // local and native hit state aligned without sending IPC on every mousemove.
    if (passthrough === ignore && performance.now() - lastPassthroughSent < 500) return;
    passthrough = ignore; lastPassthroughSent = performance.now(); bridge.setWidgetPassthrough(ignore);
  };
  refreshWidgetHit = (): void => {
    if (!scene || !lastPointer) return;
    // Clear glass is still part of the bottle. Its CPU silhouette—not rendered
    // alpha or a GPU readback—defines the clickable area.
    updatePassthrough(!dragging && !stroke?.active && !uiAt(lastPointer) && !scene.isBottleAt(lastPointer.x, lastPointer.y));
  };
  // Electron uses ignoreMouseEvents(ignore, {forward:true}); forwarded mousemove
  // events still reach this listener when the transparent area is click-through.
  document.addEventListener('mousemove', event => {
    // Do not leading-throttle hit samples: the last move may enter the bottle
    // immediately before a click, and native passthrough must change that instant.
    lastPointer = { x: event.clientX, y: event.clientY }; refreshWidgetHit?.();
  });
  document.addEventListener('mouseleave', () => { if (!dragging && !stroke?.active) updatePassthrough(true); });
  document.addEventListener('visibilitychange', () => { passthrough = null; widget.classList.remove('hit'); });
  const quick = (): void => { if (activeTool) return; const menu = element('widget-quick'); menu.hidden = !menu.hidden; refreshWidgetHit?.(); };
  const endDrag = (cancelMovement = false): void => {
    if (cancelMovement) widgetMoveQueue?.cancel();
    const previous = dragging; dragging = null;
    if (!previous) return; suppressClick = previous.moved;
    if (canvas.hasPointerCapture(previous.pointerId)) canvas.releasePointerCapture(previous.pointerId);
    refreshWidgetHit?.();
  };
  canvas.addEventListener('pointerdown', event => {
    if (event.button !== 0 || activeTool || !scene?.isBottleAt(event.clientX, event.clientY)) return;
    suppressClick = false; suppressToolClick = false; const point = { x: event.screenX, y: event.screenY };
    dragging = { pointerId: event.pointerId, start: point, last: point, moved: false }; canvas.setPointerCapture(event.pointerId); updatePassthrough(false);
  });
  canvas.addEventListener('pointermove', event => {
    if (!dragging || event.pointerId !== dragging.pointerId) return;
    const point = { x: event.screenX, y: event.screenY }; const delta = widgetDragStep(dragging.start, dragging.last, point, dragging.moved);
    dragging.moved = delta.moved;
    if (delta.moved) { dragging.last = point; if (delta.dx || delta.dy) widgetMoveQueue?.push(delta.dx, delta.dy); event.preventDefault(); }
  });
  canvas.addEventListener('pointerup', () => endDrag()); canvas.addEventListener('pointercancel', () => endDrag(true)); canvas.addEventListener('lostpointercapture', () => { if (dragging) endDrag(true); });
  window.addEventListener('blur', () => endDrag(true)); document.addEventListener('visibilitychange', () => { if (document.hidden) endDrag(true); });
  canvas.addEventListener('click', event => { if (suppressToolClick) { suppressToolClick = false; return; } if (suppressClick) { suppressClick = false; return; } if (!activeTool && !stroke?.active && scene?.isBottleAt(event.clientX, event.clientY)) quick(); });
  canvas.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (activeTool?.kind === 'spray' && !event.repeat && !widgetSprayKey && scene) { widgetSprayKey = event.key; const source = scene.defaultSpraySource(); updateToolPointer(source); stroke?.start(source); }
      else if (!activeTool) quick();
    }
    if (event.key === 'Escape') { setTool(null); element('widget-quick').hidden = true; refreshWidgetHit?.(); }
  });
  canvas.addEventListener('keyup', event => { if (widgetSprayKey === event.key) { event.preventDefault(); setTool(null); } });
  widget.addEventListener('contextmenu', event => {
    event.preventDefault(); if (!scene?.isBottleAt(event.clientX, event.clientY)) return;
    endDrag(); setTool(null); bridge.openWorkshop();
  });
  const spray = document.querySelector<HTMLButtonElement>('[data-widget-control=spray]');
  if (!spray) throw new Error('Missing spray shortcut');
  spray.addEventListener('click', event => {
    event.preventDefault(); endDrag(); setTool({ kind: 'spray' });
    canvas.focus({ preventScroll: true });
    if (lastPointer) updateToolPointer(lastPointer);
    refreshWidgetHit?.();
  });
  document.querySelector<HTMLButtonElement>('[data-widget-control=sun]')?.addEventListener('click', () => {
    scene?.sunlight(); void dispatch({ type: 'sunlight' });
  });
  // The first hover discovers the complete bottle silhouette; outside it the
  // transparent desktop region remains click-through.
  updatePassthrough(false);
  widget.classList.remove('hit');
}

async function start(): Promise<void> {
  if (!bridge || typeof bridge.getSnapshot !== 'function' || typeof bridge.dispatch !== 'function' || typeof bridge.subscribe !== 'function' || typeof bridge.finishInteraction !== 'function') {
    loading.hidden = true; element('desktop-required').hidden = false; return;
  }
  try {
    scene = new TerrariumScene(element<HTMLCanvasElement>(isWidget ? 'widget-canvas' : 'workshop-canvas'), isWidget);
    element(isWidget ? 'widget' : 'workshop').hidden = false;
    installToolInteraction(scene.canvas);
    for (const canvas of document.querySelectorAll<HTMLCanvasElement>('[data-tool-art]')) {
      canvas.width = 128; canvas.height = 128; const ctx = canvas.getContext('2d'); if (ctx) drawToolArt(ctx, canvas.dataset.toolArt as ToolArtKind, 128);
    }
    if (isWidget) installWidget(); else installWorkshop();
    element('confirm-accept').addEventListener('click', () => completeConfirmation(true)); element('confirm-cancel').addEventListener('click', () => completeConfirmation(false));
    element<HTMLDialogElement>('confirm-dialog').addEventListener('cancel', event => { event.preventDefault(); completeConfirmation(false); });
    unsubscribe = bridge.subscribe(receive); receive(await bridge.getSnapshot()); loading.hidden = true;
  } catch (error) {
    loading.hidden = true; scene?.destroy(); scene = null; unsubscribe?.();
    element('workshop').hidden = true; element('widget').hidden = true; element('desktop-required').hidden = false;
    toast(`Desktop connection failed: ${errorMessage(error)}`, true);
  }
}
window.addEventListener('beforeunload', () => { disposed = true; formDraft = null; pendingGlassForm = null; formDrag = null; widgetMoveQueue?.dispose(); sculptResizeObserver?.disconnect(); if (sculptFrame !== undefined) cancelAnimationFrame(sculptFrame); stroke?.dispose(); unsubscribe?.(); scene?.destroy(); if (toastTimer !== undefined) clearTimeout(toastTimer); confirmation?.(false); });
void start();
