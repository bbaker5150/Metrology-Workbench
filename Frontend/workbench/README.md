# Workbench frontend

This is the shared React/Vite source for the Electron Workbench and standalone
Uncertalytics. Run commands from this directory. Use Node.js 22 and `npm ci` with
the committed lockfile; see the [repository setup guide](../../README.md) for the
Django environment and instrument prerequisites.

## Development commands

| Command | Purpose |
| --- | --- |
| `npm start` | Workbench Vite server on port 3000; backend expected on port 8000. |
| `npm run dev:mock` | Frontend and Windows backend scripts with mock instruments. |
| `npm run electron:dev:mock` | Mock backend, frontend and Electron shell. |
| `npm run dev:standalone` | Standalone SharePoint entry on port 3001. |
| `npm run dev:remote` | Separate frontend/backend ports 3100/8100. |
| `npx vitest run <file-or-directory>` | Focused tests for changed behavior. |
| `npm test` | Complete frontend test suite. |
| `npm run test:coverage` | Coverage report and configured threshold checks. |

Follow [the repository workflow](../../AGENTS.md): perform focused checks before
pushing, then allow hands-on testing before running full release validation.

## Build targets

| Command | Output |
| --- | --- |
| `npm run build` | `build/`: full Workbench browser assets. |
| `npm run build:standalone` | `build-standalone/`: Uncertalytics assets served from a real URL. |
| `npm run build:singlefile` | `build-singlefile/uncertainty-budget.html`: inlined SharePoint/Forge application. |
| `npm run electron:build` | Backend packaging, frontend build and Windows installer. |

The outputs use the same uncertainty module. [Build targets](../../docs/build-targets.md)
explains their hosting differences; [SharePoint deployment](SHAREPOINT_DEPLOYMENT.md)
explains identity and permission boundaries.

## Notes editor

The Notes workspace uses the Apache-2.0 licensed DOCX Editor core and React adapter
from [`heyirisai/docx-editor`](https://github.com/heyirisai/docx-editor). The exact
pinned versions are in [package.json](package.json) and its lockfile. The editor
runs locally in the packaged application without a separate account or license
key. Notes are stored per analysis session as versioned native DOCX payloads.

## Implementation and audit references

- [Codebase guide](../../documentation.md)
- [Documentation index](../../docs/README.md)
- [Final V8.00 mathematical audit](src/modules/uncertainty/utils/risk8/FINAL_V8_AUDIT.md)
- [Testing and coverage](../../docs/testing-coverage.md)
- [Forge runtime attribution and integration](vendor/forge/README.md)
