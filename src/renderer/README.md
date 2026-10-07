# Renderer implementation — v0.9.0

`index.html`, `index.ts`, and `styles.css` provide an English Studio and the
`?mode=widget` transparent desktop companion. The Studio uses warm paper colors;
the living scene is an original Canvas 2D illustration with top/side faces and
layered overlap for a gentle 2.5D appearance, not a free-camera 3D model.
System fonts and program-drawn artwork require no remote assets or web fonts.

All persistent state comes from `window.terrarium`. Edits use validated bridge
actions; the renderer has no Node/file capability and does not run a separate
authoritative ecosystem. Snapshot ordering uses main's monotonic
`meta.revision`, not wall-clock timestamps. Drafts are protected during updates.
Names/messages are assigned using `textContent` or `value`, never imported HTML.
Without the bridge, desktop functionality is explicitly unavailable.

## Production drawing path

`scene.ts` wraps `CanvasTerrarium` from `scene-2d.ts`. The production scene uses
Canvas 2D for glass, terrain, plants, decorations and care/tool effects; it does
not initialize WebGL or import Three.js. The runtime renderer diagnostic is
`canvas2d`; screenshots and dependency inspection are still required to verify
the actual result.

`scene-2d-geometry.ts` defines seven original vessel contours and the shared
surface/root mapping. The terrain contract is 48 bottom-to-top material columns
with up to 112 grains per column, each still 5 logical drawing units high.
Surface interpolation and inward, ordered wall mapping allow old steep valleys
and new taller terrain without changing saved grain order or quantity. The
vessel rim clips visible height; the storage limit does not imply that all
vessels display the same volume.

The terrain composition fills coherent material regions with stable, low-contrast
patterns: fine soil, round clay pellets, irregular gravel, coir fibers, bark and
charcoal fragments. They are illustrations of column data, not independent
rigid bodies. `scene-botany.ts` draws original moss, fern, fittonia, two mushroom
varieties; `scene-object-art.ts` draws four stone shapes, two stump/log shapes and
seven small decorations. `scene-2d-wood.ts` supplies four distinct curved wood forms;
`tool-art.ts` draws original care tools and matte material jars.

