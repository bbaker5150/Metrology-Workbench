# Instrument highlighting and in-page dragging

Source: `32C91378-77FB-4B62-A177-46B6D704B738/1-Tasking.docx`.

## Findings and changes

The base range-cell selector had greater specificity than the attribute-based
hover and selection rules. Those attributes were set correctly but their tint
variables lost in the cascade. Matching selector specificity now establishes
the requested order: base, light column hover, darker physical-row hover,
darkest selected cells. Selected fill takes priority over hover.

Column tracking previously depended on React handlers with hard-coded indexes.
One logical occupancy grid now resolves rowSpan/colSpan cells, including Sync,
Distribution and custom columns. Only the physical hovered range and cells
shared with it receive row hover; moving vertically within a shared cell resolves
the range from pointer Y. Paint-only attributes are excluded from the layout
observer, preserving the earlier anti-jitter behavior.

The Sync seam previously combined the preceding cell's right border and Sync's
left border on the first row. Later rows omit the spanned Sync cell, making that
preceding cell the last DOM child and removing its right border. Sync now owns
one continuous left border; logical predecessors never draw a second seam.

Instrument rows previously initiated native HTML drag-and-drop with full
instrument JSON in DataTransfer. Leaving a table could enter the browser/OS
transfer path. Enterprise endpoint/drag policies are a possible environmental
factor, but no NMCI crash log or policy trace was available here: the exact
NMCI-specific root cause is **not confirmed**.

Instrument rows now use pointer gestures entirely inside the document. A small
in-page preview replaces the native drag image, and a memory-only transfer
adapter retains the established React membership/drop/save handlers. No native
DataTransfer object or trusted instrument dragstart is generated. Moves are
committed only over an instrument table. Outside release, Escape, blur, pointer
cancellation, lost capture, a new gesture, and unmount clean up the gesture and
restore cursor/selection state. Text editing and action controls remain excluded.
Pointer capture keeps outside releases observable; edge scrolling is bounded
and stops scheduling when the table reaches its scroll limit.

## Verification

- `npm audit --audit-level=high`: zero vulnerabilities.
- `npm test`: 2,054 tests in 163 files passed, no unhandled errors.
- `npm run build:singlefile`: passed.
- `INSTRUMENT_INTERACTION_SMOKE=1 node scripts/smoke-forge-srcdoc.mjs`:
  all 72 checks passed (54 standard release checks plus 18 interaction checks).
- Real Chromium mouse gestures verified outside-drop cancellation, Escape,
  successful persisted movement to another measurement area, and zero native
  instrument drag starts. Unit checks also cover blur and unmount cleanup.
- Computed colors verified both themes, shared/custom cells, selected fill and
  all previously missing column highlights. The rendered table was inspected.
- Standard browser checks confirmed overview/budget hover geometry, range
  add/delete persistence, archival, no dialogs, and no uncaught errors.

The published build still needs confirmation on NMCI to establish whether
removing native drag handoff resolves that environment's reported freeze.
