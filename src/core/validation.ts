import type {
  Decoration, DecorationKind, DecorationVariant, GlassForm, GlassSide, MaterialKind, ObjectCondition, ObjectPose, Plant, PlantEcology, Pond, SupportAttachment, SurfaceColonization, Terrain, TerrariumAction, TerrariumState, WoodForm,
} from '../shared/types';
import {
  BOTTLE_SHAPES, ENTITY_SCALE_LIMITS, GLASS_BANDS, GLASS_FACETS, GLASS_HEIGHT_LIMITS, GLASS_WIDTH_LIMITS, hasLid, MATERIAL_KINDS, TERRAIN_COLUMNS, TERRAIN_GRAIN_HEIGHT, TERRAIN_MAX_HEIGHT,
  WOOD_ANGLE_LIMITS, WOOD_BRANCH_ANGLE_LIMITS, WOOD_BRANCH_AT_LIMITS, WOOD_BRANCH_LENGTH_LIMITS, WOOD_LENGTH_LIMITS, WOOD_MAX_BRANCHES, WOOD_PRESET_KINDS, WOOD_BEND_LIMITS, OBJECT_ANGLE_LIMITS, STONE_VARIANTS, STUMP_VARIANTS, DECORATION_ITEMS, PLANT_ITEMS, isFloatingDecoration,
} from '../shared/catalog';
import { assertSupportGraph } from './support';

export const MAX_PLANTS = 24;
export const MAX_DECORATIONS = 20;
export const MIN_HEALTH = 0.12;
export const MAX_SIMULATED_DAYS = 1_000_000_000;
export const MAX_TIMESTAMP = 8_640_000_000_000_000;

const LEGACY_BOTTLES = ['round', 'square', 'cylinder'] as const;
const LEGACY_MATERIALS = ['gravel', 'clay', 'soil'] as const;
// Capacity may grow, but importing the same version-1 layer proportions must
// always reproduce the original 40-grain migration, without adding material.
const LEGACY_TERRAIN_MAX_HEIGHT = 40;
const LEGACY_PLANTS = ['cushion-moss', 'sheet-moss', 'fern', 'fittonia'] as const;
const LEGACY_DECORATIONS = ['stone', 'wood'] as const;
const PLANTS = PLANT_ITEMS.map(item => item.id);
// Hidden palette entries are still valid saved data and API actions. Never tie
// legacy compatibility to whether the workshop currently advertises an item.
const DECORATIONS = [...LEGACY_DECORATIONS, 'stump', 'path', ...DECORATION_ITEMS.map(item => item.id)] as const;
const SPEEDS = [1, 2, 5, 10] as const;
const WIDGET_SIZES = ['small', 'medium', 'large'] as const;
const PREFERENCE_KEYS = ['widgetSize', 'alwaysOnTop', 'launchAtLogin', 'reducedMotion'] as const;

type DataRecord = Record<string, unknown>;
type LegacyLayer = { material: typeof LEGACY_MATERIALS[number]; depth: number };
type CommonState = Omit<TerrariumState, 'schemaVersion' | 'bottle' | 'terrain' | 'care' | 'glassForm' | 'pond'>;
type LegacyState = CommonState & {
  schemaVersion: 1; bottle: typeof LEGACY_BOTTLES[number]; layers: LegacyLayer[];
};
const COMMON_STATE_KEYS = [
  'schemaVersion', 'name', 'bottle', 'plants', 'decorations', 'environment', 'ecology',
  'closed', 'speed', 'paused', 'vacation', 'createdAt', 'updatedAt', 'preferences',
] as const;

function invalid(label: string, reason: string): never {
  throw new TypeError(`Invalid ${label}: ${reason}`);
}

// Do not invoke accessors or accept inherited properties on an imported value.
function record(input: unknown, label: string): DataRecord {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    invalid(label, 'expected a plain object');
  }
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) {
    invalid(label, 'custom prototypes are not supported');
  }
  const result: DataRecord = Object.create(null) as DataRecord;
  for (const key of Reflect.ownKeys(input)) {
    if (typeof key !== 'string') invalid(label, 'symbol properties are not supported');
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) {
      invalid(label, 'expected enumerable data properties');
    }
    result[key] = descriptor.value;
  }
  return result;
}

