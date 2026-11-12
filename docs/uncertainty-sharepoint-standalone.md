# Uncertainty tool — standalone SharePoint build

Hosts the uncertainty budget tool as a plain HTML/JS app inside a SharePoint
site, with sessions persisted to SharePoint lists and **no Django backend**.

It exists because deploying an SPFx web part needs write access to a tenant App
Catalog, which is centrally held on Flank Speed. This build needs nothing but
permission to upload files to a document library and create lists on one site.

## Two builds — pick by how it will be hosted

| | `build:standalone` | `build:singlefile` |
| --- | --- | --- |
| Output | folder, 91 files | **one 6.7 MB HTML file** |
| Over the wire | 1.84 MB gzipped, lazy-loaded | 2.5 MB gzipped, all up front |
| Needs a real URL | **yes** | no |
| Works in an `<iframe srcdoc>` | no | **yes** |
| 3D header medallion | yes | no (static seal instead) |

**The app page injects the HTML into an `<iframe srcdoc>`**, and something
sanitises it on the way in. A srcdoc document has no URL of its own, so
relative paths have nothing to resolve against and every chunk, font, and image
request fails. Only the single-file build survives that.

Use `build:standalone` anywhere the app can be served from a real URL — it
keeps code splitting and loads less up front.

```bash
cd Frontend/workbench
npm install
npm run build:standalone     # -> build-standalone/            (real URL host)
npm run build:singlefile     # -> build-singlefile/uncertainty-budget.html  (deployable)
```


## Removing records without bulk-delete prompts

In the SharePoint build, Delete removes a record from the app by archiving its
content through ordinary updates. It does not call SharePoint delete, recycle,
or batch endpoints. This applies to sessions, builder instruments (including
multiple selections and linked-local cleanup), equations, reports, and images.
Browser or hosting-page security settings are not changed.

Archived list rows retain their full `PayloadJson` with an
`_uncertaintyArchive` marker containing the timestamp and acting user ID.
Archived session/image files retain their JSON with the same marker. A session's
`SessionId` metadata is cleared so it leaves the picker; its JSON still contains
the original ID. Reads also exclude the marker if a metadata update was interrupted.
Archiving uses the existing payload field. Lists are paged completely so retained
archives do not hide active records on later pages.

These records remain in the original SharePoint containers, not the recycle bin.
To recover a record, a site maintainer can remove the marker from its JSON; for a
session, also restore its `SessionId` metadata from the JSON's `id`. Deploy this
updated HTML file to activate the behavior; an older open page must be reloaded.

Validation: 149 focused tests and 19 checks of the built HTML in an embedded
browser passed, including session removal, multiple builder selections, reload,
retained content, and absence of native dialogs or destructive requests.

## Deploy to SharePoint (single file)

Ship `build-singlefile/uncertainty-budget.html`. It is the only thing in
`build-singlefile/` and the only thing to upload: all JavaScript, CSS, fonts,
and images are inlined as data URIs, so the page makes zero subresource
requests and has nothing to resolve.

Storage still works from inside an `<iframe srcdoc>`, which is how the app page
hosts it: the frame **inherits the parent page's origin**, so same-origin
`/_api/` requests carry cookies and the parent's `_spPageContextInfo` is
readable. That is how the tool finds which SharePoint web it is in, since its
own `location.pathname` is just `"srcdoc"`.

Forge is no longer in the chain. The build does its ship step itself — see
`vendor/forge/README.md` — so a file straight out of CI is deployable.

### One-time setup

The point of this arrangement is that **the URL never changes**, so the app
page is configured once and every later deploy is a file overwrite.

1. **Create a dedicated document library**, e.g. `AppFiles`. Not `Shared
   Documents` — a separate library keeps deploy permissions and file churn away
   from everyday documents.
2. **Turn on versioning** (Library settings → Versioning settings), keeping
   ~50 major versions. This is what makes overwriting in place safe: rollback
   is right-click → Version history → Restore.
3. On that same page, **turn two things off**, both of which break "always
   latest" silently rather than loudly:
   - *Require content approval* — with it on, an upload stays a draft and every
     reader keeps seeing the previous build.
   - *Require check out* — otherwise overwrites fight the checkout state.
4. **Set permissions**: Contribute for whoever deploys, Read for everyone who
   uses the tool. The app page fetches the HTML **as the signed-in user**, so a
   user without Read on the file gets a blank page that looks like a code bug.
