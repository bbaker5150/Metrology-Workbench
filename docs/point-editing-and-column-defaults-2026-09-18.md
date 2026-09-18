# Point editing and column defaults

Implements the CE485377 Tasking document.

- Blank point-row cell space selects the point. Value, Section, Qualifier and
  UUT editing targets fit their displayed text; UUT assignment no longer uses
  the entire column as its button.
- Session metadata uses equally distributed flexible columns while retaining
  the existing text-mirror sizing for stable read/edit geometry.
- Risk status is binary at the existing requirement threshold. PFA keeps the
  Risk 8 displayed-precision comparison; PFR keeps its exact comparison.
  Missing results remain neutral. Numeric risk calculations are unchanged.
- Point Information is an ordinary sortable, resizable column in Warnings,
  using the existing diagnostic messages. It moves between Displayed Columns
  and Add Columns using the same controls as other columns.
- Set as Default saves visibility and order in the user-local UI store.
  Unconfigured sessions inherit that preset; session-specific choices win.
  Reset Columns restores the personal preset, or built-in defaults if none
  exists. This changes UI preferences, not calibration/session records.
- Boundary-mode PFA previously imposed a 128px minimum even after manual
  resizing. Automatic sizing still reserves that width, but authored narrower
  widths now show an accessible compact boundary marker below the percentage.
- Values share a numeric track and align right, with units aligned left at a
  common start. Unit controls reserve space for the complete symbol and keep
  an unavailable-unit explanation in hover text.
- Editable text inputs, textareas and contenteditable fields select their
  existing contents on focus/click, including portal dialogs. Explicit mouse
  drag selections remain usable. Native picker controls and read-only fields
  retain their native interaction.

Coverage includes the full unit suite, dependency audit, single-file build,
baseline Forge iframe smoke, FIELD_STABILITY_SMOKE and POINT_USABILITY_SMOKE.
The latter verifies real pointer targets, value/unit alignment, complete unit
labels, input replacement, personal defaults, Point Information visibility,
binary risk coloring and boundary PFA resizing without overflow.
