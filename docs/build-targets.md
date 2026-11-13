# Build targets

The Workbench and standalone Uncertalytics share one frontend source tree and
lockfile in `Frontend/workbench`. Their entry points and storage adapters differ;
the uncertainty calculations and user interface are shared.

| Target | Command | Entry | Output / storage |
| --- | --- | --- | --- |
| Workbench | `npm run build` | `index.html` → `src/index.jsx` | `build/`; all three modules with Django storage. |
| Standalone | `npm run build:standalone` | `index.standalone.html` → `src/standalone/main.jsx` | `build-standalone/`; multiple assets served from a real URL, SharePoint storage. |
| Single file | `npm run build:singlefile` | Same standalone entry | `build-singlefile/uncertainty-budget.html`; inlined assets for SharePoint/Forge `srcdoc` hosting. |
| Electron installer | `npm run electron:build` | Workbench entry plus `public/electron.js` | PyInstaller backend, frontend assets and Windows installer. |

Artifact sizes and chunk counts vary with the commit. Read those from the build
or release rather than relying on a fixed number in documentation.

## Shared code and host boundaries

Both products import `src/modules/uncertainty/**`. The standalone bootstrap installs
an axios adapter for the module's uncertainty endpoints, servicing them through
SharePoint instead of Django. New endpoints need corresponding adapter support;
new fields inside a saved session travel with its JSON payload.

`src/standalone/sharepoint/moduleRoutesCovered.test.js` checks module endpoint
coverage. Shared assets must be imported or resolved relative to the configured
base URL. `src/standalone/noNativeForms.test.js` checks the embedded host's form
constraint. These requirements keep the same module usable in both products.

A multi-file app requires a real URL for its chunks and assets. A `srcdoc` frame
has no document URL to resolve those paths, so the single-file target inlines them.
The build also includes the Forge manifest and runtime preamble; see the
[Forge integration guide](../Frontend/workbench/vendor/forge/README.md).

The Workbench 3D emblem uses a Git LFS asset. Run `git lfs pull` when that asset is
needed. The single-file build uses a static substitute and does not need the GLB.

## Validation and publication

Follow [AGENTS.md](../AGENTS.md) and [testing guidance](testing-coverage.md) for the
focused-check, push and hands-on-test sequence. During the authorized full
validation phase, build the targets affected by the change and run their matching
smoke checks. Playwright is already a development dependency; install its Chromium
browser as needed with `npx playwright install chromium`.

The [single-file workflow](../.github/workflows/uncertainty-singlefile.yml) runs on
qualifying frontend/workflow pushes to `main` and manual dispatch. It installs the
lockfile, audits dependencies, runs tests, builds the single file, exercises the
embedded app, and publishes the HTML with a SHA-256 file. It does not deploy to
SharePoint. Confirm the exact commit's successful workflow and artifact before
calling that release verified.

Deployment uses `scripts/deploy-uncertainty.ps1` from an authorized workstation.
See [SharePoint hosting and storage](uncertainty-sharepoint-standalone.md) and
[identity and permissions](../Frontend/workbench/SHAREPOINT_DEPLOYMENT.md).
