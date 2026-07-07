"""
Whole-session (de)serialization for the Uncertainty Budget module.

The frontend treats a session as one nested document with a specific mix of
camelCase and snake_case keys (e.g. ``measurementAreas`` but
``combined_uncertainty``). Rather than fight DRF ``ModelSerializer`` field-name
mapping, these plain helpers convert between the model graph and the exact dict
shape the UI produces/consumes, so a load -> edit -> save round-trip is lossless.

``save_session`` is transactional and rebuilds the child collections from the
payload (the UI always sends the whole session). Note images are upserted in
place rather than rebuilt, because their large base64 ``data`` is written by a
separate endpoint and must survive a metadata-only session save.
"""
from django.db import transaction

from . import models


# --------------------------------------------------------------------------- #
# id helpers
# --------------------------------------------------------------------------- #
def _coerce_id(cid):
    """Round-trip the frontend id type: numeric ids (Date.now()) come back as
    ints, uuid ids stay strings."""
    if cid is None:
        return None
    s = str(cid)
    if s.isdigit():
        try:
            return int(s)
        except (TypeError, ValueError):
            return s
    return s


def _cid(value):
    """Store any incoming id as a string key."""
    return "" if value is None else str(value)


# --------------------------------------------------------------------------- #
# model -> dict (output)
# --------------------------------------------------------------------------- #
def component_to_dict(c):
    return {
        "id": _coerce_id(c.cid),
        "name": c.name,
        "type": c.component_type,
        "value": c.value,
        "value_native": c.value_native,
        "unit_native": c.unit_native,
        "dof": c.dof,
        "distribution": c.distribution,
        "isCore": c.is_core,
        "sourcePointLabel": c.source_point_label,
        "variableType": c.variable_type,
        "originalInput": c.original_input,
        "savedInputs": c.saved_inputs,
    }


def test_point_to_dict(tp):
    return {
        "id": _coerce_id(tp.cid),
        "section": tp.section,
        "tmdeDescription": tp.tmde_description,
        "measurementAreaId": tp.measurement_area_id,
        "associatedUutIds": tp.associated_uut_ids or [],
        "specifications": tp.specifications or {},
        "components": [component_to_dict(c) for c in tp.components.all()],
        "is_detailed_uncertainty_calculated": tp.is_detailed_uncertainty_calculated,
        "measurementType": tp.measurement_type,
        "equationString": tp.equation_string,
        "variableMappings": tp.variable_mappings or {},
        "variableNominals": tp.variable_nominals or {},
        "inputCorrelations": tp.input_correlations or {},
        "testPointInfo": tp.test_point_info or {},
        "uutTolerance": tp.uut_tolerance,
        "tmdeTolerances": tp.tmde_tolerances or [],
        "combined_uncertainty": tp.combined_uncertainty,
        "combined_uncertainty_absolute_base": tp.combined_uncertainty_absolute_base,
        "combined_uncertainty_inputs_native": tp.combined_uncertainty_inputs_native,
        "combined_uncertainty_inputs_base": tp.combined_uncertainty_inputs_base,
        "effective_dof": tp.effective_dof,
        "k_value": tp.k_value,
        "coverageFactorMode": tp.coverage_factor_mode or "auto",
        "coverageFactorOverride": tp.coverage_factor_override,
        "expanded_uncertainty": tp.expanded_uncertainty,
        "expanded_uncertainty_absolute_base": tp.expanded_uncertainty_absolute_base,
        "calculatedNominalValue": tp.calculated_nominal_value,
        "calculatedBudgetComponents": tp.calculated_budget_components or [],
        "calculatedBudgetGroups": tp.calculated_budget_groups or [],
        "riskMetrics": tp.risk_metrics,
    }


def area_to_dict(a):
    return {
        "id": _coerce_id(a.cid),
        "name": a.name,
        "color": a.color,
        "hiddenFromSidebar": a.hidden_from_sidebar,
    }


def uut_to_dict(u):
    return {
        "id": _coerce_id(u.cid),
        "name": u.name,
        "description": u.description,
        "measurementArea": u.measurement_area,
        "measurementAreaId": u.measurement_area_cid,
        "measurementAreaColor": u.measurement_area_color,
        "instrument": u.instrument,
    }


