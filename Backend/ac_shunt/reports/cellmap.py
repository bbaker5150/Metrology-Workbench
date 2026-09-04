"""
Single source of truth for where each ROC field lives in the app's one
canonical Excel layout — cell coordinates transcribed from a real NPSL
Report of Calibration workbook (the AC-Shunt lab original; see
``management/commands/seed_rocs.py``'s former docstring for provenance).
``excel.py`` (writer) and ``importer.py`` (reader) both import this module
so the two directions can never drift apart — a cell that moves here moves
for both at once.

Every measurement area shares this one layout now (see
``reports/area_registry.py`` — areas are plain JSON data, not separate
cell-coordinate maps). Two other real lab-original workbooks
(``templates/roc_resistance.xlsx``, ``templates/roc_temperature.xlsx``)
still sit in ``templates/`` for reference but are no longer wired to
anything; only ``roc_ac_shunt.xlsx``'s layout is used going forward.

``TEMPLATE`` layout:
  - ``template``: the trimmed-down real workbook every ROC is built from
    (``templates/<file>``, labels/fonts/merges/page-setup intact, every
    field cell blanked).
  - ``page1_sheet`` / ``page2_sheet``: sheet names.
  - ``fields``: flat non-statement values, ``field_name -> "A1"`` cell on
    ``page1_sheet`` (top-left cell of the merge, if the field is merged).
  - ``statements``: statement ``kind`` (see ``STATEMENT_ORDER`` in
    ``excel.py``) -> cell on ``page1_sheet``.
  - ``page2_fields``: the nomenclature/manufacturer/model/serial + cal/due
    date header repeated at the top of the data page, cell on
    ``page2_sheet``.
  - ``table_start_row``: first row on ``page2_sheet`` free for the
    measurement-data table(s) — everything at or below this row is
    regenerated fresh per record (see excel.py's ``_data_table``), since
    table shape (column count, row count) varies per instrument and can't
    be pinned to fixed template cells the way the fields above can.
"""

TEMPLATE = {
    "template": "roc_ac_shunt.xlsx",
    "page1_sheet": "ROC1",
    "page2_sheet": "ROC2",
    "fields": {
        "nomenclature": "A11",
        "manufacturer": "J12",
        "model_number": "J13",
        "serial_number": "J14",
        "submitted_label": "A15",
        "customer_name": "A16",
        "customer_address": "A17",
        "procedure_used": "K23",
        "ambient_temperature": "R42",
        "calibration_date": "AW42",
        "relative_humidity": "R43",
        "due_date": "AW43",
        "metrologist_name": "I48",
        "approver_name": "AQ48",
        "metrologist_title": "F50",
        "approver_title": "AV50",
        "roc_number": "E52",
        "page_label": "Z52",
        "issue_date": "AW52",
    },
    "statements": {
        "technical": "A19",
        "results_location": "A25",
        "uncertainty": "A27",
        "traceability": "A33",
        "reproduction": "A38",
    },
    "page2_fields": {
        "nomenclature": "K1",
        "calibration_date": "AW1",
        "manufacturer": "K2",
        "due_date": "AW2",
        "model_number": "K3",
        "serial_number": "K4",
        "roc_number": "E45",
        "page_label": "A46",
    },
    "table_start_row": 7,
}


# ---------------------------------------------------------------------------
# Synthetic "Data Entry" worksheet layout -- shared by every area and by
# every download (blank ROC Template, a saved record's export, and a manual
# draft export all build this same page 2, see excel.py's
# _build_data_entry_sheet / build_template_workbook). Unlike TEMPLATE
# above, none of this traces to a real NPSL file: it's a plain, unmerged
# form built from scratch so a user can hand-type or edit every field the
# Manual Input tab exposes -- front-page fields, statements, inline
# coefficients, and the calibration data table(s) -- without touching the
# certificate page's merged cells, then upload the workbook back through
# Excel Import. excel.py (writer) and importer.py (reader) both walk these
# same lists in the same order, anchored off each section's marker row (see
# DATA_ENTRY_SECTION_HEADERS), so a field added here is added for both
# directions at once.

DATA_ENTRY_SECTION_HEADERS = {
    "fields": "REPORT FIELDS",
    "statements": "FRONT-PAGE STATEMENTS",
    "inline_results": "INLINE RESULTS (OPTIONAL)",
    "calibration": "CALIBRATION DATA TABLE(S)",
}