function keys(value: DataRecord, allowed: readonly string[], label: string, optional = false): void {
  const actual = Object.keys(value);
  if (actual.some((key) => !allowed.includes(key))) invalid(label, 'unexpected property');
  if (!optional && allowed.some((key) => !Object.hasOwn(value, key))) {
    invalid(label, 'missing property');
  }
}

function object(input: unknown, allowed: readonly string[], label: string): DataRecord {
  const result = record(input, label);
  keys(result, allowed, label);
  return result;
}

function extendedObject(input: unknown, required: readonly string[], optional: readonly string[], label: string): DataRecord {
  const value = record(input, label);
  keys(value, [...required, ...optional], label, true);
  if (required.some(key => !Object.hasOwn(value, key))) invalid(label, 'missing property');
  return value;
}

function array(input: unknown, maximum: number, label: string): unknown[] {
  if (!Array.isArray(input) || Object.getPrototypeOf(input) !== Array.prototype) {
    invalid(label, 'expected an ordinary array');
  }
  if (input.length > maximum) invalid(label, `maximum length is ${maximum}`);
  const ownKeys = Reflect.ownKeys(input);
  if (ownKeys.length !== input.length + 1) invalid(label, 'sparse arrays or extra properties');
  const result: unknown[] = [];
  for (let index = 0; index < input.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(input, String(index));
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) {
      invalid(label, 'expected dense data entries');
    }
    result.push(descriptor.value);
  }
  return result;
}

function number(input: unknown, min: number, max: number, label: string): number {
  if (typeof input !== 'number' || !Number.isFinite(input) || input < min || input > max) {
    invalid(label, `expected a finite number in ${min}..${max}`);
  }
  return input;
}

function boolean(input: unknown, label: string): boolean {
  if (typeof input !== 'boolean') invalid(label, 'expected a boolean');
  return input;
}

function member<T extends string | number>(input: unknown, allowed: readonly T[], label: string): T {
  if (!allowed.includes(input as T)) invalid(label, 'unsupported value');
  return input as T;
}

function name(input: unknown): string {
  if (typeof input !== 'string' || input.length > 80 || input.trim().length === 0
    || /[\u0000-\u001f\u007f-\u009f]/u.test(input)) {
    invalid('name', 'expected 1..80 characters without control characters');
  }
  return input.trim();
}

function id(input: unknown, label: string): string {
  if (typeof input !== 'string' || input.length < 1 || input.length > 80
    || !/^[A-Za-z0-9_-]+$/u.test(input)) {
    invalid(label, 'expected an identifier of 1..80 letters, digits, dashes or underscores');
  }
  return input;
}

export function validateTimestamp(input: unknown, label = 'timestamp'): number {
  const value = number(input, 0, MAX_TIMESTAMP, label);
  if (!Number.isSafeInteger(value)) invalid(label, 'expected a safe integer');
  return value;
}

function preferences(input: unknown, partial: boolean): Partial<TerrariumState['preferences']> {
  const value = record(input, 'preferences');
  keys(value, PREFERENCE_KEYS, 'preferences', partial);
  const result: Partial<TerrariumState['preferences']> = {};
  if (Object.hasOwn(value, 'widgetSize')) result.widgetSize = member(value.widgetSize, WIDGET_SIZES, 'widget size');
  if (Object.hasOwn(value, 'alwaysOnTop')) result.alwaysOnTop = boolean(value.alwaysOnTop, 'always on top');
  if (Object.hasOwn(value, 'launchAtLogin')) result.launchAtLogin = boolean(value.launchAtLogin, 'launch at login');
  if (Object.hasOwn(value, 'reducedMotion')) result.reducedMotion = boolean(value.reducedMotion, 'reduced motion');
  return result;
}

