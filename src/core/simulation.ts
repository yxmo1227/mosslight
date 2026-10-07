import type { Decoration, DecorationKind, Plant, PlantKind, TerrariumState } from '../shared/types';
import { hasLid, isFloatingDecoration, isMossKind, TERRAIN_COLUMNS, TERRAIN_GRAIN_HEIGHT, woodPresetForm } from '../shared/catalog';
import {
  MAX_DECORATIONS, MAX_PLANTS, MAX_SIMULATED_DAYS, MIN_HEALTH,
  validateAction, validateState, validateTimestamp,
} from './validation';
import { pourTerrain, scoopTerrain, terrainColumnIndex } from './terrain';
import { drainPond, pondWater, pourPond, reconcilePond, withdrawPondWater } from './hydrology';
import { assertSupportGraph, detachSupportedChildren, moveSupportedItem } from './support';
import { isMushroom, spawnMushroomClusters, updateColony, updateStress, updateSurfaceColonies } from './ecology';

export { migrateSaveState, validateState } from './validation';

export const DAY_MILLISECONDS = 86_400_000;
export const WATER_VAPOR_CAPACITY = 0.08;
export const MAX_SIMULATION_STEPS = 4096;
export const SUNLIGHT_HALF_LIFE_MILLISECONDS = 60_000;
export const WETNESS_HALF_LIFE_MILLISECONDS = 90_000;
export const SPRAY_FULL_WET_AMOUNT = 0.1;
export const SPRAY_GROWTH_PER_WET_CYCLE = 0.05;
export const SPRAY_HEALTH_PER_WET_CYCLE = 0.04;
// Cosmetic weathering only: no decay value removes geometry or adds nutrients.
export const WOOD_BASE_DECAY_RATE = 0;
export const WOOD_DAMP_DECAY_RATE = 0.004;

const SPECIES: Record<PlantKind, {
  moisture: number; humidity: number; temperature: number; light: number; growthRate: number;
}> = {
  'cushion-moss': { moisture: 0.64, humidity: 0.78, temperature: 21, light: 0.5, growthRate: 0.1 },
  'sheet-moss': { moisture: 0.6, humidity: 0.74, temperature: 22, light: 0.55, growthRate: 0.12 },
  'star-moss': { moisture: 0.63, humidity: 0.77, temperature: 21, light: 0.53, growthRate: 0.105 },
  'fern-moss': { moisture: 0.65, humidity: 0.8, temperature: 21, light: 0.48, growthRate: 0.095 },
  fern: { moisture: 0.55, humidity: 0.7, temperature: 22, light: 0.62, growthRate: 0.065 },
  fittonia: { moisture: 0.52, humidity: 0.72, temperature: 24, light: 0.65, growthRate: 0.085 },
  'creeping-fig': { moisture: 0.56, humidity: 0.7, temperature: 23, light: 0.6, growthRate: 0.078 },
  oxalis: { moisture: 0.5, humidity: 0.65, temperature: 22, light: 0.66, growthRate: 0.075 },
  'amber-mushroom': { moisture: 0.66, humidity: 0.8, temperature: 21, light: 0.45, growthRate: 0.11 },
  'ivory-mushroom': { moisture: 0.62, humidity: 0.78, temperature: 22, light: 0.5, growthRate: 0.095 },
  'scarlet-mushroom': { moisture: 0.66, humidity: 0.8, temperature: 20, light: 0.45, growthRate: 0.1 },
  'violet-mushroom': { moisture: 0.64, humidity: 0.79, temperature: 21, light: 0.45, growthRate: 0.095 },
};

function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value));
}

function fraction(rate: number, days: number): number {
  // expm1 retains precision for tiny deltas and is bounded for arbitrarily long absences.
  return -Math.expm1(-rate * days);
}

function newId(state: TerrariumState): string {
  const existing = new Set([...state.plants, ...state.decorations].map((item) => item.id));
  const crypto = globalThis.crypto;
  if (!crypto || typeof crypto.randomUUID !== 'function') {
    throw new Error('A secure UUID provider is required to add terrarium items');
  }
  for (let attempt = 0; attempt < 8; attempt++) {
    const id = crypto.randomUUID();
    if (!existing.has(id)) return id;
  }
  throw new Error('Unable to allocate a unique terrarium identifier');
}

