# Push and pipeline verification

The user wants changes pushed for hands-on testing before the longer full build
and pipeline checks (updated September 29, 2026).

- Finish the requested changes and relevant focused checks, then push to main.
- After pushing, run the release gates from
  `.github/workflows/uncertainty-singlefile.yml` in `Frontend/workbench`:
  `npm audit --audit-level=high`, the complete `npm test` suite,
  `npm run build:singlefile`, and `node scripts/smoke-forge-srcdoc.mjs`.
  Run relevant feature smoke checks too. If dependencies change, verify `npm ci`.
- Inspect GitHub Actions for that exact commit and read any failed-step logs.
  Fix failures without weakening behavior assertions, commit and push the fix,
  and rerun the affected checks.
- Verify the exact commit's remote pipeline and published release before calling
  the work complete. A local build alone does not establish release publication.
- Tell the user when the changes are pushed and when validation finishes.