function plant(input: unknown, index: number, legacy = false): Plant {
  const label = `plant ${index}`;
  const value = extendedObject(input, [
    'id', 'kind', 'x', 'y', 'scale', 'growth', 'health', 'ageDays', ...(legacy ? [] : ['wetness']),
  ], legacy ? [] : ['support', 'ecology'], label);
  return {
    id: id(value.id, `${label} id`),
    kind: member(value.kind, legacy ? LEGACY_PLANTS : PLANTS, `${label} kind`),
    x: number(value.x, 0, 1, `${label} x`),
    y: number(value.y, 0, 1, `${label} y`),
    scale: number(value.scale, ENTITY_SCALE_LIMITS[0], ENTITY_SCALE_LIMITS[1], `${label} scale`),
    growth: number(value.growth, 0, 1, `${label} growth`),
    health: number(value.health, MIN_HEALTH, 1, `${label} health`),
    ageDays: number(value.ageDays, 0, MAX_SIMULATED_DAYS, `${label} age`),
    wetness: legacy ? 0 : number(value.wetness, 0, 1, `${label} wetness`),
    ...(Object.hasOwn(value, 'support') ? { support: supportAttachment(value.support) } : {}),
    ...(Object.hasOwn(value, 'ecology') ? { ecology: plantEcology(value.ecology) } : {}),
  };
}

function decoration(input: unknown, index: number, legacy = false): Decoration {
  const label = `decoration ${index}`;
  const value = extendedObject(input, ['id', 'kind', 'x', 'y', 'scale'], legacy ? [] : ['support', 'wood', 'condition', 'variant', 'pose', 'colonization'], label);
  const kind = member(value.kind, legacy ? LEGACY_DECORATIONS : DECORATIONS, `${label} kind`);
  if (isFloatingDecoration(kind) && ['support', 'condition', 'colonization'].some(key => Object.hasOwn(value, key))) {
    invalid(label, 'floating ornaments cannot have support, condition or moss colonization');
  }
  if (Object.hasOwn(value, 'wood') && kind !== 'wood') invalid(label, 'only driftwood supports an editable wood form');
  const condition = Object.hasOwn(value, 'condition') ? objectCondition(value.condition) : undefined;
  if (kind !== 'wood' && kind !== 'stump' && condition && condition.decay !== 0) invalid(label, kind === 'stone' ? 'stone cannot decay' : 'only wood and stumps can decay');
  if (kind !== 'wood' && kind !== 'stump' && condition && condition.mold !== undefined) invalid(label, 'only wood and stumps support mold');
  if (Object.hasOwn(value, 'pose') && kind !== 'wood') invalid(label, 'only driftwood supports orientation');
  return {
    id: id(value.id, `${label} id`),
    kind,
    x: number(value.x, 0, 1, `${label} x`),
    y: number(value.y, 0, 1, `${label} y`),
    scale: number(value.scale, ENTITY_SCALE_LIMITS[0], ENTITY_SCALE_LIMITS[1], `${label} scale`),
    ...(Object.hasOwn(value, 'support') ? { support: supportAttachment(value.support) } : {}),
    ...(Object.hasOwn(value, 'wood') ? { wood: validateWoodForm(value.wood) } : {}),
    ...(condition ? { condition } : {}),
    ...(Object.hasOwn(value, 'colonization') ? { colonization: surfaceColonization(value.colonization) } : {}),
    ...(Object.hasOwn(value, 'variant') ? { variant: decorationVariant(value.variant, kind) } : {}),
    ...(Object.hasOwn(value, 'pose') ? { pose: objectPose(value.pose) } : {}),
  };
}

