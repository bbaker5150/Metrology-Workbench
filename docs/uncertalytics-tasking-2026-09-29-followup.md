# September 29 follow-up tasking

- Measurement Inputs differentiates unit mismatch from numeric-value mismatch.
- Tabular editors keep searchable unit/prefix controls, fit numeric inputs to the longest entry per column, and offer hover delete and add buttons (× then +). Adding inserts immediately below that row; Tab still appends.
- Headers read Uncertainty or Unc. (Low)/Unc. (High). Symmetry controls sit at the upper left, with unit/prefix selection at the upper right. Numeric inputs align across rows, with a vertical divider between measurement point and uncertainty. Removed the marked header/row separator lines and the bottom Row button.
- Sticky instrument headers explicitly disable transitions in both themes.
- Empty instrument hints fit the visible scroller and reserve space around their measured arrow position.
- Whichever is greater uses the same text contrast as Bias.

Focused checks: 36 tests passed. Full validation follows the testing push, per the updated user preference in AGENTS.md.
