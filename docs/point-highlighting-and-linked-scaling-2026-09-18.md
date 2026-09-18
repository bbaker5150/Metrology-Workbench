# Point highlighting and linked budget scaling

Implements the C76C9791 Tasking document and the requested measurement-point
outer-edge highlight.

- Removed dark point-row shadows and the one-pixel horizontal gap. Merged
  categorical cells already covered that gap, making the remaining row seams
  look uneven. Vertical column-resize dividers remain.
- Point selection now uses the same SVG perimeter algorithm, stroke, function
  color, and drop shadow as instrument selection. Adjacent edges cancel;
  selected shared cells extend the perimeter across their full run. The SVG is
  outside layout, ignores pointer events, and excludes its own mutations from
  observation. Numeric text retains the previous bold, non-glowing styling.
- Escape clears area selection and its selected rows in the point list and in
  both instrument views. Capture-phase dismissal also works when a menu handles
  Escape during bubbling. It does not navigate away from the viewed point.
- Results default to 80%. Results share one saved scale; uncertainty budgets
  share another. Existing per-table preferences migrate through a family
  fallback, and newly mounted variable tables inherit the current family scale.
  Instrument scales remain independent. Reset sizes restores the new defaults.
- PFA/PFR cards have an independent shared scaling surface using the existing
  unlocked Ctrl+wheel interaction.
- Only the last measurement result says `Final Results`. An incomplete input
  budget remains an input even when its optional display name is blank; the
  equation symbol, rather than the presence of a label, identifies that budget.

Verification includes the complete unit suite, dependency audit, single-file
build, baseline Forge iframe smoke, field-stability smoke, and the new
`POINT_HIGHLIGHT_SMOKE=1` browser coverage. The latter checks both themes,
merged-cell perimeter continuity, area deselection in both instrument views,
80% defaults, linked scales, newly added unnamed variables, and PFA/PFR scaling.
