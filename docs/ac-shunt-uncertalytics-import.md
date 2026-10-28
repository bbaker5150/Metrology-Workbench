# AC shunt budget import

In the full Workbench, open Uncertalytics and choose the lightning button after Unit converter. Search saved AC-shunt sessions, select a session, review its current/frequency points and ppm results, then create a new saved budget. Previous budgets and calibration results stay unchanged. The standalone app does not include the importer.

Each imported point is a direct current measurement in A with a Frequency qualifier in Hz. The signed AC–DC difference is retained as the measured result and shown above the point workspace. It is not added as uncertainty or applied as TI bias.

The AC/DC repeatability row uses the module's saved paired Type A standard uncertainty in ppm, without another division by sqrt(N). Its degrees of freedom are N−1. Pairing, cycle caps and excluded cycles follow the AC-shunt results view. Missing Type A remains incomplete. Each point also receives an independent, editable manual Variability row: ±5 ppm, Rectangular (standard uncertainty 5/sqrt(3) ppm).

All imported TIs use the lab's ±100 ppm acceptance limits. Current ranges are grouped with their frequency qualifiers. A reference is selected from the shared Uncertalytics library, automatically when model and serial identify exactly one entry. The selector handles differently named or duplicate entries. Its existing current/frequency ranges supply the uncertainty. Missing or ambiguous ranges remain incomplete; no frequency interpolation occurs.

The routine snapshot contains only session identity, TI/reference identity, current/frequency, accepted-pair aggregates, source point IDs and stability flags. It does not fetch certificates, reader settings or phase voltage data. It does not rebuild readers, TVCs, transfer equations or manufacturer specifications. Add any remaining instrument contributions through the usual budget editors.

## Initial NIST reference setup

On the next normal backend startup, bootstrap runs `seed_ac_shunt_references`. This creates missing shared A40B/Y5020 reference definitions from the active saved shunt reports on that workstation's database. Each physical serial/range has its own definition and individual ppm uncertainties, grouped by current with frequency qualifiers, as in the supplied example.

The initial distribution is Normal (95%), matching the example. Missing report uncertainties stay unset. The source report, date, serial and physical range are recorded on each range. Setup prefers manual shunt registry entries and the registry's active/pinned report. Stable identities make repeated startup idempotent; existing definitions and later edits are preserved. Certificate updates are managed in Uncertalytics after initial setup.

To run setup separately, from `Backend/ac_shunt` use `python manage.py seed_ac_shunt_references`. This is separate from importing measurement sessions; source calibration records are read-only.

## Focused checks

Use `manage.py test uncertainty.test_ac_shunt_import` and the focused Vitest files `acShuntBudget.test.js`, `acShuntSpecs.test.js`, `AcShuntImportTool.test.jsx`, and `useSessionManager.test.js`.

After hands-on testing is approved, the feature browser check is `node scripts/smoke-ac-shunt-import.mjs`, with `WORKBENCH_URL` pointing to the full Workbench server (default port 3197). It checks the simplified preview, saved point/qualifier/result fields, manual variability, shared reference links and TI limits.