def tmde_to_dict(t):
    return {
        "id": _coerce_id(t.cid),
        "name": t.name,
        "quantity": t.quantity,
        "assetId": t.asset_id,
        "isInstrumentBased": t.is_instrument_based,
        "instrument": t.instrument,
    }


def note_image_ref_to_dict(img):
    """Lightweight ref (no base64 ``data``) used inside the session payload."""
    return {"id": _coerce_id(img.cid), "fileName": img.file_name}


def session_to_dict(s):
    return {
        "id": s.id,
        "name": s.name,
        "analyst": s.analyst,
        "organization": s.organization,
        "document": s.document,
        "documentDate": s.document_date,
        "notes": s.notes,
        "uutDescription": s.uut_description,
        "uutTolerance": s.uut_tolerance or {},
        "functionGroups": s.function_groups or [],
        "uncReq": {
            "uncertaintyConfidence": s.uncertainty_confidence,
            "reliability": s.reliability,
            "calInt": s.cal_int,
            "measRelCalcAssumed": s.meas_rel_calc_assumed,
            "neededTUR": s.needed_tur,
            "reqPFA": s.req_pfa,
            "guardBandMultiplier": s.guard_band_multiplier,
        },
        "measurementAreas": [area_to_dict(a) for a in s.measurement_areas.all()],
        "uuts": [uut_to_dict(u) for u in s.uuts.all()],
        "tmdes": [tmde_to_dict(t) for t in s.tmdes.all()],
        "testPoints": [
            test_point_to_dict(tp)
            for tp in s.test_points.all().prefetch_related("components")
        ],
        "noteImages": [note_image_ref_to_dict(i) for i in s.note_images.all()],
    }


def instrument_to_dict(i):
    return {
        "id": _coerce_id(i.id),
        "manufacturer": i.manufacturer,
        "model": i.model,
        "description": i.description,
        "measurementArea": i.measurement_area,
        "measurementAreaColor": i.measurement_area_color,
        "type": i.instrument_type,
        "functions": i.functions or [],
        "scope": i.scope,
        "owner": i.owner,
        "sourceId": i.source_id,
        "validatedSnapshot": i.validated_snapshot or None,
    }


def custom_equation_to_dict(eq):
    return {
        "id": _coerce_id(eq.id),
        "name": eq.name,
        "expression": eq.expression,
        "description": eq.description,
        "measurementArea": eq.measurement_area,
        "measurementAreaColor": eq.measurement_area_color,
        "variables": eq.variables or {},
    }


def bug_report_to_dict(b):
    return {
        "id": _coerce_id(b.id),
        "title": b.title,
        "type": b.report_type,
        "priority": b.priority,
        "description": b.description,
        "steps": b.steps,
        "reporter": b.reporter,
        "date": b.date,
        "timestamp": b.timestamp,
        "status": b.status,
    }


# --------------------------------------------------------------------------- #
# dict -> model (input)
# --------------------------------------------------------------------------- #
def _num(value, default=None):
    try:
        if value is None or value == "":
            return default
        return float(value)
    except (TypeError, ValueError):
        return default