function newPlant(state: TerrariumState, kind: PlantKind, x: number, y: number): Plant {
  return { id: newId(state), kind, x, y, scale: 1, growth: 0.18, health: 0.9, ageDays: 0, wetness: 0 };
}

function newDecoration(state: TerrariumState, kind: DecorationKind, x: number, y: number): Decoration {
  return { id: newId(state), kind, x, y, scale: 1 };
}

/** An empty, comfortably moist bottle, not a pre-populated example. */
export function createInitialState(now: number): TerrariumState {
  const time = validateTimestamp(now);
  return {
    schemaVersion: 2,
    name: 'My Little Forest',
    bottle: 'round',
    terrain: { columns: Array.from({ length: TERRAIN_COLUMNS }, () => [
      'gravel', 'gravel', 'clay', 'soil', 'soil', 'soil', 'soil', 'soil', 'soil', 'soil',
    ]) },
    plants: [], decorations: [],
    environment: { temperature: 22, light: 0.65 },
    ecology: { moisture: 0.55, humidity: 0.65, waterReserve: 0.18, simulatedDays: 0 },
    care: { sunlight: 0 },
    closed: true, speed: 1, paused: false, vacation: false,
    createdAt: time, updatedAt: time,
    preferences: { widgetSize: 'medium', alwaysOnTop: true, launchAtLogin: false, reducedMotion: false },
  };
}