5. **Upload the file once** as `uncertainty-budget.html` and note its
   server-relative path, e.g.
   `/sites/ISEAMETENG/AppFiles/uncertainty-budget.html`. Take it from the
   Details pane, not the "Copy link" button — that produces a sharing link,
   which is a different thing and will rot.
6. **Point the app page at that path, publish, and do not edit the page again.**
7. **Sync the library** (library → Sync) so it appears as a local folder.

### Every deploy after that

```powershell
pwsh Frontend/workbench/scripts/deploy-uncertainty.ps1 -LibraryPath '<synced folder>'
```

It downloads the newest release, checks it against the published SHA-256,
skips the copy if the library already holds those exact bytes, and otherwise
overwrites the file. OneDrive syncs it up as you, with the permissions you
already have — no app registration, no admin consent, and no credential that
could write to a `.mil` tenant sitting in commercial CI.

Nothing in the pipeline touches SharePoint, deliberately. A GitHub-hosted
runner cannot reach a DoD tenant, and storing a credential that could is a
policy question before it is a technical one. The last hop stays on a
CAC-authenticated workstation.

Caching: the app page usually revalidates, but a browser can hold the old file.
That is what the build stamp is for — `<meta name="x-uncertainty-build">` and
`window.__UNCERTAINTY_BUILD__` — so "am I looking at the new build?" is a
question with an answer rather than a guess. Ctrl+F5 clears it.

The 3D header medallion is absent in this build — `useGLTF` fetches the model
at runtime, which a single file cannot do. The static seal it already renders
underneath shows instead, and dropping three.js keeps ~1 MB out of the bundle.

### Nothing in the file may look like a tag

Forge does not hand the file to the browser untouched; something reads and
filters it first. The first ship attempt came back a blank page with
`Uncaught SyntaxError: Unexpected identifier 'testRecorder'` — and
`testRecorder` appears nowhere in our bundle, so by the time that error was
raised the script had already been cut somewhere it should not have been and
Forge's own injected instrumentation had landed in the wound.

The browser's parser was never the problem. Inside a `<script>` element only
the exact sequence `</script` ends the element, and `vite-plugin-singlefile`
escapes that. But the bundle is full of markup that is only ever *data*: React
ships the literal `"<script><\/script>"`, mathjs emits `'<span
class="math-…">'` several hundred times, and the print path writes a whole
`<style>` block into a popup window. Anything that scans for `<script` or
`<style` instead of running the real tokeniser finds those and splits the file
in the wrong place.

So `scripts/hardenInlineHtml.mjs` leaves nothing to find. It parses the inlined
bundle and rewrites `<` to `\x3c` — the same character to a JavaScript engine,
invisible to an HTML scanner — but only inside string literals, template
chunks, and regular expressions. That restriction is the whole difficulty:
search-and-replace cannot be used because `<` is also the less-than operator,
where `\x3c` is a syntax error. Driving it from the AST is what keeps `i < n`
untouched while `"<span>"` gets escaped.

Two assertions keep it honest, both fatal to the build:

- After rewriting, the literal values are re-read from the new AST and compared
  against the originals, so an escape that changed a *value* rather than its
  spelling fails immediately. This is what catches the one real trap: in
  `(?<name>` and `\k<name>` the `<` is regex grammar, not a character, and
  escaping it yields a pattern that will not compile.
- The finished document is scanned for `</`, `<script`, `<style`, `<iframe`,
  `<!--`, and `-->` anywhere inside a script or style body. The rewrite only
  covers what the parser classifies as data, so this is the net under it — a
  future dependency that hides markup in a legal comment fails the build rather
  than the ship.

### Nothing may rely on native form submission

Firepit blocks it, including the implicit submission a `<button>` performs
inside a form without `type="button"`. A form that works everywhere else fails
in the shipped app the worst possible way: the click lands, nothing happens, no
error.

The tool's own two editing panels are no longer forms at all — they call their
handlers from `onClick`, with `utils/submitOnEnter.js` restoring the one thing
the `<form>` was still earning, Enter in a single-line field. A source check
(`src/standalone/noNativeForms.test.js`) fails the suite if a `<form>` or a
submit button reappears anywhere that ships.

Bundled dependencies are a different matter — the docx editor's hyperlink
dialog is a real form, and forking a dependency to change two attributes is not
worth it. `src/standalone/formSubmitShim.js` covers those: on a submit-button
click it cancels the click and dispatches the `submit` event itself. React
listens for that event at the root, so the handler runs; and dispatching an
event is not a form submission, so there is nothing for the host to block.