Opaque footer pixels seat rigid objects and narrow plant roots on the terrain.
Rigid-body embedding remains capped at 24 scaled design pixels or 20% of body
height; a deep ravine can leave real overhang rather than swallowing the object.
`scene-2d-contact.ts` supplies actual footer and mushroom-stem contacts. A grounded
upright stump is redrawn as one continuous textured trunk down to those contacts,
not an old sprite with narrow rectangles appended. An attached stump remains a
rigid body without extensions to distant soil outside its parent's finite span.
This does not stretch caps or mutate terrain, ponds or saved object positions. Low-alpha shadows and
empty columns between branches are not bearing surfaces. Attached roots use a
decoration's sampled occupied support profile from `scene-2d-layout.ts`; moss
strips use a bounded smoothed drape field rather than a hard fork-shaped cut.
Decorations resolve parent-first. Root extensions
are merged into the cached sprite alpha so drawing, selection, mist targeting
and subsequent stacking share them. Foreground terrain and actual support
clipping hide buried sprite parts (soft attached moss is not hard-cut by a
parent's whole top profile), and the vessel outline clips content at its
walls and opening. This is not volumetric excavation, collision, structural
physics, freeform modelling or photographic rendering.

The faceted vessel has six independent width/height controls. Side widths are
40%–135%; lower/middle/upper heights stay within ordered bands. A link option
mirrors subsequent edits. The actual opening polygon has 5–16 sides. Optional
side fields are created by edits; old 55%–125% three-width state remains intact
until the corresponding control is changed.

Pond water is drawn from its 48 integer depths above the solid surface, clipped
at the vessel opening. It is distinct from solid material bands and remains
without plants. The core, not the renderer, settles basins and redistributes
water after terrain changes. Soil plus water is capped at 112 per column;
unavoidable global overflow is discarded, while decorations do not displace
water. The core also exchanges pond volume with the shared water budget;
the renderer only draws the supplied depths and never invents evaporation.

## Visible ecology

`scene-ecology.ts` interprets optional bounded ecology fields, with a fallback
for older saves. Sustained drought moves foliage toward warm yellow/ochre;
fern fronds arch downward and narrow, while fittonia stems droop and leaves
curl and shrink. Crowns retain their planted anchors. Recovery reverses the
rendered symptoms rather than deleting the user's plants. Waterlogging has a
separate wilt signal. Neither appearance nor quick mist effects advances the
authoritative ecological state.

Moss spread expands the local illustrated carpet up to 1.82 times its mature
initial width. Core-supplied object colonization adds increasing overlapping
seeded patches over houses, steps, rocks and deadwood. This coating is drawn
with `source-atop` on each final sprite, including a slope-extended stump, so
all painted coverage stays within existing alpha. It cannot create a floating
shelf across a fork opening or change support geometry.

Mushroom cycle state depicts developing pins, mature flushes, withering caps
and a resting remnant; generated colonies are ordinary core-provided plants,
not copies invented by drawing. Mushroom foot positions and dormant cap counts
share the same cycle state. Deadwood decay adds dark patches and mold adds
soft pale surface filaments, also alpha-masked and not structural destruction.
These original illustrations communicate a stylized model, not species-specific
scientific prediction or a safety indicator for a real terrarium.

Glass and terrain layers are cached separately. Botanical sprites are reused
until their kind, variant, wood form, whole-object pose or quantized
growth/health/wetness/condition, drought, waterlogging, spread, mushroom cycle or
surface colonization changes. Full-pose dynamic bounds and transformed
alpha drive drawing, picking, mist targeting and support sampling together.
Scale reuses the original art raster; a separate per-entity contact composite
is rebuilt when its surface fit changes. It replaces the previous contact
canvas rather than accumulating one for every pointer position. Sprite alpha
is read when art/contact is built and cached for subsequent object hit tests;
it must not be read from the GPU on every pointer move. Live entity removal and
`dispose()` release cached canvases. Care/tool effects use separate compositing
layers; idle scenes do not require continuous effects. Hidden/reduced-motion
behavior and sustained resource use still require explicit verification.

Historical `scene-3d*.ts` source/tests and pinned Three.js development dependencies
remain in the repository. Pure helpers with historical filenames may still be
reused; this does not mean the 3D engine runs. The production entry graph must
exclude `scene-3d.ts` and Three.js. The original Three license remains packaged
for provenance. See the main third-party notices.

## Desktop interaction

Whole-glass hit testing uses CPU vessel geometry, including clear-looking
interiors. It does not gate care actions on visual alpha. DOM exceptions keep
visible care controls interactive; transient sunlight/mist must not enlarge
the bottle's physical click-through region. Main uses
`setIgnoreMouseEvents(ignore, { forward: true })`. Renderer checks cannot by
themselves prove native cross-application click forwarding.

- Left-click anywhere on the bottle body to show transparent sun/spray artwork.
  Right-click the bottle opens the Studio directly, including during a held
  spray gesture. No intermediate management menu or three-dot drag handle remains.
- Drag the bottle itself after a small movement threshold. Screen-coordinate
  deltas are queued, coalesced and bounded before validated widget-only movement
  IPC; ordinary release drains the queue, cancellation/blur discards pending moves.
- Click the spray icon to arm the mister without dosing. A separate press/hold
  inside the bottle starts misting; dragging aims it and releasing anywhere
  stops and disarms the entire tool. Pointer cancel, capture loss, blur and
  hidden visibility also stop it. There is no widget put-down HUD. When the
  armed bottle canvas has focus, Space/Enter hold sprays from its default
  position; key release ends the tool. No global keyboard shortcut is installed.
- Sunlight triggers a visible temporary beam and the dedicated care action,
  without opening the Studio or permanently changing environment light.
- Workshop substrate, scoop, pond and drain tools remain selected between
  strokes and retain an exit control. The mister ends after a completed stroke.

## Studio and bounded actions

- `catalog-picker.ts` captures a palette pointer and previews a fixed-ID,
  renderer-only provisional object. Releasing inside commits, outside cancels.
  A catalog click only arms placement; a second completed canvas click places.
  Escape, cancellation, capture loss and blur discard provisional placement.
  Select and drag objects, or use the supported scene keyboard controls.
  Dropping near a decoration may attach it to that visible support; a highlighted
  landing target shows the candidate. The search allows up to 22 design pixels
  horizontally with a 42-pixel weighted distance, only over real occupied
  support columns inside the vessel. Empty fork gaps are not imaginary shelves.
  Dropping on
  ground explicitly detaches it. Core validation rejects missing parents,
  self/cyclic/cross-kind parents and chains above six levels. Parent moves
  translate descendant fallback coordinates together; removal detaches immediate
  children without orphaning surviving sub-stacks.
  Starter planting supplements missing kinds without resetting existing objects.
  Reset and import require confirmation; main revalidates all actions. Confirmed
  reset stores 48 independent empty columns, no pond/plants/decorations and keeps
  preferences. It does not reuse the first-ever profile's small starter base.
- `entity-editor.ts` exposes Size with preview/commit/cancel behavior and
  40%–200% scale for every family; wood additionally has ±15° turn and horizontal
  flip buttons. `pose` transforms the entire sprite after its authored form,
  including legacy wood, without rewriting branches. The expandable palettes
  offer four wood forms, four stone variants and two stump variants, plus seven
  decoration tiles. Preview and one `add-decoration` carry the same validated
  variant or `woodPreset`. Main saves the complete `wood` form atomically, with
  an optional bounded `bend`, not a persisted preset ID. Opening a group or
  selecting a card cannot silently create or convert an object. Old/custom wood
  retains its form when selected or resized. The bounded `wood-form` core action
  remains for compatible imports/tests, not as a primary UI. Shared
  `scene-2d-wood.ts` paths drive raster bounds and support geometry; children
  retain their own sizes and follow their parent.
- Select a material jar, hold inside the bottle and move to pour. Each accepted
  pour adds at most 16 grains per 125 ms stroke tick. Existing bottom-to-top order
  is preserved; after nearby columns fill, a bounded fallback finds room farther
  away. The shared cap remains 48 × 112. A no-accepted-dose status explains full
  terrain, not every perceived visual plateau. The separately reported v0.5
  maximum-61 stop remains unreproduced. There are no soil-percentage sliders or
  authoritative renderer-only terrain copies.
- Scoop uses a bounded 24-grain dose and radius 2/4/7 column-unit choices.
  The preview follows the scene mapping; removal affects top material in the
  local brush area, not distant terrain.
- Pond pouring requests 16 water units per tick; draining requests 24 within
  the retained brush radius. Core basin leveling is deterministic and bounded,
  separate from ecology. No-accepted-change status distinguishes full water
  capacity or an empty drain area. This is not fluid dynamics.
- The spray stroke sends a bounded 0.012 dose per accepted 125 ms tick. Targeting
  checks a direct visible plant or decoration, then bounded downward mist-cone samples. It
  sends at most one target ID, or null for untargeted ground; it is not fluid
  simulation or a multi-plant dosing multiplier.
- `stroke-controller.ts` permits at most one pending dose. Release/cancel stops
  new doses, and its generation guard rejects stale queued work. After accepted
  work settles, `finishInteraction()` requests a main-process save flush.
- Sculpt handles/sliders preview locally, then commit one validated `glass-form`
  action. Escape, cancellation, capture loss, blur or tool/tab changes revert an
  uncommitted edit. Pending accepted edits preserve their latest intended form.
- Environment, ecology and health/wetness values stay bounded by main's shared
  contract. Renderer appearance does not change time progression or save schema.

## Verification

Focused tests cover geometry/root mapping, terrain order/capacity, botanical
drawing, tool art, mist targeting, stroke cancellation and action queues.
Canvas mocks establish geometry/state invariants, not visual correctness.

`node src/renderer/verify.mjs` uses an ephemeral network-blocked Chromium fixture
and the real core reducer, without normal browser profiles or user saves.
Regression expectations must identify Canvas 2D honestly, retain existing safety
coverage, and cover seven shapes, three widget sizes, tall terrain, care gesture
lifecycle, six-handle sculpting, polygons, ponds, support stacks, planting and
foreground occlusion. Record the actual
current results and screenshots; this document is not a claim that every flow
has passed. Synthetic cancel/blur events are not native OS evidence.

Native Electron IPC, tray behavior, real cross-app click-through/focus, multiple
displays/DPI, physical sleep/lock, native filesystem dialogs and packaged launch
need separate isolated integration checks. See
[the v0.8 checklist and verification record](../../docs/RELEASING_0.8.md#verification-record).
