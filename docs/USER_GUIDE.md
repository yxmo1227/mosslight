# Mosslight v0.10.1 user guide

This guide describes Mosslight v0.10.1: compact illustrated category buttons for the expanded warm collection, with free-floating fairy and sky ornaments, ecological succession, reversible wilt, fungal cycles and a shared water budget. The desktop bottle stays transparent. See the [release scope and known limits](PUBLIC_RELEASE.md); final archive hashes belong to the live GitHub Release.

## Open the new version

Download the complete Windows ZIP from the repository's GitHub Releases when available. Quit the old app through the tray's **Save and quit** command first. Fully extract `Mosslight-0.10.1-win-x64.zip`, then double-click `Mosslight.exe` inside the extracted folder. Do not run inside the ZIP or copy just the EXE. The app includes its runtime and has no automatic updater.

Your existing forest normally continues from the local save directory. If the bottle is hidden, use the tray's **Show / find terrarium** command. Closing the Studio does not quit the companion; use the tray to quit and save.

Plant collection and Decorations now use small illustrated icon-and-name category buttons, just like Found objects. Click a category to expand or collapse its styles. Drag a style into the bottle, or pick it with a click and then choose a location, as before. This visual-only update does not change the save format or ecological simulation.

## Your desktop bottle

- **Left-click the bottle** to show the two transparent care icons: sunlight and spray.
- **Right-click the bottle** to open the Studio directly. There is no intermediate management menu.
- **Drag the bottle itself** to move it. A small movement threshold separates dragging from a click; there is no three-dot drag handle.
- Click the sunlight icon for a visible, temporary beam and warm care feedback. This does not permanently change the environment light setting.

### Pick up, spray, release

Click the **spray icon** to pick up the mister; this click does not spray. Move it over the bottle, then press and hold the left button to mist. While still holding, move across the plants to aim. Release anywhere to stop and put the mister away automatically. To spray again, pick it up again. No separate “put down” click is required; Escape cancels an armed tool.

After picking up the mister, when the bottle canvas has keyboard focus, hold Space or Enter to spray from the default plant-directed position; release ends the tool. The desktop companion normally avoids taking keyboard focus, so pointer controls remain the primary path.

Spraying applies bounded doses and targets at most one visible plant or found object per dose. Wetness and growth feedback have limits; repeated watering does not create unlimited growth. Wood and stone darken briefly; sustained dampness can weather wood and produce soft mold. Pointer cancellation, capture loss, blur or hiding must also stop the gesture. This is not a fluid or real irrigation simulation.

## Build a little landscape

Open the Studio and use **Build** to choose a vessel, substrate and plants. **Care**, **Time** and **Settings** hold the other controls.

### Containers

Seven vessel types remain available: round, square-shouldered, cylindrical, open cylinder, open cube, adjustable faceted glass and cat-ear glass. Open vessels have no lid. Changing a shape does not create a separate save or erase your planting.

Choose **Sculpted glass** to reveal six handles: lower, middle and upper on each side. Drag each handle in/out and up/down to make an asymmetric silhouette. **Editing side** selects the slider controls; **Link both sides** mirrors subsequent edits. Choose **Polygon sides** from 5 to 16 to change the opening.

Widths are bounded to 40%–135%; each height stays within its ordered lower, middle or upper band. A completed edit is saved; Escape or cancellation restores the last committed form. Switching to another vessel and back retains committed shaping parameters. Old three-width saves remain unchanged until edited. This is bounded contour shaping, not arbitrary vertex modelling.

### Pour substrate

Choose one of the six materials: soil, clay pellets, gravel, coconut coir, bark or horticultural charcoal. Their visual forms differ: fine particles, rounded pellets, irregular stones, fibers, flakes and dark fragments. Names are game material categories, not real planting recipes.

Hold inside the bottle to pour and move the pointer to spread the landing position. New material settles toward nearby lower areas while existing material order is preserved. Pouring is faster than in v0.5. Once the nearby columns fill, new material searches for remaining room farther away instead of silently discarding the whole dose. Release to stop; moving across the ground still gives you control over broad bases and hills.

