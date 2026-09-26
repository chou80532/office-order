# Third Party License Inventory

This inventory records license information for direct dependencies, relevant transitive dependencies, and bundled or browser-loaded assets.

## Direct npm dependencies

| Package | Use | Resolved version | License |
| --- | --- | ---: | --- |
| `canvas-confetti` | Runtime | 1.9.4 | ISC |
| `exceljs` | Runtime | 4.4.0 | MIT |
| `firebase` | Runtime client SDK | 12.15.0 | Apache-2.0 |
| `vue` | Runtime | 3.5.39 | MIT |
| `vue-router` | Runtime | 5.1.0 | MIT |
| `firebase-admin` | Cloud Functions runtime | 13.10.0 | Apache-2.0 |
| `firebase-functions` | Cloud Functions runtime | 7.4.0 | MIT |
| `@firebase/rules-unit-testing` | Emulator test tooling | 5.0.2 | Apache-2.0 |

Direct development-tool packages also declare permissive licenses in their installed package metadata: `@eslint/js`, `@vitejs/plugin-vue`, `eslint`, `eslint-plugin-vue`, `globals`, `vite`, `vite-plugin-vue-devtools`, and `vitest` declare MIT.

## Reviewed transitive packages

### `buffers@0.1.1`

- **License:** MIT.
- **Dependency path:** `exceljs@4.4.0` → `unzipper@0.10.14` → `binary@0.3.0` → `buffers@0.1.1`.
- **Resolution:** manually verified from upstream licensing source because npm package metadata does not declare the license. The published npm package has no `license` field or included license file. Debian's source copyright record for `node-buffers 0.1.1-2` identifies the license as MIT and explicitly says it came from `package.json` in the upstream repository, citing upstream commit `1b745ee35d33eb166e15ef1866073a07c6d7de87`. The current upstream GitHub repository no longer serves that commit directly, so the reproducible downstream source record and its exact upstream commit reference are retained here.
- **References:** [Debian source copyright record](https://sources.debian.org/copyright/license/node-buffers/0.1.1-2/) · [upstream commit referenced by that record](https://github.com/substack/node-buffers/commit/1b745ee35d33eb166e15ef1866073a07c6d7de87) · [npm package metadata](https://www.npmjs.com/package/buffers/v/0.1.1).

### `limiter@1.1.5`

- The package has no SPDX identifier in npm metadata, but its installed `LICENSE.txt` contains the MIT terms and its legacy `licenses` field says MIT. Retain that notice. This package is pulled in by the Firebase Admin/JWKS dependency path.

### `uuid`

- `uuid` is MIT-licensed.

## Browser-loaded resources and assets

- Font Awesome Free 6.7.2 is requested from cdnjs, not bundled. Retain the attribution and review the upstream terms linked in `THIRD_PARTY_NOTICES.md`.
- DM Sans and Noto Sans TC are requested from Google Fonts, not bundled. Google Fonts families are published under open-source licenses; verify family-specific terms if fonts are later copied into this repository.
- The only bundled image asset is the Office Order SVG icon. Store and menu images are supplied by each deployment operator and are not included in this repository.
- Emulator examples use fictional accounts, stores, menu entries, and addresses.

## Project license

The repository includes an MIT license in `LICENSE`; both root and Functions `package.json` identify `MIT`.
