import { isFloatingDecoration, MAX_SUPPORT_DEPTH } from '../shared/catalog';
import type { Decoration, Plant, SupportAttachment, TerrariumState } from '../shared/types';

type Item = Plant | Decoration;

/** Called only after strict plain-data validation has produced owned item copies. */
export function assertSupportGraph(plants: readonly Plant[], decorations: readonly Decoration[]): void {
  const parents = new Map(decorations.map(item => [item.id, item]));
  for (const object of decorations) if (isFloatingDecoration(object.kind) && object.support) {
    throw new TypeError('Invalid support: floating ornaments cannot attach to a surface');
  }
  for (const item of [...decorations, ...plants]) {
    const seen = new Set([item.id]);
    let support = item.support;
    for (let depth = 1; support; depth++) {
      if (depth > MAX_SUPPORT_DEPTH) throw new TypeError('Invalid support: maximum attachment depth exceeded');
      if (seen.has(support.parentId)) throw new TypeError('Invalid support: cyclic attachment');
      const parent = parents.get(support.parentId);
      if (!parent) throw new TypeError('Invalid support: parent must be an existing decoration');
      if (isFloatingDecoration(parent.kind)) throw new TypeError('Invalid support: floating ornaments cannot support plants or objects');
      seen.add(parent.id); support = parent.support;
    }
  }
}

function descendants(state: TerrariumState, parent: Item): Item[] {
  const items = [...state.decorations, ...state.plants], result = [parent];
  const included = new Set([parent.id]);
  for (let index = 0; index < result.length; index++) {
    for (const item of items) if (!included.has(item.id) && item.support?.parentId === result[index].id) {
      included.add(item.id); result.push(item);
    }
  }
  return result;
}

/** Update an owned state copy. A common bounded translation keeps fallbacks in
 * range without distorting a descendant's relative displacement at the edge. */
export function moveSupportedItem(state: TerrariumState, item: Item, x: number, y: number, support?: SupportAttachment | null): void {
  if (support === null) delete item.support;
  else if (support !== undefined) item.support = { ...support };
  assertSupportGraph(state.plants, state.decorations);
  const group = descendants(state, item);
  const dx = Math.max(-Math.min(...group.map(child => child.x)), Math.min(1 - Math.max(...group.map(child => child.x)), x - item.x));
  const dy = Math.max(-Math.min(...group.map(child => child.y)), Math.min(1 - Math.max(...group.map(child => child.y)), y - item.y));
  for (const child of group) {
    child.x = Math.max(0, Math.min(1, child.x + dx));
    child.y = Math.max(0, Math.min(1, child.y + dy));
  }
}

/** Immediate children land on their saved ground fallback; grandchildren stay
 * attached to surviving supports. No dangling reference remains. */
export function detachSupportedChildren(state: TerrariumState, removedId: string): void {
  for (const item of [...state.decorations, ...state.plants]) if (item.support?.parentId === removedId) delete item.support;
}