The authoritative terrain has 48 columns with up to 112 material units each, unchanged from v0.5. Old soil is not resized or multiplied. The illustration is clipped to the vessel and its rim; a shorter vessel may stop showing extra height before the storage cap. A status message explains when no new material can be accepted. Visible particles are illustrations of that state, not individually simulated rigid bodies.

### Scoop a valley

Choose the scoop and a small, medium or large brush. The preview shows its working area. Hold and move over the terrain to remove patches of surface material; release to stop. Larger brushes suit broad valleys, smaller brushes suit local refinements.

Only top material is removed. Distant terrain is not automatically flattened. You can create hills and valleys, not true volumetric caves, hanging ceilings or overhang physics.

### Add a pond

Scoop a valley, select **Pond water**, then hold inside the bottle to fill it. Water levels within reachable basins and can spill across a lower dividing ridge once the water reaches it. Select **Drain water** and hold near water to remove it. Release stops pouring/draining; use **Put tool down** to leave the landscape tool.

Pond water is stored separately from solid materials and remains visible without plants. Changing the terrain redistributes water while preserving its amount if room remains; a completely full landscape can force overflow out. The shared soil-plus-water limit is 112 units per column. Stones, wood and stumps do not physically displace it. Pond water now supplies the shared soil-water budget and evaporates over time. Sealed bottles recycle moisture; open bottles lose it. More water is not always better: saturation stresses plants.

### Plants and decorations

Hold the left button on a right-hand catalog card, drag into the glass, and release on soil or another object's surface. A preview appears before placement. Releasing outside, Escape, or an interrupted drag cancels without adding anything. Clicking a card alone does not add: it arms placement, then a completed click inside the glass places it. Keyboard users can activate a card and press Enter/Space on the focused canvas to place near the centre, then use arrow keys to adjust.

Select a placed plant, mushroom, stone, stump or branch to open **Make it your own** at the top of the sidebar. **Size** ranges from 40% to 200%; other attached objects keep their own sizes and follow the updated support. **Done** deselects. Edits preview while moving a slider and save when released; Escape cancels the current draft.

In **Found objects**, click **Driftwood** to reveal **Curved twig**, **Forked branch**, **Silver birch**, and **Weathered cedar**. The first two keep their familiar forms; the latter two are a pale straight branch and a dark angular upright branch, with different twigs and colors. Drag a form into the glass; opening the group never adds an object. After placing, select it and use the turn-left/turn-right buttons (15° each), horizontal flip, and **Size**. These change the whole object without rewriting its authored/custom shape. There is no branch-angle form or enable-editing step.

Expand **Stones** for Round boulder, Flat ledge, Standing stone and River pebbles; expand the stump group for Woodland stump and Fallen log. Grounded upright stumps have one continuous textured trunk down to their footing, including in a pond. A stump attached to another object does not extend skinny posts through it to faraway soil. Individual mushroom stems reach their local surface; moss keeps a smooth soft canopy across forks. Rigid objects can still overhang a valley. This is illustrated surface fitting, not gravity or structural physics, and never adds hidden soil or water.

Open each **Decorations** category to choose a style: **Little companions** has traveler, fairy, gardener, reader, cat and dog; **Houses & pavilion** has pavilion, forest cottage, mushroom cottage and woodland cabin; **Garden lights** has lantern and curved arc lamp; **Stone steps** has broad garden steps and a slender stairway; **Statue & sky** has guardian, sun, crescent moon and star. Crossing path no longer appears in the palette, but paths already saved in your bottle remain. These are original warm illustrations, not freely orbitable 3D models.

**Fairy, sun, moon and star float freely.** Drag one into open space inside the glass, then drag it again or use arrow keys to reposition it vertically or horizontally. Size works as usual. It does not snap to wood or soil, cannot support other objects, and is not colonized by moss. Soil edits do not move its saved anchor. If you reshape the vessel, its displayed anchor is clamped inside the new glass. Floating ornaments sit in a foreground layer over soil and water, so they remain visible and selectable wherever you place them; the glass still clips their edges. The sun ornament is decorative, not the sunlight care control.

