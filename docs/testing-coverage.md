# Testing and coverage

Tests live alongside the implementation in `Frontend/workbench/src`. The source
of truth for test configuration is [vite.config.mjs](../Frontend/workbench/vite.config.mjs);
the release workflow is [uncertainty-singlefile.yml](../.github/workflows/uncertainty-singlefile.yml).
Do not treat an old test count or coverage percentage as the current result.

## Validation order

[AGENTS.md](../AGENTS.md) defines the repository handoff: complete the requested
change and relevant focused checks, push to main, then allow hands-on testing.
Full tests, builds, browser release gates and pipeline verification wait for the
user's explicit go-ahead. GitHub Actions may start automatically after a qualifying
push; that does not mean the release has been inspected or verified.

## Focused checks

From `Frontend/workbench`, select the files or directory relevant to the change:

```sh
npx vitest run src/modules/uncertainty/utils/risk8
```

For mathematical changes, use independent expected values, published reference
values, workbook captures and physical invariants. Do not generate expected
results from the calculator under test. The [final V8.00 audit](../Frontend/workbench/src/modules/uncertainty/utils/risk8/FINAL_V8_AUDIT.md)
distinguishes saved final-workbook outputs, historical Excel captures and
source-based checks, and records the focused command used for that audit.

## Full validation

Once the release-validation phase is authorized:

```sh
npm audit --audit-level=high
npm test
npm run build:singlefile
npx playwright install chromium
node scripts/smoke-forge-srcdoc.mjs
```

Run relevant feature smoke selections from the workflow as well. Playwright is a
project development dependency; the browser installation is a separate step.
Verify the exact pushed commit's workflow and published artifact before reporting
release validation complete. A passing local build alone does not prove deployment.

Backend checks run in the configured Python environment from `Backend/ac_shunt`,
for example `python manage.py test uncertainty`. Select the relevant app or test
module and use the environment required by those tests; frontend results do not
validate acquisition hardware, SQL Server or Django behavior.

## Coverage

```sh
npm run test:coverage
```

The report is written to `Frontend/workbench/coverage/`, including
`index.html` and `coverage-summary.json`. The configuration includes all source
files so untested modules remain visible. Thresholds are maintained in
`vite.config.mjs`; increase them when supported by measured coverage and do not
lower them to hide a regression.

The CI workflow currently runs tests but does not invoke `test:coverage`.
Coverage is therefore a separately requested check, not an implied property of a
successful release workflow. WebGL-only presentation wrappers excluded from jsdom
coverage require suitable browser or Electron verification when changed.