## Deploy to a document library (multi-file)

Only where the app can be reached at a real URL. An app page that renders into
an `<iframe srcdoc>` cannot host it, because a srcdoc frame has no URL for the
chunk requests to resolve against.

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

Setup creates missing containers and columns, applies item access settings on the instrument lists, and migrates previously shared instruments to the published catalog. It can resume after an interruption.

### Containers created

| Name | Type | Holds |
| --- | --- | --- |
| Uncertalytics - Sessions | Document library | One JSON file per session |
| Uncertalytics - Instruments | List | Original library, restricted to historical item authors |
| Uncertalytics - Published Instruments | List | Published instrument definitions |
| Uncertalytics - Instrument Drafts | List | Private working definitions and pending submissions |
| Uncertalytics - Equations | List | Shared custom equations |
| Uncertalytics - Bug Reports | List | Bug reports raised in-tool |

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

### Creating columns

Provisioning posts **Field schema XML** to `fields/createfieldasxml`, not a JSON
object to the `/fields` collection. The first live run proved why: that
collection is polymorphic — `SP.FieldText`, `SP.FieldNumber`,
`SP.FieldMultiLineText` — so a body with no OData type annotation gives
SharePoint no way to know what to create, and it answers a bare **HTTP 400**.
Creating the lists themselves works untyped, because `SP.List` is unambiguous.

Schema XML says the type in the payload, and collapses three requests into one.
`Name` plus the `AddFieldInternalNameHint` option fixes the internal name
exactly, so there is no create-under-one-name-then-rename dance and no column
called `Session_x0020_Id`; `AddFieldToDefaultView` handles view membership.

Both smoke tests now answer 400 to a plain `POST …/fields`, the way the tenant
did, so the working shape stays the only one that passes.

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

### Errors say what SharePoint said

A failed call reports the sentence SharePoint put in the response body —
"A duplicate field name … was found", "Column limit exceeded" — alongside the
status. Reporting a bare `failed (HTTP 400)` sends whoever is holding it into
network traces looking for an explanation that was already in hand. Three body
shapes are parsed because the format follows the OData flavour the request
asked for.

## Testing

```bash
npm test                              # 1125 tests, includes 195 for this build
node scripts/smoke-sharepoint.mjs     # multi-file build, served from a real URL
node scripts/smoke-forge-srcdoc.mjs   # single-file build, inside an iframe srcdoc
```

Both smoke tests serve the built bundle from a SharePoint-shaped path, simulate
the REST API with Playwright route mocking, and drive the whole chain: web URL
discovery, digest, the storage gate detecting an unprovisioned site,
provisioning all six containers, the app mounting, and the session list coming
back through the adapter. They need `npm i --no-save playwright` (deliberately not a
project dependency) and the matching build to have been run first.

The srcdoc one also checks what a browser is too forgiving to catch: that the
file contains nothing a sanitiser could mistake for markup, and that every
image in the mounted app is embedded and actually decoded — an unresolvable
`src` inside a srcdoc frame fails silently, leaving a blank element rather than
a failed request.

## Status

**Verified here**

- **Shipped through Forge onto Flank Speed and it runs.** Forge passes the
  inlined bundle through byte-for-byte — its own 60 KB preamble (manifest
  comment, `devconsole.js`, `testRecorder.js`) is prepended and nothing of ours
  is rewritten. The page loads, finds its web, and reaches the REST API.
- Both builds compile; 219 unit tests over the SharePoint layer, the adapter,
  and the sanitiser hardening
- 9/9 smoke checks for the multi-file build served from a real URL
- 10/10 smoke checks for the single-file build inside an `about:srcdoc` frame:
  holds no sequence a sanitiser could read as markup, boots with zero failed
  subresource requests, discovers the web from the parent frame, provisions all
  six containers, mounts, and renders its images from embedded bytes
- The workbench's own tests still pass — 1492 in total, nothing regressed

**Not verified**

- **The first save/load round trip.** Provisioning has now run against a real
  tenant, but no session has been written and read back. The remaining REST
  shapes are asserted against a double, which is not the same as a live site
  accepting them — column creation is the proof of that (see below).
- Whether every container provisions cleanly end to end on a site that already
  has some of them, which is the state a partly-failed first run leaves behind.
