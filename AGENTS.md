# Push and pipeline verification

The user wants to test changes before time-consuming validation (updated October 9, 2026).

- Finish the requested changes and relevant focused checks, then push to main.
- After pushing, tell the user the changes are ready for hands-on testing and
  stop. Wait for their explicit go-ahead before full tests, builds, browser
  release gates, GitHub pipeline verification, or release publication.
- GitHub Actions currently starts automatically on frontend pushes. Do not
  manually start or monitor full validation during the user testing phase.
- Only after the user's go-ahead, run the release gates from
  `.github/workflows/uncertainty-singlefile.yml` in `Frontend/workbench`:
  `npm audit --audit-level=high`, the complete `npm test` suite,
  `npm run build:singlefile`, and `node scripts/smoke-forge-srcdoc.mjs`.
  Run relevant feature smoke checks too. If dependencies change, verify `npm ci`.
- Inspect GitHub Actions for that exact commit and read any failed-step logs.
  Fix failures without weakening behavior assertions, commit and push the fix,
  and rerun the affected checks.
- Verify the exact commit's remote pipeline and published release before calling
  release validation complete. This is not required for the hands-on testing
  handoff. A local build alone does not establish release publication.
- Tell the user when the changes are pushed and when validation finishes.
