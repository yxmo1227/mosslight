import { DECORATION_GROUPS, isFloatingDecoration, PLANT_GROUPS } from '../shared/catalog';

const categoryLabels: Readonly<Record<string, string>> = {
  companions: 'Companions', buildings: 'Buildings', lights: 'Lights', stairs: 'Steps', wonders: 'Statue & sky',
};

/** Authored metadata only. No HTML strings or imported save labels enter the DOM. */
export function installCatalogGroups(): void {
  for (const [containerId, groups, type] of [['plant-groups', PLANT_GROUPS, 'plant'], ['decoration-groups', DECORATION_GROUPS, 'decoration']] as const) {
    const container = document.getElementById(containerId);
    if (!container || container.childElementCount) continue;
    // Match Found objects: compact category tiles first, full-width styles below.
    const categories = document.createElement('div'); categories.className = 'decoration-options catalog-category-options';
    container.append(categories);
    for (const group of groups) {
      const toggle = document.createElement('button'); toggle.type = 'button'; toggle.className = 'catalog-disclosure catalog-group-toggle';
      toggle.id = `${group.id}-choices-toggle`; toggle.setAttribute('aria-expanded', 'false'); toggle.setAttribute('aria-controls', `${group.id}-choices`);
      toggle.setAttribute('aria-label', `${group.label}, ${group.items.length} styles`);
      const icon = document.createElement('canvas'); icon.dataset.categoryPreview = type; icon.dataset.categoryKind = group.items[0].id; icon.setAttribute('aria-hidden', 'true');
      const title = document.createElement('span'); title.className = 'catalog-category-label'; title.textContent = categoryLabels[group.id] ?? group.label;
      const arrow = document.createElement('span'); arrow.className = 'wood-disclosure'; arrow.textContent = '⌄'; arrow.setAttribute('aria-hidden', 'true');
      toggle.append(icon, title, arrow); categories.append(toggle);
      const choices = document.createElement('div'); choices.id = `${group.id}-choices`; choices.hidden = true;
      choices.className = type === 'plant' ? 'plant-catalog catalog-group-choices' : 'wood-preset-grid catalog-group-choices'; choices.setAttribute('role', 'group'); choices.setAttribute('aria-label', group.label);
      for (const item of group.items) {
        const button = document.createElement('button'); button.type = 'button'; button.dataset[type] = item.id;
        button.className = type === 'plant' ? 'catalog-card' : 'catalog-object-card'; button.setAttribute('aria-pressed', 'false');
        const floating = type === 'decoration' && isFloatingDecoration(item.id);
        button.setAttribute('aria-label', `${item.label}. ${floating ? 'Floats freely inside the glass.' : 'Drag into the glass, or click then place.'}`);
        const canvas = document.createElement('canvas'); canvas.dataset[type === 'plant' ? 'preview' : 'objectPreview'] = item.id; canvas.setAttribute('aria-hidden', 'true');
        const name = document.createElement('span'); name.className = 'catalog-name'; name.textContent = item.label;
        button.append(canvas, name);
        if (floating) { const badge = document.createElement('span'); badge.className = 'catalog-float'; badge.textContent = 'Free floating'; button.append(badge); }
        choices.append(button);
      }
      container.append(choices);
    }
  }
}
