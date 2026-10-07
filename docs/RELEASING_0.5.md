# Mosslight 0.5.0 verification and release gates

This iteration prepares a Windows x64 ZIP and source ZIP for local trial, not upload or public release. This document defines scope and pending checks; it is **not a completed verification report**. Previous versions' results are historical and do not validate this candidate.

## Implementation contract

- Restore a warm paper-colored Studio. Use original, deliberately two-dimensional vessel, substrate and botanical illustration, including soft moss. The desktop companion remains transparent.
- The production scene uses Canvas 2D without a Three.js/WebGL runtime dependency. Historical 3D source, tests and development dependencies remain for provenance and regression history; they must not enter the production scene bundle. Retain the original Three.js license in the packaged license directory.
- Preserve seven vessels, six distinct materials, sculpted-glass controls and adjustable scoop sizes. Materials use coherent matte forms rather than shiny faceted noise. References guide style only; no third-party characters, photographs, models, textures or distinctive assets are copied.
- Increase bounded terrain from 48 × 40 to 48 × 112 grains. Keep the 5-unit grain height, original material order, independent copies, bounded operation doses and strict schema/IPC validation. Existing saves must not be rescaled.
- Retain the historical 40-grain conversion limit for schema-1 percentage layers. Schema-2 tall terrain is a compatibility extension: v0.4 and earlier cannot read columns above 40 grains.
- Before the first tall local save, preserve compatible primary/backup bytes in fixed `terrarium.before-v0.5-primary.json` / `terrarium.before-v0.5-backup.json` restore points. Never overwrite valid earlier restore points. Missing originals cannot have a copy; preservation failure must block normal save rotation. Keep the separate v1-original and before-v0.3 shape protections.
- Ground drawing, plant/decoration roots and interaction mapping use the same terrain surface. Foreground soil hides buried parts; the vessel outline/rim clips out-of-bounds artwork. These are illustration safeguards, not volumetric caves, physical collision, freeform modelling or a scientifically calibrated ecosystem.
- Keep English application controls while preserving stored multilingual names. Whole-glass left-click opens care icons; right-click opens the Studio directly; dragging the bottle moves it after a threshold. Hold the spray icon to begin misting, drag to aim, and release anywhere to finish without a second exit step.

## Current-candidate functional checks

- [ ] Strict TypeScript, complete regression suite and build. Record exact executed counts, source binding and failures; do not remove old safety tests or weaken assertions to obtain a pass.
- [ ] Actual production dependency graph excludes Three.js/WebGL renderer code. Verify the running Canvas 2D scene and final packaged bundle, not only a renamed diagnostic tag.
- [ ] Warm Studio, transparent desktop, soft six-material appearances, readable moss/foliage and visible sunlight/mist checked with screenshots on light and dark surroundings. Review screenshots, not only pixel counts or mock geometry.
- [ ] Pour above the former 40-grain ceiling toward the opening; confirm 112-grain saturation, partial-dose overflow, preserved bottom-to-top order and no infinite accumulation. Verify narrow/short vessels, edges and steep old valleys without folds, gaps or obvious rectangular columns.
- [ ] Plant and decoration roots remain aligned with the rendered ground after pour, scoop, shape change and drag. Verify foreground-soil occlusion, empty terrain and vessel/rim clipping at low, uneven and near-full heights.
- [ ] All seven shapes, lower/middle/upper sculpt handles and keyboard sliders, facet choices, scoop brushes, object placement/selection, care/time and save/reload continue working.
- [ ] Transparent glass areas accept left/right interaction. Hold-to-mist release, outside release, pointer cancel/capture loss, blur/hidden state and keyboard release end the tool without stale overlays or doses. Keep bounded single-in-flight actions and movement IPC protections.
- [ ] Old schema-2 stacks remain exactly unchanged on import/reload. Schema-1 high-depth migration matches historical output. Reject 113-grain, sparse, foreign-material and hostile imported data.
- [ ] Full 48 × 112 terrain with maximal plant/decoration counts fits the unchanged 256 KiB save cap and round-trips. Verify before-v0.5 original bytes, primary/backup-only cases, existing restore-point protection, fail-closed unsafe targets and no incorrect v0.2-compatible labelling of tall saves.
- [ ] Independent review of core/capacity, storage compatibility, rendering/geometry and security boundaries by reviewers other than each implementation's author. Author self-checks are not independent sign-off.
- [ ] Native isolated Electron and packaged executable checks, screenshots, page errors, saved-state outcomes and renderer/resource behavior are bound to the exact current source/candidate.

## Final-archive gates

Freeze source and documentation before producing candidates. Keep package hashes and verification reports outside the source ZIP, avoiding a circular archive-hash edit. Relevant later changes invalidate the earlier binding.

- [ ] Extract the final Windows ZIP completely and test its actual executable. Record EXE/app.asar/tree hashes, product/version/icon, errors and Authenticode status; disclose an unsigned build.
- [ ] Verify original application MIT, `licenses/Three-LICENSE.txt`, `licenses/Electron-LICENSE.txt`, `licenses/LICENSES.chromium.html` and any other applicable notices. Match upstream bytes and inspect actual bundled inputs. No unexpected NSIS/elevate content.
- [ ] Validate final source ZIP CRC, exact allowlist and size/SHA-256 manifest. Exclude user saves, private data, credentials, personal paths, internal briefs, raw evidence, dependencies and generated build/release directories.
- [ ] Clean-source extraction, official-registry `npm ci`, complete check, official runtime preparation and actual isolated launch. Do not inherit development dependencies or count historical results as a fresh run.
- [ ] Independent archive security/license review bound to final hashes, with limitations and local-trial scope clearly recorded. Advisory scanning does not establish that all software is safe or licensed for every distribution route.
- [ ] Explicit release approval bound to the exact candidate/evidence before any remote repository creation, upload or public Release. Ordinary implementation or preparation for open source is not publication authority.

## Verification record

The planned accompanying report is `Mosslight-0.5.0-VERIFICATION.md`, produced in the local `release/` output directory and delivered alongside the artifacts, **not inside the source ZIP**. Its existence or this checklist alone is not proof of success.

That report must identify the tested source revision/digest, final archive hashes, executed checks and dates, independent review scope, screenshots/evidence, unresolved failures and untested conditions. Consult it for the final result; no current-pass claim is made here.

## Uncovered unless separately evidenced

Native cross-application click-through/focus, real window dragging across multiple displays/DPI, native file dialogs and their cancellation/overwrite paths, physical sleep/lock, actual disk/permission/power failures and long-duration resource behavior require device testing. Synthetic events are not physical OS verification. Canvas 2D removes the scene's WebGL requirement, not all Electron/GPU/device variability.

macOS native build/device testing/signing/notarization and remote GitHub Actions remain separate gates. A configuration file is not a completed run. NSIS embedded-plugin obligations remain unresolved, so Setup installers are not cleared; this scope is the full Windows ZIP and source ZIP.

Keep SmartScreen, Gatekeeper and antivirus enabled. Do not remove quarantine or disable security controls to bypass warnings. Hashes establish consistency, not trustworthy origin.

See the [user guide](USER_GUIDE.md), [third-party notices](../THIRD_PARTY_NOTICES.md) and [MIT license](../LICENSE). Earlier release documents are historical and remain unchanged.