Expand **Moss** for Cushion, Sheet, Star and Feather moss; **Greenery** for Miniature fern, Fittonia, Creeping fig and Woodland oxalis; **Mushrooms** for Amber caps, Ivory bells, Scarlet bonnets and Violet cups. Each collection has four original illustrated varieties. Moss can visibly expand and gradually coat suitable nearby object surfaces. Established mushrooms can produce new nearby clusters and cycle through fruiting and rest; caps need not remain visible permanently. This is bounded, playful ecology, not real species cultivation advice.

Drag near an existing object's surface to attach to it. A highlighted landing surface indicates the snap target; you do not need to hit an exact pixel. The nearest real occupied surface is selected within a bounded distance, not empty space between branches. Moss can sit on wood, and wood on stone. Moving, turning or resizing a parent updates its attached descendants while keeping their own sizes. Drag a child back to the ground to detach it. Removing a parent detaches immediate children; surviving sub-stacks stay connected. Support chains are limited to six levels and cannot form cycles.

Foreground soil hides buried parts, and the vessel outline clips objects that extend outside the glass or opening. This is a visual safeguard, not collision simulation. Starter planting fills missing example items without resetting your forest.

In Settings, **Reset** asks before changing anything. **Cancel** or Escape keeps your arrangement. **Empty bottle** removes all soil, water, plants and objects and resets care settings, but preserves preferences. The empty bottle is saved and stays empty on reopening. Export a backup first: there is no undo. The first-ever new profile still has the small initial base; confirmed Reset does not recreate that base.

## Care and time

The Care tab provides the environment and applicable lid controls. Temporary sunlight is separate from the permanent light setting. The ecology is an approximation for play, not professional growing advice.

While running and unpaused, ecological time defaults to real time `24×`. Time controls `1× / 2× / 5× / 10×` therefore mean `24× / 48× / 120× / 240×`. Offline uses real time `1×`; pause stops ecological progression. Lock/sleep is designed to use `1×`, but physical system behavior needs separate testing.

Vacation mode reduces growth/water-loss pressure; it does not promise permanent plant health. Do not change the system clock to experiment with care.

Dry soil or sustained excessive light makes greenery visibly yellow, curled and shrunken. Long-lasting saturation produces a different stressed appearance and can darken/mold wood. Authored plants remain dormant rather than permanently dying; appropriate care allows gradual recovery. New colonies have finite limits to keep the desktop responsive. See [Ecology](ECOLOGY.md) for mechanisms, evidence and intentional simplifications.

## Save, export and move computers

New v0.10 kinds and optional wood colors cannot be opened in v0.9 or earlier. Before the first new-feature save, compatible primary/backup originals are copied once to `terrarium.before-v0.10-primary.json` and `terrarium.before-v0.10-backup.json`. These are recovery points, not continuously updated copies. Failed preservation pauses autosave; export first.

The application saves locally without an account or cloud sync. On Windows, data normally resides in `%APPDATA%\Mosslight`; system configuration can change the path. The primary file is `terrarium.json`, the previous valid backup is `terrarium.backup.json`, and window placement is `window.json`.

Export JSON from Settings before updating, moving computers or downgrading. Copying the application folder does not copy its save directory. Do not edit save files while the app is running.

Exports are not promised to be encrypted. Check names, layouts, preferences and timestamps before sharing. Imports are size-, version-, structure- and checksum-checked, never executed. Local machine preferences remain, and imported files do not receive offline catch-up. Import confirmation preserves a separate copy of the current forest; cancellation does not replace it.

The interface is English. New forests use “My Little Forest”; your existing or imported names can remain in any supported language and are not silently rewritten.

## Upgrades and downgrades

v0.9 adds optional lifecycle, colonization, mold and pond-exchange fields that v0.8 cannot read. Available compatible originals are preserved before the first extended write as `terrarium.before-v0.9-primary.json` and `terrarium.before-v0.9-backup.json`. Existing geometry and authored identities remain. Do not reopen an upgraded save in an old app; export first and use a compatible recovery copy if downgrading.

v0.8 accepts earlier saves but adds decoration kinds, stone/stump variants, wood direction (`pose`) and curved forms (`bend`) that v0.7.1 and earlier cannot read. Before first saving them, available compatible original files are preserved as `terrarium.before-v0.8-primary.json` and `terrarium.before-v0.8-backup.json`. Damaged/incompatible preservation targets block overwrite. Existing shapes are not converted on selection or size changes. Empty reset alone does not introduce a v0.8-only field.

