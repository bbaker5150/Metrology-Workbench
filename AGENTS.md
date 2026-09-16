# Push and pipeline verification

The user requires pipeline failures to be fixed before pushing. This applies
even when the changed feature's targeted tests pass.

- Inspect the latest GitHub Actions run for the branch and read failed-step logs.
- Fix every known failure; do not dismiss it as unrelated or replace a failing
  behavior assertion with a weaker one just to make the pipeline green.
- Before pushing workbench changes, run the release gates from
  `.github/workflows/uncertainty-singlefile.yml` in `Frontend/workbench`:
  `npm audit --audit-level=high`, the complete `npm test` suite,
  `npm run build:singlefile`, and `node scripts/smoke-forge-srcdoc.mjs`.
  Run relevant feature smoke checks in addition to these gates. If dependencies
  change, verify a clean `npm ci` installation too.
- Do not push while a required local gate is failing. Fix the cause and rerun
  the affected gate; targeted test runs alone do not replace the full suite.
- After pushing, inspect the pipeline for that exact commit and verify success
  before calling the change complete. A local build does not establish that
  the remote release was published. Report any remote failure honestly and
  resolve it through the same pre-push checks.

GitHub Actions for this repository starts on push to `main`. The pre-push gate
is therefore the equivalent local validation plus resolution of known remote
failures; the new commit's remote result is verified after its push.