/** Apply one validated command without mutating the supplied state or command. */
export function applyAction(state: TerrariumState, input: unknown, now: number): TerrariumState {
  const next = validateState(state);
  const action = validateAction(input);
  const time = Math.max(next.updatedAt, validateTimestamp(now));
  next.updatedAt = time;
  switch (action.type) {
    case 'rename': next.name = action.name; break;
    case 'bottle':
      next.bottle = action.shape;
      if (!hasLid(action.shape)) next.closed = false;
      break;
    case 'glass-form':
      if (next.bottle !== 'glass-box') throw new RangeError('Only the faceted glass container can be shaped');
      next.glassForm = { ...action.value };
      break;
    case 'pour': next.terrain = pourTerrain(next.terrain, action.material, action.x, action.amount); break;
    case 'scoop': next.terrain = scoopTerrain(next.terrain, action.x, action.amount, action.radius); break;
    case 'pour-water': next.pond = pourPond(next.terrain, next.pond, action.x, action.amount); break;
    case 'drain-water': next.pond = drainPond(next.terrain, next.pond, action.x, action.amount, action.radius); break;
    case 'spray': {
      const target = action.plantId === null ? undefined : next.plants.find((plant) => plant.id === action.plantId);
      if (action.plantId !== null && !target) throw new RangeError('Plant not found');
      addWater(next, action.amount);
      if (target && action.amount > 0) {
        const wetnessGain = Math.min(1 - target.wetness, action.amount / SPRAY_FULL_WET_AMOUNT);
        target.wetness = clamp(target.wetness + wetnessGain);
        // The same already-wet leaf cannot repeatedly earn the complete care reward.
        // Wetness is an optical/care meter, not an additional water reservoir.
        if (!next.paused) {
          target.growth = clamp(target.growth + SPRAY_GROWTH_PER_WET_CYCLE * wetnessGain);
          target.health = clamp(target.health + SPRAY_HEALTH_PER_WET_CYCLE * wetnessGain, MIN_HEALTH, 1);
        }
      }
      break;
    }
    case 'spray-decoration': {
      const target = next.decorations.find(item => item.id === action.decorationId);
      if (!target) throw new RangeError('Decoration not found');
      addWater(next, action.amount);
      if (action.amount > 0 && !isFloatingDecoration(target.kind)) {
        target.condition ??= { wetness: 0, decay: 0 };
        target.condition.wetness = clamp(target.condition.wetness + action.amount / SPRAY_FULL_WET_AMOUNT);
      }
      break;
    }
    case 'resize-plant': {
      const target = next.plants.find(item => item.id === action.id);
      if (!target) throw new RangeError('Plant not found');
      target.scale = action.scale;
      break;
    }
    case 'resize-decoration': {
      const target = next.decorations.find(item => item.id === action.id);
      if (!target) throw new RangeError('Decoration not found');
      // Each descendant keeps its own scale and local support coordinate. The
      // renderer resolves new resting points from the changed parent's profile.
      target.scale = action.scale;
      break;
    }
    case 'wood-form': {
      const target = next.decorations.find(item => item.id === action.id);
      if (!target) throw new RangeError('Decoration not found');
      if (target.kind !== 'wood') throw new RangeError('Only driftwood has an editable wood form');
      target.wood = action.value;
      target.condition ??= { wetness: 0, decay: 0 };
      break;
    }
    case 'object-pose': {
      const target = next.decorations.find(item => item.id === action.id);
      if (!target || target.kind !== 'wood') throw new RangeError('Only existing driftwood can be reoriented');
      target.pose = { ...action.value };
      break;
    }
    case 'sunlight': next.care.sunlight = 1; break;
    case 'add-plant': {
      if (next.plants.length >= MAX_PLANTS) throw new RangeError(`A bottle holds at most ${MAX_PLANTS} plants`);
      const item = newPlant(next, action.kind, action.x, action.y);
      if (action.support) item.support = { ...action.support };
      next.plants.push(item);
      break;
    }
    case 'move-plant': {
      const item = next.plants.find((plant) => plant.id === action.id);
      if (!item) throw new RangeError('Plant not found');
      moveSupportedItem(next, item, action.x, action.y, action.support);
      break;
    }
    case 'remove-plant':
      if (!next.plants.some((plant) => plant.id === action.id)) throw new RangeError('Plant not found');
      next.plants = next.plants.filter((plant) => plant.id !== action.id && plant.ecology?.parentId !== action.id);
      break;
    case 'add-decoration': {
      if (next.decorations.length >= MAX_DECORATIONS) throw new RangeError(`A bottle holds at most ${MAX_DECORATIONS} decorations`);
      const item = newDecoration(next, action.kind, action.x, action.y);
      if (action.woodPreset) item.wood = woodPresetForm(action.woodPreset);
      if (action.variant) item.variant = action.variant;
      if (action.support) item.support = { ...action.support };
      next.decorations.push(item);
      break;
    }
    case 'move-decoration': {
      const item = next.decorations.find((decoration) => decoration.id === action.id);
      if (!item) throw new RangeError('Decoration not found');
      moveSupportedItem(next, item, action.x, action.y, action.support);
      break;
    }
    case 'remove-decoration':
      if (!next.decorations.some((decoration) => decoration.id === action.id)) throw new RangeError('Decoration not found');
      detachSupportedChildren(next, action.id);
      next.decorations = next.decorations.filter((decoration) => decoration.id !== action.id);
      break;
    case 'water': addWater(next, action.amount); break;
    case 'lid':
      if (action.closed && !hasLid(next.bottle)) throw new RangeError('This open container has no lid');
      next.closed = action.closed;
      break;
    case 'environment': next.environment = { temperature: action.temperature, light: action.light }; break;
    case 'speed': next.speed = action.speed; break;
    case 'pause': next.paused = action.paused; break;
    case 'vacation': next.vacation = action.enabled; break;
    case 'preferences': next.preferences = { ...next.preferences, ...action.value }; break;
    case 'starter': {
      // Repeated starter clicks add only missing species/types, never remove the user's work.
      const plants: { kind: PlantKind; x: number; y: number }[] = [
        { kind: 'cushion-moss', x: 0.3, y: 0.7 },
        { kind: 'sheet-moss', x: 0.6, y: 0.74 },
        { kind: 'fern', x: 0.43, y: 0.36 },
        { kind: 'fittonia', x: 0.72, y: 0.49 },
      ];
      for (const plant of plants) {
        if (next.plants.length >= MAX_PLANTS) break;
        if (!next.plants.some((item) => item.kind === plant.kind)) {
          next.plants.push(newPlant(next, plant.kind, plant.x, plant.y));
        }
      }
      const decorations: { kind: DecorationKind; x: number; y: number }[] = [
        { kind: 'wood', x: 0.22, y: 0.45 }, { kind: 'stone', x: 0.78, y: 0.76 },
      ];
      for (const decoration of decorations) {
        if (next.decorations.length >= MAX_DECORATIONS) break;
        if (!next.decorations.some((item) => item.kind === decoration.kind)) {
          next.decorations.push(newDecoration(next, decoration.kind, decoration.x, decoration.y));
        }
      }
      break;
    }
    case 'reset': {
      const empty = createInitialState(time);
      empty.terrain = { columns: Array.from({ length: TERRAIN_COLUMNS }, () => []) };
      empty.preferences = { ...next.preferences };
      return empty;
    }
  }
  assertSupportGraph(next.plants, next.decorations);
  if (next.pond && (action.type === 'pour' || action.type === 'scoop')) next.pond = reconcilePond(next.terrain, next.pond);
  return next;
}

