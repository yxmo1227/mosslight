import { DECORATION_GROUPS, isFloatingDecoration, PLANT_GROUPS, STONE_VARIANTS, STUMP_VARIANTS, WOOD_PRESETS } from '../shared/catalog';
import type { DecorationKind, DecorationVariant, PlantKind, WoodPresetKind } from '../shared/types';
import type { Position, Selection, TerrariumScene } from './scene';

type Pick = { type: Selection['type']; kind: PlantKind | DecorationKind; woodPreset?: WoodPresetKind; variant?: DecorationVariant };
interface PickerOptions { scene: TerrariumScene; prepare(): void; add(pick: Pick, position: Position): void; notice(message: string): void }
/** A palette gesture is provisional until released inside the vessel. */
export class CatalogPicker {
  private pick: Pick | null = null;
  private drag: { button: HTMLButtonElement; id: number; x: number; y: number; moved: boolean } | null = null;
  private suppressButton: HTMLButtonElement | null = null;
  private placementPointer: number | null = null;
  private readonly hint = document.getElementById('placement-hint')!;
  constructor(private readonly options: PickerOptions) {
    const canvas = options.scene.canvas;
    for (const id of ['wood-presets', 'stone-variants', 'stump-variants', ...PLANT_GROUPS.map(group => `${group.id}-choices`), ...DECORATION_GROUPS.map(group => `${group.id}-choices`)]) {
      const toggle = document.getElementById(`${id}-toggle`), choices = document.getElementById(id);
      if (!toggle || !choices) continue;
      toggle.addEventListener('click', () => {
        options.prepare(); this.cancel();
        const expanded = toggle.getAttribute('aria-expanded') !== 'true';
        toggle.setAttribute('aria-expanded', String(expanded)); choices.hidden = !expanded;
      });
      choices.addEventListener('keydown', event => {
        if (event.key !== 'Escape') return;
        event.preventDefault(); event.stopPropagation(); this.cancel();
        choices.hidden = true; toggle.setAttribute('aria-expanded', 'false'); toggle.focus();
      });
    }
    for (const button of document.querySelectorAll<HTMLButtonElement>('[data-plant], [data-decoration]')) {
      const preset = WOOD_PRESETS.find(value => value.id === button.dataset.woodPreset);
      // Only catalog-authored wood presets are accepted; malformed DOM metadata
      // must not turn into an unbounded or cross-kind placement payload.
      if (button.dataset.woodPreset && (!preset || button.dataset.decoration !== 'wood')) continue;
      const variants = button.dataset.decoration === 'stone' ? STONE_VARIANTS : button.dataset.decoration === 'stump' ? STUMP_VARIANTS : [];
      const variant = variants.find(value => value.id === button.dataset.variant);
      if (button.dataset.variant && (!variant || button.dataset.plant)) continue;
      const pick: Pick = button.dataset.plant ? { type: 'plant', kind: button.dataset.plant as PlantKind } : { type: 'decoration', kind: button.dataset.decoration as DecorationKind, ...(preset ? { woodPreset: preset.id } : {}), ...(variant ? { variant: variant.id } : {}) };
      button.draggable = false;
      button.addEventListener('dragstart', event => event.preventDefault());
      button.addEventListener('pointerdown', event => {
        if (event.button !== 0 || button.disabled) return;
        options.prepare(); this.cancel(); this.pick = pick;
        this.drag = { button, id: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
        button.setPointerCapture(event.pointerId); this.indicate();
      });
      button.addEventListener('pointermove', event => {
        if (!this.drag || this.drag.id !== event.pointerId) return;
        if (Math.hypot(event.clientX - this.drag.x, event.clientY - this.drag.y) >= 4) this.drag.moved = true;
        if (this.drag.moved) { event.preventDefault(); this.preview(event.clientX, event.clientY); }
      });
      button.addEventListener('pointerup', event => {
        const drag = this.drag; if (!drag || drag.id !== event.pointerId) return;
        this.drag = null;
        if (button.hasPointerCapture(event.pointerId)) button.releasePointerCapture(event.pointerId);
        if (drag.moved) {
          this.suppressButton = button;
          this.place(event.clientX, event.clientY);
          // Pointer-generated click follows pointerup synchronously; a later keyboard click must work.
          window.setTimeout(() => { this.suppressButton = null; }, 0);
        }
      });
      button.addEventListener('pointercancel', () => this.cancel());
      button.addEventListener('lostpointercapture', () => { if (this.drag) this.cancel(); });
      button.addEventListener('click', event => {
        event.preventDefault(); event.stopPropagation();
        if (this.suppressButton === button) { this.suppressButton = null; return; }
        options.prepare(); this.cancel(); this.pick = pick; this.indicate();
        options.notice('Choose a spot inside the glass. Escape cancels.');
        canvas.focus({ preventScroll: true });
      });
    }
    canvas.addEventListener('pointermove', event => { if (this.pick && !this.drag) this.preview(event.clientX, event.clientY); });
    canvas.addEventListener('pointerleave', () => { if (!this.drag) options.scene.setPlacementPreview(null); });
    canvas.addEventListener('pointerdown', event => {
      if (!this.pick || event.button !== 0) return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (!options.scene.placementAt(event.clientX, event.clientY, undefined, this.pick.kind)) { this.cancel(); return; }
      this.placementPointer = event.pointerId; canvas.setPointerCapture(event.pointerId); this.preview(event.clientX, event.clientY);
    }, true);
    canvas.addEventListener('pointerup', event => {
      if (this.placementPointer !== event.pointerId) return;
      event.preventDefault(); event.stopImmediatePropagation(); this.placementPointer = null;
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      this.place(event.clientX, event.clientY);
    }, true);
    canvas.addEventListener('pointercancel', () => this.cancel());
    canvas.addEventListener('lostpointercapture', event => { if (this.placementPointer === event.pointerId) this.cancel(); });
    canvas.addEventListener('keydown', event => {
      if (this.pick && (event.key === 'Enter' || event.key === ' ')) {
        // Keyboard placement is explicit, unlike a catalog click that silently adds.
        const rect = canvas.getBoundingClientRect(); event.preventDefault(); event.stopImmediatePropagation();
        this.place(rect.left + rect.width / 2, rect.top + rect.height * .65);
      }
    }, true);
    document.addEventListener('keydown', event => { if (event.key === 'Escape' && this.pick) { event.preventDefault(); this.cancel(); } });
    canvas.addEventListener('contextmenu', event => { if (this.pick) { event.preventDefault(); this.cancel(); } });
    window.addEventListener('blur', () => this.cancel());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.cancel(); });
  }
  private indicate(): void {
    this.options.scene.canvas.classList.toggle('placing', Boolean(this.pick));
    this.hint.textContent = this.pick ? 'Release inside the glass to place. Escape cancels.' : 'Drag from here onto soil, stone or wood. Click, then choose a spot also works.';
    for (const button of document.querySelectorAll<HTMLButtonElement>('[data-plant], [data-decoration]')) button.setAttribute('aria-pressed', String(Boolean(this.pick && (button.dataset.plant ?? button.dataset.decoration) === this.pick.kind && button.dataset.woodPreset === this.pick.woodPreset && button.dataset.variant === this.pick.variant)));
  }
  private preview(x: number, y: number): void {
    const position = this.options.scene.placementAt(x, y, undefined, this.pick?.kind);
    this.options.scene.setPlacementPreview(this.pick && position ? { ...this.pick, position } : null);
    this.hint.textContent = position ? this.pick && isFloatingDecoration(this.pick.kind) ? 'Release to float here. No support needed.' : position.support ? 'Release to attach. It will follow this support.' : 'Release to place on the landscape.' : 'Move inside the glass. Releasing outside cancels.';
  }
  private place(x: number, y: number): void {
    const pick = this.pick, position = this.options.scene.placementAt(x, y, undefined, pick?.kind); this.cancel();
    if (pick && position) this.options.add(pick, position);
  }
  cancel(): void {
    const drag = this.drag; this.drag = null; this.pick = null;
    const pointer = this.placementPointer; this.placementPointer = null;
    if (pointer !== null && this.options.scene.canvas.hasPointerCapture(pointer)) this.options.scene.canvas.releasePointerCapture(pointer);
    if (drag?.button.hasPointerCapture(drag.id)) drag.button.releasePointerCapture(drag.id);
    this.options.scene.setPlacementPreview(null); this.indicate();
  }
}