- Whether Forge's iframe carries a `sandbox` attribute. Without
  `allow-same-origin` the frame gets an opaque origin, cookies are not sent,
  and SharePoint persistence becomes impossible from inside — the tool would
  need a different storage story. The smoke test assumes no sandbox, matching
  the observed `about:srcdoc` behaviour.

**Known limitation**

`public/3demblem.glb` is stored in Git LFS. A clone without `git lfs` gets a
133-byte pointer and the 3D emblem fails to parse; run `git lfs pull`. This
affects the dev server, Electron, and the multi-file build; the single-file
build stubs the 3D emblem out entirely.

## Module changes

Three, all of them fixes rather than SharePoint-specific forks —
`modules/uncertainty/**` is otherwise the same code the Electron/Django product
runs.

`HeaderEmblem.jsx` addressed both of its assets by absolute path, which only
resolves when the app is served from the server root: true for the dev server
and Electron's `file://` load, false for a bundle in a library subfolder. The
`.glb` now goes through `import.meta.env.BASE_URL` — the identical URL wherever
the app already worked. The still seal is *imported* rather than addressed,
because a srcdoc frame has no URL to resolve against at all; as a module asset
it is hashed in the normal builds and inlined as a data URI in the single-file
one. It moved from `public/` to `src/assets/` to make that possible, and
`index.html` lost its now-pointless preload of the old path.

`BugReportModal.jsx` and `EquationLibraryMenu.jsx` were forms with submit
buttons. Neither is a form now: the buttons call their handler from `onClick`,
and `utils/submitOnEnter.js` keeps Enter working from a single-line field —
including the cases the browser also declined, so a textarea still takes
newlines. Nothing depends on the form machinery Firepit blocks.

## Visible storage names (October 2026)

Use the same `App - Content` display-name convention as Modernization Tracker:

| Display name | SharePoint type | Legacy name recognized by the app |
| --- | --- | --- |
| Uncertalytics - Sessions | Document library | UncertaintySessions |
| Uncertalytics - Instruments | List | UncertaintyInstruments |
| Uncertalytics - Published Instruments | List | UncertaintyPublishedInstruments |
| Uncertalytics - Instrument Drafts | List | UncertaintyInstrumentDrafts |
| Uncertalytics - Equations | List | UncertaintyEquations |
| Uncertalytics - Bug Reports | List | UncertaintyBugReports |

New containers are visible in Site contents. Existing deployments need one explicit organization pass: deploy the new single-file HTML, open the app as an owner, click the **Storage administration** database icon in the app header, then choose **Organize storage**. The button appears automatically for users with Manage Lists permission; no keyboard shortcut is needed. Check all six entries show Visible. Close/reload other app tabs after renaming.

Organization updates titles, descriptions, Hidden=false, and OnQuickLaunch=false using existing list IDs. Sidebar links are not added. It preserves records, attachments, permissions, internal URLs, and library contents. Original internal titles and previous `Uncertalytics — ...` display names remain readable; no data migration or replacement containers are needed. Destination collisions stop before metadata changes, interrupted updates can be retried, already-correct metadata is skipped, and the result is read back before success is reported. Visibility is not an access restriction.

## Instrument review and SharePoint permissions

Members of **Metrology Software Owners** can review and approve submissions until the **Uncertalytics SME** SharePoint site group exists. Creating that group transfers review access immediately, even if the group is empty. Add each intended reviewer to it, including owners who should keep reviewing, and grant the list access shown below. The app checks eligibility when opening the validation inbox and again at approval.

General users can submit an orange local instrument for review. It stays yellow in their library until a reviewer confirms publication.

Editing a shared instrument in a session gives that session an independent **Session only** definition. It preserves the shared origin for a later submission and does not save a Local library entry automatically. The user can explicitly save the edited instrument to their Local library with its **Status** icon. Right-clicking a shared Status icon to make a Local copy is available only to eligible SMEs, with reviewer access checked again when saving. General users can still withdraw their own pending submission to Local.

In the validation inbox, click a submission's **Status** icon to **Validate** it or **Return to Local**. Returning it keeps the submitted specifications and original author, clears the pending review, and restores it to the submitter's private Local library. It does not add a local copy to the reviewer's library or change an existing published instrument. Both actions require the current review version; reopen the inbox if someone has already changed, withdrawn, returned, or approved the submission.

