# Build targets

Two products ship from this repository. **They are not forks.** There is one
`src/`, one test suite, and one dependency tree; the products differ only in
which entry point Vite is pointed at and which config it uses.

| | Metrology Workbench | Uncertainty Budget (Flank Speed) |
| --- | --- | --- |
| Command | `npm run build` → `electron-builder` | `npm run build:singlefile` |
| Entry | `index.html` → `src/main.jsx` | `index.standalone.html` → `src/standalone/main.jsx` |
| Contains | all three modules, Uncertalytics nested among them | the uncertainty module alone |
| Backend | Django, bundled into the installer | SharePoint lists, no backend |
| Ships as | Windows installer | one 6.7 MB HTML file, uploaded to a document library |

The single-file build finishes the job Forge's "ship" step used to do — it
inlines Forge's two runtime scripts and prepends the `WFC-MANIFEST` comment
itself, so the file that comes out of CI is deployable as-is. See
`vendor/forge/README.md`.

A third target, `npm run build:standalone`, is the SharePoint app as a folder of
91 files rather than one. Use it wherever the app can be served from a real URL;
it keeps code splitting and loads less up front. Forge cannot host it — see
`uncertainty-sharepoint-standalone.md` for why.

## Why one tree and not two

The uncertainty module is the same code in both products. `src/modules/uncertainty/**`
is imported by the workbench's module registry (route `/uncertalytics`) and by
the standalone entry point, and neither has a copy of the other's version.

That is deliberate, and it is the reason the SharePoint build substitutes at the
**network boundary** rather than at the call sites: `src/standalone/main.jsx`
installs an axios adapter that recognises the module's
`${API_BASE_URL}/uncertainty/...` requests and services them from SharePoint
instead. Editing every call site would have been the obvious approach and would
have forked the module — leaving two implementations of session handling to keep
in step, and two places for every future fix to land.

A fork would go stale within weeks. The two products drift in *hosting*, which is
a thin, well-defined seam; they must not drift in metrology.

## What changing the tool actually involves

Almost always one place. A change to the UI, the equations, the risk maths, a
table, a chart, or an export is a change to `src/modules/uncertainty/**`, and
both products get it on their next build.

**The exception is a new endpoint.** If a feature calls a backend route the
adapter does not know, the request falls past it to the real network and fails
on SharePoint, where there is no Django to answer. New *fields inside a session*
are free — a session is stored as one whole JSON document, so its shape can
change without touching anything.

That exception is the one failure this layout could hide: it works on a
developer's desk, breaks only on Flank Speed, only in that feature, and only
once somebody tries it. So it is checked rather than remembered —
`src/standalone/sharepoint/moduleRoutesCovered.test.js` reads the module's axios
call sites out of the source and puts each through the real adapter, failing
with the offending file and endpoint if no route matches.

Two other host constraints are enforced the same way, and both are improvements
to the workbench too rather than concessions to SharePoint:

- Assets are imported, not addressed by absolute path — an absolute
  `/asset.png` only resolves when the app is served from the server root.
- Nothing relies on native form submission, which the Flank Speed sanitiser
  blocks; `utils/submitOnEnter.js` provides Enter-to-commit explicitly, and
  `src/standalone/noNativeForms.test.js` fails if a `<form>` reappears.

## Verifying a change to either

```bash
cd Frontend/workbench
npm test                              # 1511 tests, both products
npm run test:coverage                 # same, with the coverage ratchet

npm run build && npm run build:standalone && npm run build:singlefile

npm i --no-save playwright            # deliberately not a project dependency
node scripts/smoke-sharepoint.mjs     # multi-file build, real URL       (9 checks)
node scripts/smoke-forge-srcdoc.mjs   # single-file build, srcdoc frame  (13 checks)
```

CI does the same on every push to `main` (`.github/workflows/uncertainty-singlefile.yml`)
and publishes the single file as a release asset with its SHA-256, so the newest
deployable build is always at a stable URL:

    https://github.com/<owner>/<repo>/releases/latest/download/uncertainty-budget.html

Deploying it is `scripts/deploy-uncertainty.ps1`, which runs on a workstation
rather than a runner — see `uncertainty-sharepoint-standalone.md` for why.

`3demblem.glb` is in Git LFS. Without `git lfs pull` a clone gets a 133-byte
pointer and the workbench launcher's 3D emblem throws while parsing it. The
single-file build is unaffected — it stubs the 3D emblem out.
