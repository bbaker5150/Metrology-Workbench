# AC shunt category settings

Each settings category uses the same actions:

- **Save point** persists all fields in that category for the focused point and active direction. The opposite direction is unchanged, including its cycle count.
- **Apply to all points** persists the category to only the active Forward or Reverse direction for every current/frequency pair in the session, creating missing rows in that direction. Initial warm-up is excluded from Apply all. Save warm-up separately for each point and direction; its value stays attached to that point when the list is reordered.
- **Reset** restores that category from the configured default setup, with system defaults for unset fields, and saves it to the focused point. Other categories are preserved.

The low-frequency section remains hidden as before, but its category mapping and actions are retained for when that section is enabled. Saved setups remain device-local.

The frontend uses one `actions/save-settings-category/` endpoint for all categories. The backend validates the complete category before writing and commits all affected points in one transaction. A failed bulk update cannot leave an earlier subset saved. Creating a settings row preserves the counterpart's cycle count and uses the effective form defaults instead of legacy model defaults. Existing settings in other categories are never replaced by a category save.

Background data refreshes retain unsaved edits for the same point. Changing the point or direction loads that point's stored settings. Saves are disabled while a request is in progress, and failed requests leave the draft editable. Cycle targets in the form and sidebar use each direction's saved value.

Warm-up is editable at every frequency. It is used when a run starts at that point, not repeated at every intermediate point in a batch. Unconfigured warm-up defaults to zero (or the user's saved default setup), independently of list position. Existing saved warm-up values are retained. The 5790A/B profile offers Auto range as well as fixed physical ranges; Auto sends `RANGE AUTO` to either model without changing the fixed-range default.

## Deployment and validation

Update frontend and backend together. Apply API migrations through `0040_tvccorrection_decimal_values` through the normal bootstrap or `python manage.py migrate api` on the AC shunt database. Migration 0038 permits fractional settling times; 0040 permits fractional TVC AC/DC differences and expanded uncertainties. Existing integer values are preserved. Shunt corrections and uncertainties already support decimals.

Regression coverage includes category isolation, direction-specific bulk saves, missing settings/directions, zeros/fractional values, transaction rollback, configured defaults, background refreshes, warm-up retention after reordering, autorange commands for both reader models, and decimal correction API round trips. Stability edits use cycle-local sample indices and refresh cycle, direction, and paired statistics; excluded readings are never reused as an insufficient-sample fallback. Physical instruments and SQL Server migration execution still require lab validation.

The repository's single-file pipeline packages the Uncertainty module, not the AC Shunt instrument-control module. AC Shunt changes require deploying the full Workbench frontend and the updated backend together.
