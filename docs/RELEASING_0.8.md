# v0.8.0 local trial checklist

Local release preparation only. No remote repository, upload or public release is authorized. Package with `--publish never`; preserve prior verified releases and normal saves.

## Scope

- Four independently curved wood forms; whole-object 15° rotation and horizontal flip, preserving authored and legacy forms.
- Four stone variants, two stump/log variants and seven original illustrated decorations, with drag previews and atomic placement.
- Forgiving real-surface snapping, target feedback, consistent transformed drawing/hit/mist/support geometry.
- Continuous textured grounded stumps, no distant-soil posts under attached stumps, smooth moss canopy around forks.
- Confirmed reset removes all terrain, water, plants and objects, preserving preferences; cancel/Escape remain non-mutating.

## Required evidence

- Strict TypeScript, full core/desktop/renderer and main/storage boundary suites.
- Reject malformed variants, poses and bends without partial saves. Preserve exact compatible originals before first v0.8-only save; fail closed if preservation cannot be validated.
- Distinct art, actual palette placement, rotation/flip, size endpoints, legacy shape preservation and restart persistence.
- Steep pond/stump and fork/moss screenshots, not just alpha footer assertions. Test transformed support, hit and mist geometry, snap tolerance and child following.
- Reset cancellation, confirmation, empty save and empty normal reopening in isolated profiles.
- Final Windows ZIP extraction, icon/version/licenses/source-byte binding, source manifest, clean-source install/check/smoke.
- Independent QA and security/license review bound to the final candidate. Relevant changes invalidate prior results.

## Compatibility

Schema remains 2 with strict optional extensions. New decoration kinds, `variant`, `pose` and `wood.bend` are unreadable by v0.7.1. Compatible original primary/backup bytes are preserved once in `terrarium.before-v0.8-primary.json` / `terrarium.before-v0.8-backup.json`; failures block overwrite. Earlier compatibility gates remain and must not mislabel newer files as older-compatible. Export before upgrades; never run two versions against one normal save.

## Verification record

The delivery includes `Mosslight-0.8.0-VERIFICATION.md` beside its archives, with actual outcomes, hashes and exclusions. This source checklist is not a claim of PASS in advance.

## Limits

Original Canvas 2D with illustrated top/side faces: no WebGL, free camera, rigid-body physics or structural simulation. Real overhang is allowed, vessel walls clip content, water does not displace objects. Existing terrain capacity, scale, object count and support-depth limits remain. First-ever profile creation retains its small initial base; confirmed Reset is empty.

Windows is unsigned. Do not bypass SmartScreen or antivirus. Native cross-app forwarding/focus, multiple monitors/DPI, physical power/storage failures and long-running device performance need separate testing. macOS is not verified/notarized. NSIS distribution is not approved. No public upload is performed.