Run the storage setup as a site owner when deploying this version. Setup restricts the historical **Instruments** list to owner reads and manager writes, adds **Instrument Drafts** and **Published Instruments**, and copies prior shared definitions to the published list. It preserves the historical item authors and IDs. The owner needs Manage Lists on all three lists during the upgrade. The app opens once setup marks the migration complete. An owner can rerun interrupted setup. Existing shared instruments retain their IDs. The app reads older local rows for their creator. Their next edit or removal writes a private copy that supersedes the original row.

If setup previously stopped on the unique-values error for **Uncertalytics - Instrument Drafts**, replace the hosted HTML with the corrected file, reload the app, and run the setup action shown. Setup reuses the partial list and creates its indexed draft ID field with uniqueness enforcement disabled.

| Resource | Metrology App Users | Uncertalytics SME | Metrology Software Owners |
| --- | --- | --- | --- |
| App page and Site Assets | Read | Read | Full Control |
| Sessions, Equations and Bug Reports | Contribute | Contribute | Full Control |
| Original Instruments | Read | Read | Full Control |
| Published Instruments | Read | Manage Lists and Contribute | Full Control |
| Instrument Drafts | Contribute | Manage Lists and Contribute | Full Control |

Apply these grants at the list level. A list-scoped Edit permission level normally includes Manage Lists and Contribute. Reserve Manage Lists on the instrument lists for reviewers and administrators. Check inherited grants and any unique item permissions before rollout.

If app users cannot see published instruments, check their group's Read grant on **Published Instruments**. If an owner can see only their own submissions, check the owner's Full Control grant on **Instrument Drafts**, not just the site. The app now verifies the reviewer's Manage Lists permission on Drafts and reports a missing grant instead of presenting an incomplete inbox as an empty queue. The SME-group handoff rule above still applies.

Library and inbox request failures provide copyable error details and retry controls, including HTTP status and request ID when available. The earlier instrument access report has been removed from the app.

Use the Description column's filter menu to select Manufacturer, Model, Name, or Tag values and sort by that field. Status filters distinguish Local, Awaiting validation, and Shared instruments. Selected values within one field are alternatives; filters across fields combine. The inbox icon appears for eligible reviewers only while submissions await validation.

Opening the library reloads newly published instruments and updated shared definitions while preserving local edits and submissions that are still being saved. A failed refresh retains the last known library and shows an error rather than silently treating it as current.

* **Instrument Drafts** uses ReadSecurity 2 and WriteSecurity 2. SharePoint restricts general users to reading and editing their own rows. Manage Lists lets reviewers read submissions from other users. The inbox displays pending rows. An approval copies the reviewed definition to the catalog. [Microsoft SharePoint list security settings](https://learn.microsoft.com/en-us/sharepoint/dev/schema/security-element)
* **Original Instruments** uses ReadSecurity 2 and WriteSecurity 4. Each ordinary user can read their own historical local rows.
* **Published Instruments** uses ReadSecurity 1 and WriteSecurity 4. All app users can read the catalog. Publishing through the app requires reviewer eligibility and write access to this list. A list owner can still administer content directly through SharePoint. [Microsoft SharePoint write permissions](https://learn.microsoft.com/en-us/openspecs/sharepoint_protocols/ms-primepf/f396c2d2-3348-48f5-b3cc-0f116ddef837)
* The app checks the instrument list settings and migration status before reading or writing instrument definitions. SharePoint uses its own signed-in identity, item versions and list permissions for the writes. Shared deletion requires current SME eligibility and SharePoint write permission; no shared password is used. The confirmation distinguishes removal of the user's private instruments from shared removal for everyone. General users can remove their own private instruments.

After setup, test with two ordinary accounts and one reviewer. Submit an instrument with the first ordinary account, reopen its library, and confirm the second account cannot retrieve that private draft. Review and confirm the submission with the SME account. After reloading, both ordinary accounts should see the green shared definition. Repeat with an edit to an existing shared instrument to check that its original specifications remain visible until approval.

Apply uncertainty migration 0020 for the Django workbench. Django uses the same group names and handoff rule in its own auth database. **Metrology Software Owners** members can review until the **Uncertalytics SME** auth group exists. Add the intended reviewers to that group when you create it. Serve the workbench with a same-origin API and an authenticated Django session for approvals. Anonymous device installations may submit using a private device credential.

Existing Django local definitions remain accessible using the original browser's owner key. The first edit or submission creates a private working copy tied to the signed-in user or device credential. Deleting a legacy definition hides it for that user. Its original data remains available to other existing devices with the historical owner key.
