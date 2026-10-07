# Mosslight 0.4.0 verification and release gates

This iteration prepares a Windows x64 ZIP and source ZIP for local trial, not upload or public release. This is a scope/checklist document, **not a report that every check passed**. Actual test counts, environment, candidate hashes, visual evidence and exclusions belong in the accompanying version-specific verification record. Previous versions' results are historical.

## Implementation contract

- English application text, controls, errors, accessibility labels and new-forest default name. Existing/imported names are user data, not translation targets. Native operating-system chrome may follow the OS language.
- Left-click the glass/body for transparent sunlight and spray icons. Right-click opens the Studio directly. Drag the bottle itself after a movement threshold; no separate three-dot handle or intermediate management menu.
- Press and hold the spray icon, move the held sprayer to aim, release anywhere to end the gesture and tool. No separate widget “put down” step. Keyboard press/release follows the same lifecycle when focused.
- Visible temporary sunlight feedback and a cohesive dark natural-art presentation. No claim of photographic realism or support on every GPU.
- Keep seven vessel types, six materials, bounded faceted widths/facets, scoop sizes, terrain order/capacity, care/time behavior, saves/import/export and clipping limitations. Rendering remains a bounded local visual representation, not independent particle/fluid/cave physics.
- Retain schema 2 and v0.3 shape extensions. Preserve strict v1 migration, before-v0.3 recovery copies and fail-closed overwrite protection. Localization must not change preservation paths, checksum/schema rules or stored names.

## Current-candidate functional checks

- [ ] Strict type checking, focused translation/name-preservation tests, complete regression suite and build. Report actual executed counts; do not weaken assertions to pass.
- [ ] English text across Studio, tray, dialogs, errors, accessibility descriptions, tool messages and loading/unavailable states. Check packaged code, not only static HTML. Preserve multilingual imported/saved names.
- [ ] Whole-bottle interaction, including transparent-looking glass regions: left-click, right-click direct Studio, movement threshold, drag without accidental care clicks, and no hidden stale management path.
- [ ] Spray icon pointer down/move/up/cancel/capture loss/blur/hidden lifecycle. No pending dose after cancellation, no stale cursor/overlay, no invisible click-blocking UI and no need for a second release action. Keyboard behavior must not introduce global shortcuts.
- [ ] Sunlight creates visible bounded feedback, fades normally, honors reduced-motion intent and does not permanently rewrite environmental light.
- [ ] Existing pouring, scoop sizes, shaping, material order, plant placement and storage/restart behavior remain correct with the new layout and input handling.
- [ ] Actual render path, transparent desktop composition, scene readability and dark Studio contrast verified with screenshots and matching state. Do not infer visual success from a renderer tag alone.
- [ ] Independent review of the translation-owned core/storage delta by someone other than its author; implementation self-checks are not independent security sign-off.
- [ ] Independent scoped review of new native movement/IPC boundaries and renderer changes; verify bounded values, trusted sender checks, no remote content, no Node capability in the renderer and resource cleanup.

## Final-archive gates

Freeze source and documentation before creating candidates. Package hashes and later archive verification stay outside the source ZIP, rather than changing the source archive to insert its own hash. Relevant later changes invalidate the earlier candidate binding.

- [ ] Final Windows ZIP fully extracted and tested using its actual executable; bind EXE/app.asar/tree hashes, page errors, screenshots and saved-state results. A development build is not the delivered package.
- [ ] Verify actual product/version/icon and Authenticode status. Clearly disclose an unsigned build.
- [ ] Original application MIT, Three-LICENSE.txt, Electron-LICENSE.txt, LICENSES.chromium.html and all applicable notices exist in the delivered package and match upstream bytes. No unexpected NSIS/elevate content.
- [ ] Final source ZIP CRC, exact allowlist, manifest sizes/hashes and extraction match the frozen source. No private data, credentials, personal paths, real saves, internal briefs, raw evidence, dependencies or generated release/build folders.
- [ ] Clean source extraction into a new directory, official-registry npm ci, check, runtime preparation and actual launch. Do not inherit a developer machine's installed dependencies or old test results.
- [ ] Independent archive security/license review, matching final hashes, explicit uncovered items and local-trial scope. Current advisory scanning does not prove all software safe or clear license obligations.
- [ ] Explicit release approval bound to the exact candidate/evidence before any external repository creation, upload or publication. Ordinary implementation or “prepare for open source” is not upload authority.

## Uncovered unless separately evidenced

Native OS drag/click-through/focus, multiple monitors/DPI, native file dialogs and cancellation/overwrite confirmation, physical sleep/lock, real disk/permission/power failures, varied GPU/driver support and long-running resource behavior need device-specific checks. Synthetic event injection is not physical OS verification.

macOS native build/device/signing/notarization and remote GitHub Actions are separate gates. An existing workflow or configuration is not a passed run.

Only the full Windows ZIP and source ZIP are prepared here. NSIS embedded-plugin obligations remain unresolved, so Setup installers are not cleared. Keep SmartScreen, Gatekeeper and antivirus enabled; hashes verify consistency, not trustworthy origin.

See [user guide](USER_GUIDE.md), [third-party notices](../THIRD_PARTY_NOTICES.md) and [MIT license](../LICENSE). Third-party terms and reference-brand rights are not replaced by the project's MIT license.