/** Every branch is plain bounded data, not an executable or recursive model. */
export function validateWoodForm(input: unknown): WoodForm {
  const value = extendedObject(input, ['length', 'angle', 'branches'], ['bend', 'tone'], 'wood form');
  return {
    length: number(value.length, WOOD_LENGTH_LIMITS[0], WOOD_LENGTH_LIMITS[1], 'wood length'),
    angle: number(value.angle, WOOD_ANGLE_LIMITS[0], WOOD_ANGLE_LIMITS[1], 'wood angle'),
    ...(Object.hasOwn(value, 'bend') ? { bend: number(value.bend, WOOD_BEND_LIMITS[0], WOOD_BEND_LIMITS[1], 'wood bend') } : {}),
    ...(Object.hasOwn(value, 'tone') ? { tone: member(value.tone, ['natural', 'birch', 'charred'] as const, 'wood tone') } : {}),
    branches: array(value.branches, WOOD_MAX_BRANCHES, 'wood branches').map((inputBranch, index) => {
      const branch = object(inputBranch, ['at', 'length', 'angle'], `wood branch ${index}`);
      return {
        at: number(branch.at, WOOD_BRANCH_AT_LIMITS[0], WOOD_BRANCH_AT_LIMITS[1], 'branch position'),
        length: number(branch.length, WOOD_BRANCH_LENGTH_LIMITS[0], WOOD_BRANCH_LENGTH_LIMITS[1], 'branch length'),
        angle: number(branch.angle, WOOD_BRANCH_ANGLE_LIMITS[0], WOOD_BRANCH_ANGLE_LIMITS[1], 'branch angle'),
      };
    }),
  };
}

function decorationVariant(input: unknown, kind: DecorationKind): DecorationVariant {
  if (kind === 'stone') return member(input, STONE_VARIANTS.map(item => item.id), 'stone variant');
  if (kind === 'stump') return member(input, STUMP_VARIANTS.map(item => item.id), 'stump variant');
  return invalid('variant', 'only stone or stump accepts a variant');
}
function objectPose(input: unknown): ObjectPose {
  const value = object(input, ['angle', 'flipX'], 'object pose');
  return { angle: number(value.angle, OBJECT_ANGLE_LIMITS[0], OBJECT_ANGLE_LIMITS[1], 'object angle'), flipX: boolean(value.flipX, 'object flip') };
}
function objectCondition(input: unknown): ObjectCondition {
  const value = extendedObject(input, ['wetness', 'decay'], ['mold'], 'object condition');
  return { wetness: number(value.wetness, 0, 1, 'object wetness'), decay: number(value.decay, 0, 1, 'object decay'),
    ...(Object.hasOwn(value, 'mold') ? { mold: number(value.mold, 0, 1, 'object mold') } : {}) };
}

function plantEcology(input: unknown): PlantEcology {
  const value = extendedObject(input, ['drought', 'waterlogging', 'spread', 'cycle', 'generation'], ['parentId', 'offspring'], 'plant ecology');
  const generation = member(value.generation, [0, 1] as const, 'plant generation');
  if (generation === 1 && !Object.hasOwn(value, 'parentId')) invalid('plant ecology', 'generated plants require a parent id');
  if (generation === 0 && Object.hasOwn(value, 'parentId')) invalid('plant ecology', 'authored plants cannot have a parent id');
  const offspring = Object.hasOwn(value, 'offspring') ? number(value.offspring, 0, 2, 'plant offspring') : undefined;
  if (offspring !== undefined && (!Number.isInteger(offspring) || (generation === 1 && offspring !== 0))) invalid('plant offspring', 'expected a bounded authored generation counter');
  return {
    drought: number(value.drought, 0, 1, 'plant drought'), waterlogging: number(value.waterlogging, 0, 1, 'plant waterlogging'),
    spread: number(value.spread, 0, 1, 'plant spread'), cycle: number(value.cycle, 0, 1, 'plant cycle'), generation,
    ...(Object.hasOwn(value, 'parentId') ? { parentId: id(value.parentId, 'colony parent id') } : {}),
    ...(offspring !== undefined ? { offspring } : {}),
  };
}

function surfaceColonization(input: unknown): SurfaceColonization {
  const value = object(input, ['moss', 'health'], 'surface colonization');
  return { moss: number(value.moss, 0, 1, 'surface moss'), health: number(value.health, 0, 1, 'surface moss health') };
}

