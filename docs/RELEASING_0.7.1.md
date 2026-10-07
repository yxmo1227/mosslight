# v0.7.1 local trial checklist

This is local release preparation, not permission to publish, upload or create a remote repository. Package with `--publish never`; preserve earlier verified releases and normal user saves.

## Scope

- Four original driftwood presets under an expandable Found objects group, with matching drag preview and one atomic placement action.
- Size-only selected-object editing from 40% to 200%; existing/custom wood geometry remains unchanged when selecting or resizing.
- Stump base and individual mushroom-stem contact with actual terrain/support; no hidden soil, pond or save modifications to disguise gaps.
- Shared visible geometry for drawing, pointer selection, mist targeting and stacking; finite actual support spans, bounded caches.

## Required evidence

- Strict TypeScript, full core/desktop/renderer tests, main/storage boundary tests; malformed preset inputs rejected and exactly one complete placement saved.
- Actual palette expansion, four distinct forms, direct captured-pointer dragging, outside/Escape cancellation, Size preview/commit/cancel and normal restart persistence.
- Independent steep-slope fixture checking every stem footer and stump underside, not merely one contact point per object. Preserve the reproduction of the old failure.
- Attached stone/stump/wood/moss/mushroom stacks at scale endpoints, with hit and spray geometry matching the displayed art.
- Current renderer checks and isolated Electron tests using disposable profiles; never normal user saves.
- Final Windows ZIP inspection/extraction, product version/icon/license contents, exact archive hashes, allowlisted source manifest and clean-source installation/check/smoke.
- Independent security/license and final-candidate review. Relevant changes invalidate the associated verification.

## Compatibility

Schema 2 and the v0.7 saved-state contract remain. A preset identifier is an input command only; its validated existing `wood` form is saved atomically. Old/custom forms are not silently converted. Existing pre-v0.7 preservation gates still protect compatible v0.6 originals before first writing wood/condition fields. Export a backup before upgrades and never run two versions against one save directory.

## Verification record

The local delivery includes `Mosslight-0.7.1-VERIFICATION.md` next to its archives. That record contains actual outcomes, hashes and exclusions after verification. This checklist does not assert PASS in advance.

## Limits

Surface fitting is a warm 2D illustration, not gravity, structural/load physics, arbitrary branch modelling or a biological prediction. Root/stem artwork can extend to the terrain while caps and main bodies retain their shape. Rigid branch/stone overhang can remain where physically plausible. Existing material capacity, vessel clipping, object limits and support-depth limits remain.

Windows is unsigned. Do not bypass SmartScreen or antivirus. OS click-through/focus, multi-monitor/DPI, physical sleep/power/storage failures and long-duration device behavior need separate testing. macOS is not verified or notarized. NSIS distribution is not approved. No public upload is performed by this iteration.
