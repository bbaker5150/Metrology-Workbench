# Forge runtime (vendored)

`devconsole.js` and `testRecorder.js` are **not ours**. They are the runtime
Forge injects into an app when you ship one, captured from a real shipped
artifact on 2026-08-10 and committed here verbatim.

They are vendored because Forge is a scaffolding tool for building apps without
a repository, and this app has one. Everything Forge's ship step does mechanically
— inline these two files, prepend a manifest — the build now does itself, which
is what lets a push to `main` produce a finished, deployable file with no
workstation in the loop.

## Do not edit these files

Their bytes are hashed into the `WFC-MANIFEST` comment at the top of the built
page. Reformatting them, normalising line endings, or running them through a
linter changes the hash and makes the manifest wrong.

For the same reason the single-file build injects them **after**
`hardenInlineHtml` has run, and excludes them from its scan. Both contain `</`
inside string literals, which that pass would otherwise escape.

## Refreshing them

Forge will update its runtime eventually, and a stale copy here is the sort of
thing nobody notices. To refresh: ship any app through Forge, take the two files
out of the project folder, drop them in here, and run the tests. The hashes in
`scripts/forgeRuntime.mjs` are asserted against the vendored bytes, so a
mismatch fails the build rather than shipping a runtime that disagrees with its
own manifest.

## What they do

`devconsole.js` installs `window.__PseudoDevConsole` and patches `console` and
`fetch` — it has to run before the app, so it is injected at the top of `<head>`.
`testRecorder.js` records interactions and is injected before `</body>`.

Neither renders the "Not Secured — Ship in Forge before entering CUI/sensitive
data" banner: that comes from the host page, which looks for the globals these
scripts install and for the button ids they expect (`wct-devconsole-button`).
Including them is what makes the host treat the page as a shipped app.