function addWater(state: TerrariumState, amount: number): void {
  const soilAddition = Math.min(1 - state.ecology.moisture, amount * 0.75);
  state.ecology.moisture += soilAddition;
  // Saturation overflow is discarded, never converted into new inventory.
  state.ecology.waterReserve = Math.min(1, state.ecology.waterReserve + amount - soilAddition);
}

function simulateWater(
  state: TerrariumState, days: number, retention: number, environment: TerrariumState['environment'],
): void {
  const ecology = state.ecology;
  const targetMoisture = 0.62;
  const infiltrated = Math.min(Math.max(0, targetMoisture - ecology.moisture), ecology.waterReserve)
    * fraction(0.9 * retention, days);
  ecology.waterReserve -= infiltrated;
  ecology.moisture += infiltrated;
  // Visible pond water is part of the same inventory: capillary exchange wets
  // soil instead of leaving a wet pond beside inexplicably dehydrated plants.
  const pondInventory = pondWater(state.pond);
  const pondTarget = 0.7 + Math.min(.25, pondInventory * .35);
  const pondAbsorbed = withdrawPondWater(state.terrain, state.pond,
    Math.max(0, pondTarget - ecology.moisture) * fraction(.22 * retention, days));
  ecology.moisture += pondAbsorbed;
  let vapor = ecology.humidity * WATER_VAPOR_CAPACITY;
  if (state.closed) {
    const targetHumidity = clamp(0.24 + ecology.moisture * 0.76
      + (environment.temperature - 22) * 0.006 + state.plants.length * 0.0015);
    const exchanged = (targetHumidity * WATER_VAPOR_CAPACITY - vapor) * fraction(3, days);
    if (exchanged >= 0) {
      const soilEvaporated = Math.min(ecology.moisture, exchanged);
      ecology.moisture -= soilEvaporated;
      const pondEvaporated = withdrawPondWater(state.terrain, state.pond, exchanged - soilEvaporated);
      vapor += soilEvaporated + pondEvaporated;
    } else {
      const condensed = Math.min(vapor, -exchanged);
      const intoSoil = Math.min(1 - ecology.moisture, condensed);
      const intoReserve = Math.min(1 - ecology.waterReserve, condensed - intoSoil);
      ecology.moisture += intoSoil;
      ecology.waterReserve += intoReserve;
      vapor -= intoSoil + intoReserve;
    }
  } else {
    const heat = (environment.temperature - 10) / 25;
    const protection = state.vacation ? 0.3 : 1;
    const evaporationRate = (0.018 + heat * 0.04 + environment.light * 0.025) / retention * protection;
    const evaporated = ecology.moisture * fraction(evaporationRate, days);
    ecology.moisture -= evaporated;
    const pondEvaporated = withdrawPondWater(state.terrain, state.pond,
      pondWater(state.pond) * fraction(evaporationRate * .55, days));
    // Vapor exceeding the air reservoir escapes; ventilation only removes water, never creates it.
    vapor = Math.min(WATER_VAPOR_CAPACITY, vapor + evaporated + pondEvaporated);
    vapor *= 1 - fraction(1.8 * protection, days);
  }
  ecology.moisture = clamp(ecology.moisture);
  ecology.waterReserve = clamp(ecology.waterReserve);
  ecology.humidity = clamp(vapor / WATER_VAPOR_CAPACITY);
}

function terrainConditions(state: TerrariumState): { retention: number; support: number[] } {
  let absorbent = 0;
  let clay = 0;
  const soilEquivalent = (column: TerrariumState['terrain']['columns'][number]): number => {
    let soil = 0;
    for (const material of column) {
      if (material === 'soil') soil += 1;
      else if (material === 'coir') soil += 0.85;
      else if (material === 'bark') soil += 0.35;
      else if (material === 'charcoal') soil += 0.1;
    }
    return soil * TERRAIN_GRAIN_HEIGHT / 95;
  };
  for (const column of state.terrain.columns) {
    absorbent += soilEquivalent(column);
    clay += column.filter((material) => material === 'clay').length * TERRAIN_GRAIN_HEIGHT / 95;
  }
  const retention = clamp(0.25 + absorbent / TERRAIN_COLUMNS * 1.6 + clay / TERRAIN_COLUMNS * 0.65, 0.25, 1.8);
  const support = state.plants.map((plant) => {
    if (plant.support) {
      const parent = state.decorations.find(item => item.id === plant.support!.parentId);
      if (parent && (parent.kind === 'wood' || parent.kind === 'stump')) return .95;
      if (isMossKind(plant.kind)) return .8;
    }
    const center = terrainColumnIndex(plant.x);
    const neighbors = state.terrain.columns.slice(Math.max(0, center - 1), Math.min(TERRAIN_COLUMNS, center + 2));
    return clamp(0.2 + neighbors.reduce((sum, column) => sum + soilEquivalent(column), 0) / neighbors.length * 2.2);
  });
  return { retention, support };
}

