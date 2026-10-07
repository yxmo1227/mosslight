import type { Plant, TerrariumState } from '../shared/types';
import { isFloatingDecoration, isMossKind, isMushroomKind } from '../shared/catalog';
import { MAX_PLANTS } from './validation';

export const MAX_GENERATED_CLUSTERS = 12;
export const MANUAL_PLANT_RESERVE = 6;
export const FUNGAL_CYCLE_DAYS = 48;
const clamp = (n: number): number => Math.max(0, Math.min(1, n));
const fraction = (rate: number, days: number): number => -Math.expm1(-rate * days);
export const isMoss = (plant: Plant): boolean => isMossKind(plant.kind);
export const isMushroom = (plant: Plant): boolean => isMushroomKind(plant.kind);

/** Dimensionless, deliberately accelerated game physiology, not species-calibrated biology.
 * Stress is reversible; authored plants and constructions are never destroyed. */
export function plantEcology(plant: Plant): NonNullable<Plant['ecology']> {
  return plant.ecology ??= { drought: 0, waterlogging: 0, spread: 0, cycle: .2, generation: 0 };
}

export function updateStress(plant: Plant, state: TerrariumState, moisture: number, days: number): number {
  const ecology = plantEcology(plant);
  const excessLight = clamp((state.environment.light - .78) / .22);
  const scorching = excessLight * (.8 + .2 * clamp((state.environment.temperature - 28) / 7));
  const dryness = Math.max(clamp((.32 - moisture) / .28), scorching);
  const flooded = clamp((moisture - .79) / .21);
  const protection = state.vacation ? .3 : 1;
  for (const [key, target] of [['drought', dryness * protection], ['waterlogging', flooded * protection]] as const) {
    ecology[key] += (target - ecology[key]) * fraction(target > ecology[key] ? .3 : .16, days);
  }
  return Math.max(ecology.drought, ecology.waterlogging);
}

export function updateColony(plant: Plant, wellbeing: number, days: number): void {
  const ecology = plantEcology(plant), stress = Math.max(ecology.drought, ecology.waterlogging);
  if (isMoss(plant) || isMushroom(plant)) {
    const suitable = clamp((wellbeing - .22) / .58) * (1 - stress);
    if (suitable > .05) ecology.spread += (1 - ecology.spread) * fraction((isMoss(plant) ? .017 : .022) * suitable, days);
    else ecology.spread *= Math.exp(-.003 * stress * days);
  }
  // Fruit bodies age even under stress, while dormant mycelium waits for moisture.
  // A whole cluster recurs instead of accumulating immortal mushrooms indefinitely.
  if (isMushroom(plant)) {
    if (stress > .55 || wellbeing < .15) {
      ecology.cycle += (.96 - ecology.cycle) * fraction(.2, days);
    } else {
      ecology.cycle = (ecology.cycle + days * (.6 + wellbeing * .4) / FUNGAL_CYCLE_DAYS) % 1;
    }
  }
}

/** Colonization is an attached surface coating rather than hundreds of movable
 * objects. Established mats remain at that surface but brown under poor care. */
