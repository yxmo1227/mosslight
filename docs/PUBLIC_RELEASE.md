# Mosslight v0.10.1 release scope

The first GitHub release is prepared from the accepted v0.10.1 desktop app. Public availability, final artifact hashes and release status are established by the repository's live GitHub Release, not by this source document.

## Deliverables

- `Mosslight-0.10.1-win-x64.zip`: the complete Windows x64 application and its runtime. Extract the entire ZIP and run `Mosslight.exe` from the extracted folder.
- `Mosslight-0.10.1-source.zip`: standalone source with `SOURCE_MANIFEST.json`, a per-file size and SHA-256 manifest. Install locked dependencies to build it; it is not a runnable application.
- Release checksums: use the values attached to the live Release to verify the exact downloaded archives. A checksum does not establish publisher identity.

The source checkout works independently of the original build workspace. Internal agent instructions, briefs, raw review evidence, Foundry records, real saves, personal paths, secrets, dependencies and compiled output are excluded from the source distribution.

## What's in v0.10.1

Compact illustrated category buttons organize the plant and decoration collections. This UI patch retains the v0.10 library, drag/click placement, keyboard access, free-floating fairy and sky ornaments, local saves and the existing ecological simulation. It introduces no new dependencies or external artwork.

The original code, documentation and artwork use [MIT](../LICENSE). Electron and other third-party components retain their own terms; see [third-party notices](../THIRD_PARTY_NOTICES.md). The packaged app includes the runtime notices and licenses.

## Known limits

- Windows ZIP only: the app is unsigned and can trigger SmartScreen. Keep operating-system protections enabled and verify the release origin.
- macOS build configuration exists, but native device testing, signing and notarization are incomplete. No supported macOS release is claimed.
- NSIS Setup installers are excluded while their embedded-plugin license obligations remain unresolved.
- Native window movement, click-through, focus across apps, multiple displays/DPI, physical sleep/lock, native file dialogs, power/storage failure recovery and long-duration resource use need broader device testing.
- The scene is Canvas 2D illustration with bounded terrain, water and ecology; it is not unrestricted 3D modelling, full fluid physics or scientific growing advice.
- App files and saves live separately. Back up your forest before changing versions; newer save features may be incompatible with an older app.

The workflows check source and can create unsigned candidate artifacts. Their existence does not prove a remote run passed, and candidate artifacts do not automatically become public Releases. Earlier `RELEASING*.md` documents record historical local-trial scope and checks.

For everyday use, see the [user guide](USER_GUIDE.md). For source builds, see [README](../README.md#build-from-source). For sensitive reports, see [SECURITY](../SECURITY.md).
