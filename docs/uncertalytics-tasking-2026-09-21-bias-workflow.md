# September 21 tasking: bias workflow and point assignment

Source: `D6619F1D-38BA-4C47-83CC-F4644984E84C/1-Tasking.docx`.

## Completed requirements

1. Removed the redundant default-input explanation. Analyst and Document Date
   share the right-hand alignment of Risk and Mitigation input values.
2. Direct points have a single-row **Measurement Bias** table: Name, Nominal,
   Bias. Derived points always show Bias in **Measurement Inputs**, including
   constant equations. Removed the Add Bias button and special output-row
   background. The output variable edits the equation's left side only; nominal
   remains read-only and right-side mappings are preserved.
3. Assigning either an existing or newly created UUT from a sidebar point opens
   that point's uncertainty budget and selects the assigned UUT.
4. Quick-add defaults use UUT units, not area metadata or TMDE units. A point
   created before its UUT keeps the Units placeholder until the first UUT unit
   is supplied. Users can still deliberately select Units afterwards.
5. Expanded single-sided tolerance controls say **Known value** and
   **Unknown value**, consistent with the collapsed summaries. In the context
   of the adjacent bound and unit, these labels remain unambiguous.

## Bias invariants

The always-visible editor displays the live combined source bias. Viewing or
focusing it does not save a manual override. An explicit edit, including zero
or the same inherited value, creates a point-owned manual net bias. Clearing
the field or using its remove button restores the original source calculation
and preserves any source overrides. The inherited total is not rounded before
authoring, so an equivalent manual total retains numerical parity.

No bias/risk formulas changed. Manual net bias still replaces the source sum;
UUT bias, uncertainty components, nominal values, and the measurement equation
remain independent. Percent bias retains the Excel MUA final-UUT-tolerance
basis. The direct table reuses the same audited editor/resolver as derived
points.

## Validation

- Dependency audit: no vulnerabilities.
- Complete Vitest suite: 181 files, 2,195 tests passed.
- Production single-file build passed.
- Baseline Forge iframe smoke: 54 checks passed.
- New tasking browser smoke: 71 checks passed, covering all five requirements.
- Input-editing browser regression: 75 checks passed.
- Measurement-bias browser regression: 96 checks passed, including percent
  basis, source/net restoration, instrument edits, and persistence.
- Multi-source workbook parity browser regression: 153 checks passed, including
  equivalent net replacement across the four supported known tolerance types.
- Previous September 21 tasking regression: 114 checks passed, including input
  inheritance, keyboard editing, clipboard ownership, layout, and builder units.
- Component tests cover direct and constant-derived net editing, focus without
  mutation, explicit zero, clearing/removal, and preserved point data.
- Browser screenshots reviewed for metadata alignment, both bias tables,
  output-row background parity, and expanded single-sided labels.

Browser fixtures run through an isolated mocked SharePoint adapter. They do
not modify a user's live session or site. All listed checks passed before push;
exact-commit Actions success and the published HTML are also verified before
delivery.
