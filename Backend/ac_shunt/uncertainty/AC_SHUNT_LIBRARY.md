# Export and clean the shunt library

Run this on the lab computer that holds the AC-shunt data, with the backend stopped and the repository virtual environment active. From `Backend/ac_shunt`:

```powershell
python manage.py export_ac_shunt_library --output "$env:USERPROFILE\Desktop\ac-shunt-library.json" --clean-old-imports
```

Send the resulting JSON file back for instrument review. It contains the active A40B/Y5020 catalog reports with serials, physical ranges, current/frequency points and uncertainties; generated Uncertalytics instrument definitions; and a backup of the removed library entries. It does not contain session readings, database credentials, or unrelated instruments.

Only instruments with a matching catalog report containing at least one valid, nonnegative uncertainty at a valid current/frequency point are created. Session records, a CHECK STD/NIST label, an empty report, and the TI's generated 100 ppm lab acceptance limit do not establish calibration evidence. Unsupported catalog records remain in the export for review but produce no instrument definitions. A report containing some missing uncertainty values can still support an instrument; those missing points remain unset rather than receiving invented values.

Manual correction records, and records explicitly described as temporary or copied corrections, are labeled **MANUAL**, regardless of uncertainty. For baseline records, classification uses **catalog uncertainties**, never a TI's lab acceptance limit: all known nonnegative uncertainties equal to 100 ppm means **CHECK STD**; other known values mean **NIST**. Names follow `Fluke {A40B or Y5020} {SERIAL} {RANGE} {MANUAL, CHECK STD, or NIST}`. Baseline and manual correction sets with the same serial remain distinct and cannot overwrite one another. Exports include `isManual`; older exports recover that flag from the matching live report or explicit manual/temporary/copied provenance.

Only entries carrying AC-shunt import provenance and local copies linked to them are cleared. Older TI definitions are also recognized through their saved import session and matching serial/model; shared instruments linked into those sessions are excluded. Manually authored instruments and saved budget snapshots remain intact. The file must be new; an existing export is never overwritten. If the export fails, cleanup does not run. Omit `--clean-old-imports` for a read-only export.

To repopulate the library after cleanup:

```powershell
python manage.py seed_ac_shunt_references
```

Backend startup also runs this seed command. One library entry represents each shunt correction set, with separate reference and TI specifications. Its main functions retain the report uncertainties; `acShuntIdentity.uutFunctions` retains TI measurement points and the lab's 100 ppm acceptance limit, including existing edited TI limits. New TI session points augment that profile without creating another library instrument. Library selection, drag/drop, AC-shunt import and synchronization use the specifications for the chosen role. A saved source report selection takes precedence over the usual manual-first matching default.

Existing generated TI copies are consolidated into the reference entry, with a complete `ac-shunt-roles-*.json` backup in the Portal data folder before removal. Linked local copies are relinked without replacing their specifications. Repeating startup is idempotent. Existing budgets retain their saved definitions until explicitly synchronized or reimported; their old TI snapshots are not rewritten by cleanup.

Seeding also removes old automatically generated entries that lack reported calibration uncertainty, along with their linked local library copies. Before removal, their complete definitions are saved to a new `ac-shunt-unsupported-*.json` file under the Portal data folder's `backups` directory (the path is printed). If the backup fails, removal does not run. Manually authored library entries, AC-shunt sessions/reports, and saved uncertainty budget snapshots remain intact. New generated/imported entries retain source report evidence, so supported portable definitions remain valid on computers without the source catalog. Older TMDE definitions with report provenance and ppm uncertainties also remain valid; a generated TI acceptance limit alone does not.

To install a reviewed export instead, run these commands from `Backend/ac_shunt` with the backend stopped:

```powershell
python manage.py import_ac_shunt_library --input "$env:USERPROFILE\Desktop\ac-shunt-library-reviewed.json" --dry-run
python manage.py import_ac_shunt_library --input "$env:USERPROFILE\Desktop\ac-shunt-library-reviewed.json"
```

The dry run validates every definition, lists eligible names, and reports excluded instruments without writing. Import excludes definitions without matching report uncertainty in the exported or live catalog. If an excluded definition was previously generated in the library, import backs it up and removes it and its linked local copies. Import creates missing supported shared library entries, preserves existing uncertainty definitions and customized names, and leaves saved budgets intact. Validation or an ID conflict rolls back the whole import. The backup section is not imported. Repeating the command does not add duplicates. A missing TI rating is filled only when its exact model/serial has a unique catalog rating. Catalog ratings also take precedence over historical session range settings during seeding, without removing any measured current/frequency points.

Tagged serials such as `5965004-2` merge with their base serial only when model, physical range, correction provenance (baseline/manual), the complete current/frequency point set, actual AC–DC corrections **and** uncertainties match. A matching 100 ppm uncertainty alone is insufficient. Missing corrections, different corrections, different uncertainties, or partial point coverage keep records separate. New exports include `correctionPpm` for this comparison. For an older export, run the import on the originating lab computer: it can recover omitted corrections from the same report ID and unchanged current/frequency/uncertainty data. Offline review of an old export cannot prove those records equivalent.

The retained entry lists verified serial aliases so measurement import continues to match tagged sessions automatically. Seeding and reviewed import remove only identical, uncustomized duplicate library definitions and relink local copies without changing their edits. Source calibration reports and saved budgets remain intact. If a later report changes a tagged record's corrections, seeding revokes the alias and keeps the differing definition separate.
