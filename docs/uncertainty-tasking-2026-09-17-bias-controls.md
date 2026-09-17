# Compact fields and bias controls

The latest tasking requests content-sized Session Info/Risk/Mitigation fields,
compact instrument bias controls, and an optional Net Bias in Measurement Inputs.

Session fields share a 120px starting width. A hidden text mirror measures the
same content in both read and edit states, reserving space for native controls.
Typing grows the field; focus alone does not change its width, height, or text
position. Long content scrolls within Session Info instead of clipping or
overlapping adjacent fields. Metadata blur commits are wrapped explicitly so a
React focus event cannot be mistaken for the next keyboard-navigation field.

The tolerance/error-limit mode bar now contains a Bias toggle styled like DS/SS.
The checkbox for Whichever is greater occupies the footer, and the optional bias
fields appear below it. Toggling visibility never changes the stored bias. The
editor initially focuses its mode control, avoiding an untouched numeric draft
being committed over a newer selection from the portaled unit menu.

The Already corrected checkbox is removed. Previously saved corrected entries
remain inert on load and show a short explanation when expanded. Editing the
bias explicitly authors an active residual; its uncertainty is untouched.

Measurement Inputs has a top-right + to add one Net Bias row, initialized from
the current source sum. It uses the existing audited manual-net risk contract:
replace the calibration/source total, preserve UUT bias, and never change the
equation or uncertainty budget. Removing it restores source propagation. Stored
source overrides survive underneath the net entry; budget copying and JSON
persistence preserve the setting. Resetting a legacy UUT override does not clear
an independently editable net row.

Regression coverage includes mode-toggle persistence, legacy corrected values,
unit selection, net add/edit/remove/copy, unchanged uncertainty/TUR, and retained
UUT ownership. The instrument bias browser smoke additionally measures uniform
field widths, growth, focus geometry, both themes, and immediate risk updates.

Release validation: zero audit vulnerabilities, all 2,066 tests across 165 files
passing, successful single-file build, and 92 passing combined baseline/feature
browser checks. The initial three unit-selection failures were fixed by the
mode-control focus change; the unchanged assertions and complete suite passed
on rerun.
