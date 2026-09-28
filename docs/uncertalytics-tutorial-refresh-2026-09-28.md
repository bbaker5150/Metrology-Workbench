# Tutorial refresh — September 28, 2026

## Scope

Reviewed the guided walkthrough against the current application controls and recent GUI tasking. Expanded it to 50 steps across 10 independently selectable workflows. Instructions operate on the user's current session; no demo records are inserted by the tutorial.

| Workflow | Coverage |
| --- | --- |
| Session setup | Create/switch sessions, metadata, combined Risk & Mitigation Inputs, autosave |
| Instruments & Measurement Areas | Add areas/instruments, random and editable colors, ranges, IV/FS/absolute/dB terms, symmetry/sidedness, units/prefixes, distribution/resolution, selection, custom columns |
| Additional uncertainties | Add and name rows, Manual/Table/Equation, adjacent distribution, matching table points, equation variable binding, individual budget selection, label rail/selection/deletion, range bias |
| Direct measurement | Area settings, budget reuse, new points, UUT assignment/default unit, nominal, selected budget contributors |
| Derived measurement | Area settings, equation/budget reuse, output target, measurement equation, input names/nominals/units, input budgets, sensitivity, correlation, Taylor/Monte Carlo |
| Budget controls & results | Editing/reordering/removing, direct tabular/equation sources, repeatability and sample standard deviation, fixed distribution/DOF, combined/expanded uncertainty, k, always-visible contributions, breakdowns, warnings |
| Risk & mitigation | REOP/confidence/requirements, TUR/PFA/PFR, guard bands vs interval-only results, point overrides/inheritance, single-sided/unknown-measurement availability |
| Columns & workspace | Displayed/Add Columns, append/reorder/hide, defaults, centered draggable menu, independent scroll, three divider fit modes, full-width points, table heights/zoom |
| Editing & shortcuts | Single-click Section editing, value keyboard navigation, multi-selection, point/budget clipboard, undo |
| Library, tools & session files | Session vs shared library synchronization, builder, reverse traceability, unit conversion, Notes, PDF export/import |

## Removed stale guidance

- Removed contribution-chart toggle instructions: the graph is always displayed with available final results.
- Replaced column-group checkbox/filter instructions with the current two-pane column menu.
- Corrected TMDE instrument creation to the area + button.
- Updated area-entry wording, searchable units, point-specific requirement overrides, and current repeatability behavior.
- Distinguished uncertainty equations from derived measurement equations and input-method types from Type A/B classification.
- Kept developer-only visualizers outside the public tutorial.

## Navigation and highlighting

- Tutorial topics open the appropriate Overview/Budget/Notes view and reveal the instrument pane when needed from full-width points.
- Requirement topics expand the combined requirements section.
- The coach uses the browser top layer so its navigation remains usable above new native popovers.
- Card placement follows an open menu; highlight geometry updates when the menu is dragged or resized.
- Newly mounted targets scroll into view; missing prerequisites remain explicit and users can jump to another workflow.
- Step numbering is consistent within each workflow.

## Verification

- Audit: zero vulnerabilities.
- Complete suite: 196 files / 2,328 tests passed.
- Single-file build passed.
- Tutorial and base Forge browser smoke: 114 checks passed, covering all 50 targets, missing derived prerequisites, native column popovers, menu dragging, uncertainty type menus, both themes, short viewports, full-width points, and Notes routing.
- Local screenshots reviewed for light-mode column navigation and dark-mode short-window layout.
- Re-run with `TUTORIAL_SMOKE=1 node scripts/smoke-forge-srcdoc.mjs` after building the single-file app.

## Required actions

Hands-on steps now show the action required to unlock Next. The tutorial watches committed session/point changes or the requested menu/selection state; clicking a highlighted control alone does not satisfy a data-entry step. New points require a numeric value and UUT assignment; uncertainty tables require numeric entries; equations require valid syntax and uncertainty equations require their fixed variables. Repeatability requires saved readings.

While an action is pending, mouse and keyboard interactions outside its working area are blocked. Its editor menus remain usable. Workflow selection, Jump to step, Back, and Close are always available. Explanatory steps use ordinary Next. Completed actions remain completed when revisiting them during the same walkthrough; closing resets progress. Only first-session creation advances automatically, after the session exists. All other actions wait for Next. Pending advancement is cancelled when the user jumps or closes.

The checks include saved-action completion, invalid inputs, unrelated controls, independent step state, revisiting completed steps, cancellation on jump/close, and restoring normal app interactions after closing.

### Action-gating verification

- Audit: zero vulnerabilities; full suite: 197 files / 2,341 tests passed.
- Single-file build passed; tutorial/browser checks cover all 50 targets plus action gating, portal selection, navigation, cancellation, and restoration of ordinary interactions.
- Compact-window verification sizes the Forge iframe to the browser viewport, so card-fit assertions exercise the actual app viewport.
