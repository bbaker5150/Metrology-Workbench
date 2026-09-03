"""
Filesystem-backed registry of measurement areas.

Replaces the old ``MeasurementArea`` Django model. An "area" is just a JSON
file in ``reports/areas/`` shaped exactly like a ROC payload (the same shape
``ROCRecordSerializer`` / ``ManualInputForm.jsx`` speak) -- ``area_code``,
``area_name``, ``nomenclature``, ``submitted_label``, ``statements``, and
every other field a ROC has, populated with that area's defaults (mostly
blank, plus its approved front-page statement text). Since there's only one
canonical Excel layout now (``cellmap.TEMPLATE``), the area no longer needs
to say anything about cell coordinates -- it's purely data.

**To add a new template: drop one more ``<code>.json`` file in this
directory.** No other code changes needed -- ``list_areas()`` picks it up
for the frontend dropdown, and ``get_area()`` feeds it straight into
``excel.build_download_workbook`` as the starting data for that area's ROC
Template download.

Files are read fresh on every call -- there are only a handful of small
JSON files, so this isn't worth caching, and it means dropping in a new
file takes effect without a backend restart.
"""
import json
from pathlib import Path

AREAS_DIR = Path(__file__).resolve().parent / "areas"


def _load(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def list_areas():
    """Summaries for the frontend's area dropdown, shaped like the old
    MeasurementAreaSerializer output: code, name, default_nomenclature,
    submitted_label, statements."""
    areas = []
    for path in sorted(AREAS_DIR.glob("*.json")):
        data = _load(path)
        areas.append({
            "code": data.get("area_code", ""),
            "name": data.get("area_name", ""),
            "default_nomenclature": data.get("nomenclature", ""),
            "submitted_label": data.get("submitted_label", "Submitted by:"),
            "statements": data.get("statements", []),
        })
    areas.sort(key=lambda area: area["name"])
    return areas


def get_area(code):
    """The full ROC-payload-shaped dict for `code`, or None if no area.json
    has a matching area_code. Used directly as the `data` a ROC Template
    download is built from (see views.roc_template)."""
    for path in AREAS_DIR.glob("*.json"):
        data = _load(path)
        if data.get("area_code") == code:
            return data
    return None