function commonState(value: DataRecord, legacy: boolean): CommonState {
  const plants = array(value.plants, MAX_PLANTS, 'plants').map((entry, index) => plant(entry, index, legacy));
  const decorations = array(value.decorations, MAX_DECORATIONS, 'decorations').map((entry, index) => decoration(entry, index, legacy));
  const identifiers = new Set<string>();
  for (const item of [...plants, ...decorations]) {
    if (identifiers.has(item.id)) invalid('identifiers', 'duplicate plant or decoration id');
    identifiers.add(item.id);
  }
  for (const item of plants) if (item.ecology?.generation === 1) {
    const parent = plants.find(candidate => candidate.id === item.ecology?.parentId);
    if (!parent || parent.id === item.id || parent.ecology?.generation === 1 || parent.kind !== item.kind) invalid('plant ecology', 'generated colony needs an existing authored parent of the same kind');
  }
  assertSupportGraph(plants, decorations);
  const environment = object(value.environment, ['temperature', 'light'], 'environment');
  const ecology = object(value.ecology, ['moisture', 'humidity', 'waterReserve', 'simulatedDays'], 'ecology');
  const createdAt = validateTimestamp(value.createdAt, 'created at');
  const updatedAt = validateTimestamp(value.updatedAt, 'updated at');
  if (updatedAt < createdAt) invalid('updated at', 'must not precede creation');
  return {
    name: name(value.name),
    plants, decorations,
    environment: {
      temperature: number(environment.temperature, 10, 35, 'temperature'),
      light: number(environment.light, 0, 1, 'light'),
    },
    ecology: {
      moisture: number(ecology.moisture, 0, 1, 'moisture'),
      humidity: number(ecology.humidity, 0, 1, 'humidity'),
      waterReserve: number(ecology.waterReserve, 0, 1, 'water reserve'),
      simulatedDays: number(ecology.simulatedDays, 0, MAX_SIMULATED_DAYS, 'simulated days'),
    },
    closed: boolean(value.closed, 'closed'),
    speed: member(value.speed, SPEEDS, 'speed'),
    paused: boolean(value.paused, 'paused'),
    vacation: boolean(value.vacation, 'vacation'),
    createdAt, updatedAt,
    preferences: preferences(value.preferences, false) as TerrariumState['preferences'],
  };
}

export function validateTerrain(input: unknown): Terrain {
  const value = object(input, ['columns'], 'terrain');
  const columns = array(value.columns, TERRAIN_COLUMNS, 'terrain columns');
  if (columns.length !== TERRAIN_COLUMNS) invalid('terrain columns', `exactly ${TERRAIN_COLUMNS} columns are required`);
  return {
    columns: columns.map((column, index) => array(column, TERRAIN_MAX_HEIGHT, `terrain column ${index}`)
      .map((material) => member(material, MATERIAL_KINDS, `terrain column ${index} material`))),
  };
}

function supportAttachment(input: unknown): SupportAttachment {
  const value = object(input, ['parentId', 'x'], 'support');
  return { parentId: id(value.parentId, 'support parent id'), x: number(value.x, 0, 1, 'support x') };
}

/** Keep bounded integer depths for basin geometry and a conserved sub-grain exchange. */
export function validatePond(input: unknown, terrain?: Terrain): Pond {
  const value = extendedObject(input, ['depths'], ['exchange'], 'pond');
  const entries = array(value.depths, TERRAIN_COLUMNS, 'pond depths');
  if (entries.length !== TERRAIN_COLUMNS) invalid('pond depths', `exactly ${TERRAIN_COLUMNS} columns are required`);
  const depths = entries.map((entry, index) => {
    const depth = number(entry, 0, TERRAIN_MAX_HEIGHT, `pond depth ${index}`);
    if (!Number.isInteger(depth)) invalid('pond depth', 'expected an integer');
    if (terrain && depth + terrain.columns[index].length > TERRAIN_MAX_HEIGHT) invalid('pond depth', 'water and soil exceed capacity');
    return depth;
  });
  const exchange = Object.hasOwn(value, 'exchange') ? number(value.exchange, 0, 1, 'pond exchange') : undefined;
  if (exchange !== undefined && exchange > depths.reduce((sum, depth) => sum + depth, 0)) invalid('pond exchange', 'cannot exceed pond inventory');
  return { depths, ...(exchange !== undefined ? { exchange } : {}) };
}

