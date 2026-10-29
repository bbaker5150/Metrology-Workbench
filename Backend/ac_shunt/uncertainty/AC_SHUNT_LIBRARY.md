# Export and clean the shunt library

Run this on the lab computer that holds the AC-shunt data, with the backend stopped and the repository virtual environment active. From `Backend/ac_shunt`:

```powershell
python manage.py export_ac_shunt_library --output "$env:USERPROFILE\Desktop\ac-shunt-library.json" --clean-old-imports
```

Send the resulting JSON file back for instrument review. It contains the active A40B/Y5020 catalog reports with serials, physical ranges, current/frequency points and uncertainties; generated Uncertalytics instrument definitions; and a backup of the removed library entries. It does not contain session readings, database credentials, or unrelated instruments.

The classification uses **catalog uncertainties**, never a TI's lab acceptance limit: all known nonnegative uncertainties equal to 100 ppm means **CHECK STD**; other known values mean **NIST**. Missing uncertainties remain unset. If no valid uncertainties exist, an explicit saved Check STD/NIST label is retained, otherwise the type remains unset. Names follow `Fluke {A40B or Y5020} {SERIAL} {RANGE} {CHECK STD or NIST}`. Review mixed 100/non-100 reports (classified NIST) and entries without a type before using them.

Only entries carrying AC-shunt import provenance and local copies linked to them are cleared. Older TI definitions are also recognized through their saved import session and matching serial/model; shared instruments linked into those sessions are excluded. Manually authored instruments and saved budget snapshots remain intact. The file must be new; an existing export is never overwritten. If the export fails, cleanup does not run. Omit `--clean-old-imports` for a read-only export.

To repopulate the library after cleanup:

```powershell
python manage.py seed_ac_shunt_references
```

Backend startup also runs this seed command. Stable identities prevent repeated runs from adding duplicates. TIs retain the lab's 100 ppm acceptance limit, while standards retain the corresponding report uncertainties and frequency qualifiers. Existing budgets retain their saved definitions until explicitly synchronized or reimported.