@transaction.atomic(using="uncertainty")
def save_session(data):
    """Create or fully update a session from the whole-session payload.

    Child collections (areas, uuts, tmdes, test points + components) are rebuilt
    from the payload. Note image refs are upserted so their base64 data — saved
    via the image endpoint — survives a metadata save.
    """
    session_id = data.get("id")
    unc = data.get("uncReq") or {}

    defaults = {
        "name": data.get("name", "New Session"),
        "analyst": data.get("analyst", "") or "",
        "organization": data.get("organization", "") or "",
        "document": data.get("document", "") or "",
        "document_date": data.get("documentDate", "") or "",
        "notes": data.get("notes", "") or "",
        "uut_description": data.get("uutDescription", "") or "",
        "uut_tolerance": data.get("uutTolerance") or {},
        "function_groups": data.get("functionGroups") or [],
        "uncertainty_confidence": _num(unc.get("uncertaintyConfidence"), 95),
        "reliability": _num(unc.get("reliability"), 85),
        "cal_int": _num(unc.get("calInt"), 12),
        "meas_rel_calc_assumed": _num(unc.get("measRelCalcAssumed"), 85),
        "needed_tur": _num(unc.get("neededTUR"), 4),
        "req_pfa": _num(unc.get("reqPFA"), 2),
        "guard_band_multiplier": _num(unc.get("guardBandMultiplier"), 1),
    }

    session, _created = models.Session.objects.update_or_create(
        id=session_id, defaults=defaults
    )

    # Rebuild relational children.
    session.measurement_areas.all().delete()
    session.uuts.all().delete()
    session.tmdes.all().delete()
    session.test_points.all().delete()  # cascades components

    for a in data.get("measurementAreas", []) or []:
        models.MeasurementArea.objects.create(
            session=session,
            cid=_cid(a.get("id")),
            name=a.get("name", "") or "",
            color=a.get("color", "") or "",
            hidden_from_sidebar=bool(a.get("hiddenFromSidebar", False)),
        )

    for u in data.get("uuts", []) or []:
        models.Uut.objects.create(
            session=session,
            cid=_cid(u.get("id")),
            name=u.get("name", "") or "",
            description=u.get("description", "") or "",
            measurement_area_cid=_cid(u.get("measurementAreaId")),
            measurement_area=u.get("measurementArea", "") or "",
            measurement_area_color=u.get("measurementAreaColor", "") or "",
            instrument=u.get("instrument"),
        )

    for t in data.get("tmdes", []) or []:
        models.SessionTmde.objects.create(
            session=session,
            cid=_cid(t.get("id")),
            name=t.get("name", "") or "",
            quantity=_num(t.get("quantity"), 1),
            asset_id=t.get("assetId", "") or "",
            is_instrument_based=bool(t.get("isInstrumentBased", False)),
            instrument=t.get("instrument"),
        )

    for tp in data.get("testPoints", []) or []:
        point = models.TestPoint.objects.create(
            session=session,
            cid=_cid(tp.get("id")),
            section=tp.get("section", "") or "",
            tmde_description=tp.get("tmdeDescription", "") or "",
            measurement_area_id=_cid(tp.get("measurementAreaId")) if tp.get("measurementAreaId") else "",
            associated_uut_ids=tp.get("associatedUutIds") or [],
            test_point_info=tp.get("testPointInfo") or {},
            specifications=tp.get("specifications") or {},
            measurement_type=tp.get("measurementType", "direct") or "direct",
            equation_string=tp.get("equationString", "") or "",
            variable_mappings=tp.get("variableMappings") or {},
            variable_nominals=tp.get("variableNominals") or {},
            input_correlations=tp.get("inputCorrelations") or {},
            uut_tolerance=tp.get("uutTolerance"),
            tmde_tolerances=tp.get("tmdeTolerances") or [],
            is_detailed_uncertainty_calculated=bool(
                tp.get("is_detailed_uncertainty_calculated", False)
            ),
            combined_uncertainty=_num(tp.get("combined_uncertainty")),
            combined_uncertainty_absolute_base=_num(
                tp.get("combined_uncertainty_absolute_base")
            ),
            combined_uncertainty_inputs_native=_num(
                tp.get("combined_uncertainty_inputs_native")
            ),
            combined_uncertainty_inputs_base=_num(
                tp.get("combined_uncertainty_inputs_base")
            ),
            effective_dof=_num(tp.get("effective_dof")),
            k_value=_num(tp.get("k_value")),
            coverage_factor_mode=tp.get("coverageFactorMode", "auto") or "auto",
            coverage_factor_override=_num(tp.get("coverageFactorOverride")),
            expanded_uncertainty=_num(tp.get("expanded_uncertainty")),
            expanded_uncertainty_absolute_base=_num(
                tp.get("expanded_uncertainty_absolute_base")
            ),
            calculated_nominal_value=_num(tp.get("calculatedNominalValue")),
            calculated_budget_components=tp.get("calculatedBudgetComponents") or [],
            calculated_budget_groups=tp.get("calculatedBudgetGroups") or [],
            risk_metrics=tp.get("riskMetrics"),
        )
        for c in tp.get("components", []) or []:
            models.ManualComponent.objects.create(
                test_point=point,
                cid=_cid(c.get("id")),
                name=c.get("name", "") or "",
                component_type=c.get("type", "B") or "B",
                value=_num(c.get("value")),
                value_native=_num(c.get("value_native")),
                unit_native=c.get("unit_native", "") or "",
                dof=_num(c.get("dof")),
                distribution=c.get("distribution", "") or "",
                is_core=bool(c.get("isCore", False)),
                source_point_label=c.get("sourcePointLabel", "") or "",
                variable_type=c.get("variableType", "") or "",
                original_input=c.get("originalInput"),
                saved_inputs=c.get("savedInputs"),
            )

    # Upsert note-image refs without clobbering stored base64 data.
    incoming = data.get("noteImages", []) or []
    incoming_cids = {_cid(i.get("id")) for i in incoming}
    session.note_images.exclude(cid__in=incoming_cids).delete()
    for img in incoming:
        obj, _ = models.NoteImage.objects.get_or_create(
            session=session, cid=_cid(img.get("id"))
        )
        obj.file_name = img.get("fileName", "") or ""
        # Whole-session payload may carry inline data on first save/import.
        if img.get("fileObject"):
            obj.data = img.get("fileObject")
        obj.save()

    return session


