# Uncertainty tool — standalone SharePoint build

Hosts the uncertainty budget tool as a plain HTML/JS app inside a SharePoint
site, with sessions persisted to SharePoint lists and **no Django backend**.

It exists because deploying an SPFx web part needs write access to a tenant App
Catalog, which is centrally held on Flank Speed. This build needs nothing but
permission to upload files to a document library and create lists on one site.

## Build

```bash
cd Frontend/workbench
npm install
npm run build:standalone     # -> build-standalone/
```

Output is ~15 MB on disk, **1.8 MB gzipped over the wire**, entry `index.html`.
Assets use relative URLs, so the bundle works from whatever folder it lands in.

## Deploy

1. Create (or pick) a document library folder on the site, e.g.
   `Assets/Software/Uncertainty`.
2. Upload the **entire contents** of `build-standalone/` into it — `index.html`,
   `assets/`, and the loose files beside them. Keep the structure; the app loads
   its chunks relative to `index.html`.
3. Point the App page web part's **HTML File URL** at the uploaded
   `index.html`, e.g.
   `/sites/ISEA/Assets/Software/Uncertainty/index.html`.
4. Load the page. On a site that has never run the tool you get a setup card
   listing the containers it needs — press **Create them now**. You need Edit or
   Full Control on the site.

Setup is idempotent and strictly additive: it only creates what is missing and
never deletes or retypes anything, so it is safe to run again after any error.

### Containers created

| Name | Type | Holds |
| --- | --- | --- |
| `UncertaintySessions` | Document library | One JSON file per session |
| `UncertaintyInstruments` | List | Shared instrument definitions |
| `UncertaintyEquations` | List | Shared custom equations |
| `UncertaintyBugReports` | List | Bug reports raised in-tool |

### Optional configuration

Edit the `<head>` of the deployed `index.html` in place — no rebuild:

```html
<script>
  window.UNCERTAINTY_CONFIG = {
    listPrefix: 'LabB',                      // run a second isolated instance
    webUrl: 'https://tenant/sites/other'     // target a different web
  };
</script>
```

## How it works

### The module is not forked

`modules/uncertainty/**` is the same code the Electron/Django product runs. The
only substitution happens at the network boundary: `src/standalone/main.jsx`
installs an **axios adapter** that recognises the module's
`${API_BASE_URL}/uncertainty/...` calls and services them from SharePoint.

That was the whole point of the design. Editing every call site would have
forked the module and left two implementations of session handling to keep in
step. Instead there is one, and a fix lands in both products.

Anything not matching an uncertainty route falls through to the real network
adapter untouched.

### Storage shape

Sessions are one JSON file each in a document library rather than rows across
ten lists. The Django backend's own module docstring explains why that fits:
the frontend *"treats a session as one deeply-nested document that it loads and
saves whole"*, and its REST surface only ever wrote whole sessions.

A multiline text column would have been simpler, but SharePoint caps a Note
field well below the size a budget with many test points reaches, and the
failure mode is a **silently truncated** session. The fields the picker needs
are promoted to real indexed columns.

One consequence worth knowing: the module's session list endpoint returns whole
documents, not summaries — `loadData` calls `replaceSessions(res.data)` and then
works from memory. So opening the tool reads every session file. Requests run
with bounded concurrency (6) because unbounded would trip SharePoint throttling
and serial would make a 30-session site slow to open.

### Auth

No SPFx runtime means no `SPHttpClient`, so the plumbing in
`src/standalone/sharepoint/spContext.js` reconstructs what it provided:

- **Which web are we in?** Tried in order: `_spPageContextInfo` on our window,
  the same on the parent frame (legal because same-origin; wrapped because a
  cross-origin parent throws), then derived from `/sites/<name>` in our own
  path, with a `?webUrl=` override for testing.
- **Form digest.** SharePoint rejects writes without one. It is fetched from
  `/_api/contextinfo` and cached until just before the server-reported expiry —
  the tool sits open on a desk for hours, so a digest cached for the page
  lifetime would start failing every save after 30 minutes.

All requests use `credentials: 'include'` against the same origin.

## Testing

```bash
npm test                              # 1032 tests, includes 102 for this build
node scripts/smoke-sharepoint.mjs     # end-to-end in a real browser
```

The smoke test serves the built bundle from a SharePoint-shaped path, simulates
the REST API with Playwright route mocking, and drives the whole chain: web URL
discovery, digest, the storage gate detecting an unprovisioned site,
provisioning all four containers, the app mounting, and the session list coming
back through the adapter. It needs `npm i -D playwright` (deliberately not a
project dependency).

## Status

**Verified here**

- Builds; 102 unit tests over the SharePoint layer and adapter
- All 9 end-to-end smoke checks pass in Chromium against a mocked SharePoint
- The workbench's own 930 tests still pass — nothing regressed

**Not verified**

- **No call has run against a real SharePoint tenant.** Provisioning and the
  first save/load round trip need a manual pass. The REST shapes are asserted
  against a double, which is not the same as a live site accepting them.
- How the App page web part actually hosts the file — iframe versus inline
  injection — was inferred, not observed. If it injects the HTML inline rather
  than framing the file URL, module scripts will not execute and the page will
  need the iframe route instead.

**Known limitation**

`public/3demblem.glb` is stored in Git LFS. A clone without `git lfs` gets a
133-byte pointer and the 3D emblem fails to parse; run `git lfs pull`.

## One module change

`HeaderEmblem.jsx` referenced `/3demblem.glb` and `/navair-seal-384.webp` by
absolute path. Those only resolve when the app is served from the server root —
true for the dev server and Electron's `file://` load, false for a bundle in a
library subfolder. Both now go through `import.meta.env.BASE_URL`, which is the
identical URL wherever the app already worked. It is a correctness fix that
benefits both builds, not a SharePoint-specific fork.
