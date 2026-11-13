# AC shunt budget import

In the full Workbench, open Uncertalytics and choose the lightning button after Unit converter. Search saved AC-shunt sessions, select a session, review its current/frequency points and ppm results, then create a new saved budget. Previous budgets and calibration results stay unchanged. The standalone app does not include the importer.

Each imported point is a direct current measurement in A with a Frequency qualifier in Hz. On first opening an imported budget, Section is hidden and Qualifier appears immediately after Value (for example, `1000 Hz`). Later column customizations persist for that budget. The signed AC–DC difference is retained in point provenance; the extra imported-result header above the point workspace is removed. Imported session names preserve the source name and append ` · Uncertainty Budget`. It is not added as uncertainty or applied as TI bias.

The AC/DC repeatability row uses the module's saved paired Type A standard uncertainty in ppm, without another division by sqrt(N). Its degrees of freedom are N−1. Pairing, cycle caps and excluded cycles follow the AC-shunt results view. Missing Type A remains incomplete. Each point also receives an independent, editable manual Fluke 5790B Variability row: ±5 ppm, Rectangular (standard uncertainty 5/sqrt(3) ppm).

For the supplied example, the signed result is −0.070 ppm and the repeatability row uses the full saved standard uncertainty, 0.6150070189859945 ppm, with 4 degrees of freedom for 5 pairs. The preview labels this as standard Type A (k = 1). Newer AC-shunt result cards label their ± value as expanded Type A (k = 2); that display is twice the standard value and is not used as a standard input to the budget.

The actual TI and reference are matched automatically to the shared Uncertalytics library by model and serial. The import menu only requires selecting the saved session; it has no TI or standard selectors. The TI table displays the library make, model and serial and retains the library link, just like the TMDE table. If a TI has no unique match, correct its library identity before retrying. The importer does not invent a generic TI. Library TI ranges initially use the lab's ±100 ppm acceptance limits, grouped by current with frequency qualifiers. Subsequent library edits are preserved. Reference current/frequency ranges supply their individual uncertainty. Missing or ambiguous ranges are flagged for review; no frequency interpolation occurs. The TMDE name stores its description separately from make/model, and repeated identity prefixes from earlier imports are displayed only once.

Shunt library names and new imports use `Fluke {A40B or Y5020} {serial} {rated range} {CHECK STD, MANUAL, or NIST}`. For example: `Fluke Y5020 3845014 20 A CHECK STD` and `Fluke Y5020 5965004 20 A NIST`. Manufacturer and model stay in their own fields; serial, range and standard designation occupy Description. Both instrument tables display those fields in the same order. Older budgets retain their saved definitions until the library instrument is synced or the session is imported again.

The routine snapshot contains session identity, TI/reference identity and configured shunt range, current/frequency, accepted-pair aggregates, source point IDs and stability flags. Model, serial and rated range support automatic matching independently of the display name. It does not fetch certificates or send raw phase readings. Y5020 snapshots also contain the generic 5790B definition and compact resolution sensitivities described below. Add any remaining instrument contributions through the usual budget editors.

## Generic 5790B for Y5020 imports

Y5020 imports automatically add one **Fluke 5790B**, without a serial number, to the Current area's TMDE table, and one linked **Fluke 5790B - Resolution** source per point. A40B imports do neither. The dedicated shared library ID is `fluke-5790b-generic`; reader serials and unrelated 5790 entries cannot make the match ambiguous. Bootstrap creates it once, and the first Y5020 import also ensures it exists for installations launched without bootstrap. The v1-to-v2 setup backs up the old generic library definition and moves its edited resolution values into the new qualifier layout. Later setup preserves edits. Stable IDs let older resolution components resolve after a library sync; existing imported budgets retain their saved definitions until synced or imported again.