The earlier v0.7 gate remains: optional wood-shape and object-condition fields cannot be read by v0.6. Before first saving these fields, compatible originals are preserved once as `terrarium.before-v0.7-primary.json` and `terrarium.before-v0.7-backup.json`. All these copies are first-extension recovery points, not continuously updated downgrade saves. Export before upgrading. Never run old and new versions against the same save concurrently.

v0.6 retains schema 2 and accepts earlier data without changing old soil quantities or material order. The older `glass-box` state uses the current faceted vessel appearance while retaining its ecology and saved widths.

**A pond field, support attachment, new mushroom, stump, independent glass sides or a new polygon count makes the save unreadable by v0.5 and earlier.** Before first saving these features locally, compatible originals are preserved as:

- `terrarium.before-v0.6-primary.json`
- `terrarium.before-v0.6-backup.json`

The gate also recognizes an empty pond field. Removing visible water or switching vessels is not a guarantee that all incompatible fields disappear. Compatible originals may include tall v0.5 terrain; files already containing v0.6 features cannot be used as downgrade copies.

**Once any column exceeds 40 grains, that save is unreadable by v0.4 or earlier.** Before the first taller local save, existing compatible primary and backup files are preserved as:

- `terrarium.before-v0.5-primary.json`
- `terrarium.before-v0.5-backup.json`

These fixed-name copies retain the first compatible originals; later autosaves do not replace them. If an original was absent or already taller than 40 grains, no compatible copy can be created from it. Failure to preserve or validate a required copy pauses normal autosaving rather than overwriting the original. Export an additional backup yourself before upgrading.

The `cat` vessel and `glassForm` shaping fields added in v0.3 cannot be read by the old v0.2 app. Switching back to a common vessel may still retain shaping fields, so do not let the old app overwrite newer data.

The separate shape-compatibility protection remains. Before first writing a shape-extended state locally, existing v0.2-compatible primary/backup originals are preserved as:

- `terrarium.before-v0.3-primary.json`
- `terrarium.before-v0.3-backup.json`

An existing valid preservation file is not overwritten by later autosaves. Taller terrain is not considered v0.2-compatible; v0.6-feature files cannot become pre-v0.3 or pre-v0.5 restore points. A file that never existed cannot have an original backup. All three sets are first-extension restore points, not the latest state or a complete history.

v0.1 imports still validate the original checksum and strict structure before approximate layer migration. This conversion keeps its original maximum of 40 grains; increasing the new capacity does not reinterpret legacy layers. Local originals are preserved as `terrarium.v1-original-…json` before overwrite. The application does not rewrite an external file simply because you imported it.

Before downgrading, quit the app, export and preserve all current data, and choose a compatible old restore point. Ask the maintainer if unsure. Never run two versions against the same data directory or delete recovery copies to bypass protection.

## If something goes wrong

- **Autosave is paused:** the original could not be preserved safely. Export the current forest to a writable location, retain original files, check disk space/permissions, then restart. Exporting alone does not clear the protection within that session.
- **A damaged save:** the application attempts recovery from a valid backup while preserving originals. A new or empty forest is not permission to delete old data.
- **A missing bottle:** use the tray's show/restore or Studio command.
- **Blank or unavailable graphics:** preserve your save, quit and report the device/system and error. The production scene uses Canvas 2D, not WebGL, but Electron/device/scaling problems can still require investigation.
- **An OS security warning:** stop and verify origin/hashes. Do not disable SmartScreen, Gatekeeper or antivirus, or remove quarantine to bypass checks.

The warm illustrated style is deliberate. No photographic-realism, unrestricted modelling, full particle/fluid physics or scientifically accurate ecology guarantee is made. Native OS drag/click-through/focus, multiple screens/DPI, file dialogs, physical power/storage failures and long-duration resource use need device testing. macOS native validation/signing/notarization remain separate; NSIS installers are not cleared for distribution.

See [README](../README.md), the [release scope and known limits](PUBLIC_RELEASE.md) and the [security policy](../SECURITY.md).
