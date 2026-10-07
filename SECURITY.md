# Security policy

Mosslight v0.10.1 is an early desktop release. There is no long-term support or guaranteed response-time commitment. Report vulnerabilities against the current source revision or release with the affected version and platform; historical trial checks do not establish that another archive is safe.

## Reporting a vulnerability

If this repository's **Security** tab provides **Report a vulnerability**, use that private GitHub channel. Its availability must be confirmed in the live repository; this file does not claim that private reporting is enabled. If that option is absent, ask the maintainer for a private contact channel without disclosing exploit details publicly.

Do not post exploitable details, real saves, credentials, certificates or personal information in public Issues, comments or Pull Requests. No security email address or alternative confidential inbox is specified here.

A useful private report includes the affected version/commit, OS and architecture, reproduction steps with a clean sample profile, expected and actual behavior, potential impact and a minimal sample with personal data removed. Test only your own installation and sample data.

## App boundaries and data

Normal operation is local and offline: no account, telemetry, cloud AI, cloud sync or remote content. The renderer uses a restricted desktop bridge rather than direct Node or file access. The main process validates commands and state changes. Imported files are untrusted JSON data, never executable code, with size, schema and checksum validation.

Save migrations and compatibility extensions preserve available compatible local originals before overwrite. A failed required preservation blocks normal saving. Keep your originals and export a backup before upgrading or downgrading; see the [user guide](docs/USER_GUIDE.md#upgrades-and-downgrades). Do not delete recovery files to bypass a preservation failure.

Saves and JSON exports are not encrypted. They can contain forest names, layouts, preferences and timestamps; avoid secrets and review exports before sharing. A locally damaged file or writable directory can still affect safety. Electron, Chromium, Node and build dependencies also need ongoing security review; offline operation does not eliminate those risks.

## Download verification

The Windows ZIP is unsigned. No trusted release-signing or macOS-notarization configuration is established. Verify the release origin and SHA-256 checksum before running a download; checksums confirm consistency, not publisher identity or the absence of vulnerabilities. Keep SmartScreen, Gatekeeper and antivirus enabled, and do not remove quarantine attributes to bypass an operating-system warning.

The release scope is Windows x64 ZIP plus source. macOS native validation remains incomplete, and NSIS Setup installers are not cleared for distribution because embedded-plugin license obligations remain unresolved. See [release scope and known limits](docs/PUBLIC_RELEASE.md).

Source checks, CI builds, native device tests, security review and final-archive review provide different evidence. A passing check or an uploaded workflow artifact does not by itself approve a public release.
