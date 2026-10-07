# Contributing to Mosslight

Contributions to the offline terrarium, accessibility, original artwork and tests are welcome. Mosslight v0.10.1 is an early release; report what you actually checked and which platform you used. Use this repository's Issues for ordinary bugs and Pull Requests for changes. See [SECURITY](SECURITY.md) before reporting a vulnerability.

## Local development

Use Node.js 22.12 or newer and npm from the product checkout:

```sh
npm ci
npm run check
npm run setup:electron
npm start
```

Keep TypeScript strict and preserve the lockfile. Do not commit dependency directories, generated output or real user saves. The Windows release is a complete x64 ZIP; verify it on Windows. macOS build configuration is retained, but native validation, signing and notarization are incomplete. See the [user guide](docs/USER_GUIDE.md) and [release scope](docs/PUBLIC_RELEASE.md).

## Implementation boundaries

- `src/shared/types.ts` defines state, commands and the desktop bridge. Contract changes must update main-process validation, simulation, rendering and tests, and account for older save compatibility.
- `src/core/` contains deterministic simulation logic. Test running time at 24×, relative speed controls, offline time at 1×, pause, time boundaries and invalid inputs without real-time waits.
- `src/renderer/` must not import Node APIs, write files or load remote content. Request changes through the restricted bridge; the main process validates every mutation.
- `src/desktop/` owns windows, tray, file access and bridge security. Test untrusted imports, path and size limits, damaged-save recovery and preservation when a write fails.
- Terrain remains 48 ordered columns with at most 112 material units per column. Pond water shares that height limit. Test non-flat ground, local valleys, pour order, footing, supports, resizing and save round trips. Legacy v1 layer migration keeps its historical 40-unit conversion.
- Validate original checksums and structures before migration. Preserve local originals before overwriting and stop writes when required preservation fails. Use temporary sample profiles, never real saves.
- Continuous tools must stop on release, cancellation, capture loss, blur or hiding. Keep bounded doses and main-process validation, and verify the last completed action is saved.
- Use original or explicitly licensed artwork and code. Record sources, license terms, notices and modifications. Public visibility does not grant permission to copy distinctive assets, logos, fonts or proprietary code.
- Dependency updates must include matching package/lockfile changes and a review of security advisories, licenses and Electron settings. Do not weaken tests or security controls to pass checks.

## Before submitting

1. Describe the problem, resulting behavior, user impact and relevant tradeoffs.
2. Add focused tests for policy, state, path and workflow changes. Run `npm run check` and report the actual result, OS and Node version. Explain any failed or unavailable checks.
3. For desktop changes, include manual steps for focus, dragging, click-through, menus, tray and sleep/resume. Screenshots should use sample forests and exclude personal desktop information.
4. Update affected documentation, save-upgrade guidance and third-party notices. Describe implemented behavior separately from plans.
5. Review the diff for credentials, certificates, account details, personal paths and real saves. Exclude `.env`, `.foundry/`, internal briefs/instructions, raw evidence, `node_modules/`, `dist/` and `release/` from source submissions.

Original contributions are provided under the project's [MIT License](LICENSE). Third-party components retain their own licenses. Do not submit material with unknown, incompatible or unverified redistribution rights.

Keep discussion respectful and report findings honestly. Publishing releases, deploying, buying services or changing production data requires a separate maintainer-approved release step; a successful build or manual workflow is not publication approval.