function glassSide(input: unknown, label: string): GlassSide {
  const value = object(input, GLASS_BANDS, label);
  const result = {} as GlassSide;
  for (const band of GLASS_BANDS) {
    const point = object(value[band], ['width', 'height'], `${label} ${band}`);
    result[band] = { width: number(point.width, ...GLASS_WIDTH_LIMITS, `${label} ${band} width`), height: number(point.height, ...GLASS_HEIGHT_LIMITS[band], `${label} ${band} height`) };
  }
  return result;
}

function glassForm(input: unknown): GlassForm {
  const value = extendedObject(input, ['lower', 'middle', 'upper', 'facets'], ['sides'], 'glass form');
  const sides = Object.hasOwn(value, 'sides') ? object(value.sides, ['left', 'right'], 'glass sides') : undefined;
  return {
    lower: number(value.lower, 0.55, 1.25, 'glass form lower'),
    middle: number(value.middle, 0.55, 1.25, 'glass form middle'),
    upper: number(value.upper, 0.55, 1.25, 'glass form upper'),
    facets: member(value.facets, GLASS_FACETS, 'glass form facets'),
    ...(sides ? { sides: { left: glassSide(sides.left, 'left glass'), right: glassSide(sides.right, 'right glass') } } : {}),
  };
}

/** Strictly validate schema-2 data and return an independently owned copy. */
export function validateState(input: unknown): TerrariumState {
  const value = record(input, 'terrarium state');
  const required = [...COMMON_STATE_KEYS, 'terrain', 'care'];
  keys(value, [...required, 'glassForm', 'pond'], 'terrarium state', true);
  if (required.some((key) => !Object.hasOwn(value, key))) invalid('terrarium state', 'missing property');
  if (value.schemaVersion !== 2) invalid('schema version', 'only version 2 is supported');
  const common = commonState(value, false);
  const bottle = member(value.bottle, BOTTLE_SHAPES, 'bottle');
  if (!hasLid(bottle) && common.closed) invalid('closed', 'this bottle has no lid');
  const care = object(value.care, ['sunlight'], 'care');
  const ground = validateTerrain(value.terrain);
  return {
    ...common, schemaVersion: 2, bottle, terrain: ground,
    care: { sunlight: number(care.sunlight, 0, 1, 'sunlight') },
    // Optional compatible extension: old schema-2 saves remain byte-shape
    // compatible, and undefined is not accepted as a substitute for absence.
    ...(Object.hasOwn(value, 'glassForm') ? { glassForm: glassForm(value.glassForm) } : {}),
    ...(Object.hasOwn(value, 'pond') ? { pond: validatePond(value.pond, ground) } : {}),
  };
}

// Version-1 imports must satisfy the complete old contract before conversion.
// A version-1 plant must not contain version-2 wetness, even if it would be valid.
function validateLegacyState(input: unknown): LegacyState {
  const value = object(input, [...COMMON_STATE_KEYS, 'layers'], 'legacy terrarium state');
  if (value.schemaVersion !== 1) invalid('schema version', 'expected version 1');
  const layers = array(value.layers, 3, 'layers').map((inputLayer, index): LegacyLayer => {
    const layer = object(inputLayer, ['material', 'depth'], `layer ${index}`);
    if (layer.material !== LEGACY_MATERIALS[index]) invalid('layers', 'expected gravel, clay, soil in order');
    return { material: LEGACY_MATERIALS[index], depth: number(layer.depth, 0, 1, `layer ${index} depth`) };
  });
  if (layers.length !== 3) invalid('layers', 'all three material layers are required');
  return {
    ...commonState(value, true), schemaVersion: 1,
    bottle: member(value.bottle, LEGACY_BOTTLES, 'legacy bottle'), layers,
  };
}