# field_name -> label, in display order -- mirrors ManualInputForm.jsx's
# Instrument / Customer / Environment & Dates / Personnel sections exactly.
# area_code leads the list so a round-tripped download (Template or a saved
# record's export) always carries its area on re-upload -- see
# importer.py's parse_workbook, which no longer has per-area sheet names to
# detect the area from now that every area shares this one layout.
DATA_ENTRY_FIELDS = [
    ("area_code", "Measurement Area"),
    ("roc_number", "RoC #"),
    ("nomenclature", "Nomenclature"),
    ("manufacturer", "Manufacturer"),
    ("model_number", "Model"),
    ("serial_number", "Serial"),
    ("procedure_used", "Procedure Used"),
    ("submitted_label", "Submitted-By Label"),
    ("customer_name", "Activity / Ship"),
    ("customer_address", "Address"),
    ("ambient_temperature", "Ambient Temperature (°C)"),
    ("relative_humidity", "Relative Humidity (%)"),
    ("calibration_date", "Calibration Date"),
    ("due_date", "Due Date"),
    ("issue_date", "Issue Date"),
    ("metrologist_name", "Metrologist"),
    ("metrologist_title", "Metrologist Title"),
    ("approver_name", "Approved By"),
    ("approver_title", "Approver Title"),
]

# statement kind -> label, in excel.py's STATEMENT_ORDER -- includes
# "special", which (unlike the other five kinds) has no fixed cell in
# TEMPLATE above and so previously had nowhere to be written on an exported
# workbook at all.
DATA_ENTRY_STATEMENTS = [
    ("technical", "Technical / Method Statement"),
    ("results_location", "Results Location Statement"),
    ("special", "Special Statement"),
    ("uncertainty", "Uncertainty Statement"),
    ("traceability", "Traceability Statement"),
    ("reproduction", "Reproduction Statement"),
]

# Rows each statement's merged input cell spans.
STATEMENT_ROW_HEIGHT = 3

INLINE_RESULT_HEADERS = ["Label", "Value", "Label 2", "Value 2"]

# Fixed rows on the Data Entry sheet -- title (1), instructions (2), a blank
# row (3), then the fields section header. Everything below is deterministic
# from here (fixed-count sections: field count, statement count x
# STATEMENT_ROW_HEIGHT, and the inline-results table's own fixed 3-row
# preamble are all constants, not content-dependent), which is what lets
# excel.py tie every one of the certificate page's own values -- REPORT
# FIELDS / FRONT-PAGE STATEMENTS cells (data_entry_field_row /
# data_entry_statement_row), Inline Results
# (DATA_ENTRY_INLINE_RESULTS_DATA_START_ROW), and each calibration table's
# data cells (via _build_data_entry_sheet's own returned per-table
# data_start_row, since table shape varies per record and so can't be a
# fixed constant like the rows below) -- to these same Data Entry cells with
# live formulas instead of just duplicating values at generation time: edit
# one, the other updates in Excel itself.
DATA_ENTRY_FIELDS_HEADER_ROW = 4
DATA_ENTRY_FIELDS_START_ROW = DATA_ENTRY_FIELDS_HEADER_ROW + 1
DATA_ENTRY_STATEMENTS_HEADER_ROW = DATA_ENTRY_FIELDS_START_ROW + len(DATA_ENTRY_FIELDS) + 1
DATA_ENTRY_STATEMENTS_START_ROW = DATA_ENTRY_STATEMENTS_HEADER_ROW + 1
# Blank spacer, then the inline-results section header (see
# DATA_ENTRY_SECTION_HEADERS["inline_results"]), its one-line instruction,
# and its Label/Value/Label 2/Value 2 column-header row -- 3 fixed rows
# before the first real inline-result data row.
DATA_ENTRY_INLINE_RESULTS_HEADER_ROW = (
    DATA_ENTRY_STATEMENTS_START_ROW + len(DATA_ENTRY_STATEMENTS) * STATEMENT_ROW_HEIGHT + 1
)
DATA_ENTRY_INLINE_RESULTS_DATA_START_ROW = DATA_ENTRY_INLINE_RESULTS_HEADER_ROW + 3

_DATA_ENTRY_FIELD_INDEX = {key: i for i, (key, _label) in enumerate(DATA_ENTRY_FIELDS)}
_DATA_ENTRY_STATEMENT_INDEX = {kind: i for i, (kind, _label) in enumerate(DATA_ENTRY_STATEMENTS)}


def data_entry_field_row(field_name):
    """Row of `field_name`'s input cell (column B) on the Data Entry sheet,
    or None if it isn't one of DATA_ENTRY_FIELDS (e.g. "page_label", which
    is computed at generation time, not a user-editable field)."""
    index = _DATA_ENTRY_FIELD_INDEX.get(field_name)
    return None if index is None else DATA_ENTRY_FIELDS_START_ROW + index


def data_entry_statement_row(kind):
    """Row of `kind`'s input cell (column B) on the Data Entry sheet, or
    None if it isn't one of DATA_ENTRY_STATEMENTS."""
    index = _DATA_ENTRY_STATEMENT_INDEX.get(kind)
    return None if index is None else DATA_ENTRY_STATEMENTS_START_ROW + index * STATEMENT_ROW_HEIGHT
