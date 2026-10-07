import assert from 'node:assert/strict';
import test from 'node:test';
import { DECORATION_GROUPS, isFloatingDecoration, PLANT_GROUPS } from '../shared/catalog';
import { installCatalogGroups } from './catalog-groups';

/** Minimal authored-DOM fixture: no browser or persisted product state. */
class ElementFixture {
  id = ''; type = ''; className = ''; textContent = ''; hidden = false;
  dataset: Record<string, string> = {};
  attributes = new Map<string, string>();
  children: ElementFixture[] = [];
  constructor(readonly tagName: string) {}
  get childElementCount(): number { return this.children.length; }
  setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
  append(...nodes: ElementFixture[]): void { this.children.push(...nodes); }
}

function all(node: ElementFixture): ElementFixture[] { return [node, ...node.children.flatMap(all)]; }
function fixture(run: (containers: Record<string, ElementFixture>) => void): void {
  const containers = { 'plant-groups': new ElementFixture('div'), 'decoration-groups': new ElementFixture('div') };
  for (const [id, container] of Object.entries(containers)) container.id = id;
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    getElementById: (id: string) => Object.values(containers).flatMap(all).find(node => node.id === id) ?? null,
    createElement: (tag: string) => new ElementFixture(tag),
  } });
  try { installCatalogGroups(); run(containers); }
  finally { if (previous) Object.defineProperty(globalThis, 'document', previous); else Reflect.deleteProperty(globalThis, 'document'); }
}

test('eight category tiles reuse representative art and retain full accessible labels', () => fixture(containers => {
  const expectedLabels = ['Moss', 'Greenery', 'Mushrooms', 'Companions', 'Buildings', 'Lights', 'Steps', 'Statue & sky'];
  const tiles = Object.values(containers).flatMap(container => container.children[0].children);
  assert.equal(tiles.length, 8);
  assert.deepEqual(tiles.map(tile => tile.children[1].textContent), expectedLabels);
  const groups = [...PLANT_GROUPS, ...DECORATION_GROUPS];
  for (const [index, tile] of tiles.entries()) {
    const group = groups[index];
    assert.equal(tile.tagName, 'button'); assert.equal(tile.type, 'button');
    assert.equal(tile.id, `${group.id}-choices-toggle`);
    assert.equal(tile.attributes.get('aria-controls'), `${group.id}-choices`);
    assert.equal(tile.attributes.get('aria-expanded'), 'false');
    assert.equal(tile.attributes.get('aria-label'), `${group.label}, ${group.items.length} styles`);
    const icon = tile.children[0];
    assert.equal(icon.tagName, 'canvas'); assert.equal(icon.attributes.get('aria-hidden'), 'true');
    assert.equal(icon.dataset.categoryPreview, index < PLANT_GROUPS.length ? 'plant' : 'decoration');
    assert.equal(icon.dataset.categoryKind, group.items[0].id);
    assert.equal(tile.children[2].className, 'wood-disclosure');
    assert.equal(tile.children[2].attributes.get('aria-hidden'), 'true');
    // Disclosures must never match the placement picker's [data-plant]/[data-decoration].
    assert.equal(tile.dataset.plant, undefined); assert.equal(tile.dataset.decoration, undefined);
  }
}));

test('category grids precede full-width collapsed panels with unchanged item order and placement payloads', () => fixture(containers => {
  for (const [id, groups, type] of [['plant-groups', PLANT_GROUPS, 'plant'], ['decoration-groups', DECORATION_GROUPS, 'decoration']] as const) {
    const container = containers[id], grid = container.children[0];
    assert.equal(grid.className, 'decoration-options catalog-category-options');
    assert.equal(grid.children.length, groups.length);
    assert.equal(container.children.length, groups.length + 1);
    for (const [index, group] of groups.entries()) {
      const panel = container.children[index + 1];
      assert.equal(panel.id, `${group.id}-choices`); assert.equal(panel.hidden, true);
      assert.equal(panel.attributes.get('role'), 'group'); assert.equal(panel.attributes.get('aria-label'), group.label);
      assert.equal(panel.className, type === 'plant' ? 'plant-catalog catalog-group-choices' : 'wood-preset-grid catalog-group-choices');
      assert.deepEqual(panel.children.map(item => item.dataset[type]), group.items.map(item => item.id));
      for (const [itemIndex, button] of panel.children.entries()) {
        const item = group.items[itemIndex];
        assert.equal(button.attributes.get('aria-pressed'), 'false'); assert.equal(button.type, 'button');
        assert.equal(button.children[0].dataset[type === 'plant' ? 'preview' : 'objectPreview'], item.id);
        assert.equal(button.children[1].textContent, item.label);
        const floating = type === 'decoration' && isFloatingDecoration(item.id);
        assert.equal(button.attributes.get('aria-label'), `${item.label}. ${floating ? 'Floats freely inside the glass.' : 'Drag into the glass, or click then place.'}`);
        assert.equal(button.children.length, floating ? 3 : 2);
        if (floating) assert.equal(button.children[2].textContent, 'Free floating');
      }
    }
  }
}));

test('installing catalog groups twice preserves original nodes without duplicate items or icons', () => fixture(containers => {
  const before = Object.values(containers).flatMap(all);
  installCatalogGroups();
  const after = Object.values(containers).flatMap(all);
  assert.equal(after.length, before.length);
  assert.ok(after.every((node, index) => node === before[index]));
}));
