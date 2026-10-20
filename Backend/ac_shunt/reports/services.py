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

# Matches the lab's AC-Shunt ROC page 2 (e.g. the Y5020 workbook's ROC2
# sheet): one row per test current, one column per frequency, each cell the
# Forward/Reverse averaged AC-DC difference.
CURRENT_COLUMN = {"header": "Test Current", "unit": "(Amps)"}
AC_DC_UNIT = "(µA/A)"
AC_DC_INTRO = (
    "The TI was measured to determine its Ac-dc difference. In the following "
    "table a positive sign indicates that more alternating current was "
    "required to obtain the same emf output."
)


def list_ac_shunt_sessions(params=None):
    """Search the full session history with bounded, stable pagination."""
    from api.models import CalibrationSession
    from django.db.models import Q
    from django.core.paginator import Paginator

    params = params or {}
    try:
        page_size = max(1, min(100, int(params.get("page_size", 20))))
    except (TypeError, ValueError):
        page_size = 20
    try:
        all_sessions = CalibrationSession.objects.all()
        models = list(all_sessions.exclude(test_instrument_model="").exclude(
            test_instrument_model__isnull=True
        ).order_by("test_instrument_model").values_list("test_instrument_model", flat=True).distinct())
        sessions = all_sessions
        fields = ("session_name", "test_instrument_model", "test_instrument_serial",
                  "standard_instrument_model", "standard_instrument_serial")
        for word in str(params.get("q", "")).split():
            match = Q()
            for field in fields:
                match |= Q(**{f"{field}__icontains": word})
            sessions = sessions.filter(match)
        if params.get("model"):
            sessions = sessions.filter(test_instrument_model=params["model"])
        ordering = {"oldest": ("created_at", "id"), "name": ("session_name", "id")}.get(
            params.get("sort"), ("-created_at", "-id")
        )
        paginator = Paginator(sessions.order_by(*ordering).values("id", *fields, "created_at"), page_size)
        page = paginator.get_page(params.get("page", 1))
        return {"available": True, "sessions": list(page.object_list),
                "total": paginator.count, "page": page.number,
                "pages": paginator.num_pages, "models": models}
    except DjangoDBError:
        return {"available": False, "sessions": [], "total": 0, "page": 1, "pages": 1, "models": []}


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

    try:
        points = list(session.test_point_set.points.select_related("results").all())
    except ObjectDoesNotExist:
        # No TestPointSet on this session yet (e.g. a session created but
        # never run) -- both the OneToOne reverse accessor's own
        # RelatedObjectDoesNotExist and TestPointSet.DoesNotExist subclass
        # this, so it's the correct single exception to catch here.
        points = []
    table = _ac_dc_difference_table(points)

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
        "tables": [table] if table else [],
    }


def _ac_dc_difference_table(points):
    """Pivot Forward/Reverse test points into Current x Frequency AC-DC
    differences. Each cell is the pair-level mean (``pair_delta_uut_ppm``,
    mirrored on both direction rows -- the headline value the AC-Shunt module
    reports), falling back to the mean of the two legacy single-pass
    ``delta_uut_ppm`` values, the same fallback its session Excel export uses."""
    pairs = {}
    for point in points:
        pairs.setdefault((point.current, point.frequency), {})[point.direction] = getattr(point, "results", None)
    if not pairs:
        return None

    currents = sorted({current for current, _ in pairs})
    frequencies = sorted({frequency for _, frequency in pairs})
    rows = []
    for current in currents:
        row = [_number(current)]
        for frequency in frequencies:
            row.append(_ac_dc_average(pairs.get((current, frequency), {})))
        rows.append(row)

    intro = [AC_DC_INTRO]
    uncertainties = [
        float(results.expanded_uncertainty)
        for directions in pairs.values() for results in directions.values()
        if results is not None and results.expanded_uncertainty is not None
    ]
    if uncertainties:
        worst = round(max(uncertainties), 1)
        verb = "is" if round(min(uncertainties), 1) == worst else "does not exceed"
        intro.append(
            f"The relative expanded uncertainty for the Ac-dc difference for all "
            f"frequencies and currents {verb} {_number(worst)} µA/A."
        )
    intro.append(f"The maximum test current used was {_number(currents[-1])} amperes.")

    return {
        "title": "Ac-dc Difference Data",
        "intro_text": " ".join(intro),
        "columns": [CURRENT_COLUMN] + [
            {"header": _frequency_label(frequency), "unit": AC_DC_UNIT} for frequency in frequencies
        ],
        "rows": rows,
    }


def _ac_dc_average(directions):
    for direction in ("Forward", "Reverse"):
        results = directions.get(direction)
        if results is not None and results.pair_delta_uut_ppm is not None:
            return round(float(results.pair_delta_uut_ppm), 1)
    legacy = [getattr(directions.get(direction), "delta_uut_ppm", None) for direction in ("Forward", "Reverse")]
    if all(value is not None for value in legacy):
        return round((float(legacy[0]) + float(legacy[1])) / 2, 1)
    return ""


def _frequency_label(frequency):
    if frequency >= 1000:
        return f"{_number(frequency / 1000)} kHz"
    return f"{_number(frequency)} Hz"


def _number(value):
    """Render 10.00000 / 1.0 as 10 / 1 while keeping real fractions."""
    value = float(value)
    return int(value) if value.is_integer() else value


def _round_or_blank(value):
    if value is None:
        return ""
    try:
        return round(float(value), 4)
    except (TypeError, ValueError):
        return value
