# Report customer directory

In Report of Calibration → Manual Input → Customer, search or browse the directory and select a result. Search matches Lab Name, Activity, Sub Custodian, Lab Address and SYSCOM. Results are paginated in groups of 20.

Selection copies Lab Name into Activity / Ship and Lab Address into Address. A row without a lab name uses its Activity or Sub Custodian code as the label. A missing address clears the previous customer's address and prompts the operator to enter it. Both fields remain editable. Saved reports store copies of these values, so later directory updates do not alter them.

## Updating the list

Expand **Update customer directory**, then drop or choose the latest `.xlsx` file. This replaces the entire directory after validation. Use the five column headers from the original workbook (order may differ): Activity, Sub Custodian, Lab Name, Lab Address, SYSCOM. Empty rows are ignored, exact duplicate records are collapsed, and missing addresses are allowed. Rows need a name or activity/sub-custodian code. Formulas must be converted to values. Invalid and empty workbooks leave the directory unchanged.

The importer accepts files up to 10 MB, 50 MB uncompressed, 50,000 records and 255 characters per field. Directory replacement and source metadata updates run in one transaction. The lookup displays the source filename, record count and update time; Refresh directory retrieves updates made by another user of the same reports database.

## Initial deployment

The repository includes a normalized snapshot of the supplied **Lab Address List.xlsx**, containing 11,885 customers (687 with addresses). Migration 0004 loads it automatically on initial setup. Migration 0003 creates the directory tables in the existing `reports` database; migration 0004 initializes its metadata. The normal bootstrap applies these migrations. For a manual upgrade, run:

```
python manage.py migrate reports --database=reports
```

The bundled snapshot is `reports/data/customers_initial.json.gz`. The snapshot is a gzip-compressed JSON array with `activity`, `sub_custodian`, `lab_name`, `address`, and `syscom` strings. It seeds once and never overwrites later imports. Once migration 0004 has run, use the Excel import to populate or update the list.


Update frontend and backend together. The packaged backend includes the reports data and migrations via `ac_shunt_backend.spec`. GET `/api/reports/customers/?q=...&page=...` searches the directory. POST `/api/reports/customers/import/` accepts a multipart `file`. Both endpoints follow the existing reports API access model.
