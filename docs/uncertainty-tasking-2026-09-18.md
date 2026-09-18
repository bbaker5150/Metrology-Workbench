# September 18 tasking

Source: Tasking.docx supplied September 18, followed by the supplied tolerance
and bias testing workbook and embedded PDF session for the comparison item.

Work checklist (completion and validation recorded as each group is verified):

- [x] Instrument column resizing preserves peers and fills the trailing column;
  fitting the last column gives remaining space to its left neighbour.
- [x] Remove library function prefixes from budget range choices.
- [x] Make Sync-cell selection reliable for single/multiple ranges.
- [x] Make custom-column + work while inline cells are expanded; uppercase names.
- [x] Permit budget TMDE sources without error limits, with live warnings/updates.
- [x] Say whichever is greater instead of point-dependent; hide it for SS limits.
- [x] Use the same left-edge highlight on every add-component option.
- [x] Measurement Inputs bias display modes: native bias, percent, nominal + bias.
- [x] Bias percent label %, net-row remove icon on hover, bias-only editor mode,
  persistent active bias mode, collapsed bias summaries.
- [x] Align unit dropdowns to a trigger edge; use % IV / ppm IV / ppb IV labels.
- [x] Measurement-point inner dividers, persistent header and bottom scrollbar;
  opaque instrument sticky headers without the visible gap.
- [x] Update scale icon to the requested bold Lucide scaling SVG.
- [x] Measurement-area header copy/cut/paste/context-menu support for points and
  pasting instruments into empty areas.
- [x] Tolerance unit selection before range units; risk without point units.
- [x] Compare all supplied workbook/session cases with equivalent physical bias
  inputs and document causes of differences without changing the source files.

## Comparison outcome

See [the comparison report](tolerance-bias-comparison-2026-09-18.md).
The workbook and PDF contain different physical offsets and cal source links.
With equivalent inputs, all 12 populated known-value cases agree across all
populated cached outputs (maximum absolute difference 4.82e-11). The six
unknown-value rows have blank workbook risk results and are not claimed as
numerical parity cases. Original attachments and the running session are unchanged.

## Validation

- Dependency audit: zero vulnerabilities; dependencies unchanged.
- Complete Vitest suite: 167 files, 2,089 tests.
- Production single-file build and iframe-srcdoc smoke checks.
- Bias workflow: 93 browser checks, including light/dark styling and focus stability.
- Column workflow: 94 browser checks, including last-column autofit and filler ownership.
- September tasking workflow: large point-list scrolling and sticky headers,
  copying all 35 points into an empty area, context clipboard commands, Sync
  blank-space selection, first-click custom-column creation while editing,
  bias-only mode and separate summary line, unit-menu placement, instrument
  paste into an empty area, and hover/automatic-height stability.

Existing width assertions were updated to the document's new full-panel filler
rule, replacing the prior shrink-panel preference. Other peer widths remain
asserted unchanged. Label assertions follow the requested IV suffix order;
unitless risk tests verify all six tolerance types against equivalent physical-unit cases.
