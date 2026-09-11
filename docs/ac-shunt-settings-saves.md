# AC shunt category settings

Each settings category uses the same actions:

- **Save point** persists all fields in that category for the focused point and active direction. General's paired cycle count also updates the counterpart direction for that current/frequency pair.
- **Apply to all points** persists the category to both Forward and Reverse directions for every current/frequency pair in the session, creating missing direction rows. Stability includes initial warm-up time; the confirmation states this explicitly.
- **Reset** restores that category from the configured default setup, with system defaults for unset fields, and saves it to the focused point. Other categories are preserved.

The low-frequency section remains hidden as before, but its category mapping and actions are retained for when that section is enabled. Saved setups remain device-local.

The frontend uses one `actions/save-settings-category/` endpoint for all categories. The backend validates the complete category before writing and commits all affected points in one transaction. A failed bulk update cannot leave an earlier subset saved. Creating a settings row preserves the counterpart's cycle count and uses the effective form defaults instead of legacy model defaults. Existing settings in other categories are never replaced by a category save.

Background data refreshes retain unsaved edits for the same point. Changing the point or direction loads that point's stored settings. Saves are disabled while a request is in progress, and failed requests leave the draft editable. Cycle targets in the form and sidebar resolve per current/frequency pair.

## Deployment and validation

Update frontend and backend together. Apply API migration `0038_alter_calibrationsettings_settling_time` through the normal bootstrap or `python manage.py migrate api` on the AC shunt database. It changes settling time to a float so fractional seconds accepted by the form can be persisted.

Validation includes 31 frontend tests, eight backend SQLite tests, and the production build. Coverage includes category isolation, both-direction bulk saves, missing settings/directions, zeros/fractional seconds, transaction rollback, configured defaults, background refreshes, and switching between points with different cycle counts. Physical instruments and SQL Server migration execution were not available for validation here.