function migrateTerrain(layers: LegacyLayer[]): Terrain {
  const totalDepth = layers.reduce((sum, layer) => sum + layer.depth, 0);
  const totalGrains = Math.min(LEGACY_TERRAIN_MAX_HEIGHT,
    Math.round(Math.min(210, totalDepth * 95) / TERRAIN_GRAIN_HEIGHT));
  const allocation = layers.map((layer, index) => {
    const exact = totalDepth === 0 ? 0 : totalGrains * layer.depth / totalDepth;
    return { index, count: Math.floor(exact), remainder: exact - Math.floor(exact) };
  });
  let remaining = totalGrains - allocation.reduce((sum, layer) => sum + layer.count, 0);
  for (const layer of [...allocation].sort((left, right) => right.remainder - left.remainder || left.index - right.index)) {
    if (remaining <= 0) break;
    if (layers[layer.index].depth === 0) continue;
    layer.count += 1;
    remaining -= 1;
  }
  const column: MaterialKind[] = [];
  for (const layer of allocation) {
    for (let grain = 0; grain < layer.count; grain++) column.push(layers[layer.index].material);
  }
  return { columns: Array.from({ length: TERRAIN_COLUMNS }, () => [...column]) };
}

/** Strict v1-to-v2 migration, or strict validation and cloning of an existing v2 save. */
export function migrateSaveState(input: unknown): TerrariumState {
  const version = record(input, 'terrarium state').schemaVersion;
  if (version === 2) return validateState(input);
  if (version !== 1) invalid('schema version', 'only versions 1 and 2 are supported');
  const { layers, schemaVersion: _version, ...legacy } = validateLegacyState(input);
  return validateState({
    ...legacy, schemaVersion: 2, terrain: migrateTerrain(layers), care: { sunlight: 0 },
  });
}

