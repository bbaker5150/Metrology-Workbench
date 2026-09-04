"""
In-process service layer for the Report of Calibration module.

Two directions live here:

  - Functions other modules import (never HTTP) to read report data without
    crossing process boundaries — the "soft dependency" contract from
    docs/adding-a-module.md. Empty until another module needs to pull ROC
    data in-process. CRUD on ROCRecord itself lives in views.py -- area
    *definitions* aren't a model at all, see area_registry.py -- that part
    of this file is for callers *outside* the reports app.

  - list_ac_shunt_sessions()/pull_ac_shunt_session() below: reports is the
    downstream end of the pipeline (AC-Shunt -> Type-A -> Uncertainty Budget
    -> ROC), so these pull FROM the api (AC-Shunt) app's models, in-process,
    the same way. They return plain dicts (DTOs), never ORM objects, so the
    views stay simple JSON passthroughs.
"""
from django.core.exceptions import ObjectDoesNotExist
from django.db.utils import Error as DjangoDBError

from . import area_registry

AC_SHUNT_AREA_CODE = "AC_SHUNT"

DATA_TABLE_COLUMNS = [
    {"header": "Current", "unit": "(A)"},
    {"header": "Frequency", "unit": "(Hz)"},
    {"header": "Direction", "unit": ""},
    {"header": "ΔUUT", "unit": "(ppm)"},
    {"header": "Expanded Unc.", "unit": "(ppm)"},
    {"header": "k", "unit": ""},
]


def list_ac_shunt_sessions():
    """Return {"available": bool, "sessions": [...]} from the AC-Shunt (api) app.

    `available=False` means the AC-Shunt database itself is unreachable (e.g.
    an MSSQL outage) -- distinct from "available but zero sessions exist".
    """
    from api.models import CalibrationSession

    try:
        sessions = list(
            CalibrationSession.objects.order_by("-created_at").values(
                "id",
                "session_name",
                "test_instrument_model",
                "test_instrument_serial",
                "standard_instrument_model",
                "standard_instrument_serial",
            )[:50]
        )
    except DjangoDBError:
        return {"available": False, "sessions": []}
    return {"available": True, "sessions": sessions}


def pull_ac_shunt_session(session_id):
    """Map one CalibrationSession + its test points into a ROC payload dict.

    Returns None if the session doesn't exist. Only instrument identity,
    environment, and a measurement data table are populated -- customer,
    procedure, dates, and personnel are left for the user to fill in via
    Manual Input, matching what the AC-Shunt Pull tab's UI already tells them.
    """
    from api.models import CalibrationSession

    try:
        session = CalibrationSession.objects.get(pk=session_id)
    except (CalibrationSession.DoesNotExist, DjangoDBError):
        return None

    area = area_registry.get_area(AC_SHUNT_AREA_CODE)

    rows = []
    try:
        points = list(session.test_point_set.points.select_related().all())
    except ObjectDoesNotExist:
        # No TestPointSet on this session yet (e.g. a session created but
        # never run) -- both the OneToOne reverse accessor's own
        # RelatedObjectDoesNotExist and TestPointSet.DoesNotExist subclass
        # this, so it's the correct single exception to catch here.
        points = []
    for point in points:
        results = getattr(point, "results", None)
        rows.append([
            str(point.current),
            point.frequency,
            point.direction,
            _round_or_blank(getattr(results, "delta_uut_ppm_avg", None)),
            _round_or_blank(getattr(results, "expanded_uncertainty", None)),
            _round_or_blank(getattr(results, "k_value", None)),
        ])

    return {
        "area_code": area["area_code"] if area else AC_SHUNT_AREA_CODE,
        "area_name": area["area_name"] if area else "AC Shunt",
        "roc_number": "",
        "nomenclature": area["nomenclature"] if area else "Current Shunt",
        "manufacturer": "",
        "model_number": session.test_instrument_model or "",
        "serial_number": session.test_instrument_serial or "",
        "submitted_label": area["submitted_label"] if area else "Submitted by:",
        "customer_name": "",
        "customer_address": "",
        "procedure_used": "",
        "statements": area["statements"] if area else [],
        "inline_results": [],
        "ambient_temperature": _round_or_blank(session.temperature),
        "relative_humidity": _round_or_blank(session.humidity),
        "calibration_date": session.created_at.date().isoformat() if session.created_at else "",
        "due_date": "",
        "issue_date": "",
        "metrologist_name": "",
        "metrologist_title": "",
        "approver_name": "",
        "approver_title": "",
        "tables": (
            [{
                "title": "AC Shunt Calibration Data",
                "intro_text": "",
                "columns": DATA_TABLE_COLUMNS,
                "rows": rows,
            }]
            if rows else []
        ),
    }


def _round_or_blank(value):
    if value is None:
        return ""
    try:
        return round(float(value), 4)
    except (TypeError, ValueError):
        return value
