import type { BottleShape, DecorationKind, GlassBand, GlassForm, GlassSide, MaterialKind, PlantKind, WoodForm, WoodPresetKind } from './types';

export const TERRAIN_COLUMNS = 48;
export const TERRAIN_MAX_HEIGHT = 112;
export const TERRAIN_GRAIN_HEIGHT = 5;
export const MATERIAL_KINDS: readonly MaterialKind[] = ['soil', 'clay', 'gravel', 'coir', 'bark', 'charcoal'];
export const BOTTLE_SHAPES: readonly BottleShape[] = ['round', 'square', 'cylinder', 'open-cylinder', 'open-cube', 'glass-box', 'cat'];
export const DEFAULT_GLASS_FORM: Readonly<GlassForm> = Object.freeze({ lower: .82, middle: 1, upper: .72, facets: 8 });
export const GLASS_BANDS: readonly GlassBand[] = ['lower', 'middle', 'upper'];
export const GLASS_HEIGHT_LIMITS: Record<GlassBand, readonly [number, number]> = {
  lower: [.12, .36], middle: [.4, .7], upper: [.76, 1.08],
};
export const GLASS_WIDTH_LIMITS = [.4, 1.35] as const;
export const GLASS_FACETS = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16] as const;
export const MAX_SUPPORT_DEPTH = 6;
export const ENTITY_SCALE_LIMITS = [.4, 2] as const;
export const WOOD_LENGTH_LIMITS = [.5, 2] as const;
export const WOOD_ANGLE_LIMITS = [-160, 160] as const;
export const WOOD_MAX_BRANCHES = 3;
export const WOOD_BEND_LIMITS = [-.35, .35] as const;
export const OBJECT_ANGLE_LIMITS = [-180, 180] as const;
export const STONE_VARIANTS = Object.freeze([
  Object.freeze({ id: 'boulder', label: 'Round boulder' }), Object.freeze({ id: 'flat', label: 'Flat ledge' }),
  Object.freeze({ id: 'spire', label: 'Standing stone' }), Object.freeze({ id: 'pebbles', label: 'River pebbles' }),
] as const);
export const STUMP_VARIANTS = Object.freeze([
  Object.freeze({ id: 'upright', label: 'Woodland stump' }), Object.freeze({ id: 'fallen', label: 'Fallen log' }),
] as const);
/** Catalog groups are presentation only; saved kinds remain stable across editions. */
export const PLANT_GROUPS = [
  { id: 'moss', label: 'Moss', items: [
    { id: 'cushion-moss', label: 'Cushion moss' }, { id: 'sheet-moss', label: 'Sheet moss' },
    { id: 'star-moss', label: 'Star moss' }, { id: 'fern-moss', label: 'Feather moss' },
  ] },
  { id: 'greenery', label: 'Greenery', items: [
    { id: 'fern', label: 'Miniature fern' }, { id: 'fittonia', label: 'Fittonia' },
    { id: 'creeping-fig', label: 'Creeping fig' }, { id: 'oxalis', label: 'Woodland oxalis' },
  ] },
  { id: 'mushrooms', label: 'Mushrooms', items: [
    { id: 'amber-mushroom', label: 'Amber caps' }, { id: 'ivory-mushroom', label: 'Ivory bells' },
    { id: 'scarlet-mushroom', label: 'Scarlet bonnets' }, { id: 'violet-mushroom', label: 'Violet cups' },
  ] },
] as const satisfies readonly { id: string; label: string; items: readonly { id: PlantKind; label: string }[] }[];
export const DECORATION_GROUPS = [
  { id: 'companions', label: 'Little companions', items: [
    { id: 'traveler', label: 'Little traveler' }, { id: 'fairy', label: 'Woodland fairy' },
    { id: 'gardener', label: 'Little gardener' }, { id: 'reader', label: 'Forest reader' },
    { id: 'cat', label: 'Sleepy cat' }, { id: 'dog', label: 'Friendly pup' },
  ] },
  { id: 'buildings', label: 'Houses & pavilion', items: [
    { id: 'pavilion', label: 'Stone pavilion' }, { id: 'cottage', label: 'Forest cottage' },
    { id: 'mushroom-house', label: 'Mushroom cottage' }, { id: 'treehouse', label: 'Woodland cabin' },
  ] },
  { id: 'lights', label: 'Garden lights', items: [
    { id: 'lantern', label: 'Garden lantern' }, { id: 'arc-lamp', label: 'Arc lamp' },
  ] },
  { id: 'stairs', label: 'Stone steps', items: [
    { id: 'steps', label: 'Garden steps' }, { id: 'slender-steps', label: 'Slender stairway' },
  ] },
  { id: 'wonders', label: 'Statue & sky', items: [
    { id: 'statue', label: 'Quiet guardian' }, { id: 'sun', label: 'Little sun' },
    { id: 'moon', label: 'Crescent moon' }, { id: 'star', label: 'Wishing star' },
  ] },
] as const satisfies readonly { id: string; label: string; items: readonly { id: DecorationKind; label: string }[] }[];
for (const group of [...PLANT_GROUPS, ...DECORATION_GROUPS]) {
  for (const item of group.items) Object.freeze(item);
  Object.freeze(group.items); Object.freeze(group);
}
Object.freeze(PLANT_GROUPS); Object.freeze(DECORATION_GROUPS);
export const PLANT_ITEMS = Object.freeze(PLANT_GROUPS.flatMap(group => [...group.items]));
export const DECORATION_ITEMS = Object.freeze(DECORATION_GROUPS.flatMap(group => [...group.items]));
export function isMossKind(kind: string): boolean { return PLANT_GROUPS[0].items.some(item => item.id === kind); }
export function isMushroomKind(kind: string): boolean { return PLANT_GROUPS[2].items.some(item => item.id === kind); }
export function isFloatingDecoration(kind: string): boolean { return kind === 'fairy' || kind === 'sun' || kind === 'moon' || kind === 'star'; }
export const WOOD_BRANCH_AT_LIMITS = [.2, .85] as const;
export const WOOD_BRANCH_LENGTH_LIMITS = [.2, .8] as const;
export const WOOD_BRANCH_ANGLE_LIMITS = [-80, 80] as const;
export const DEFAULT_WOOD_FORM: Readonly<WoodForm> = Object.freeze({
  length: 1, angle: 0, branches: [
    { at: .3, length: .4, angle: -65 },
    { at: .65, length: .35, angle: 60 },
  ],
});
/** A palette choice resolves once to the existing saved WoodForm contract. */
export const WOOD_PRESETS = [
  { id: 'single', label: 'Curved twig', form: { length: 1.35, angle: -12, bend: -.24, branches: [] } },
  { id: 'fork', label: 'Forked branch', form: { length: 1.1, angle: -65, bend: .10, branches: [
    { at: .46, length: .72, angle: 68 },
  ] } },
  { id: 'double-fork', label: 'Silver birch', form: { length: 1.6, angle: -16, bend: 0, tone: 'birch', branches: [
    { at: .28, length: .25, angle: -58 }, { at: .72, length: .34, angle: 65 },
  ] } },
  { id: 'branched', label: 'Weathered cedar', form: { length: 1.18, angle: -84, bend: -.04, tone: 'charred', branches: [
    { at: .22, length: .50, angle: -75 }, { at: .56, length: .32, angle: 62 }, { at: .82, length: .22, angle: -44 },
  ] } },
] as const;
for (const preset of WOOD_PRESETS) {
  for (const branch of preset.form.branches) Object.freeze(branch);
  Object.freeze(preset.form.branches); Object.freeze(preset.form); Object.freeze(preset);
}
Object.freeze(WOOD_PRESETS);
export const WOOD_PRESET_KINDS: readonly WoodPresetKind[] = Object.freeze(WOOD_PRESETS.map(preset => preset.id));
export function woodPresetForm(id: WoodPresetKind): WoodForm {
  const preset = WOOD_PRESETS.find(value => value.id === id);
  if (!preset) throw new TypeError('Unknown driftwood preset');
  return { ...preset.form, branches: preset.form.branches.map(branch => ({ ...branch })) };
}
export function defaultGlassSide(form: GlassForm = DEFAULT_GLASS_FORM): GlassSide {
  return { lower: { width: form.lower, height: 112 / 510 }, middle: { width: form.middle, height: 285 / 510 }, upper: { width: form.upper, height: 1 } };
}
export function hasLid(shape: BottleShape): boolean { return shape !== 'open-cylinder' && shape !== 'open-cube'; }
export const MATERIAL_NAMES: Record<MaterialKind, string> = {
  soil: 'Forest soil', clay: 'Clay pebbles', gravel: 'Gravel', coir: 'Coco coir', bark: 'Bark', charcoal: 'Charcoal',
};
export const BOTTLE_NAMES: Record<BottleShape, string> = {
  round: 'Round flask', square: 'Shoulder flask', cylinder: 'Tall jar',
  'open-cylinder': 'Open cylinder', 'open-cube': 'Open cube', 'glass-box': 'Sculpted glass', cat: 'Cat-ear jar',
};
