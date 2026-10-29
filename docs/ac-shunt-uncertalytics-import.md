# AC shunt budget import

In the full Workbench, open Uncertalytics and choose the lightning button after Unit converter. Search saved AC-shunt sessions, select a session, review its current/frequency points and ppm results, then create a new saved budget. Previous budgets and calibration results stay unchanged. The standalone app does not include the importer.

Each imported point is a direct current measurement in A with a Frequency qualifier in Hz. On first opening an imported budget, Section is hidden and Qualifier appears immediately after Value (for example, `1000 Hz`). Later column customizations persist for that budget. The signed AC–DC difference is retained as the measured result and shown above the point workspace. It is not added as uncertainty or applied as TI bias.

The AC/DC repeatability row uses the module's saved paired Type A standard uncertainty in ppm, without another division by sqrt(N). Its degrees of freedom are N−1. Pairing, cycle caps and excluded cycles follow the AC-shunt results view. Missing Type A remains incomplete. Each point also receives an independent, editable manual Variability row: ±5 ppm, Rectangular (standard uncertainty 5/sqrt(3) ppm).

For the supplied example, the signed result is −0.070 ppm and the repeatability row uses the full saved standard uncertainty, 0.6150070189859945 ppm, with 4 degrees of freedom for 5 pairs. The preview labels this as standard Type A (k = 1). Newer AC-shunt result cards label their ± value as expanded Type A (k = 2); that display is twice the standard value and is not used as a standard input to the budget.

The actual TI and reference are matched automatically to the shared Uncertalytics library by model and serial. The import menu only requires selecting the saved session; it has no TI or standard selectors. The TI table displays the library make, model and serial and retains the library link, just like the TMDE table. If a TI has no unique match, correct its library identity before retrying. The importer does not invent a generic TI. Library TI ranges initially use the lab's ±100 ppm acceptance limits, grouped by current with frequency qualifiers. Subsequent library edits are preserved. Reference current/frequency ranges supply their individual uncertainty. Missing or ambiguous ranges are flagged for review; no frequency interpolation occurs. The TMDE name stores its description separately from make/model, and repeated identity prefixes from earlier imports are displayed only once.

Shunt library names and new imports use `Fluke {A40B or Y5020} {serial} {rated range} {CHECK STD or NIST}`. For example: `Fluke Y5020 3845014 20 A CHECK STD` and `Fluke Y5020 5965004 20 A NIST`. Manufacturer and model stay in their own fields; serial, range and standard designation occupy Description. Both instrument tables display those fields in the same order. Older budgets retain their saved definitions until the library instrument is synced or the session is imported again.

The routine snapshot contains only session identity, TI/reference identity and configured shunt range, current/frequency, accepted-pair aggregates, source point IDs and stability flags. Model, serial and rated range support automatic matching independently of the display name. It does not fetch certificates, reader settings or phase voltage data. It does not rebuild readers, TVCs, transfer equations or manufacturer specifications. Add any remaining instrument contributions through the usual budget editors.

## Initial instrument setup

On the next normal backend startup, bootstrap runs `seed_ac_shunt_references`. This creates missing shared A40B/Y5020 standards, including Check STD catalog entries that have not appeared in a saved session. Each physical serial/range has its own definition and individual ppm uncertainties from its active saved report, grouped by current with frequency qualifiers. Labeled catalog entries without report values are included with their uncertainty unset. Legacy generic `Shunt` catalog models use A40B, matching the AC-shunt corrections UI.

The same setup creates missing TI definitions from saved AC-shunt sessions and seeds lab ±100 ppm acceptance limits. It gets the physical range from session configuration or a uniquely matching catalog record, never the largest measurement point. Standard designation comes from device remarks, then active report notes/number: explicit CHECK STD/Check Standard and NIST labels are recognized. A device's Check STD designation takes precedence over NIST traceability text on its report. Unlabeled entries remain untagged, and unknown or conflicting ratings remain absent rather than guessed. TI and reference definitions retain their separate acceptance/uncertainty roles.

Existing matching library entries receive the conventional naming update once, retaining their IDs, functions, uncertainty values, range IDs and custom columns. A naming-version marker prevents subsequent startup from overwriting later user naming edits. Restart the backend after updating to rename the existing entries and add missing standards. For new TIs recorded after startup, restart or run the setup command before importing; edit existing library definitions to add any later measurement ranges.

The initial distribution is Normal (95%), matching the example. Missing report uncertainties stay unset. The source report, date, serial and physical range are recorded on each range. Setup prefers manual shunt registry entries and the registry's active/pinned report. Stable identities make repeated startup idempotent; existing definitions and later edits are preserved. Certificate updates are managed in Uncertalytics after initial setup.

To run setup separately, from `Backend/ac_shunt` use `python manage.py seed_ac_shunt_references`. This is separate from importing measurement sessions; source calibration records are read-only.

## Focused checks

Use `manage.py test uncertainty.test_ac_shunt_import` and the focused Vitest files `acShuntBudget.test.js`, `acShuntSpecs.test.js`, `AcShuntImportTool.test.jsx`, `App.sidebarRisk.test.jsx`, and `useSessionManager.test.js`.

After hands-on testing is approved, the feature browser check is `node scripts/smoke-ac-shunt-import.mjs`, with `WORKBENCH_URL` pointing to the full Workbench server (default port 3197). It checks the simplified preview, saved point/qualifier/result fields, manual variability, shared reference links and TI limits.