One Voltage function groups each physical voltage range by **Resolution Mode → Measurement Mode → Frequency → Calibration Interval**. The interval qualifier offers **90 Days**, **1 Year**, and **2 Years** for absolute AC/DC measurement specifications; AC/DC transfer specifications are available only at the manual's 2-year interval. Frequencies remain numeric Hz qualifiers. The resolution-mode qualifiers are **Medium/Slow or HIRES On** and **Fast/Off, HIRES Off**. Resolution increments come from the **5790B Service Manual, page 1-6, Resolution and Range Limits**. Values occupy the normal editable Resolution cells. Absolute AC measurement, DC (polarity reversal), and AC/DC transfer uncertainty values come from pp. 1-6–1-8 and 1-12. The published `ppm of reading + µV` terms add linearly, then divide by the stated normal 99% divisor `k=2.58`. Temperature, warm-up, DC-zero, low-frequency and typical-only conditions are retained in range notes. Relative specifications, non-sine specifications and optional wideband specifications are not substituted for these absolute sine-wave measurement specifications. Y5020 import selects only resolution; the new accuracy terms do not enter its budget automatically. For example, the 2.2 V range has a full increment of 0.1 µV in Medium/Slow and 1 µV in Fast. Resolution uses the full-increment rectangular divisor `sqrt(12)`. HIRES ON also selects the fine increment, as specified in [Fluke's operator manual, Table 4-5 and HIRES command](https://s3.amazonaws.com/download.flukecal.com/pub/literature/5790B___omeng0000_0.pdf).

All eight phase means contribute to the AC–DC calculation. For each shunt, `Vac = (|ac_open| + |ac_close|)/2` and `Vdc = (|dc_pos| + |dc_neg|)/2`. Each AC phase has sensitivity magnitude `10^6/(2 eta Vdc)` ppm/V; each DC phase has magnitude `10^6 Vac/(2 eta Vdc^2)` ppm/V. The eight sensitivities combine in quadrature under independent phase-rounding assumptions, then multiply the instrument's live voltage standard resolution. One full digit is retained for each phase mean, with no sample, cycle or forward/reverse averaging reduction; the largest accepted-cycle contribution is used. Cycle caps, ABBA pairing and manual/automatic exclusions follow the saved result. Type A remains unchanged.

Older sessions with no phase means use the nominal Y5020 voltage, `current × 0.01 Ω`, with that assumption recorded in budget notes. AUTO range does not retain an actual selected range, so its resolution uses the supported 2.2 V upper-bound increment and records this in notes. The contribution is converted to ppm and equivalent current uncertainty; volts are never combined directly with amps. Changing the linked instrument's resolution immediately recalculates the contribution, combined/expanded uncertainty and risk metrics. Removing a required resolution leaves the contribution explicitly incomplete.

## Instrument setup and maintenance

Backend bootstrap runs `seed_ac_shunt_references`. Eligible shunt definitions
require a matching active catalog report with at least one valid, nonnegative
uncertainty at a valid current/frequency point. A session, a label or a generated
TI acceptance limit alone does not establish calibration evidence. Missing
uncertainties within an otherwise supported report remain unset.

One library entry represents a shunt correction set, with reference uncertainty
in its main functions and TI acceptance specifications in `acShuntIdentity.uutFunctions`.
Selection and import choose the profile for the requested role. Baseline and
manual correction sets remain distinct; a selected source report takes precedence
over the normal manual-first matching default. Existing edited specifications and
saved budget snapshots are preserved.

Classification uses the catalog uncertainty values: all known valid values equal
to 100 ppm produce CHECK STD; otherwise manual or temporary/copied corrections
produce MANUAL, and baseline report values produce NIST. Manual provenance remains
recorded even when the visible label is CHECK STD. Setup also initializes the
generic 5790B definition used by Y5020 imports.

From `Backend/ac_shunt`, run `python manage.py seed_ac_shunt_references` to invoke
setup separately. The [library maintenance guide](../Backend/ac_shunt/uncertainty/AC_SHUNT_LIBRARY.md)
describes evidence requirements, role consolidation, backup-before-removal rules,
export/import, and serial-alias checks. Consult it before cleaning existing
library entries; calibration source records and saved budgets remain intact.

## Focused checks

Use `manage.py test uncertainty.test_ac_shunt_import uncertainty.test_generic_5790` and the focused Vitest files `acShuntBudget.test.js`, `acShuntSpecs.test.js`, `AcShuntImportTool.test.jsx`, `AcShuntInstrumentIdentity.test.jsx`, `App.sidebarRisk.test.jsx`, and `useSessionManager.test.js`.

After hands-on testing is approved, the feature browser check is `node scripts/smoke-ac-shunt-import.mjs`, with `WORKBENCH_URL` pointing to the full Workbench server (default port 3197). It checks the simplified preview, saved point/qualifier/result fields, manual variability, shared reference links and TI limits.

## Workspace integration

Instrument-table color pickers update both the named measurement-area group and
the legacy ID-based area record, including the first edit after import. Both
instrument tables share the saved color.

The customized Notes wrapper preserves per-session native DOCX payloads, autosave,
legacy-image migration, themes and File menu integration. Its related editor
packages are pinned together in the frontend manifest; runtime checks reject mixed
versions and Vite deduplicates the editor and ProseMirror dependencies. See the
[frontend guide](../Frontend/workbench/README.md) for setup. Focused Notes checks
cover real-core DOCX parse/save with text, a table and an embedded image, plus
runtime-version and autosave behavior.

## Large instrument performance

The instrument tables ignore their own measured-width and header-position writes when scheduling layout. This prevents idle layout feedback from repeatedly measuring a large specification table. Qualifier labels are measured in one batch, and qualifier spans are indexed once per instrument snapshot instead of rebuilding the entire range list for every cell. Hover uses the existing cell highlight layer without updating React workspace state; its cell grid is reused until the table structure changes. Scrolling measures instrument group endpoints instead of every specification row. These changes apply to the UUT, TMDE and shared instrument-library tables.

Y5020 resolution calculations normalize only the linked 5790B range IDs, preserving fresh resolution edits and the original range indexes. No specifications, qualifiers, confidence levels or budget contributions are removed or reduced to achieve the speedup.

Focused regressions cover large instruments in session and point views, linked
resolution edits, qualifier-span equivalence, lookup work, cached hover, and
MutationObserver settling after header positioning. Set `REPORT_INSTRUMENT_TIMINGS=1`
when running `LargeInstrumentPerformance.test.jsx` for local jsdom timings; these
measure the test renderer, not browser frame rates. Use the [performance guide](uncertalytics-performance.md)
for cache maintenance and validation. Follow [AGENTS.md](../AGENTS.md) before
running full browser or release checks.