export function updateSurfaceColonies(state: TerrariumState, days: number): void {
  const sources = state.plants.filter(isMoss);
  for (const object of state.decorations) {
    if (isFloatingDecoration(object.kind)) continue;
    let exposure = 0, health = 0, nearby = 0;
    for (const plant of sources) {
      const ecology = plantEcology(plant), reach = .08 + ecology.spread * .62;
      const distance = Math.abs(plant.x - object.x);
      const verticalReach = .24 + ecology.spread * .6;
      const connection = plant.support?.parentId === object.id ? 1
        : clamp(1 - distance / reach) * clamp(1 - Math.abs(plant.y - object.y) / verticalReach);
      const energy = connection * ecology.spread;
      exposure = Math.max(exposure, energy * clamp((plant.health - .28) / .55)
        * (1 - Math.max(ecology.drought, ecology.waterlogging)));
      health += plant.health * connection; nearby += connection;
    }
    if (!object.colonization && exposure < .04) continue;
    object.colonization ??= { moss: 0, health: nearby ? health / nearby : .5 };
    const colony = object.colonization;
    colony.moss = clamp(colony.moss + (1 - colony.moss) * fraction(.024 * exposure, days));
    const surfaceSuitability = clamp(1 - Math.abs(state.ecology.moisture - .62) / .5)
      * clamp(1 - Math.abs(state.environment.temperature - 22) / 15)
      * (state.environment.light === 0 ? 0 : clamp(1 - Math.abs(state.environment.light - .5) / .65));
    // Established coatings are living colonies too: removing the original
    // movable patch does not make that coating immune to darkness or drying.
    const targetHealth = nearby ? health / nearby : .12 + .88 * surfaceSuitability;
    colony.health += (targetHealth - colony.health) * fraction(.22, days);
  }
}

function generatedId(parentId: string, slot: number): string {
  let hash = 2166136261;
  for (const char of parentId) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return `colony-${parentId.slice(0, 48)}-${(hash >>> 0).toString(16)}-${slot}`;
}

/** Only authored mycelial colonies reproduce; stable IDs and persisted slots
 * make replay deterministic, prevent exponential growth and respect deletions. */
export function spawnMushroomClusters(state: TerrariumState): void {
  const roots = state.plants.filter(plant => isMushroom(plant) && plant.ecology?.generation !== 1);
  const ids = new Set([...state.plants, ...state.decorations].map(item => item.id));
  let generated = state.plants.filter(plant => plant.ecology?.generation === 1).length;
  for (const root of roots) {
    const ecology = plantEcology(root);
    while ((ecology.offspring ?? 0) < 2 && generated < MAX_GENERATED_CLUSTERS && state.plants.length < MAX_PLANTS - MANUAL_PLANT_RESERVE) {
      const slot = ecology.offspring ?? 0;
      if (ecology.spread < (slot === 0 ? .3 : .6) || Math.max(ecology.drought, ecology.waterlogging) > .35 || root.health < .48) break;
      const id = generatedId(root.id, slot), direction = slot === 0 ? -1 : 1;
      // One dry gravel side must not block colonization of suitable soil on the
      // other. Try finite, deterministic alternatives and avoid overlapping an
      // existing cluster on the same surface. Leave the slot pending if all fail.
      const candidates = [direction * .12, -direction * .12, direction * .065, -direction * .065].map(offset => ({
        x: Math.max(.04, Math.min(.96, root.x + offset)),
        support: root.support ? { ...root.support, x: clamp(root.support.x + offset * (7 / 3)) } : undefined,
      }));
      const destination = candidates.find(candidate => {
        const column = state.terrain.columns[Math.min(47, Math.floor(candidate.x * 48))];
        const parent = candidate.support && state.decorations.find(item => item.id === candidate.support!.parentId);
        const organic = parent && (parent.kind === 'wood' || parent.kind === 'stump')
          || column.some(material => material === 'soil' || material === 'bark' || material === 'coir');
        const occupied = state.plants.some(item => item.kind === root.kind && item.support?.parentId === candidate.support?.parentId
          && Math.abs((item.support?.x ?? item.x) - (candidate.support?.x ?? candidate.x)) < (candidate.support ? .11 : .05));
        return organic && !occupied;
      });
      if (!destination) break;
      const { x, support } = destination;
      ecology.offspring = slot + 1;
      if (ids.has(id)) continue;
      state.plants.push({ id, kind: root.kind, x, y: root.y, scale: .8, growth: .16, health: root.health, ageDays: 0, wetness: 0,
        ...(support ? { support } : {}),
        ecology: { drought: ecology.drought, waterlogging: ecology.waterlogging, spread: 0, cycle: slot ? .05 : .35, generation: 1, parentId: root.id },
      });
      ids.add(id); generated++;
    }
  }
}
