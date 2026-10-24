# ROCgen / Metrology Workbench — Codebase Documentation 0 AI Gen

This document explains how the whole repository fits together: what each part
does, how data flows between the parts, how to run and build it, and where to
look when changing something. It reflects the code as of October 2026.

For deeper detail on individual features, `docs/` holds the narrower design and
tasking notes. This file links to them where they are relevant.

---

## Table of contents

1. [What this project is](#1-what-this-project-is)
2. [Repository layout](#2-repository-layout)
3. [High-level architecture](#3-high-level-architecture)
4. [Two shipped products from one source tree](#4-two-shipped-products-from-one-source-tree)
5. [Running it locally](#5-running-it-locally)
6. [Backend (Django) in detail](#6-backend-django-in-detail)
   - 6.1 Project config, URLs, ASGI
   - 6.2 Database topology and routing
   - 6.3 Boot sequence
   - 6.4 `api` app — AC Shunt calibration
   - 6.5 `uncertainty` app — Uncertainty Budget storage
   - 6.6 `reports` app — Report of Calibration
   - 6.7 Instrument drivers (`NPSL_Tools`) and mock mode
   - 6.8 Diagnostics and logging
7. [Frontend (React + Vite + Electron) in detail](#7-frontend-react--vite--electron-in-detail)
   - 7.1 Entry points and the workbench shell
   - 7.2 Shared layer (`src/shared`)
   - 7.3 AC Shunt module (`modules/ac-shunt`)
   - 7.4 Uncertainty module / Uncertalytics (`modules/uncertainty`)
   - 7.5 Reports module (`modules/reports`)
   - 7.6 Standalone SharePoint build (`src/standalone`)
   - 7.7 Electron main process
8. [Cross-module pipeline: AC Shunt → Uncertainty → ROC](#8-cross-module-pipeline-ac-shunt--uncertainty--roc)
9. [Build, packaging and deployment](#9-build-packaging-and-deployment)
10. [Testing and CI](#10-testing-and-ci)
11. [Conventions and rules of the codebase](#11-conventions-and-rules-of-the-codebase)
12. [How to make common changes](#12-how-to-make-common-changes)
13. [Known caveats and gotchas](#13-known-caveats-and-gotchas)
14. [Glossary](#14-glossary)

---

## 1. What this project is

ROCgen started as a tool for standardizing **Report of Calibration (ROC)**
generation across Navy Primary Standards Laboratory (NPSL) measurement areas.
It has grown into the **Metrology Workbench**: a desktop application that hosts
several independent lab tools behind one launcher.

| Tool (launcher card) | Module id | Route | What it does |
| --- | --- | --- | --- |
| **Run Calibration** | `ac-shunt` | `#/ac-shunt` | Drives lab instruments over GPIB/VISA to run AC–DC difference calibrations of AC current shunts, with live charts, stability tracking, Type A statistics, corrections management, and multi-viewer observation. |
| **Uncertainty Budget** ("Uncertalytics") | `uncertainty` | `#/uncertalytics` | A full measurement-uncertainty and decision-risk tool: Type A/B budgets, instrument libraries, derived (equation-based) measurements, GUM Supplement 1 Monte Carlo, and a port of the lab's Excel "Unc Tool v8.00" risk engine (PFA/PFR/TUR, guard bands, calibration intervals). |
| **Report of Calibration** | `reports` | `#/report-of-calibration` | Builds ROC documents from manual input, Excel import, or AC-shunt session data, and exports a PDF and an NPSL-format Excel workbook. |

The Uncertainty tool also ships on its own as a single HTML file hosted in
SharePoint (Flank Speed), which uses SharePoint lists as storage instead of the
Django backend. See [§4](#4-two-shipped-products-from-one-source-tree).

---

## 2. Repository layout

```
ROCgen/
├── AGENTS.md                     Agent/automation workflow rules (push, release gates)
├── README.md                     Offline Electron + NPSL_Tools install notes (Windows)
├── documentation.md              ← this file
├── package.json                  Stray root-level deps (chart libs); not used by the app build
├── .github/workflows/
│   └── uncertainty-singlefile.yml  CI: test + build + smoke + publish single-file release
├── docs/                         Feature/design notes (see §14 for an index)
├── Backend/ac_shunt/             Django project (Python)
│   ├── manage.py
│   ├── entry_point.py            Production/PyInstaller boot script
│   ├── ac_shunt_backend.spec     PyInstaller spec → ac_shunt_backend.exe
│   ├── requirements.txt
│   ├── uncertainty_data.json     Bundled reference data file
│   ├── ac_shunt/                 Project package: settings, urls, asgi, wsgi
│   ├── api/                      AC Shunt app (calibration, instruments, corrections)
│   │   └── NPSL_Tools/           Local pip package: PyVISA instrument drivers
│   ├── uncertainty/              Uncertainty Budget storage app
│   ├── reports/                  Report of Calibration app
│   └── scripts/                  Ad-hoc e2e smoke scripts
└── Frontend/
    ├── icon_builder/             Hand-run scripts that bake icons / 3D emblem art
    └── workbench/                The React app (Vite, Vitest, Electron)
        ├── index.html            Workbench entry HTML → src/index.jsx
        ├── index.standalone.html SharePoint entry HTML → src/standalone/main.jsx
        ├── vite.config.mjs                Workbench build + Vitest config
        ├── vite.standalone.config.mjs     Multi-file SharePoint build
        ├── vite.singlefile.config.mjs     Single-file SharePoint build
        ├── SHAREPOINT_DEPLOYMENT.md
        ├── public/               electron.js, memory diagnostics, icons, 3D .glb (LFS)
        ├── scripts/              Build plugins, deploy script, smoke/check scripts
        ├── vendor/forge/         Forge runtime scripts inlined into the single-file build
        └── src/
            ├── index.jsx         Workbench bootstrap
            ├── app/              Shell: router, launcher, top bar, issue tracker
            ├── shared/           The ONLY cross-module code (theme, toasts, config, axios)
            ├── modules/
            │   ├── ac-shunt/
            │   ├── uncertainty/
            │   └── reports/
            └── standalone/       SharePoint host for the uncertainty module
```

> On macOS the folder may show as `backend/` and `Backend/`. The filesystem is
> case-insensitive, so both names refer to the same directory. Git tracks it as
> `Backend/`. A local `venv/` may also sit there and is not tracked.

---

## 3. High-level architecture

```
┌──────────────────────────── Electron window ────────────────────────────┐
│  React SPA (hash router)                                                │
│  ┌──────────────── WorkbenchShell (top bar, theme, toasts) ───────────┐ │
│  │  HomeLauncher  │  ac-shunt module │ uncertainty module │ reports   │ │
│  └───────┬────────────────┬─────────────────┬────────────────┬────────┘ │
└──────────┼────────────────┼─────────────────┼────────────────┼──────────┘
           │ HTTP (axios)   │ WebSocket       │ HTTP           │ HTTP
           ▼                ▼                 ▼                ▼
┌────────────────── Django + Channels (Daphne ASGI, port 8000) ───────────┐
│  /api/ (legacy) & /api/ac-shunt/ ─► api app ◄── /ws/... consumers       │
│  /api/uncertainty/               ─► uncertainty app                     │
│  /api/reports/                   ─► reports app                         │
│                                                                         │
│  api ──PyVISA──► GPIB instruments (5730A, 3458A, 5790A/B, 8508A, ...)   │
└───────┬───────────────┬─────────────────┬───────────────┬───────────────┘
        ▼               ▼                 ▼               ▼
   default DB      outbox.sqlite3   uncertainty.sqlite3  reports.sqlite3
 (MSSQL or SQLite)  (write buffer)
```

Key ideas:

- **The shell knows little.** The frontend shell provides the top bar, theme,
  notifications, routing, and an issue tracker. Each tool is a self-contained,
  lazy-loaded React subtree. Modules never import from each other.
- **The backend mirrors the frontend.** Each frontend module has a matching
  Django app with its own URL namespace and, except for `api`, its own SQLite
  database.
- **Cross-module data moves in-process.** When a downstream module (reports,
  uncertainty) reads upstream data (AC-shunt sessions), it calls Python
  functions directly instead of making HTTP calls. It also *snapshots* the
  values, so a saved budget or ROC does not change when the source changes.
- **Hosting is swapped at the network boundary.** The SharePoint build replaces
  the axios adapter, not the module code, so the uncertainty module is never
  forked.

---

## 4. Two shipped products from one source tree

Details: `docs/build-targets.md` and `docs/uncertainty-sharepoint-standalone.md`.

| | Metrology Workbench | Uncertainty Budget (SharePoint / Flank Speed) |
| --- | --- | --- |
| Build command | `npm run build` + `electron-builder` (`npm run electron:build`) | `npm run build:singlefile` (or `build:standalone` for a multi-file folder) |
| HTML entry | `index.html` → `src/index.jsx` | `index.standalone.html` → `src/standalone/main.jsx` |
| Contains | All three modules | Only the uncertainty module |
| Storage | Django backend (bundled `.exe`) | SharePoint document library + lists, accessed through REST |
| Ships as | Windows NSIS installer ("AC Shunt Calibration") | One self-contained HTML file (`uncertainty-budget.html`) |

Both products import the same `src/modules/uncertainty/**`. A change to the
math, UI, or exports reaches both on their next build. The one exception is a
**new backend endpoint**: the SharePoint adapter must also handle it, or the
feature breaks only on SharePoint. A test
(`src/standalone/sharepoint/moduleRoutesCovered.test.js`) reads every axios call
site in the module and fails if the adapter cannot route one.

---

## 5. Running it locally

### Prerequisites

- Node.js 22 (the version CI uses) with npm
- Python 3 with a virtualenv at `<repo>/venv` (the npm scripts call
  `..\..\venv\Scripts\python.exe`, a Windows path)
- `pip install -r Backend/ac_shunt/requirements.txt`
- `pip install -e Backend/ac_shunt/api/NPSL_Tools` (the instrument driver package)
- Instrument PCs only: NI-VISA, plus ODBC Driver 17 or 18 for SQL Server if you use MSSQL
- `git lfs pull` (otherwise `public/3demblem.glb` is a 133-byte pointer and the launcher's 3D emblem throws)

The root `README.md` covers offline and proxy-restricted Electron installs
(`ELECTRON_SKIP_BINARY_DOWNLOAD`, manual `dist` placement).

### npm scripts (`Frontend/workbench/package.json`)

| Script | What it runs |
| --- | --- |
| `npm start` | Vite dev server on `0.0.0.0:3000` (proxies `/api` and `/ws` to `127.0.0.1:8000`) |
| `npm run start:backend` | `manage.py bootstrap && manage.py runserver 0.0.0.0:8000` |
| `npm run dev` | Backend and frontend together (`concurrently`) |
| `npm run dev:mock` | Same, with `MOCK_INSTRUMENTS=1` (no lab hardware needed; also seeds a mock session) |
| `npm run electron:dev` / `electron:dev:mock` | Backend, Vite, then Electron once ports 3000 and 8000 are up (`scripts/launch-electron.cjs`) |
| `*:remote` variants | Same flows on ports 3100/8100, so a second copy can run beside the first |
| `npm run dev:tunnel` | Same-origin API mode (`VITE_API_SAME_ORIGIN=1`) for Cloudflare-tunnel style access |
| `npm run seed-mock` / `seed-uncertainty-mock` | Seed mock AC-shunt or uncertainty data |
| `npm run dev:standalone` | Vite dev server for the SharePoint entry on port 3001 |
| `npm test` / `test:watch` / `test:coverage` | Vitest |
| `npm run build` / `build:standalone` / `build:singlefile` | Production builds (see §9) |
| `npm run electron:build` | PyInstaller backend, Vite build, then `electron-builder` installer |

### Useful environment variables

| Variable | Where | Effect |
| --- | --- | --- |
| `MOCK_INSTRUMENTS=1` | backend | Discovery, status sockets and calibration use fixture instruments |
| `AC_SHUNT_PORTAL_DIR` | backend | Overrides the data/credentials folder (default `OneDrive*/Documents/Portal` or `~/Documents/Portal`) |
| `REDIS_URL` | backend | Use the Redis channel layer instead of in-memory (multi-worker) |
| `AC_SHUNT_WORKSTATION_ID` | backend | Stable bench identity when hostnames are cloned |
| `AC_SHUNT_CORRECTIONS_PASSWORD_HASH` | backend | Hash that gates edits to imported correction data |
| `AC_SHUNT_DIAGNOSTICS_DIR` | backend | Where JSONL diagnostics logs go |
| `VITE_BACKEND_PORT` | frontend | Backend port (default 8000) |
| `VITE_API_SAME_ORIGIN=1` | frontend | Use `/api` and `/ws` on the page origin instead of `http://<host>:8000` |
| `FRONTEND_PORT` | Electron dev | Which dev server port Electron loads |
| `BUILD_STAMP` | single-file build | Text baked into the page to identify the build |

---

## 6. Backend (Django) in detail

Location: `Backend/ac_shunt/`. Stack: Django, Django REST Framework,
drf-nested-routers, Channels and Daphne (ASGI and WebSockets), django-cors-headers,
PyVISA, numpy, openpyxl, pyodbc and mssql-django, and optionally channels-redis.

### 6.1 Project config, URLs, ASGI

**`ac_shunt/settings.py`** does most of the environment work:

1. **Portal directory.** `CREDENTIALS_DIR` is resolved to `OneDrive*/Documents/Portal`
   if that tree exists, otherwise `~/Documents/Portal`, unless `AC_SHUNT_PORTAL_DIR`
   overrides it. It holds every SQLite file, the SQL credential files, the
   corrections password hash, `workstations.json`, and diagnostics.
2. **Default database selection.** It reads `SQLUSER.txt`, `SQLPASS.txt`,
   `SQLHOST.txt`, and `SQLNAME2.txt` from the Portal directory. If all four are
   present, an ODBC Driver 17 or 18 is installed, and a test `pyodbc.connect`
   succeeds, `default` is **MSSQL**. Otherwise `default` is a local SQLite file
   (`ac_shunt_local.db.sqlite3`). MSSQL detection is skipped during PyInstaller
   builds.
3. **Additional aliases:** `outbox`, `uncertainty`, and `reports`, all SQLite in
   the Portal directory (see §6.2).
4. **Mock mode:** `MOCK_INSTRUMENTS` comes from the environment.
5. **Channel layer:** Redis if `REDIS_URL` is set (pinged once at boot),
   otherwise `InMemoryChannelLayer`.
6. **Calibration supervisor timing:** `CALIBRATION_GRACE_WINDOW_SECONDS = 30` (how
   long a run survives with no host socket) and
   `CALIBRATION_RUNLOCK_STALE_SECONDS = 90` (when a bench lock counts as abandoned).
7. **Logging:** console output, plus a rotating JSONL diagnostics file per process.

**`ac_shunt/urls.py`** mounts:

```
admin/
api/ac-shunt/      → api.urls        (preferred namespace)
api/uncertainty/   → uncertainty.urls
api/reports/       → reports.urls
api/               → api.urls        (legacy alias, kept last)
```

The frontend's AC-shunt code still uses the legacy `/api/...` paths.

**`ac_shunt/asgi.py`** joins the WebSocket routes of all three apps into one
`URLRouter` inside `AuthMiddlewareStack`, then wraps the result in
`DiagnosticASGI`, which records lifecycle and transport events.

### 6.2 Database topology and routing

`api/db_routers.py` → `WorkbenchRouter` (also exported under the old name
`OutboxRouter`):

| Alias | Engine | What lives there |
| --- | --- | --- |
| `default` | MSSQL (lab) or SQLite fallback | All `api` (AC-shunt) tables, plus Django's auth, admin, sessions, and contenttypes |
| `outbox` | SQLite `ac_shunt_outbox.sqlite3` | Only `api.PendingReadingWrite` |
| `uncertainty` | SQLite `uncertainty.sqlite3` | All `uncertainty` app tables |
| `reports` | SQLite `reports.sqlite3` | All `reports` app tables |

The router uses `APP_DB_MAP = {'uncertainty': 'uncertainty', 'reports': 'reports'}`.
`allow_migrate` enforces strict isolation: a module app can migrate only onto
its own alias, a module alias accepts only its own app, and the outbox accepts
only the outbox model. `api` is deliberately left out of the map so its MSSQL
schema and migration history stay unchanged.

Because `migrate` only touches `default`, module databases must be migrated
explicitly, for example `python manage.py migrate reports --database=reports`.
The `bootstrap` command does this for every entry in `APP_DB_MAP`.

### 6.3 Boot sequence

There are two equivalent boot paths:

- **Development:** `manage.py bootstrap && manage.py runserver` (chained by npm scripts).
  `api/management/commands/bootstrap.py` runs these steps in order:
  1. `migrate` on `default` (errors are logged; boot continues if MSSQL is down)
  2. `migrate <app> --database=<alias>` for each module database
  3. Create the outbox schema if it is missing
  4. Ensure the "Local Workstation" row exists, and optionally seed benches from
     `Portal/workstations.json` (only when no non-default benches exist)
  5. In mock mode, seed the mock calibration session if it is missing
- **Packaged:** `entry_point.py` (frozen to `ac_shunt_backend.exe`) runs the same
  steps, refuses to start if port 8000 is taken, then calls
  `runserver 0.0.0.0:8000 --noreload`. (Daphne is in `INSTALLED_APPS`, so
  `runserver` serves ASGI.)

Each step is defensive. The guiding rule is that *a backend that can still
buffer writes to the outbox is better than one that refuses to boot*.

`api/apps.py::ApiConfig.ready()` also registers signals, makes sure the outbox
schema exists for plain `runserver` and test runs, and deletes stale
`WorkstationClaim` rows left by a previous process.

### 6.4 `api` app — AC Shunt calibration

This is the largest backend app: `consumers.py` is about 4,900 lines, and
`models.py`, `views.py`, and `serializers.py` add about 4,100 more.

#### 6.4.1 The measurement

An **AC–DC difference** calibration compares a test instrument (TI/UUT, the
shunt under test) against a standard shunt. Each shunt's output is read through
a thermal voltage converter (TVC) by a reader DMM (3458A, 8508A, 34420A,
5790A/B). For each test point (current × frequency × direction), one **cycle**
measures four phases in order:

```
ac_open → dc_pos → dc_neg → ac_close
```

Each phase is measured on the standard side (`std_*`) and the test side
(`ti_*`). From the eight phase averages, `models.compute_delta_uut_ppm` computes:

```
V_DC = (|dc_pos| + |dc_neg|) / 2        V_AC = (|ac_open| + |ac_close|) / 2   (per side)
term_STD = (V_AC_STD − V_DC_STD)·1e6 / (η_std · V_DC_STD)
term_UUT = (V_AC_UUT − V_DC_UUT)·1e6 / (η_ti  · V_DC_UUT)
δ_UUT [ppm] = δ_std_known + term_STD − term_UUT + δ_std − δ_ti
```

- `η` (eta) is the TVC sensitivity. It is measured by **TVC characterization**
  (the `char_plus1`, `char_minus`, and `char_plus2` stages at ±500 ppm) and
  stored in `TVCSensitivity`.
- `δ_std_known` is the standard shunt's certified correction, taken from its
  Report of Calibration (`ShuntCorrection`).
- `δ_std` and `δ_ti` are TVC corrections.

A frontend copy of this formula lives in
`modules/ac-shunt/components/calibration/sessionExcelExport.js`. **If you change
one, change the other.**

**Type A statistics.** Each test point repeats `n_cycles` cycles (at least 2;
the model default is 3 and the "initial defaults" preset uses 15). The point
result is the mean of the per-cycle δ values, with
`u_A = s(δᵢ)/√N` (`aggregate_cycle_deltas`).

**Forward/Reverse pairing.** Points come in Forward/Reverse pairs (the operator
flips the AC–DC adapter between passes). `build_pair_rows` pairs Fwd cycle *i*
with Rev cycle *N+1−i* when **ABBA** pairing is on
(`CalibrationConfigurations.use_abba_pairing`). This cancels linear drift.
`apply_outlier_filter` can reject outliers automatically: Chauvenet for N ≥ 12,
the 1.5×IQR rule for 4 ≤ N < 12. Operators can also exclude cycles by hand.
`CalibrationResults.build_pair_analytics` and `recompute_pair_aggregate` mirror
the pair-level mean and u_A onto both rows. A signal (`api/signals.py`) keeps
`n_cycles` the same on Forward and Reverse siblings.

#### 6.4.2 Data model (`api/models.py`)

```
CalibrationSession ─┬─ Calibration (1:1) ─┬─ CalibrationConfigurations (shunt range, amp range, ABBA)
                    │                     └─ CalibrationTVCCorrections (JSON)
                    ├─ TestPointSet (1:1) ── TestPoint* (current, frequency, direction, order,
                    │                         correction_report → ShuntReport)
                    │                           ├─ CalibrationSettings (1:1)  all per-point knobs
                    │                           ├─ CalibrationReadings (1:1)  raw JSON sample arrays
                    │                           └─ CalibrationResults  (1:1)  averages, η, δ, u_A, k, U
                    │                                 └─ CalibrationResultsCycle*  per-cycle phase stats
                    └─ workstation → Workstation

Shunt ── ShuntReport* (dated RoC, is_active / is_pinned) ── ShuntCorrection* (current, freq, corr, unc)
TVC   ── TVCReport*  (dated RoC)                         ── TVCCorrection*
TVC   ── TVCSensitivity* (η per current/frequency)

Workstation, WorkstationClaim, CalibrationRunLock   multi-bench locking
PendingReadingWrite                                 outbox (on the outbox DB)
BugReport, Message
```

Notes:

- `CalibrationSession` stores instrument *identity and routing*: the standard and
  test shunt models and serials, TVC serials, std/TI reader model, serial,
  address and input (FRONT/REAR), AC and DC source addresses, the source-routing
  switch driver (11713C), an optional separate reader-routing switch, the
  amplifier (Clarke-Hess 8100), and temperature and humidity.
- `CalibrationSettings` holds every per-point setting: warm-up, settling,
  samples, NPLC, stability method (sliding window or IQR), thresholds, 8508A
  filter and resolution options, 5790 filter, range, and input-switch delay,
  low-frequency options (11 Hz filter, harmonic projection), characterization
  order and source, and `n_cycles`. `api/settings_categories.py` defines the
  setting *categories* the UI saves together, either for one point or for all
  points (`save_category`), plus `initial_defaults`.
- **Reports of Calibration for devices.** Each Shunt or TVC keeps its full
  certificate history. The report with the newest date is active, unless an
  operator pins an older one (`resolve_active_report`, `refresh_active_report`).
  A `TestPoint` can store the exact `correction_report` it was generated from.
  `CalibrationResults.fetch_automatic_corrections` prefers that report and falls
  back to a session-serial lookup for legacy points.

#### 6.4.3 REST API (`api/urls.py`, `api/views.py`)

Every route below is available under `/api/` and under `/api/ac-shunt/`.

| Route | Purpose |
| --- | --- |
| `calibration_sessions/` (ViewSet) | Session CRUD |
| `calibration_sessions/{id}/initialize-instruments/` | Assign instruments to the session |
| `calibration_sessions/{id}/information/` `tvc-corrections/` `configurations/` `settings/` `readings/` `results/` | GET/PUT sub-documents (plus `/settings/{tp_id}`, `/readings/{tp_id}`, `/results/{tp_id}`) |
| `calibration_sessions/{id}/test_points/` (nested) | Test point CRUD, plus actions: `append`, `clear`, `actions/update-order`, `actions/save-settings-category`, `actions/apply-settings-to-all`, `actions/apply-reader-settings-to-all`, `{pk}/clear-readings`, `{pk}/calculate-averages`, `{pk}/analytics` (PATCH: outlier mode and exclusions), `{pk}/update-results`, `{pk}/resolved-corrections`, `{pk}/mark-readings-stability` |
| `shunts/`, `shunts/{id}/reports/` | Shunt devices and their dated RoCs (with an activate/pin action) |
| `tvcs/`, `tvcs/{id}/reports/` | Same for TVCs |
| `corrections/authorize/` | Exchanges the admin password for a 10-minute token that permits writes to *imported* correction data (`corrections_auth.py`; configure with `manage.py configure_corrections_password`) |
| `instruments/discover/` | VISA resource scan and `*IDN?` identification (mocked when `MOCK_INSTRUMENTS`) |
| `workstations/` | Read-only bench list |
| `bug_reports/` | In-app bug reports (also feed the Workbench Issues tracker) |
| `diagnostics/events/` | Client lifecycle events written to the diagnostics log |
| `system_info/` | Host and server info |

Test-point changes are broadcast over WebSockets so other viewers stay in sync
(`_broadcast_test_point_sync`).

#### 6.4.4 WebSockets (`api/routing.py`, `api/consumers.py`)

| Path | Consumer | Purpose |
| --- | --- | --- |
| `ws/collect-readings/{session_id}/` | `CalibrationConsumer` | Starts, stops, and streams calibration runs |
| `ws/status/{model}/{gpib}/` | `InstrumentStatusConsumer` | Connects one instrument, polls status, runs a zero-cal |
| `ws/switch/{model}/{gpib}/` | `SwitchDriverConsumer` | 11713C switch status and control |
| `ws/db-health/` | `DbHealthConsumer` | Pushes `{reachable, pending_count, ...}` for the outbox and DB banner |
| `ws/host-sync/` | `HostSyncConsumer` | Host and observer presence, workstation claims, session broadcast |

**`CalibrationConsumer` commands** (JSON `{"command": ...}`):

- Start a task: `start_collection` (one reading set), `start_full_calibration`
  (one point, full sequence), `start_single_stage_batch`,
  `start_full_calibration_batch` (many points), `start_paired_batch` (forward
  pass, pause for the adapter flip, reverse pass in reverse order),
  `tvc_characterization`
- Control: `stop_collection`, `set_amplifier_range`, `amplifier_confirmed` /
  `operation_cancelled` (answers to operator prompts), `paired_run_resume` (sent
  after the adapter flip)
- Read-only: `request_live_sync` returns the server's in-flight buffer, so a
  socket that joins mid-run can draw the live chart immediately

**How a run is kept safe:**

- **`SessionSupervisor`** (`session_supervisor.py`). There is one per session per
  process, and it owns the long-running `asyncio.Task` and its stop, confirmation,
  and flip events. Sockets only *attach* and *detach*. If the last host socket
  goes away, a 30-second grace window starts. If no host reconnects, the run is
  stopped safely. Observer disconnects never affect the run. The consumer
  forwards `self.stop_event`, `self.state`, and similar attributes to the
  supervisor through proxy properties, so the task code did not need rewriting.
- **Per-bench run lock** (`CalibrationRunLock`, `session_state.acquire_run_lock`).
  This is a database-backed single-flight lock that works across ASGI workers.
  The host heartbeat (about every 25 s) refreshes it. After 90 s without a
  heartbeat, a lock counts as stale and another run can take it over.
- **Observer mode.** Browsers that are not the bench host connect with
  `?role=remote`. The UI disables controls for them, and the consumer also drops
  every command in `CALIBRATION_HOST_ONLY_COMMANDS` that arrives from a remote
  socket.
- **`session_state.py`** stores all process-local shared state in one module:
  each host's active session, connected viewers, the live-state snapshot, and
  workstation claims (mirrored to the `WorkstationClaim` table). It is the
  planned seam for moving that state to Redis.

**Inside a measurement** (`_perform_single_measurement`): the consumer
configures the readers, works out the source drive voltage (negated for
`dc_neg`), applies settling time, and then runs two phases:

1. *Search*: slide a window, discarding samples, until the readings are stable
   (sliding-window ppm threshold or IQR filter).
2. *Collect*: take `num_samples` while watching stability.

It gives up after `stability_max_attempts`. Low-frequency AC can use
harmonic-projection DC estimation (`_project_dc_from_ripple`). A shared 5790
measuring both sides switches INPUT1/INPUT2 with its own settling delay.
Every sample is broadcast to the `session_<id>` group and buffered for late
joiners.

**Durable saves: the outbox** (`api/outbox.py`). Every stage save first writes a
`PendingReadingWrite` row to the local `outbox` SQLite database, which works even
when MSSQL is down, and then immediately tries to apply it to `default`. If that
fails, a background drainer retries with backoff (5 s → 15 s → 1 min → 5 min →
15 min → 30 min, failing after 20 attempts). Replay is idempotent because a write
*overwrites* that stage's reading list. `DbHealthConsumer` shows outbox status
in the UI.

### 6.5 `uncertainty` app — Uncertainty Budget storage

The frontend treats an uncertainty **session** as one deeply nested document
that it loads and saves whole. The backend therefore exposes whole-session
endpoints and normalizes only the top-level entities:

```
Session (PK = frontend Date.now() id)
 ├── MeasurementArea*   (cid, name, color, hidden)
 ├── Uut*               (UUT instruments; instrument JSON)
 ├── SessionTmde*       (reference instruments, quantity, asset id)
 ├── TestPoint*         (section, measurement_type direct|derived, equation, variable
 │     │                 mappings and nominals, input correlations, UUT/TMDE tolerances,
 │     │                 computed results: u_c, ν_eff, k, U, budget components,
 │     │                 Monte Carlo result, risk_metrics …)
 │     └── ManualComponent*  (Type A/B extra components)
 └── NoteImage*
Instrument (shared library; string PK)     CustomEquation     BugReport
```

Each child row keeps the frontend's original id in `cid`, and the serializer
gives it back unchanged, so ids survive the round trip. Irregular leaves are
stored as JSON fields.

Routes (`/api/uncertainty/`): `sessions/` (GET all whole documents, POST create),
`sessions/{id}/` (GET, PUT, DELETE), `sessions/{id}/notes/` (DOCX notes payload),
`sessions/{id}/images/[...]`, `instruments/[...]` (shared library; writes to the
validated library need a shared password), `equations/[...]`, `bug_reports/[...]`,
`info/`, `system_info/`, and `ac-shunt/sessions/[{id}/]`. The last one is the
read-only AC-shunt snapshot used by the budget importer (`ac_shunt_import.py`).
It never recomputes or saves calibration results.

The `seed_uncertainty_mock` management command loads the fixtures in
`uncertainty/fixtures/mock/`.

### 6.6 `reports` app — Report of Calibration

- **`ROCRecord`** is one saved ROC. It has flat columns (ROC number, instrument
  identity, procedure, customer, area code and name, environment, dates,
  metrologist and approver) and JSON fields for `statements`
  (`[{kind, text}]`), `inline_results` (front-page coefficient rows), and
  `tables` (`[{title, intro_text, columns:[{header, unit}], rows}]`).
  A record *snapshots* its area's statements, so later edits to an area's
  defaults do not change saved reports.
- **Measurement areas are JSON files**, not database rows. Each file in
  `reports/areas/*.json` (`ac_shunt`, `resistance`, `temperature`) is a full
  ROC-shaped payload with that area's defaults and approved statement text.
  **To add an area, add one JSON file.** `area_registry.py` reads the files on
  every call, so no restart is needed.
- **Excel generation** (`excel.py` + `cellmap.py`). Output is written into a real,
  trimmed NPSL workbook (`templates/roc_ac_shunt.xlsx`, sheets `ROC1` and
  `ROC2`). `cellmap.TEMPLATE` maps every fixed field to its exact cell. Data
  tables are generated below `table_start_row` on a dense, merged column grid
  that matches the template. Downloads include a **Data Entry** sheet, and the
  certificate cells are formulas that point back to it. Dates are formatted
  NPSL-style (`02MAR2026`). The resistance and temperature templates are kept
  for reference but are not wired up; every area uses the AC-shunt layout.
- **Excel import** (`importer.py`). It reads workbooks through the *same*
  `cellmap`, so generation and parsing cannot drift apart. If a Data Entry sheet
  exists, only that sheet is read. Otherwise it reads the certificate page and
  detects table shape with `_scan_tables`.
- **Customer directory** (`Customer`, `CustomerDirectory`, `customers.py`).
  A searchable lab and customer list, seeded from
  `data/customers_initial.json.gz` (11,885 rows) by migration 0004. It can be
  replaced wholesale from an `.xlsx` upload, with size and row limits and a
  single transaction. See `docs/report-customer-directory.md`.
- **AC-shunt pull** (`services.py`). `list_ac_shunt_sessions` (search and
  pagination) and `pull_ac_shunt_session` read `api` models in-process and map a
  session into a ROC payload: model and serial, temperature and humidity, date,
  and a data table of current, frequency, direction, ΔUUT, U, and k.

Routes (`/api/reports/`): `info/`, `areas/`, `rocs/`, `rocs/{id}/`,
`rocs/{id}/excel/`, `roc/generate/` (POST payload → xlsx), `roc/template/`
(blank or prefilled template for an area), `roc/parse/` (multipart xlsx →
payload), `ac-shunt/sessions/`, `ac-shunt/sessions/{id}/pull/`, `customers/`,
`customers/import/`.

`manage.py seed_rocs` loads sample ROCs transcribed from real NPSL reports.

### 6.7 Instrument drivers (`NPSL_Tools`) and mock mode

`api/NPSL_Tools/` is a small pip-installable package (`npsl_tools`) of PyVISA
drivers. `Instrument` (base class) opens a VISA resource and provides
`query`, `write`, `read`, and `check_identity`. Drivers:

| Driver | Instrument | Role |
| --- | --- | --- |
| `instrument_5730A` | Fluke 5730A calibrator | AC/DC source |
| `instrument_3458A` | Keysight 3458A DMM | Reader |
| `instrument_8508A` | Fluke 8508A reference DMM | Reader (FRONT/REAR inputs, filters, transfer mode) |
| `instrument_34420A` | Keysight 34420A nanovoltmeter | Reader |
| `instrument_5790A` / `5790B` | Fluke 5790 AC measurement standard | Reader (can serve both sides through INPUT1/INPUT2) |
| `instrument_8100` | Clarke-Hess 8100 transconductance amp | Current amplifier (ranges 2 mA to 100 A) |
| `instrument_11713C` | Keysight 11713C switch driver | SPDT relay for source or reader routing |
| `instrument_53132A` | Counter | Frequency |
| `instrument_ESP302` | Newport ESP302 | Motion controller |

`enums/` holds 5790B NIST wideband data and 792A angle tables.

**Mock mode** (`MOCK_INSTRUMENTS=1`): `mock_instruments.py` returns fake
discovery and status data, and `mock_calibration_instruments.py` subclasses the
real drivers with a stubbed VISA resource. The subclasses produce synthetic
readings with a small per-address ppm bias and optional low-frequency ripple, so
the whole calibration pipeline runs without hardware.

### 6.8 Diagnostics and logging

- `api/diagnostics.py` writes JSON lines (boot id, pid, uptime) to
  `Portal/diagnostics/backend-<pid>.jsonl`, rotated at 10 MB × 5 files. It also
  enables `faulthandler`, wraps ASGI to record connection lifecycle, and accepts
  client events at `diagnostics/events/`. It never records request bodies or
  credentials.
- Electron writes `userData/diagnostics/electron-lifecycle.jsonl`, and
  `public/memory-diagnostics.cjs` samples renderer memory. See
  `docs/weekend-renderer-oom-2026-09-21.md` and
  `docs/calibration-disconnect-diagnostics.md`.

---

## 7. Frontend (React + Vite + Electron) in detail

Location: `Frontend/workbench/`. Stack: React 19, react-router 8 (hash router),
Vite 6, Vitest 4 + Testing Library + jsdom, Electron 41, axios + axios-retry.
Charts use Chart.js, Recharts, and Plotly. 3D uses three.js and react-three-fiber.
Math uses mathjs, simple-statistics, and KaTeX. Documents use @react-pdf/renderer,
pdf-lib, ExcelJS, SheetJS, and the heyirisai DOCX editor. Drag and drop uses
dnd-kit, and animation uses GSAP.

### 7.1 Entry points and the workbench shell

- **`src/index.jsx`** applies the saved theme class to `<body>` before first
  paint, imports `shared/apiClient` (which configures axios retry), and renders
  `ThemeProvider` → `NotificationProvider` → `RouterProvider` + `ZoomToast`.
- **`src/app/moduleRegistry.jsx`** is the single source of truth for the tools.
  It exports the `MODULES` array: `{id, route, title, subtitle, path, status,
  Component: lazy(loader), preload}`. Both the router and the launcher read it.
- **`src/app/routes.jsx`** uses `createHashRouter`. Hash routing is deliberate:
  the same build works under `file://` in Electron, on the dev server, and with
  `serve -s`. Routes: `/` → `/home` (launcher), `/<route>/*` for each module
  (inside `<Suspense>`), legacy redirects `/uncertainty/*` and `/reports/*`, and
  unknown paths → `/home`.
- **`WorkbenchShell.jsx`** renders `WorkbenchTopBar` (window controls through
  Electron IPC, theme toggle, back to launcher) and the active route. It also
  hosts **Workbench Issues** (`WorkbenchIssues.jsx` + `issueStore.js`), a
  lazy-loaded tracker that merges bug reports from `/api/bug_reports/` and the
  uncertainty module's `/api/uncertainty/bug_reports/`.
- **`HomeLauncher.jsx`** shows the card grid and preloads a module's chunk on
  hover or focus, so clicks feel instant. `LauncherEmblem.jsx` renders the 3D
  NAVAIR medallion (`public/3demblem.glb`).

### 7.2 Shared layer (`src/shared`)

This is the **only** code shared across modules. Keep it small.

| File | Purpose |
| --- | --- |
| `config.js` | `API_BASE_URL` (`http://<page host>:8000/api`, or `/api` in same-origin mode), `WS_BASE_URL`, `baseIp`, `BACKEND_PORT`. The host follows the page origin, so a remote observer at `10.x.x.x:3000` reaches the backend at `10.x.x.x:8000` |
| `apiClient.js` | axios-retry on the global axios singleton: 15 retries, 2 s apart, to cover the bundled backend's ~21 s cold start |
| `ThemeContext.jsx` | Light/dark theme, persisted in `localStorage` and sent to Electron |
| `NotificationContext.jsx` | Toast stack (`showNotification(msg, type, ms)`) |
| `ZoomToast.jsx`, `CaptionControls.jsx`, `UiSettings.jsx`, `ToolbarLayoutIcon.jsx` | Small shared UI pieces |
| `WorkbenchIssuesContext.js` | Lets modules open the issue tracker |
| `fonts/` | Embedded Inter fonts |

### 7.3 AC Shunt module (`modules/ac-shunt`)

Root: `AcShuntApp.jsx`. While mounted, it injects scoped Bootstrap and module CSS
and adds `ac-shunt-active` to `<body>`. Main tabs:

| Tab | Components |
| --- | --- |
| `sessionSetup` | `SessionSetup`, `SessionManager` (pick or create a session), `SessionDetailsForm` (instrument identity and routing, environment) |
| `instrumentStatus` | `InstrumentStatusTab` / `InstrumentStatusPanel` (discovery, per-instrument status sockets), `SwitchControl` |
| `runCalibration` | `Calibration.jsx` (~4,500 lines: run controls, settings forms, presets, live charts `CalibrationChart`, `LiveStabilityTracker`, `CycleStatisticsTracker`, `CalibrationStatusBar` with ETA from `useCalibrationETA`) |
| `calibrationResults` | `CalibrationResults.jsx` (per-point results, pair analytics, cycle exclusions, Excel export through `sessionExcelExport.js`), `RangeResultsModal` |

Supporting pieces:

- `TestPointSidebar` (drag-to-reorder test points)
- `CorrectionsModal` + `tables/ShuntCorrections`, `TVCCorrections` (manage dated
  device RoCs; edits to imported data need a corrections token)
- `ConfigurationModal`
- `SessionNotesFloatingPanel`
- `BugReportModal`
- `HarmonicProjectionInfoModal`

State lives in **`contexts/InstrumentContext.jsx`**. It holds the selected
session, discovered instruments, the std/TI reader roles, live readings per
stage, the collect-readings socket, observer/host role, and host-sync presence.

Hooks:

- `useDbHealth` (subscribes to `ws/db-health/`)
- `useCycleAnalytics`
- `useObserverTab` (observers are limited to the Run and Results tabs)
- `useCalibrationETA`

Utils:

- `observationState` (remembers which session an observer is following)
- `resolveSessionNCycles`, `resolveEffectiveCycle`
- `calibrationSettingsScope`
- `instrumentStatus`
- `uncertaintyPresentation`

Constants (`constants/constants.js`) list reading types and colors, available
currents (1 mA to 100 A) and frequencies, and amplifier ranges.

### 7.4 Uncertainty module / Uncertalytics (`modules/uncertainty`)

Root: `UncertaintyApp.jsx` adds `uncertainty-active` to `<body>`, so module
design tokens reach portaled modals. It then renders `App.jsx` (the ported
Uncertalytics app, ~6,600 lines) and passes in `AcShuntImportTool`. That tool is
passed as a prop only in the workbench, so the standalone build never bundles it.

**Concepts and data model** (client side; matches §6.5):

- A **session** holds analyst, organization, document info, and session-level
  settings, plus:
  - **measurement areas** (groups with colors),
  - **UUTs** and **TMDE** (reference instruments),
  - **test points**,
  - notes (a versioned DOCX payload) and images.
- A **test point** is either *direct* or *derived*. A derived point has an
  equation with named inputs, each input with its own budget, nominal values, and
  input correlations. Each point carries a UUT tolerance, TMDE tolerances, and
  manual components.
- **Tolerances** are specification objects (reading, range, and floor terms,
  units, distribution). `uncertaintyMath.calculateUncertaintyFromToleranceObject`
  turns them into standard uncertainties.
- The **instrument library** (shared, `Instrument` model) holds reusable
  function → range → specification trees. The builder and lookup modals live in
  `features/instruments/`.

**Calculation pipeline:**

1. `features/analysis/utils/budgetUtils.js` and `resolvePointBudgetComponents.js`
   break tolerances, resolution, repeatability (Type A), and manual or dynamic
   components into budget rows (value, distribution divisor, ν, sensitivity).
2. `features/analysis/hooks/useUncertaintyCalculation.js` combines them:
   - RSS with correlations (`combineWithCorrelation`)
   - effective degrees of freedom (Welch–Satterthwaite)
   - k from Student-t at the confidence level (`getKValueFromTDistribution`),
     or a manual override
   - expanded U
   - derived points use first-order propagation (`calculateDerivedUncertainty`)
     or **Monte Carlo** (`utils/monteCarlo.js`, `risk8/monteCarloEngine8.js`;
     GUM Supplement 1, seeded mulberry32 PRNG, deterministic, shortest coverage
     interval).
3. `features/analysis/hooks/useRiskCalculation.js` → `utils/risk8/*` compute
   decision risk. **`riskEngine8.js` is a function-for-function port of the
   VBA module `modRiskBackend` in `Unc Tool v8.00-Beta.7.xlsm`**, and the VBA is
   the authority (see `utils/risk8/MIGRATION_AUDIT.md`).
   - `computeOneRow8.js` reproduces the workbook row contract: nominal, limits,
     u_cal, bias, TUR, REOP, targets, decay model, resolution, producing PFA,
     PFR, guard-band multiplier and physical limits, mitigated and
     interval-adjusted risk, and status.
   - `riskBridge8.js` and `riskAdapter8.js` connect app data to that contract.
   - Golden vectors captured from Excel (`*.json`, `goldenVectors8.js`) keep it
     honest.
   - **Do not "improve" this math.** Fidelity to the workbook is the requirement.
4. Results feed `UncertaintyBudgetTable`, `ContributionPlot`, the risk
   dashboards and visualizers, the breakdown modals (step-by-step derivations),
   and the PDF report (`utils/pdfGenerator.js`).

**Other notable parts:**

- `hooks/useSessionManager.js`: loads, saves, imports, and exports sessions
  through `${UNCERTAINTY_API}`, keeps 50-step undo, and does crash recovery
  (`sessionRecovery`, `usePageExitRecovery`).
- `features/analysis/components/UncertaintyPanel.jsx`: the main analysis
  workspace (~17,000 lines, the largest file in the repo).
- `SessionNotesWorkspace.jsx`: the DOCX notes editor
  (`@heyirisai/docx-editor-*` 1.11.0, runs fully offline).
- Tools: `UnitConverter`, `ReverseTraceabilityTool`, `FloatingNotepad`,
  `FloatingImagesPanel`, `AcShuntImportTool`.
- `GuidedWalkthrough` + `walkthroughSteps.js`: the in-app tutorial.
- `utils/fileIo.js`: import and export of session files.
- `utils/submitOnEnter.js`: Enter-to-commit without `<form>` (required by the
  SharePoint host).

### 7.5 Reports module (`modules/reports`)

Root: `ReportsApp.jsx` → `ReportsProvider` (`contexts/ReportsContext.jsx`) →
`ReportsMain.jsx`, a two-pane layout with a resizable sidebar whose width is
saved in `localStorage`.

- **Sidebar, "Data Source" tab** (`DataSourcePanel`) has four sources:
  - *Saved Records* (`SavedRecords`, backed by `rocs/`)
  - *Excel Import* (`ExcelImport`, backed by `roc/parse/` and `roc/template/`)
  - *Manual Input* (`ManualInputForm`, with `CustomerLookup` for the customer
    directory)
  - *AC-Shunt Pull* (`AcShuntImport`, backed by `ac-shunt/sessions/`)
- **Sidebar, "Report Sections" tab** (`ReportBuilder`) shows and orders the
  sections that appear in the report.
- **Preview** (`PDFPreview` + `pdf/CalibrationPDF.jsx`) renders with
  @react-pdf/renderer in Base14 Times-Roman for speed. Ω is drawn as a small
  vector glyph, or spelled out as "Ohm" in justified paragraphs, because Base14
  has no Ω. `pdf/printReady.js` uses pdf-lib to set `PrintScaling: None`, so
  the page prints at actual size with SOP margins.
- `api.js` wraps every `/api/reports/` call.

### 7.6 Standalone SharePoint build (`src/standalone`)

`main.jsx` boots only the uncertainty module, with no router or shell:

1. Read optional `window.UNCERTAINTY_CONFIG` (`listPrefix`, `webUrl`).
2. Create a `SharePointStore` (`sharepoint/spStore.js`).
3. **Replace `axios.defaults.adapter`** with `createSharePointAdapter`
   (`axiosSharePointAdapter.js`). It catches `${UNCERTAINTY_API}/...` requests
   and serves them from SharePoint. Everything else falls through to the real
   network.
4. Render `StorageGate`, which detects unprovisioned sites and offers to create
   the containers, and `StorageAdministration` ("Organize storage", rename to
   visible names).
5. Install `formSubmitShim.js` (the host blocks native form submission).

Storage layout:

- `UncertaintySessions`: a document library with **one JSON file per session**,
  plus indexed metadata columns for the picker.
- `UncertaintyInstruments`, `UncertaintyEquations`, `UncertaintyBugReports`: lists.

`spContext.js` finds the SharePoint web (from `_spPageContextInfo` on its own
window or the parent frame, or from the URL), caches the form digest until just
before it expires, and reports SharePoint's own error messages.

Deletes **archive** records (an `_uncertaintyArchive` marker) instead of calling
SharePoint delete endpoints. Columns are created through `createfieldasxml`.

### 7.7 Electron main process (`public/electron.js`)

- **Packaged** (`app.isPackaged`): spawns
  `resources/ac_shunt_backend/ac_shunt_backend.exe`, waits 5 s, then opens
  `file://.../build/index.html`. It kills the backend on quit.
- **Development**: does not spawn a backend (the npm script already started
  one) and loads `http://localhost:${FRONTEND_PORT||3000}`.
- Frameless window with IPC handlers: `window-minimize`,
  `window-maximize-toggle`, `window-close`, `window-is-maximized`,
  `theme-changed`, `theme-get`. The theme is saved to `userData/theme.json`, so
  the window background matches before React loads.
- Writes lifecycle diagnostics (renderer gone, unresponsive, navigation, backend
  exit) and runs memory sampling.

---

## 8. Cross-module pipeline: AC Shunt → Uncertainty → ROC

The intended flow is **AC-Shunt run → Type A → Uncertainty Budget → ROC**. Each
link is *optional*: every module must work fully from manual entry.

1. **AC Shunt → Uncertainty.** The lightning button in Uncertalytics
   (`AcShuntImportTool`) searches saved runs through
   `/api/uncertainty/ac-shunt/sessions/` and fetches a read-only snapshot. It
   then builds a new saved budget:
   - Electrical points per current/frequency, as native **derived** points
     (equation `Iref + I0·mean(ref − UUT terms)`)
   - A UUT and reference instruments, reusing matching shared-library
     definitions by model and serial
   - Type A from pair analytics (u = s/√N, ν = N−1)
   - Reader specs (34420A, 5790B by range) and UUT acceptance limits (Y5020
     Navy ±100 ppm; A40B manufacturer limits)
   - Conservative input correlations

   Full rules: `docs/ac-shunt-uncertalytics-import.md`. Logic:
   `utils/acShuntBudget.js`, `acShuntDerivedPoint.js`, `acShuntReaderSpecs.js`,
   `acShuntUutSpecs.js`, `acShuntLibrary.js`; backend
   `uncertainty/ac_shunt_import.py`.
2. **AC Shunt → ROC.** *AC-Shunt Pull* in Reports calls
   `reports/services.py::pull_ac_shunt_session` and fills a ROC payload. The
   operator completes customer, procedure, dates, and signatures.
3. Every hop **snapshots** the data. Later edits to the source never change a
   saved budget or ROC.

---

## 9. Build, packaging and deployment

| Target | Command (in `Frontend/workbench`) | Output |
| --- | --- | --- |
| Workbench web bundle | `npm run build` | `build/` (relative `base: './'`; manual chunks for chart, katex, dnd, gsap) |
| Backend exe | `npm run build-python` (PyInstaller `ac_shunt_backend.spec`) | `Backend/ac_shunt/dist/ac_shunt_backend/` |
| Desktop installer | `npm run electron:build` | NSIS installer, appId `com.navair.acshunt`, backend copied into `resources/` |
| SharePoint multi-file | `npm run build:standalone` | `build-standalone/` (about 91 files; needs a real URL) |
| SharePoint single file | `npm run build:singlefile` | `build-singlefile/uncertainty-budget.html` (about 6.7 MB) |

**The single-file build** (`vite.singlefile.config.mjs`) exists because the
SharePoint app page injects HTML into an `<iframe srcdoc>`, which has no base
URL. The build therefore:

- inlines all JS and CSS and embeds fonts and images as data URIs
  (`vite-plugin-singlefile`)
- stubs out three.js and the 3D emblem (`standalone/stubs/threeStub.jsx`)
- runs `scripts/hardenInlineHtml.mjs`, which walks the AST and rewrites `<` as
  `\x3c` *only inside string, template, and regex literals*, so no host
  sanitizer can mistake bundled data for a tag. It also verifies that literal
  values are unchanged and that no `</`, `<script`, or `<!--` remains in
  script bodies
- inlines Forge's runtime scripts (`vendor/forge/`, `scripts/forgeRuntime.mjs`)
  and adds the `WFC-MANIFEST` comment
- stamps the build (`<meta name="x-uncertainty-build">`,
  `window.__UNCERTAINTY_BUILD__`)

**Deploying to SharePoint:** CI publishes each build as a GitHub release
(`build-<sha7>`, with a SHA-256). The latest is always at
`.../releases/latest/download/uncertainty-budget.html`. On a CAC-authenticated
workstation, `scripts/deploy-uncertainty.ps1 -LibraryPath '<synced folder>'`
downloads it, checks the hash, and overwrites the file in a OneDrive-synced
library. CI never touches SharePoint. One-time library setup (versioning on,
content approval and checkout off, permissions) is in
`docs/uncertainty-sharepoint-standalone.md`.

---

## 10. Testing and CI

### Frontend

- `npm test` runs Vitest with jsdom, CSS disabled, at most 4 workers, and a 30 s
  timeout (some Monte Carlo validation tests run tens of thousands of trials).
  About 220 test files sit next to the code they test (`*.test.js[x]`).
- `npm run test:coverage` uses V8 coverage with `all: true` and *ratchet*
  thresholds (statements 45, branches 34, functions 37, lines 46). Raise them as
  coverage grows. Never lower them. See `docs/testing-coverage.md`.
- Tests that guard host constraints:
  - `standalone/sharepoint/moduleRoutesCovered.test.js`: every uncertainty
    endpoint must be routable on SharePoint
  - `standalone/noNativeForms.test.js`: no `<form>` or submit buttons in
    shipped code
  - `singlefilePlugin.test.js`, `scripts/hardenInlineHtml.test.mjs`
- Numeric tests assert published reference values (Student-t tables, normal
  quantiles), relational invariants (PFA rises as TUR worsens), and
  Excel-captured golden vectors. They do not snapshot whatever the code
  currently returns.
- `scripts/` contains many Playwright and Electron smoke and check scripts
  (`smoke-*.mjs/.cjs`, `*-checks.mjs`). The release-critical one is
  `node scripts/smoke-forge-srcdoc.mjs`, which boots the built single file in an
  `about:srcdoc` frame against a mocked SharePoint REST API. Environment flags
  select extra suites (`STORAGE_ADMIN_SMOKE`, `SEPTEMBER22_SMOKE`,
  `TASKING_TYPE_B_SMOKE`, `WORKSPACE_POLISH_SMOKE`).
  `node scripts/smoke-sharepoint.mjs` covers the multi-file build.

### Backend

```
cd Backend/ac_shunt
python manage.py test                  # all apps
python manage.py test api              # e.g. api/tests.py, test_5790a_reader_routing.py, ...
python manage.py test uncertainty.test_ac_shunt_import
python manage.py test reports
```

The `api` suite covers reader routing (5790A/B, 8508 stage configuration),
correction sources and authorization, settings categories, reading stability,
instrument discovery, diagnostics, and the outbox and router. `NPSL_Tools/tests`
holds driver unit tests.

### CI (`.github/workflows/uncertainty-singlefile.yml`)

The workflow runs on pushes to `main` that touch `Frontend/workbench/**`, and
on manual dispatch. Steps, all in `Frontend/workbench`:

1. `npm ci` (with `ELECTRON_SKIP_BINARY_DOWNLOAD=1`)
2. `npm audit --audit-level=high` (the full report goes to the step summary;
   only high and critical advisories block)
3. `npm test`
4. `npm run build:singlefile` with `BUILD_STAMP`
5. Install Playwright Chromium, then run `smoke-forge-srcdoc.mjs` five times
   (base run plus four flagged suites)
6. Checksum, upload the artifact, `gh release create build-<sha7>`

The backend has no CI. `AGENTS.md` describes the expected order for automated
agents: push, hand off for testing, and only run the full release gates after
the user approves.

---

## 11. Conventions and rules of the codebase

- **No cross-module imports.** Nothing under `modules/<a>/` imports from
  `modules/<b>/`. Use the backend's in-process services or manual import.
- **Keep `shared/` small.** Promote code there only when a second module
  actually needs it.
- **The module root is the only public surface.** Its default export is the
  `React.lazy` target.
- **Each module defines its API root once**, in `constants/` (`UNCERTAINTY_API`,
  `REPORTS_API`, AC-shunt's `API_BASE_URL`).
- **Module styles are scoped**, through a body class (`ac-shunt-active`,
  `uncertainty-active`) and module CSS. Avoid global selectors.
- **Import assets; do not use absolute paths.** `/asset.png` breaks in a library
  subfolder and in srcdoc.
- **No native form submission** in uncertainty code. Use `onClick` handlers and
  `submitOnEnter`.
- **Snapshot, don't link**, when one module copies another's data.
- **Risk math mirrors the Excel VBA.** Keep names, constants, and iteration
  counts. Quote the VBA in comments.
- **The δ formula has two copies** (Python `compute_delta_uut_ppm` and JS
  `sessionExcelExport.js`). Keep them in step.
- **Backend boot must not fail because MSSQL is down.** The outbox has to keep
  working.
- Comment style is explanatory: comments say *why* a choice was made. Match the
  density of nearby code.

---

## 12. How to make common changes

**Add a workbench module.** Follow `docs/adding-a-module.md`:

1. Add an entry to `MODULES` in `src/app/moduleRegistry.jsx`.
2. Create `src/modules/<id>/` with a root component, contexts, components,
   hooks, utils, and constants.
3. Backend: create a Django app with `urls.py`, `routing.py`, and `services.py`.
4. Add it to `INSTALLED_APPS`, add a `DATABASES[<alias>]` entry, and add it to
   `APP_DB_MAP`.
5. Mount it at `api/<id>/` in `ac_shunt/urls.py` and add its WebSocket routes in
   `asgi.py`.
6. Add the app to `ac_shunt_backend.spec` `datas`, so the packaged exe includes
   it.

**Add a ROC measurement area.** Add `Backend/ac_shunt/reports/areas/<code>.json`
(copy an existing one). No other code changes are needed.

**Add an instrument driver.** Add `npsl_tools/instruments/instrument_<model>.py`
(subclass `Instrument` or follow the pattern of the existing drivers), register
it in the consumer's `INSTRUMENT_CLASS_MAP`, and add a mock subclass in
`api/mock_calibration_instruments.py` and mock status data in
`api/mock_instruments.py`.

**Add a per-point calibration setting.**

1. Add a field to `CalibrationSettings` and create a migration.
2. Add it to the serializer.
3. Add it to the right `CATEGORY_FIELDS` group in `settings_categories.py`.
4. Read it in the consumer's measurement code.
5. Expose it in the `Calibration.jsx` settings UI.

**Add an uncertainty endpoint.** Add the Django view and URL, *and* handle the
route in `src/standalone/sharepoint/axiosSharePointAdapter.js` with matching
`spStore` support. Otherwise `moduleRoutesCovered.test.js` fails, and so would
the SharePoint deployment. New fields *inside* a session need no changes,
because sessions are stored whole.

**Change risk math.** Find the governing VBA procedure in
`Unc Tool v8.00-Beta.7.xlsm`, port it exactly, and add or refresh Excel-captured
vectors. See `utils/risk8/MIGRATION_AUDIT.md` and
`scripts/capture-risk-beta7.ps1`.

---

## 13. Known caveats and gotchas

- **Git LFS:** `public/3demblem.glb` needs `git lfs pull`. Without it, the
  launcher's 3D emblem throws. The single-file build is unaffected.
- **Development settings in `settings.py`:** `DEBUG = True`, a hard-coded
  `SECRET_KEY`, `ALLOWED_HOSTS` including `'*'`, and `CORS_ALLOW_ALL_ORIGINS =
  True`. Most views use `AllowAny`. The app assumes a trusted lab network.
- **Windows-only npm scripts:** backend scripts call `..\..\venv\Scripts\python.exe`.
  On macOS or Linux, run Django by hand from `Backend/ac_shunt`.
- **PyInstaller spec:** `datas` lists `ac_shunt`, `api`, `reports`, and
  `uncertainty_data.json`, but not the `uncertainty` app directory. Check that
  the packaged exe includes that app's migrations and modules before relying on
  it.
- **Toast styling** lives in `modules/ac-shunt/App.css` and is only guaranteed
  after AC-shunt has mounted (noted in `NotificationContext.jsx`).
- **Very large files** (`UncertaintyPanel.jsx`, `App.jsx`, `Calibration.jsx`,
  `consumers.py`) dominate the coverage gaps. The plan is to move their logic
  into testable `*.logic.js` modules.
- **Process-local state:** supervisors and live buffers are lost on a backend
  restart. A restart is a hard stop for in-flight runs; buffered outbox writes
  survive.
- **`Frontend/workbench/README.md`** is mostly Create React App boilerplate. The
  project uses Vite, so ignore the CRA commands there.
- Test counts quoted in older docs (1,125 / 1,273 / 1,511) are historical.
  Run `npm test` for the current number.

---

## 14. Glossary

| Term | Meaning |
| --- | --- |
| **ROC / RoC** | Report of Calibration: the certificate issued for a calibrated item, and also the certificate on file for a lab standard (Shunt/TVC reports) |
| **NPSL** | Navy Primary Standards Laboratory |
| **UUT / TI** | Unit Under Test / Test Instrument |
| **STD** | Standard (reference) side of the comparison |
| **TMDE** | Test, Measurement and Diagnostic Equipment: reference instruments in a budget |
| **TVC** | Thermal Voltage Converter |
| **η (eta)** | TVC sensitivity (gain), from characterization |
| **δ (delta) UUT** | AC–DC difference of the UUT, in ppm |
| **ABBA pairing** | Pairing Fwd cycle *i* with Rev cycle *N+1−i* to cancel linear drift |
| **Type A / Type B** | Uncertainty from statistics / from other information (specs, certificates) |
| **k, U, ν_eff** | Coverage factor, expanded uncertainty, effective degrees of freedom |
| **TUR / TAR** | Test Uncertainty Ratio / Test Accuracy Ratio |
| **PFA / PFR** | Probability of False Accept / False Reject |
| **REOP** | Reliability at End Of Period (in-tolerance probability at the end of the interval) |
| **Guard band (GB)** | Tightened acceptance limits that reduce PFA |
| **Outbox** | Local SQLite write buffer for calibration saves while MSSQL is unavailable |
| **Observer / remote** | A read-only viewer of another bench's live run |
| **Flank Speed / Forge** | The DoD Microsoft 365 tenant and the SharePoint app-page host the single-file build runs in |
| **Portal directory** | `Documents/Portal`: per-user folder for credentials, SQLite DBs, and diagnostics |

### `docs/` index

- Architecture: `adding-a-module.md`, `build-targets.md`, `testing-coverage.md`
- SharePoint: `uncertainty-sharepoint-standalone.md`, `Frontend/workbench/SHAREPOINT_DEPLOYMENT.md`, `vendor/forge/README.md`
- AC Shunt: `8508a-ac-shunt-integration.md`, `ac-shunt-corrections-authorization.md`, `ac-shunt-cycle-stability.md`, `ac-shunt-settings-saves.md`, `ac-shunt-shared-5790-stability.md`, `calibration-disconnect-diagnostics.md`, `weekend-renderer-oom-2026-09-21.md`
- Pipeline: `ac-shunt-uncertalytics-import.md`
- Reports: `report-customer-directory.md`
- Uncertainty features and bias: `uncertainty-bias.md`, `tolerance-bias-comparison-2026-09-18.md`, `bias-coverage-and-tasking-2026-09-18.md`, `input-units-and-bias-verification-2026-09-18.md`, and the dated `uncertainty-*` / `uncertalytics-*` tasking notes (layout, interactions, measurement points, tutorial)
- Risk engine: `Frontend/workbench/src/modules/uncertainty/utils/risk8/MIGRATION_AUDIT.md`
