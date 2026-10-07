# Mosslight 0.10.0 — expanded collections

Local trial preparation only. No public upload, deployment or signed distribution is authorized by this document. Windows x64 is the tested target; macOS packaging and native behavior need separate verification on a Mac.

## Scope

- Four mosses, four greenery varieties, four mushroom varieties in expandable collections.
- Six companions, four buildings, two lights, two stairways, and guardian/sun/moon/star ornaments.
- Free-floating fairy and celestial anchors, independent of terrain or structural supports.
- Two new wood silhouettes and tones; the accepted first two presets are unchanged.
- Legacy Crossing path removed only from the palette; old placed paths and saved wood forms retained.
- Strict new-kind/tone validation, v0.10 first-extension preservation, existing v0.9 ecology retained.

## Verification record

The adjacent delivery record `Mosslight-0.10.0-VERIFICATION.md` records checks actually completed against the final source and Windows archives, hashes and remaining limitations. Until that record says PASS, this is an unverified candidate. Historical v0.9 test totals do not certify v0.10.

Required checks: strict TypeScript, unit tests, security/storage boundaries, actual renderer gestures, independent catalog/floating QA, legacy save compatibility, built executable smoke, ZIP manifest and license verification, clean-source build. Test with isolated `mosslight-test-*` profiles; never advance or overwrite the user's forest to prove behavior.

## Save safety

The schema remains 2 with additive kinds and optional wood `tone`. Old versions reject these additions. Existing v0.9 content is unchanged unless the user selects new content. Before first writing a v0.10 extension, preserve exact compatible originals as `terrarium.before-v0.10-primary.json` and `terrarium.before-v0.10-backup.json`; never overwrite an earlier preservation copy. Invalid preservation targets block autosave.

## Intentional limits

At most 24 plants and 20 objects per bottle; catalog size is not placement capacity. Airborne ornaments are decorative, not organisms or light sources. Drawings are warm 2D/2.5D illustrations and clipped by the glass/foreground, not rigid-body models. Existing ecological rules remain dimensionless, accelerated and bounded, not species-calibrated science. The local Windows ZIP is unsigned; no automatic updater or public download has been configured.
