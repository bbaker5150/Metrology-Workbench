# Adding a Workbench module

A module owns its React subtree, state, styles and API calls. The Workbench shell
provides routing, navigation, theme and notifications. Put cross-module services
in an explicit shared interface; do not import another module's private UI.

## Frontend registration

Create a directory under `Frontend/workbench/src/modules/` and a default-exported
root component. Use the existing modules as examples. Register it in
[`moduleRegistry.jsx`](../Frontend/workbench/src/app/moduleRegistry.jsx):

```jsx
const loadExample = () => import("../modules/example/ExampleApp");

// Add to MODULES:
{
  id: "example",
  route: "example",
  title: "Example Tool",
  subtitle: "Describe what the tool does",
  path: "/example",
  status: "ready",
  Component: lazy(loadExample),
  preload: loadExample,
}
```

`id` is the stable internal key; `route` is the URL segment. The router uses
`route` to build `/<route>/*`, so it must be present even when it equals `id`.
The launcher uses `path`. Keep the loader stable so preloading and `React.lazy`
share the same browser module-cache entry.

The [router](../Frontend/workbench/src/app/routes.jsx) creates routes from the
registry inside the shared shell and a Suspense boundary. Hash routing supports
both browser URLs and Electron's `file://` load. A module can own subroutes using
`Routes` and `Route` from the installed `react-router` package.

For an unfinished launcher card, use `status: "coming-soon"` and `Component: null`.
Do not replace the existing Uncertalytics or Report of Calibration entries when
adding a new module.

## Shared services

- `src/shared/ThemeContext.jsx`: `useTheme()` supplies the selected theme.
- `src/shared/NotificationContext.jsx`: `useNotifications().showNotification(message,
  type, duration)` displays a shared notification. Its source documents the current
  AC-shunt stylesheet dependency; check styling when adding a new early-loading caller.
- `src/shared/config.js`: use `API_BASE_URL` and `WS_BASE_URL` rather than hard-coded
  hosts. Configuration supports local and same-origin hosting.
- `src/shared/apiClient.js`: the bootstrap configures the axios singleton's retry
  behavior. Module calls use that shared client setup.

Keep single-module components, contexts, hooks and utilities inside the module.
Avoid broad global CSS selectors that affect neighboring tools. The module root
should compose its own providers rather than placing private state in the shell.

## Backend integration

Where server storage or instrument access is required, add the corresponding
Django app under `Backend/ac_shunt` and register it in project settings and URLs.
The existing uncertainty and reports apps provide examples of isolated storage.

The database router is [`api/db_routers.py`](../Backend/ac_shunt/api/db_routers.py).
Add an alias and an `APP_DB_MAP` entry when the module requires a separate database;
verify migration routing rather than assuming every app uses `default`. Keep the
outbox model's routing intact.

Mount an explicit API namespace in
[`ac_shunt/urls.py`](../Backend/ac_shunt/ac_shunt/urls.py). If sockets are needed,
provide module-local routing and join it in
[`ac_shunt/asgi.py`](../Backend/ac_shunt/ac_shunt/asgi.py). Use the existing service
pattern for optional cross-module imports: expose plain data, snapshot imported
values, and retain a manual-entry route when upstream data is unavailable.

A new Workbench module is not automatically part of standalone Uncertalytics.
If a shared uncertainty feature adds an endpoint, implement its SharePoint adapter
route too; see [build targets](build-targets.md).

## Verification

Follow [AGENTS.md](../AGENTS.md) for validation order. Before handoff, add focused
checks for registry routing, module behavior and any storage/service contract.
Confirm the module can be used without data from another module.

During the authorized full-validation phase, exercise browser and Electron
navigation, shared styling, backend migrations/routing, and the appropriate release
checks. The [testing guide](testing-coverage.md) distinguishes focused checks from
full-suite and deployment validation.