function simulateStep(
  state: TerrariumState, days: number, sunlight: number, substrate: ReturnType<typeof terrainConditions>,
  realOffset: number, realMilliseconds: number,
): void {
  const environment = {
    temperature: clamp(state.environment.temperature + sunlight * 2, 10, 35),
    light: clamp(state.environment.light + sunlight * 0.2),
  };
  const previousMoisture = state.ecology.moisture;
  const previousHumidity = state.ecology.humidity;
  simulateWater(state, days, substrate.retention, environment);
  const moisture = (previousMoisture + state.ecology.moisture) / 2;
  const humidity = (previousHumidity + state.ecology.humidity) / 2;
  for (const [index, plant] of state.plants.entries()) {
    const rootSupport = substrate.support[index] ?? .8;
    const species = SPECIES[plant.kind];
    const waterScore = clamp(1 - Math.abs(moisture - species.moisture) / 0.5);
    const humidityScore = clamp(1 - Math.abs(humidity - species.humidity) / 0.85);
    const climateScore = (climate: TerrariumState['environment']): number => {
      const temperatureScore = clamp(1 - Math.abs(climate.temperature - species.temperature) / 15);
      // Fungal growth uses organic matter, not photosynthesis. Dim/dark fungi
      // can persist; intense light is still an adverse heat/drying environment.
      const lightScore = isMushroom(plant) ? .85 + .15 * clamp(1 - climate.light)
        : climate.light === 0 ? 0 : clamp(1 - Math.abs(climate.light - species.light) / 0.75);
      return waterScore * (0.45 + humidityScore * 0.55) * temperatureScore * lightScore * rootSupport;
    };
    // This is a gentle game-care boost, not an instruction to expose shade plants
    // to harsh sun. Keep the ordinary suitability floor while briefly warming
    // and brightening the climate; the moisture-limited bonus is always bounded.
    const stress = updateStress(plant, state, moisture, days);
    const wellbeing = clamp((Math.max(climateScore(state.environment), climateScore(environment))
      + sunlight * 0.08 * waterScore * rootSupport) * (1 - stress * .95));
    const targetHealth = Math.max(state.vacation ? 0.58 : MIN_HEALTH,
      MIN_HEALTH + (1 - MIN_HEALTH) * wellbeing);
    const oldHealth = plant.health;
    plant.health = clamp(oldHealth + (targetHealth - oldHealth)
      * fraction(targetHealth > oldHealth ? 0.65 : 0.35, days), MIN_HEALTH, 1);
    const growthFactor = wellbeing < 0.08 ? 0 : wellbeing * (oldHealth + plant.health) / 2;
    plant.growth = clamp(plant.growth + (1 - plant.growth)
      * fraction(species.growthRate * growthFactor * (state.vacation ? 0.3 : 1), days));
    // Keep living roots/mycelium, but visible foliage contracts during prolonged
    // drought or waterlogging instead of remaining a full-size healthy silhouette.
    if (stress > .35) plant.growth += (.12 - plant.growth) * fraction(.035 * stress, days);
    updateColony(plant, wellbeing, days * (state.vacation ? .3 : 1));
    plant.ageDays = Math.min(MAX_SIMULATED_DAYS, plant.ageDays + days);
  }
  for (const item of state.decorations) {
    if (item.kind !== 'wood' && item.kind !== 'stump') continue;
    item.condition ??= { wetness: 0, decay: 0 };
    // Existing conditionless wood joins the same ecology. Integrate the transient
    // wetness over this step instead of assuming a fresh mist lasts all night.
    const wetness = averageCare(decay(item.condition.wetness, realOffset, WETNESS_HALF_LIFE_MILLISECONDS), realMilliseconds, WETNESS_HALF_LIFE_MILLISECONDS);
    const damp = clamp(moisture * .45 + humidity * .45 + wetness * .1);
    const saturation = clamp((moisture - .8) / .2);
    const oxygen = 1 - saturation * .35;
    const rate = (WOOD_BASE_DECAY_RATE + WOOD_DAMP_DECAY_RATE * damp * damp * oxygen) * (state.vacation ? .3 : 1);
    item.condition.decay = clamp(item.condition.decay + (1 - item.condition.decay) * fraction(rate, days));
    const moldTarget = clamp((humidity - .72) / .24) * clamp((moisture - .65) / .3) * oxygen;
    const oldMold = item.condition.mold ?? 0;
    item.condition.mold = clamp(oldMold + (moldTarget - oldMold) * fraction(moldTarget > oldMold ? .045 : .025, days));
  }
  updateSurfaceColonies(state, days * (state.vacation ? .3 : 1));
  spawnMushroomClusters(state);
}

