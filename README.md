# Mosslight

A quiet, offline desktop terrarium. Pour illustrated substrate, shape a small landscape, plant moss and greenery, and keep a little forest beside your work.

Mosslight **v0.10.1** is an early MIT-licensed desktop app with an English interface. The release target is **Windows x64**, distributed as a complete ZIP. See the [release scope and known limits](docs/PUBLIC_RELEASE.md).

## What you can make

- A transparent desktop bottle with a separate, warm paper Studio for building and care.
- Seven vessels, including glass you can shape with six handles and a polygon opening.
- Hills and valleys made from six substrate materials, with ponds you can fill and drain.
- Four mosses, four greenery varieties and four mushrooms, plus stones, stumps, driftwood, companions, houses, lights and sky ornaments.
- Objects you can drag, resize, rotate, stack and attach to supporting surfaces; fairy and sky ornaments float freely.
- Playful ecology: moss spreads, mushrooms cycle through fruiting and rest, and dry or wet conditions change the forest's appearance without permanently destroying authored plants.
- Local saves, JSON export/import and reversible care settings, with no account, telemetry, cloud sync or automatic updater.

All scene artwork is original Canvas 2D illustration. The ecology and terrain are bounded approximations for play, not scientific growing advice or full particle/fluid physics. Read the [user guide](docs/USER_GUIDE.md) and [ecology notes](docs/ECOLOGY.md) for details.

## Windows quick start

1. Choose `Mosslight-0.10.1-win-x64.zip` from [GitHub Releases](https://github.com/yxmo1227/mosslight/releases) when the release is available. A source ZIP contains code, not a runnable app.
2. **Extract all files** to a local folder, then double-click `Mosslight.exe` in that folder. Do not launch inside the ZIP or copy only the EXE. The packaged app includes its runtime; Node.js is not needed.
3. Left-click the desktop bottle for care icons. Right-click it to open the Studio. Drag the bottle itself to move it.
4. In **Build**, pour substrate, scoop a valley, fill a pond, place plants and arrange found objects. Click the desktop spray icon, then hold over the bottle to mist; release puts the mister away.
5. Closing the Studio leaves the companion running. Use the tray's **Save and quit** command to exit; **Show / find terrarium** restores a hidden bottle.

The Windows package is unsigned and may trigger SmartScreen. Check the release origin and its SHA-256 checksum. A checksum confirms file consistency, not publisher identity. Keep operating-system security protections enabled.

## Your forest and privacy

Saves normally live in `%APPDATA%\Mosslight` on Windows, separately from the application folder. The primary file is `terrarium.json`, the previous valid backup is `terrarium.backup.json`, and window placement is `window.json`. System configuration can change this location.

Export a JSON backup in **Settings** before upgrading, moving computers or downgrading. Quit the old app completely before replacing application files, and do not run two versions against the same save directory. Newer save features may be unreadable in older versions; first-upgrade recovery copies are not a complete save history. See [upgrades and downgrades](docs/USER_GUIDE.md#upgrades-and-downgrades).

Normal app use stays local and offline. JSON exports are not encrypted and can include forest names, layouts, preferences and timestamps; review them before sharing. Imports are size-, structure-, version- and checksum-checked and are never executed. Installing source dependencies, preparing Electron and running GitHub Actions may require a network connection.

## Build from source

Use **Node.js 22.12 or newer**, npm and a desktop environment. Run these commands from the standalone product checkout:

```sh
npm ci
npm run check
npm run setup:electron
npm start
```

Keep the supplied `package-lock.json`. Electron `44.4.1` requires its desktop runtime to be installed separately; `setup:electron` uses the official installer with checksum verification. The start, smoke, pack and distribution hooks also prepare it when needed. A missing valid cache requires a network connection.

| Command | Purpose |
| --- | --- |
| `npm run typecheck` | Strict TypeScript checking |
| `npm test` | Simulation, renderer, desktop and storage boundary tests |
| `npm run build` | Compile main, preload and renderer output |
| `npm run check` | Type checking, tests and build |
| `npm start` / `npm run dev` | Build and launch the development app |
| `npm run smoke` | Electron smoke checks with isolated test saves |
| `npm run pack` | Check and create a local application directory |
| `npm run dist:win` | Check and build the complete Windows x64 ZIP |
| `npm run source` | Create a standalone source ZIP with a size/SHA-256 manifest |

The repository also retains a `dist:mac` build configuration for use on a Mac. macOS device validation, signing and notarization are incomplete; a build configuration is not a supported macOS release. NSIS Setup installers are outside this release because their embedded-plugin license obligations remain unresolved.

The production scene uses Canvas 2D. Three.js `0.186.0` remains pinned for historical 3D source and tests; it is not the current scene renderer. Electron includes components with their own licenses, so the application license does not make every bundled component MIT. See [third-party notices](THIRD_PARTY_NOTICES.md).

## Contributing and security

Bug reports and pull requests are welcome. See [CONTRIBUTING](CONTRIBUTING.md) for development and verification expectations, and [SECURITY](SECURITY.md) for sensitive reports. Native window behavior, multiple displays/DPI, physical sleep/lock, file dialogs, power/storage failures and long-duration resource use still need broader device testing.

Original code, documentation and artwork use the [MIT License](LICENSE). Third-party components retain their own terms. Historical local-trial checklists remain in `docs/`; their results do not establish that a different archive or a remote workflow passed.
