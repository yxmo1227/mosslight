import { DEFAULT_WOOD_FORM, isFloatingDecoration, WOOD_MAX_BRANCHES } from '../shared/catalog';
import type { Decoration, Plant, TerrariumAction, TerrariumState, WoodForm } from '../shared/types';
import type { Selection } from './scene';

type EditAction = Extract<TerrariumAction, { type: 'resize-plant' | 'resize-decoration' | 'wood-form' | 'object-pose' }>;
export function editableWood(value?: WoodForm): WoodForm {
  const form = value ?? DEFAULT_WOOD_FORM;
  return { ...form, branches: form.branches.map(branch => ({ ...branch })) };
}
export function withBranchCount(value: WoodForm, count: number): WoodForm {
  const form = editableWood(value);
  count = Math.max(0, Math.min(WOOD_MAX_BRANCHES, Math.floor(count)));
  form.branches = Array.from({ length: count }, (_, index) => form.branches[index] ?? {
    at: .3 + index * .22, length: .4, angle: index % 2 === 0 ? -60 : 60,
  });
  return form;
}
/** Renderer-only preview: never mutates the authoritative snapshot or a sibling. */
export function previewEntityEdit(state: TerrariumState, action: EditAction): TerrariumState {
  if (action.type === 'resize-plant') return { ...state, plants: state.plants.map(item => item.id === action.id ? { ...item, scale: action.scale } : item) };
  return { ...state, decorations: state.decorations.map(item => {
    if (item.id !== action.id) return item;
    if (action.type === 'resize-decoration') return { ...item, scale: action.scale };
    if (item.kind !== 'wood') return item;
    return action.type === 'object-pose' ? { ...item, pose: { ...action.value } } : { ...item, wood: editableWood(action.value) };
  }) };
}
interface EditorOptions {
  state(): TerrariumState | undefined;
  selection(): Selection | null;
  commit(action: TerrariumAction): Promise<void>;
  render(): void;
  close(): void;
}
export class EntityEditor {
  private draft: EditAction | null = null;
  private pending: EditAction[] = [];
  private currentId: string | null = null;
  private readonly panel: HTMLElement;
  constructor(private readonly options: EditorOptions) {
    this.panel = document.getElementById('entity-editor')!;
    for (const input of this.panel.querySelectorAll<HTMLInputElement>('input[type=range]')) {
      let pointer: number | null = null;
      input.addEventListener('pointerdown', event => { if (event.button === 0) pointer = event.pointerId; });
      input.addEventListener('pointerup', event => { if (pointer === event.pointerId) pointer = null; });
      input.addEventListener('pointercancel', () => { pointer = null; this.finish(false); });
      input.addEventListener('lostpointercapture', event => { if (pointer === event.pointerId) { pointer = null; this.finish(false); } });
      input.addEventListener('input', () => this.edit(input));
      input.addEventListener('change', () => this.finish(true));
      input.addEventListener('blur', () => this.finish(false));
      input.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); this.finish(false); } });
    }
    document.getElementById('wood-rotate-left')!.addEventListener('click', () => this.pose('left'));
    document.getElementById('wood-rotate-right')!.addEventListener('click', () => this.pose('right'));
    document.getElementById('wood-flip')!.addEventListener('click', () => this.pose('flip'));
    document.getElementById('close-entity-editor')!.addEventListener('click', () => { this.finish(false); options.close(); });
    window.addEventListener('blur', () => this.finish(false));
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.finish(false); });
  }
  private input(id: string): HTMLInputElement | HTMLSelectElement { return document.getElementById(id) as HTMLInputElement | HTMLSelectElement; }
  visibleState(state: TerrariumState): TerrariumState {
    for (const action of this.pending) state = previewEntityEdit(state, action);
    return this.draft ? previewEntityEdit(state, this.draft) : state;
  }
  private entity(): Plant | Decoration | undefined {
    const state = this.options.state(), selection = this.options.selection(); if (!state || !selection) return undefined;
    const visible = this.visibleState(state);
    return (selection.type === 'plant' ? visible.plants : visible.decorations).find(item => item.id === selection.id);
  }
  sync(): void {
    const selection = this.options.selection();
    if (selection?.id !== this.currentId) { this.draft = null; this.currentId = selection?.id ?? null; }
    const item = this.entity(); this.panel.hidden = !item; if (!item) return;
    const value = (id: string, amount: number, label: string): void => { this.input(id).value = String(amount); document.getElementById(`${id}-value`)!.textContent = label; };
    value('entity-scale', item.scale, `${Math.round(item.scale * 100)}%`);
    document.getElementById('entity-support')!.textContent = isFloatingDecoration(item.kind) ? 'Free floating · drag anywhere inside the glass' : item.support ? 'Attached · follows its support' : 'Grounded · drag to arrange';
    const wood = selection?.type === 'decoration' && item.kind === 'wood';
    document.getElementById('wood-pose-controls')!.hidden = !wood;
    if (wood) {
      const pose = (item as Decoration).pose ?? { angle: 0, flipX: false };
      document.getElementById('wood-flip')!.setAttribute('aria-pressed', String(pose.flipX));
      document.getElementById('wood-pose-value')!.textContent = `${Math.round(pose.angle)}°${pose.flipX ? ' · Flipped' : ''}`;
    }
    document.getElementById('entity-size-hint')!.textContent = wood ? 'Resize, rotate or flip. Attached plants follow along.' : 'Drag to arrange. Use Size to make this object smaller or larger.';
  }
  private edit(input: HTMLInputElement): void {
    const item = this.entity(), selection = this.options.selection(); if (!item || !selection || input.id !== 'entity-scale') return;
    const amount = Number(input.value);
    // Selecting/resizing old or custom wood never replaces its saved structure.
    this.draft = { type: selection.type === 'plant' ? 'resize-plant' : 'resize-decoration', id: item.id, scale: amount };
    this.sync(); this.options.render();
  }
  finish(commit: boolean): void {
    const action = this.draft; this.draft = null; if (!action) return;
    if (commit) this.commit(action);
    this.sync(); this.options.render();
  }
  private pose(change: 'left' | 'right' | 'flip'): void {
    this.finish(false);
    const item = this.entity(), selection = this.options.selection();
    if (!item || selection?.type !== 'decoration' || item.kind !== 'wood') return;
    const current = (item as Decoration).pose ?? { angle: 0, flipX: false };
    const value = change === 'flip' ? { ...current, flipX: !current.flipX } : { ...current, angle: ((current.angle + (change === 'left' ? -15 : 15) + 180) % 360 + 360) % 360 - 180 };
    this.commit({ type: 'object-pose', id: item.id, value });
    this.sync(); this.options.render();
  }
  private commit(action: EditAction): void {
    this.pending.push(action);
    void this.options.commit(action).finally(() => { this.pending = this.pending.filter(item => item !== action); this.sync(); this.options.render(); });
  }
}