def save_instrument(data):
    """Upsert a library instrument.

    Scope is preserved when the payload omits it, so a legacy save path (which
    doesn't know about scopes) can't silently demote a ``validated`` instrument
    to ``local``. Brand-new instruments with no scope default to ``local`` — the
    safe choice, since promotion to ``validated`` is password-gated upstream.
    """
    pk = _cid(data.get("id"))
    owner = data.get("owner", "") or ""
    scope_in = data.get("scope")
    source_id_in = data.get("sourceId", "") or ""
    if scope_in == models.Instrument.SCOPE_LOCAL and source_id_in:
        linked_local = models.Instrument.objects.filter(
            scope=models.Instrument.SCOPE_LOCAL,
            owner=owner,
            source_id=source_id_in,
        ).first()
        if linked_local:
            pk = linked_local.id
    existing = models.Instrument.objects.filter(id=pk).first()
    scope = data.get("scope") or (existing.scope if existing else models.Instrument.SCOPE_LOCAL)

    defaults = {
        "manufacturer": data.get("manufacturer", "") or "",
        "model": data.get("model", "") or "",
        "description": data.get("description", "") or "",
        "measurement_area": data.get("measurementArea", "") or "",
        "measurement_area_color": data.get("measurementAreaColor", "") or "",
        "instrument_type": data.get("type", "") or "",
        "functions": data.get("functions") or [],
        "scope": scope,
        "owner": owner or (existing.owner if existing else ""),
        "source_id": source_id_in or (existing.source_id if existing else ""),
    }
    # Only overwrite the snapshot when the caller explicitly supplies one
    # (e.g. on a sync), so ordinary edits don't wipe the divergence baseline.
    if "validatedSnapshot" in data:
        defaults["validated_snapshot"] = data.get("validatedSnapshot")

    obj, _ = models.Instrument.objects.update_or_create(id=pk, defaults=defaults)
    return obj


def save_custom_equation(data):
    obj, _ = models.CustomEquation.objects.update_or_create(
        id=_cid(data.get("id")),
        defaults={
            "name": data.get("name", "") or "",
            "expression": data.get("expression", "") or "",
            "description": data.get("description", "") or "",
            "measurement_area": data.get("measurementArea", "") or "",
            "measurement_area_color": data.get("measurementAreaColor", "") or "",
            "variables": data.get("variables") or {},
        },
    )
    return obj


def save_bug_report(data):
    obj, _ = models.BugReport.objects.update_or_create(
        id=_cid(data.get("id")),
        defaults={
            "title": data.get("title", "") or "",
            "report_type": data.get("type", "Bug") or "Bug",
            "priority": data.get("priority", "Normal") or "Normal",
            "description": data.get("description", "") or "",
            "steps": data.get("steps", "") or "",
            "reporter": data.get("reporter", "") or "",
            "date": data.get("date", "") or "",
            "timestamp": data.get("timestamp", "") or "",
            "status": data.get("status", "Open") or "Open",
        },
    )
    return obj
