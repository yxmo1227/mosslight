# Mosslight 0.6.0 verification and release gates

This candidate prepares a Windows x64 ZIP and source ZIP for local trial, not upload or public release. This is a scope/checklist document, **not a completed verification report**. Prior releases and author self-checks do not establish independent or final-archive approval.

## Implementation contract

- Keep the warm paper Studio, transparent desktop and original Canvas 2D artwork. No copied reference assets, photorealism promise, runtime Three.js scene or unrestricted 3D modelling claim.
- Keep 48 terrain columns capped at 112 grains, with the existing 5-unit drawing height and exact bottom-to-top material order. Increase the UI pour dose to 16 and search for remaining capacity beyond the local neighborhood when it fills. Partial acceptance and no-room outcomes remain bounded and observable.
- Distinguish that reproducible local-full defect from the reported v0.5 maximum-61 stop, which remains unreproduced. Vessel rims clip visible height before the shared storage cap in some shapes. Do not report the historical symptom as conclusively fixed without matching evidence.
- Sculpted glass has lower/middle/upper controls on both sides, each editable in width and height. Support independent or linked sides, keyboard sliders and a genuine 5–16-sided opening. Preserve legacy three-width forms until edited; validate ordered height ranges and cancel uncommitted drafts safely.
- Add original Amber caps, Ivory bells and Little stump artwork. Support plants/objects on decoration surfaces, including moss on wood and stacked decoration chains. Validate decoration-only parents, IDs, no cycles and maximum six-level depth. Moves translate descendant fallbacks together; deleting a parent detaches immediate children without orphaning deeper surviving stacks.
- Add decorative pond water and drain tools. Store exactly 48 integer depths, bounded by soil plus water ≤112 per column. Level reachable basins deterministically, preserve inventory across terrain changes when capacity permits, and discard only unavoidable global overflow. Water is independent of ecological misting and does not gain magical growth effects; objects do not displace it physically.
- Click the desktop mister icon to arm without watering, then hold inside the bottle to spray. Release anywhere stops and disarms; Escape, cancellation, capture loss, blur/hidden state also stop the interaction. Retain icon-only controls, whole-glass care/right-click access, native body dragging, bounded single-flight actions and explicit save flushes.
- Keep strict schema 2 and old material quantities. Before first saving a pond field, support, new mushroom/stump, independent sides or new facet count, preserve compatible primary/backup original bytes in fixed exclusive `terrarium.before-v0.6-primary.json` / `terrarium.before-v0.6-backup.json` files. Never replace valid prior originals; fail closed before normal rotation when preservation fails. Do not label v0.6-feature files as pre-v0.3 or pre-v0.5 copies. Existing v1 and previous extension gates remain.

## Current-candidate checks

- [ ] Strict TypeScript, full regression suite and build. Record exact executed counts, source digest and failures; retain old safety assertions.
- [ ] Fixed-pointer terrain pouring beyond the local neighborhood, partial final doses, full global capacity, immutable previous stacks and no unbounded accumulation. Separately exercise the reported-height landscape in isolated data and report what was or was not reproduced.
- [ ] All seven vessel shapes, narrow/short/uneven near-rim terrain, six asymmetric handles, ordered height bands, optional linked editing, every polygon count, cancellation, rapid edits and save/reload. Inspect actual screenshots, not only numeric checks.
- [ ] Two distinct mushrooms, stump, stacked wood/stone/moss, terrain changes beneath parents, subtree movement near bounds, reattachment, parent removal and foreground/support/vessel clipping. Reject malformed, sparse, accessor, cross-kind, missing/self/cyclic and over-depth support data.
- [ ] Pond fills a valley, remains within its basin until a spill threshold, levels within discrete resolution, drains locally, redistributes after pour/scoop, survives reload and remains visible without plants. Test inventory conservation, global overflow, immutable inputs, worst-case finite relaxation and no ecological changes from decorative water.
- [ ] Exact pre-v0.6 primary/backup bytes, restart/repeated-save exclusivity, backup-only and mixed generations, invalid/oversized/incompatible preservation targets, paused overwrites and absence of misleading older restore points. Round-trip maximal valid state under the unchanged 256 KiB limit.
- [ ] Mister arming creates no dose; distinct hold starts visible mist; inside/outside release, cancel, capture loss, blur/hidden state, Escape and keyboard release stop/disarm without stale doses or cursors. Retain quick sunlight, transparent-body click-through geometry and direct right-click Studio behavior.
- [ ] Actual isolated Electron and packaged executable checks with state assertions, screenshots, page errors and lifecycle evidence. Verify startup instructions and complete-folder extraction without touching normal user saves.
- [ ] Independent review by someone other than each implementation's author, bound to the relevant core, storage, interaction and renderer source hashes. Record findings and resolutions, not only pass counts.

## Final-archive gates

Freeze code and documentation before final artifact creation. Later relevant changes invalidate a previous artifact binding. Keep final hashes/reports outside the source ZIP to avoid a circular archive edit.

- [ ] Extract the final `Mosslight-0.6.0-win-x64.zip` completely and launch its actual EXE in isolation. Record executable/app.asar/tree/archive hashes, version/icon, errors and signing status; disclose unsigned Windows builds.
- [ ] Verify runtime scene dependency graph excludes historical Three.js engine code while retaining the original Three MIT license for provenance. Compare packaged Electron/Chromium and application notices with their upstream/original bytes; inspect actual bundled inputs and no unexpected NSIS/elevate content.
- [ ] Verify source ZIP CRC, exact allowlist and SHA-256/size manifest. Exclude real saves, credentials, private paths, internal instructions, raw Foundry evidence, dependencies, compiled output and release directories.
- [ ] Reproduce from a clean source extraction with pinned-lockfile installation, complete checks, official Electron runtime preparation and isolated launch. Do not count the development directory or historical runs as this clean-source result.
- [ ] Bind independent archive security/license review, known limitations and local-trial scope to final hashes. Advisory scans do not establish universal safety or permission for every distribution route.
- [ ] Obtain explicit release approval for the exact artifact/evidence before creating a remote repository, uploading or publishing a Release. Local implementation and packaging are not public-release authority.

## Verification record

The planned report is `Mosslight-0.6.0-VERIFICATION.md` in the local `release/` output directory, delivered alongside artifacts and **not inside the source ZIP**. A planned name or checklist does not prove that the report exists or that checks passed.

The completed record must identify exact source/artifact digests, actual execution dates and test counts, screenshots, independent review scope, unresolved failures and untested conditions. No final-pass or public-release claim is made here.

## Separate device and release boundaries

Native cross-app click-through/focus, multiple displays/DPI, real window dragging, native file dialogs, physical sleep/lock and storage/power failures, and long-duration resource use require separate device evidence. Synthetic events are not physical OS verification. Canvas 2D does not remove all Electron/device variability.

macOS native builds/device checks/signing/notarization and remote CI are separate gates. An existing workflow is not proof that it ran. NSIS embedded-plugin obligations remain unresolved, so Setup installers are not cleared for distribution.

Keep SmartScreen, Gatekeeper and antivirus enabled. Do not remove quarantine or disable security controls to bypass warnings. Hashes prove consistency, not trustworthy origin. There is no public download channel or automatic updater in this scope.

See the [user guide](USER_GUIDE.md), [third-party notices](../THIRD_PARTY_NOTICES.md) and [MIT license](../LICENSE). Earlier release documents remain historical and unchanged.
