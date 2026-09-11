# Cycle-specific reading stability

The live calibration and saved results charts send the displayed cycle along with the measurement phase, instrument, and inclusive sample range. Auto mode resolves to the displayed cycle at submission. Sample numbers stay fixed when unstable samples are hidden, and the editor validates ranges against the selected cycle. In the Combined results view, select Forward or Reverse before editing stability.

The API validates the request and updates only the chosen cycle in the addressed test point. Requests without a cycle are accepted only for legacy cycle-one data. The reading row is locked during the update. The same calculation used when collecting a cycle now refreshes its phase statistics, delta, direction aggregate, and paired statistics after a manual stability edit. Cycles with insufficient stable data become unavailable rather than retaining stale cycle statistics.

Migration 0039 enables automatic IQR/Chauvenet filtering by default for new calibration results. Existing saved choices, including explicit `none`, are retained. The frontend also defaults to auto when no saved preference is available.

Validation: 42 frontend tests covering chart interaction, cycle selection, and analytics preferences; 17 backend tests covering scoped stability edits, recalculation, defaults, and the existing category-settings regressions. Production frontend build checked. Hardware acquisition and the deployment's SQL Server were not exercised. The broader legacy analytics test module could not import because the environment lacks `npsl_tools`; targeted database tests use SQLite.