/** Validate every IPC/UI action before any state mutation. */
export function validateAction(input: unknown): TerrariumAction {
  const value = record(input, 'action');
  const check = (allowed: readonly string[]) => keys(value, ['type', ...allowed], 'action');
  const position = () => ({ x: number(value.x, 0, 1, 'x'), y: number(value.y, 0, 1, 'y') });
  switch (value.type) {
    case 'rename': check(['name']); return { type: 'rename', name: name(value.name) };
    case 'bottle': check(['shape']); return { type: 'bottle', shape: member(value.shape, BOTTLE_SHAPES, 'bottle') };
    case 'glass-form': check(['value']); return { type: 'glass-form', value: glassForm(value.value) };
    case 'pour': check(['material', 'x', 'amount']); return {
      type: 'pour', material: member(value.material, MATERIAL_KINDS, 'material'),
      x: number(value.x, 0, 1, 'x'), amount: grainAmount(value.amount),
    };
    case 'pour-water': check(['x', 'amount']); return { type: 'pour-water', x: number(value.x, 0, 1, 'x'), amount: grainAmount(value.amount) };
    case 'drain-water':
    case 'scoop':
      check(['x', 'amount', ...(Object.hasOwn(value, 'radius') ? ['radius'] : [])]);
      return {
        type: value.type, x: number(value.x, 0, 1, 'x'), amount: grainAmount(value.amount),
        ...(Object.hasOwn(value, 'radius') ? { radius: scoopRadius(value.radius) } : {}),
      };
    case 'spray': check(['plantId', 'amount']); return {
      type: 'spray', plantId: value.plantId === null ? null : id(value.plantId, 'spray plant id'),
      amount: number(value.amount, 0, 0.025, 'spray amount'),
    };
    case 'spray-decoration': check(['decorationId', 'amount']); return {
      type: 'spray-decoration', decorationId: id(value.decorationId, 'spray decoration id'),
      amount: number(value.amount, 0, 0.025, 'spray amount'),
    };
    case 'resize-plant':
    case 'resize-decoration': check(['id', 'scale']); return {
      type: value.type, id: id(value.id, 'resize item id'),
      scale: number(value.scale, ENTITY_SCALE_LIMITS[0], ENTITY_SCALE_LIMITS[1], 'item scale'),
    };
    case 'wood-form': check(['id', 'value']); return { type: 'wood-form', id: id(value.id, 'wood id'), value: validateWoodForm(value.value) };
    case 'object-pose': check(['id', 'value']); return { type: 'object-pose', id: id(value.id, 'object id'), value: objectPose(value.value) };
    case 'sunlight': check([]); return { type: 'sunlight' };
    case 'add-plant': check(['kind', 'x', 'y', ...(Object.hasOwn(value, 'support') ? ['support'] : [])]); return { type: 'add-plant', kind: member(value.kind, PLANTS, 'plant kind'), ...position(), ...(Object.hasOwn(value, 'support') ? { support: supportAttachment(value.support) } : {}) };
    case 'move-plant': check(['id', 'x', 'y', ...(Object.hasOwn(value, 'support') ? ['support'] : [])]); return { type: 'move-plant', id: id(value.id, 'plant id'), ...position(), ...(Object.hasOwn(value, 'support') ? { support: value.support === null ? null : supportAttachment(value.support) } : {}) };
    case 'remove-plant': check(['id']); return { type: 'remove-plant', id: id(value.id, 'plant id') };
    case 'add-decoration': {
      const hasPreset = Object.hasOwn(value, 'woodPreset');
      const hasVariant = Object.hasOwn(value, 'variant');
      check(['kind', 'x', 'y', ...(Object.hasOwn(value, 'support') ? ['support'] : []), ...(hasPreset ? ['woodPreset'] : []), ...(hasVariant ? ['variant'] : [])]);
      const kind = member(value.kind, DECORATIONS, 'decoration kind');
      if (hasPreset && kind !== 'wood') invalid('wood preset', 'only driftwood accepts a branch preset');
      if (isFloatingDecoration(kind) && Object.hasOwn(value, 'support')) invalid('support', 'floating ornaments cannot attach to a surface');
      return { type: 'add-decoration', kind, ...position(),
        ...(Object.hasOwn(value, 'support') ? { support: supportAttachment(value.support) } : {}),
        ...(hasPreset ? { woodPreset: member(value.woodPreset, WOOD_PRESET_KINDS, 'wood preset') } : {}),
        ...(hasVariant ? { variant: decorationVariant(value.variant, kind) } : {}),
      };
    }
    case 'move-decoration': check(['id', 'x', 'y', ...(Object.hasOwn(value, 'support') ? ['support'] : [])]); return { type: 'move-decoration', id: id(value.id, 'decoration id'), ...position(), ...(Object.hasOwn(value, 'support') ? { support: value.support === null ? null : supportAttachment(value.support) } : {}) };
    case 'remove-decoration': check(['id']); return { type: 'remove-decoration', id: id(value.id, 'decoration id') };
    case 'water': check(['amount']); return { type: 'water', amount: number(value.amount, 0, 0.2, 'water amount') };
    case 'lid': check(['closed']); return { type: 'lid', closed: boolean(value.closed, 'closed') };
    case 'environment': check(['temperature', 'light']); return {
      type: 'environment', temperature: number(value.temperature, 10, 35, 'temperature'), light: number(value.light, 0, 1, 'light'),
    };
    case 'speed': check(['speed']); return { type: 'speed', speed: member(value.speed, SPEEDS, 'speed') };
    case 'pause': check(['paused']); return { type: 'pause', paused: boolean(value.paused, 'paused') };
    case 'vacation': check(['enabled']); return { type: 'vacation', enabled: boolean(value.enabled, 'vacation') };
    case 'preferences': check(['value']); return { type: 'preferences', value: preferences(value.value, true) };
    case 'starter': check([]); return { type: 'starter' };
    case 'reset': check([]); return { type: 'reset' };
    default: invalid('action type', 'unsupported action');
  }
}

function grainAmount(input: unknown): number {
  const amount = number(input, 1, 32, 'grain amount');
  if (!Number.isInteger(amount)) invalid('grain amount', 'expected an integer');
  return amount;
}

function scoopRadius(input: unknown): number {
  const radius = number(input, 1, 8, 'scoop radius');
  if (!Number.isInteger(radius)) invalid('scoop radius', 'expected an integer');
  return radius;
}
