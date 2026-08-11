# Test Coverage — state and roadmap

## Running

```bash
cd Frontend/workbench
npm test              # 1273 tests, no coverage instrumentation
npm run test:coverage # same suite + coverage report and threshold check
```

The HTML report lands in `Frontend/workbench/coverage/index.html`.

## Where things stand

| Metric | Before | Now |
| --- | --- | --- |
| Tests | 930 | 1273 |
| Test files | 74 | 91 |
| Statements | 42.66% | 46.02% |
| Branches | 32.99% | 34.88% |
| Functions | 35.57% | 38.18% |
| Lines | 44.34% | 47.72% |

`vite.config.mjs` sets `coverage.all = true`, so a module with no tests reports
as 0% instead of vanishing from the report. Turning that off would inflate every
number above without a single new assertion — don't.

The thresholds in `vite.config.mjs` are a **ratchet, not a target**. They sit
just below the current numbers so a regression fails the build. Raise them as
coverage climbs.

## Why the headline number moves slowly

Coverage here is dominated by a small number of very large components. 58% of
all uncovered statements live in ten files:

| Uncovered stmts | File | Current |
| --- | --- | --- |
| ~3,300 | `features/analysis/components/UncertaintyPanel.jsx` (14,986 lines) | 36% |
| ~1,160 | `ac-shunt/components/calibration/Calibration.jsx` (4,783 lines) | 2% |
| ~950 | `modules/uncertainty/App.jsx` (5,091 lines) | 40% |
| ~500 | `modules/uncertainty/utils/uncertaintyMath.js` | 71% |
| ~470 | `ac-shunt/contexts/InstrumentContext.jsx` | 22% |
| ~440 | `ac-shunt/components/analysis/UncertaintyAnalysis.jsx` | 0% |
| ~390 | `ac-shunt/components/calibration/CorrectionsModal.jsx` | 22% |
| ~375 | `ac-shunt/components/calibration/CalibrationResults.jsx` | 2% |
| ~320 | `ac-shunt/components/instruments/InstrumentStatusPanel.jsx` | 2% |
| ~315 | `features/instruments/components/UniversalInstrumentModal.jsx` | 71% |

A 15,000-line component cannot be meaningfully covered by adding tests to it.
The coverage number is a symptom; the size is the cause.

## What has been prioritized

Pure logic and hooks first — the code where a test failure means a *wrong
number*, not a moved pixel. In a calibration application that ordering matters
more than the headline percentage:

- `utils/risk8/*` — the Risk 8.0 engine, 86%
- `utils/uncertaintyMath.js` — distributions, coverage factors, correlation
  combination, TAR/TUR, PFA/PFR, guard banding, 71%
- `features/analysis/utils/*` — budget assembly, 81%
- Shared infrastructure — config, contexts, the router table, the API client
- Hooks — `useDbHealth`, `useCycleAnalytics`, `useFloatingWindow`,
  `useCalibrationETA`

Wherever possible the assertions are published reference values (Student-t
tables, the exact normal quantile) or *relational* invariants (PFA must rise as
TUR degrades; guard banding must lower PFA and raise PFR). Those catch a
numerics regression. Snapshots of whatever the code currently returns would not.

## Recommended path to high coverage

1. **Extract logic from the three mega-components.** `UncertaintyPanel.jsx`,
   `Calibration.jsx`, and `App.jsx` hold roughly 5,400 uncovered statements
   between them. Pulling their calculation, formatting, and state-transition
   helpers into sibling `*.logic.js` modules makes that code testable without
   mounting the component. This is the single highest-leverage change available
   and it improves the codebase independently of coverage.
2. **Cover the remaining contexts and hooks** — `InstrumentContext` (470),
   `useSessionManager` (263), `useUncertaintyCalculation` (172). These are
   tractable today with the `renderHook` patterns already used in
   `useDbHealth.test.js` and `useCycleAnalytics.test.js`.
3. **Add render-level smoke tests** for the untested modals
   (`EditSessionModal`, `InstrumentBuilderModal`, `UncertaintyAnalysis`,
   `CalibrationResults`). Mount, assert the primary affordances, exercise the
   submit path. Cheap, and they catch import-time and prop-contract breakage.
4. **Raise the thresholds** in `vite.config.mjs` after each step so the gains
   are locked in.
5. **Wire `npm run test:coverage` into CI.** There is no `.github/workflows`
   directory today, so nothing enforces any of this automatically.

## Known gaps in this environment

- `Frontend/workbench/public/3demblem.glb` is stored in Git LFS. A clone without
  `git lfs` installed gets a 133-byte pointer, and the launcher's 3D medallion
  then throws during render. Run `git lfs pull` after cloning.
- `LauncherEmblem.jsx` is excluded from coverage: it is WebGL-only and jsdom
  cannot execute it.
