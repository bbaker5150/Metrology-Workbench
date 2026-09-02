"""
Single source of truth for where each ROC field lives in a real NPSL
Report of Calibration workbook — cell coordinates transcribed from four
completed reports reviewed in a ``ROCs/`` folder that sits next to this
repo's checkout (see ``management/commands/seed_rocs.py`` for the file
list). ``excel.py`` (writer) and ``importer.py`` (reader) both import this
module so the two directions can never drift apart — a cell that moves here
moves for both at once.

Layout, per area:
  - ``template``: the trimmed-down real workbook this area's ROC is built
    from (``templates/<file>``, labels/fonts/merges/page-setup intact,
    every field cell blanked).
  - ``page1_sheet`` / ``page2_sheet``: sheet names. AC_SHUNT and RESISTANCE
    use two real sheets (matching the source files' own ROC1/ROC2 and
    ROC/"Roc Data" split); TEMPERATURE's source keeps everything on one
    sheet, so both point at the same name.
  - ``fields``: flat non-statement values, ``field_name -> "A1"`` cell on
    ``page1_sheet`` (top-left cell of the merge, if the field is merged).
  - ``statements``: statement ``kind`` (see ``STATEMENT_ORDER`` in
    ``excel.py``) -> cell on ``page1_sheet``. A kind missing here is simply
    not written for that area (e.g. TEMPERATURE's source has no
    ``results_location`` sentence).
  - ``page2_fields``: the nomenclature/manufacturer/model/serial + cal/due
    date header repeated at the top of the data page, cell on
    ``page2_sheet``.
  - ``table_start_row``: first row on ``page2_sheet`` free for the
    measurement-data table(s) — everything at or below this row is
    regenerated fresh per record (see excel.py's ``_data_table``), since
    table shape (column count, row count) varies per instrument and can't
    be pinned to fixed template cells the way the fields above can.
"""

AREA_TEMPLATES = {
    "AC_SHUNT": {
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
    },
    "RESISTANCE": {
        "template": "roc_resistance.xlsx",
        "page1_sheet": "ROC",
        "page2_sheet": "Roc Data",
        "fields": {
            "nomenclature": "A11",
            "manufacturer": "J12",
            "model_number": "J13",
            "serial_number": "J14",
            "submitted_label": "A15",
            "customer_name": "A16",
            "customer_address": "A17",
            "procedure_used": "K23",
            "ambient_temperature": "R40",
            "calibration_date": "AX40",
            "relative_humidity": "R41",
            "due_date": "AX41",
            "metrologist_name": "L45",
            "approver_name": "AR45",
            "metrologist_title": "I47",
            "approver_title": "AM47",
            "roc_number": "E54",
            "page_label": "Z54",
            "issue_date": "AV54",
        },
        "statements": {
            "technical": "A19",
            "results_location": "A24",
            "uncertainty": "A26",
            "traceability": "A31",
            "reproduction": "A36",
        },
        "page2_fields": {
            "nomenclature": "I2",
            "calibration_date": "AX2",
            "manufacturer": "I3",
            "due_date": "AX3",
            "model_number": "I4",
            "serial_number": "I5",
            "roc_number": "F52",
            "page_label": "Z52",
        },
        "table_start_row": 8,
    },
    "TEMPERATURE": {
        "template": "roc_temperature.xlsx",
        "page1_sheet": "Report of Calibration",
        # The lab original continues its result pages below the first page on
        # one very tall worksheet.  Downloads deliberately split that into a
        # conventional two-tab ROC: the source-formatted certificate face on
        # sheet 1 and an editable calibration-data table on sheet 2.
        "page2_sheet": "Calibration Data",
        "fields": {
            "nomenclature": "A11",
            "manufacturer": "I13",
            "model_number": "I14",
            "serial_number": "I15",
            "submitted_label": "A17",
            "customer_name": "A19",
            "customer_address": "A20",
            # No dedicated procedure cell in the source (it's embedded in
            # the technical statement's prose there) — added on the blank
            # row between the statement and the coefficient block so this
            # area still exposes the same procedure_used field as the
            # other two.
            "procedure_used": "I27",
            "ambient_temperature": "M51",
            "calibration_date": "AS51",
            "relative_humidity": "M52",
            "due_date": "AS52",
            "metrologist_name": "G58",
            "approver_name": "AP58",
            "metrologist_title": "E59",
            "approver_title": "AL59",
            "roc_number": "E61",
            "page_label": "AA61",
            "issue_date": "AT61",
        },
        "statements": {
            "technical": "A22",
            "uncertainty": "A36",
            "traceability": "A42",
            "reproduction": "A47",
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
    },
}


def area_map(area_code):
    return AREA_TEMPLATES.get(area_code) or AREA_TEMPLATES["AC_SHUNT"]


# ---------------------------------------------------------------------------
# Synthetic "Data Entry" worksheet layout -- shared by every area and by
# every download (blank ROC Template, a saved record's export, and a manual
# draft export all build this same page 2, see excel.py's
# _build_data_entry_sheet / build_template_workbook). Unlike AREA_TEMPLATES
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
DATA_ENTRY_FIELDS = [
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
# "special", which (unlike the other five kinds) has no fixed cell in any
# AREA_TEMPLATES entry above and so previously had nowhere to be written on
# an exported workbook at all.
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
# from here (fixed-count sections, no content-dependent row growth), which is
# what lets excel.py tie the certificate page's REPORT FIELDS / FRONT-PAGE
# STATEMENTS cells to these same rows with live formulas (see
# data_entry_field_row / data_entry_statement_row below) instead of just
# duplicating values at generation time -- edit one, the other updates in
# Excel itself. Inline Results and the calibration table(s) are NOT tied
# this way: both sit below a content-dependent inline-results row count, and
# neither has a single well-defined "the" value to link a certificate cell
# to, so they stay independent, hand-editable content on each page.
DATA_ENTRY_FIELDS_HEADER_ROW = 4
DATA_ENTRY_FIELDS_START_ROW = DATA_ENTRY_FIELDS_HEADER_ROW + 1
DATA_ENTRY_STATEMENTS_HEADER_ROW = DATA_ENTRY_FIELDS_START_ROW + len(DATA_ENTRY_FIELDS) + 1
DATA_ENTRY_STATEMENTS_START_ROW = DATA_ENTRY_STATEMENTS_HEADER_ROW + 1

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
