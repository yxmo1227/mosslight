export type BottleShape = 'round' | 'square' | 'cylinder' | 'open-cylinder' | 'open-cube' | 'glass-box' | 'cat';
export type GlassBand = 'lower' | 'middle' | 'upper';
export type GlassSideName = 'left' | 'right';
/** Width relative to its authored band; height is a fraction of the 510-unit vessel. */
export interface GlassControlPoint { width: number; height: number }
export type GlassSide = Record<GlassBand, GlassControlPoint>;
/** Legacy widths stay intact; optional independent sides are a v0.6 extension. */
export interface GlassForm {
  lower: number; middle: number; upper: number; facets: number;
  sides?: { left: GlassSide; right: GlassSide };
}
export type MaterialKind = 'gravel' | 'clay' | 'soil' | 'coir' | 'bark' | 'charcoal';
export type PlantKind = 'cushion-moss' | 'sheet-moss' | 'star-moss' | 'fern-moss' | 'fern' | 'fittonia' | 'creeping-fig' | 'oxalis' | 'amber-mushroom' | 'ivory-mushroom' | 'scarlet-mushroom' | 'violet-mushroom';
export type DecorationKind = 'stone' | 'wood' | 'stump' | 'pavilion' | 'statue' | 'traveler' | 'cottage' | 'lantern' | 'steps' | 'path' | 'fairy' | 'gardener' | 'reader' | 'cat' | 'dog' | 'mushroom-house' | 'treehouse' | 'arc-lamp' | 'slender-steps' | 'sun' | 'moon' | 'star';
export type StoneVariant = 'boulder' | 'flat' | 'spire' | 'pebbles';
export type StumpVariant = 'upright' | 'fallen';
export type DecorationVariant = StoneVariant | StumpVariant;
export interface ObjectPose { angle: number; flipX: boolean }
export type WoodPresetKind = 'single' | 'fork' | 'double-fork' | 'branched';
export type Speed = 1 | 2 | 5 | 10;
export interface Layer { material: MaterialKind; depth: number }
/** 48 columns, each a bottom-to-top sequence of at most 112 material grains. */
export interface Terrain { columns: MaterialKind[][] }
/** Original 2D support surface: x is local 0..1, never a free-floating height. */
export interface SupportAttachment { parentId: string; x: number }
/** Original editable deadwood. Angles are clockwise degrees; branches are non-recursive. */
export interface WoodBranch { at: number; length: number; angle: number }
export interface WoodForm { length: number; angle: number; branches: WoodBranch[]; bend?: number; tone?: 'natural' | 'birch' | 'charred' }
/** Reversible surface mold and slow weathering never destroy constructed geometry. */
export interface ObjectCondition { wetness: number; decay: number; mold?: number }
/** Integer landscape water plus the consumed fraction of one grain; feeds the shared water budget. */
export interface Pond { depths: number[]; exchange?: number }
/** Optional v0.9 extension; old saves initialize gently on their next ecological step. */
export interface PlantEcology {
  drought: number; waterlogging: number; spread: number; cycle: number;
  generation: 0 | 1; parentId?: string; offspring?: number;
}
export interface SurfaceColonization { moss: number; health: number }
export interface Plant {
  id: string; kind: PlantKind; x: number; y: number; scale: number;
  growth: number; health: number; ageDays: number; wetness: number;
  support?: SupportAttachment;
  ecology?: PlantEcology;
}
export interface Decoration { id: string; kind: DecorationKind; x: number; y: number; scale: number; support?: SupportAttachment; wood?: WoodForm; condition?: ObjectCondition; variant?: DecorationVariant; pose?: ObjectPose; colonization?: SurfaceColonization }
export interface TerrariumState {
  schemaVersion: 2;
  name: string;
  bottle: BottleShape;
  glassForm?: GlassForm;
  terrain: Terrain;
  pond?: Pond;
  plants: Plant[];
  decorations: Decoration[];
  environment: { temperature: number; light: number };
  ecology: { moisture: number; humidity: number; waterReserve: number; simulatedDays: number };
  care: { sunlight: number };
  closed: boolean;
  speed: Speed;
  paused: boolean;
  vacation: boolean;
  createdAt: number;
  updatedAt: number;
  preferences: { widgetSize: 'small' | 'medium' | 'large'; alwaysOnTop: boolean; launchAtLogin: boolean; reducedMotion: boolean };
}
export type TerrariumAction =
  | { type: 'rename'; name: string }
  | { type: 'bottle'; shape: BottleShape }
  | { type: 'glass-form'; value: GlassForm }
  | { type: 'pour'; material: MaterialKind; x: number; amount: number }
  | { type: 'scoop'; x: number; amount: number; radius?: number }
  | { type: 'pour-water'; x: number; amount: number }
  | { type: 'drain-water'; x: number; amount: number; radius?: number }
  | { type: 'spray'; plantId: string | null; amount: number }
  | { type: 'spray-decoration'; decorationId: string; amount: number }
  | { type: 'sunlight' }
  | { type: 'add-plant'; kind: PlantKind; x: number; y: number; support?: SupportAttachment }
  | { type: 'move-plant'; id: string; x: number; y: number; support?: SupportAttachment | null }
  | { type: 'remove-plant'; id: string }
  | { type: 'resize-plant'; id: string; scale: number }
  | { type: 'add-decoration'; kind: DecorationKind; x: number; y: number; support?: SupportAttachment; woodPreset?: WoodPresetKind; variant?: DecorationVariant }
  | { type: 'move-decoration'; id: string; x: number; y: number; support?: SupportAttachment | null }
  | { type: 'remove-decoration'; id: string }
  | { type: 'resize-decoration'; id: string; scale: number }
  | { type: 'wood-form'; id: string; value: WoodForm }
  | { type: 'object-pose'; id: string; value: ObjectPose }
  | { type: 'water'; amount: number }
  | { type: 'lid'; closed: boolean }
  | { type: 'environment'; temperature: number; light: number }
  | { type: 'speed'; speed: Speed }
  | { type: 'pause'; paused: boolean }
  | { type: 'vacation'; enabled: boolean }
  | { type: 'preferences'; value: Partial<TerrariumState['preferences']> }
  | { type: 'starter' }
  | { type: 'reset' };
export interface Snapshot {
  state: TerrariumState;
  meta: { revision: number; version: string; platform: string; storageStatus: string; offlineHours: number };
}
export interface FileResult { ok: boolean; message: string }
export interface TerrariumBridge {
  getSnapshot(): Promise<Snapshot>;
  dispatch(action: TerrariumAction): Promise<Snapshot>;
  subscribe(listener: (snapshot: Snapshot) => void): () => void;
  openWorkshop(): void;
  hideWidget(): void;
  setWidgetPassthrough(ignore: boolean): void;
  moveWidget(dx: number, dy: number): void;
  finishInteraction(): Promise<Snapshot>;
  exportSave(): Promise<FileResult>;
  importSave(): Promise<FileResult>;
}
declare global { interface Window { terrarium: TerrariumBridge } }
