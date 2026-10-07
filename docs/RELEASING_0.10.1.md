# Mosslight 0.10.1 — compact illustrated categories

This checklist records the earlier local UI-only trial patch. For the first GitHub release, see [public release scope](PUBLIC_RELEASE.md); this historical checklist does not establish public availability or final archive hashes.

## Scope

- Plant collection: compact icon-and-name buttons for Moss, Greenery and Mushrooms.
- Decorations: compact icon-and-name buttons for companions, buildings, lights, steps, and statue/sky.
- Reuse original item illustrations and the warm Found objects visual language.
- Retain category expansion, all existing styles, click/drag placement, keyboard access, saves and ecology.
- No new dependencies, external assets, remote services or permissions.

## Verification record

The adjacent `Mosslight-0.10.1-VERIFICATION.md` delivery report records tests actually completed and final artifact hashes. This checklist alone is not evidence of a passing build. Earlier reports remain historical.

Check category icons and labels in wide/narrow panels, expansion state, item placement, keyboard toggles, and absence of overflow. Run strict TypeScript, relevant tests and renderer regression; verify the Windows package independently of a development build. Keep the user's real profile and currently running app untouched during testing.

At that trial stage, the source and Windows archives remained local. Public upload, code signing, macOS distribution and native OS/DPI acceptance were separate gates; the live Release and its attached verification evidence establish the current public delivery status.