function decay(value: number, realMilliseconds: number, halfLife: number): number {
  return clamp(value * Math.exp(-Math.LN2 * (realMilliseconds / halfLife)));
}

function averageCare(value: number, realMilliseconds: number, halfLife: number): number {
  const exponent = Math.LN2 * (realMilliseconds / halfLife);
  return exponent === 0 ? value : clamp(value * -Math.expm1(-exponent) / exponent);
}

function decayCare(state: TerrariumState, realMilliseconds: number): void {
  state.care.sunlight = decay(state.care.sunlight, realMilliseconds, SUNLIGHT_HALF_LIFE_MILLISECONDS);
  for (const plant of state.plants) {
    plant.wetness = decay(plant.wetness, realMilliseconds, WETNESS_HALF_LIFE_MILLISECONDS);
  }
  for (const item of state.decorations) if (item.condition) {
    item.condition.wetness = decay(item.condition.wetness, realMilliseconds, WETNESS_HALF_LIFE_MILLISECONDS);
  }
}

/**
 * Educational ecosystem approximation. Online time is 24 * speed; offline time is 1x.
 * At most 4096 bounded steps are used, never one replay per missed frame. This
 * retains sub-day resolution over the requested 2–3-year forecast horizon.
 * Stored water = moisture + waterReserve + humidity * WATER_VAPOR_CAPACITY + pondWater.
 */
export function advanceSimulation(
  state: TerrariumState, realMilliseconds: number, mode: 'online' | 'offline', now: number,
): TerrariumState {
  const next = validateState(state);
  next.updatedAt = Math.max(next.updatedAt, validateTimestamp(now));
  if (typeof realMilliseconds !== 'number' || !Number.isFinite(realMilliseconds) || realMilliseconds < 0) {
    throw new RangeError('Elapsed time must be a finite, nonnegative number');
  }
  if (mode !== 'online' && mode !== 'offline') throw new TypeError('Unknown simulation mode');
  if (realMilliseconds === 0) return next;
  if (next.paused) {
    decayCare(next, realMilliseconds);
    return next;
  }
  const rate = mode === 'online' ? 24 * next.speed : 1;
  const remaining = MAX_SIMULATED_DAYS - next.ecology.simulatedDays;
  const days = Math.min(remaining, realMilliseconds / DAY_MILLISECONDS * rate);
  if (days <= 0) {
    decayCare(next, realMilliseconds);
    return next;
  }
  const steps = Math.min(MAX_SIMULATION_STEPS, Math.max(1, Math.ceil(days * 24)));
  const stepDays = days / steps;
  // If the age limit clips an extreme absence, only integrate its simulated prefix;
  // cosmetic care still expires over the complete real absence below.
  const realPerStep = days * DAY_MILLISECONDS / rate / steps;
  const initialSunlight = next.care.sunlight;
  for (let index = 0; index < steps; index++) {
    const sunlight = decay(initialSunlight, index * realPerStep, SUNLIGHT_HALF_LIFE_MILLISECONDS);
    simulateStep(next, stepDays, averageCare(sunlight, realPerStep, SUNLIGHT_HALF_LIFE_MILLISECONDS), terrainConditions(next), index * realPerStep, realPerStep);
  }
  decayCare(next, realMilliseconds);
  next.ecology.simulatedDays = Math.min(MAX_SIMULATED_DAYS, next.ecology.simulatedDays + days);
  return next;
}
