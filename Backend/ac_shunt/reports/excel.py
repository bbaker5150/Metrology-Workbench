"""
Excel (.xlsx) generation for the Report of Calibration module.

Not a byte-for-byte replica of the original NPSL 55-column grid layout — the
source workbooks that defined that layout no longer exist in this repo (see
the rocgen-project-state memory). This produces a clean, functional,
single-sheet export instead: front-page content stacked top to bottom in the
same order CalibrationPDF.jsx renders, then any data tables below. Swap this
generator out if/when the lab supplies real template files to match exactly.
"""
from io import BytesIO

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font
from openpyxl.worksheet.worksheet import Worksheet

TOTAL_COLUMNS = 8

TITLE_FONT = Font(name="Times New Roman", size=18, bold=True)
LAB_FONT = Font(name="Times New Roman", size=14, bold=True)
BODY_FONT = Font(name="Times New Roman", size=12)
BOLD_BODY_FONT = Font(name="Times New Roman", size=12, bold=True)
HEADER_FONT = Font(name="Times New Roman", size=11, bold=True)

CENTER = Alignment(horizontal="center", vertical="center", wrap_text=True)
JUSTIFY = Alignment(horizontal="justify", vertical="top", wrap_text=True)

# Front-page statement kinds in NPSL's canonical order (matches
# ManualInputForm.jsx's STATEMENT_LABELS and CalibrationPDF.jsx's
# technical/statements_rest split).
STATEMENT_ORDER = ["technical", "results_location", "special", "uncertainty", "traceability", "reproduction"]


def _centered(ws: Worksheet, row: int, text: str, font: Font = BODY_FONT) -> int:
    ws.merge_cells(start_row=row, start_column=1, end_row=row, end_column=TOTAL_COLUMNS)
    cell = ws.cell(row=row, column=1, value=text or "")
    cell.font = font
    cell.alignment = CENTER
    return row + 1


def _paragraph(ws: Worksheet, row: int, text: str) -> int:
    if not text:
        return row
    ws.merge_cells(start_row=row, start_column=1, end_row=row, end_column=TOTAL_COLUMNS)
    cell = ws.cell(row=row, column=1, value=text)
    cell.font = BODY_FONT
    cell.alignment = JUSTIFY
    # Rough autosize so wrapped paragraphs don't clip: ~100 chars/line at
    # this column width, ~15.6pt per line.
    lines = max(1, -(-len(text) // 100))
    ws.row_dimensions[row].height = 15.6 * lines
    return row + 1


def _label_value(ws: Worksheet, row: int, label: str, value) -> int:
    ws.cell(row=row, column=1, value=label).font = BOLD_BODY_FONT
    ws.merge_cells(start_row=row, start_column=2, end_row=row, end_column=TOTAL_COLUMNS)
    cell = ws.cell(row=row, column=2, value=value if value not in (None, "") else "")
    cell.font = BODY_FONT
    return row + 1


def _data_table(ws: Worksheet, row: int, table: dict) -> int:
    row = _paragraph(ws, row, table.get("intro_text") or "")
    if table.get("title"):
        row = _centered(ws, row, table["title"], BOLD_BODY_FONT)

    columns = table.get("columns") or []
    if not columns:
        return row + 1

    for index, column in enumerate(columns, start=1):
        header_text = "\n".join(filter(None, [column.get("header"), column.get("unit")]))
        cell = ws.cell(row=row, column=index, value=header_text)
        cell.font = HEADER_FONT
        cell.alignment = CENTER
    row += 1

    for data_row in table.get("rows") or []:
        for index, value in enumerate(data_row, start=1):
            cell = ws.cell(row=row, column=index, value=value if value not in (None,) else "")
            cell.font = BODY_FONT
            cell.alignment = CENTER
        row += 1

    return row + 2


def build_workbook(data: dict) -> Workbook:
    """Build a Workbook from a ROC payload dict (the same shape ManualInputForm
    edits and ROCRecordSerializer produces)."""
    wb = Workbook()
    ws = wb.active
    ws.title = "Report of Calibration"
    ws.sheet_view.showGridLines = False
    ws.page_margins.left = ws.page_margins.right = 0.5
    ws.page_margins.top = ws.page_margins.bottom = 0.5
    for col_index in range(1, TOTAL_COLUMNS + 1):
        ws.column_dimensions[chr(64 + col_index)].width = 14

    row = 1
    row = _centered(ws, row, "Department of the Navy")
    row = _centered(ws, row, "NAVAIR North Island, Bldg. 469-S")
    row = _centered(ws, row, "San Diego, CA 92135")
    row += 1
    row = _centered(ws, row, "Navy Primary Standards Laboratory", LAB_FONT)
    row = _centered(ws, row, "(COM) 619-545-9705 (DSN) 735-9705 (FAX) 619-545-9861")
    row += 1

    row = _centered(ws, row, "Report of Calibration", TITLE_FONT)
    row = _centered(ws, row, "for")
    row = _centered(ws, row, data.get("nomenclature"), BOLD_BODY_FONT)
    row += 1

    row = _label_value(ws, row, "Manufacturer:", data.get("manufacturer"))
    row = _label_value(ws, row, "Model:", data.get("model_number"))
    row = _label_value(ws, row, "Serial:", data.get("serial_number"))
    row += 1

    row = _centered(ws, row, data.get("submitted_label") or "Submitted by:")
    row = _centered(ws, row, data.get("customer_name"))
    row = _centered(ws, row, data.get("customer_address"))
    row += 1

    statements_by_kind = {s.get("kind"): s.get("text", "") for s in (data.get("statements") or [])}
    ordered_statements = [statements_by_kind[k] for k in STATEMENT_ORDER if statements_by_kind.get(k)]

    row = _paragraph(ws, row, ordered_statements[0] if ordered_statements else "")
    if data.get("procedure_used"):
        row = _label_value(ws, row, "Procedure Used:", data["procedure_used"])
    row += 1

    for line in data.get("inline_results") or []:
        cells = [str(c) for c in line if c not in (None, "")]
        if cells:
            pairs = [f"{cells[i]} = {cells[i + 1]}" for i in range(0, len(cells) - 1, 2)]
            row = _centered(ws, row, "     ".join(pairs))

    for text in ordered_statements[1:]:
        row = _paragraph(ws, row, text)
    row += 1

    row = _label_value(ws, row, "Ambient Temperature:", f"{data.get('ambient_temperature') or ''} °C")
    row = _label_value(ws, row, "Relative Humidity:", f"{data.get('relative_humidity') or ''} %")
    row = _label_value(ws, row, "Calibration Date:", data.get("calibration_date"))
    row = _label_value(ws, row, "Due Date:", data.get("due_date"))
    row += 2

    row = _label_value(ws, row, "Metrologist:", data.get("metrologist_name"))
    row = _label_value(ws, row, "", data.get("metrologist_title"))
    row += 1
    row = _label_value(ws, row, "Approved by:", data.get("approver_name"))
    row = _label_value(ws, row, "", data.get("approver_title"))
    row += 2

    row = _label_value(ws, row, "RoC #:", data.get("roc_number"))
    row = _label_value(ws, row, "Issue Date:", data.get("issue_date"))
    row += 2

    for table in data.get("tables") or []:
        row = _data_table(ws, row, table)

    return wb


def workbook_to_bytes(workbook: Workbook) -> bytes:
    buffer = BytesIO()
    workbook.save(buffer)
    return buffer.getvalue()
