"""
HTTP endpoints for the Uncertainty Budget module (mounted at ``/api/uncertainty/``).

Sessions are read/written as whole nested documents (see ``serializers.py``),
matching how the frontend ``useSessionManager`` loads everything into memory and
persists a session at a time. Instruments (global library), bug reports, and
note images each get their own small collection endpoints.
"""
import hashlib
import secrets
from uuid import UUID

from django.conf import settings
from django.contrib.auth.models import Group
from django.db import router, transaction
from django.db.models import Q
from django.db.models import Prefetch
from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from . import models, serializers


@api_view(["GET"])
@permission_classes([AllowAny])
def ac_shunt_sessions(request):
    from reports.services import list_ac_shunt_sessions
    return Response(list_ac_shunt_sessions(request.query_params))


@api_view(["GET"])
@permission_classes([AllowAny])
def ac_shunt_snapshot(request, session_id):
    from .ac_shunt_import import session_snapshot
    snapshot = session_snapshot(session_id)
    if snapshot is None:
        return Response({"detail": "AC-shunt session not found."}, status=404)
    from .y5020_resolution import is_y5020
    if is_y5020(snapshot['instruments']['test_instrument_model']):
        # Also initialize on first import for installations launched without
        # bootstrap. The stable library ID prevents serial matching/duplicates.
        from .fluke5790_instrument import seed_generic_5790
        reader, _ = seed_generic_5790()
        snapshot['generic5790Instrument'] = serializers.instrument_to_dict(reader)
    return Response(snapshot)


@api_view(["GET"])
@permission_classes([AllowAny])
def module_info(request):
    """Report that the Uncertainty Budget backend is present and wired."""
    return Response({
        "module": "uncertainty",
        "title": "Uncertainty Budget",
        "status": "ready",
    })


@api_view(["GET"])
@permission_classes([AllowAny])
def system_info(request):
    """Expose the backing database type for this module (drives the DB pill)."""
    engine = settings.DATABASES.get("uncertainty", {}).get("ENGINE", "")
    db_type = "sqlite3" if "sqlite3" in engine else "mssql"
    return Response({"module": "uncertainty", "database_type": db_type})


# --------------------------------------------------------------------------- #
# Sessions
# --------------------------------------------------------------------------- #
def _session_documents():
    return models.Session.objects.prefetch_related(
        "measurement_areas", "uuts", "tmdes", "test_points__components",
        # The document exposes image references only. Image bodies are fetched
        # separately by session_images and need not occupy memory on every load.
        Prefetch("note_images", queryset=models.NoteImage.objects.defer("data")),
    )


@api_view(["GET", "POST"])
@permission_classes([AllowAny])
def sessions(request):
    if request.method == "GET":
        qs = _session_documents()
        return Response([serializers.session_to_dict(s) for s in qs])

    # POST -> create from whole-session payload.
    session = serializers.save_session(request.data)
    full = _session_documents().get(pk=session.pk)
    return Response(serializers.session_to_dict(full), status=status.HTTP_201_CREATED)


@api_view(["GET", "PUT", "DELETE"])
@permission_classes([AllowAny])
def session_detail(request, session_id):
    if request.method == "DELETE":
        models.Session.objects.filter(pk=session_id).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    if request.method == "PUT":
        data = dict(request.data)
        data["id"] = int(session_id)
        serializers.save_session(data)

    session = get_object_or_404(
        _session_documents(),
        pk=session_id,
    )
    return Response(serializers.session_to_dict(session))


# --------------------------------------------------------------------------- #
# Instruments (global library)
# --------------------------------------------------------------------------- #
def _library_password():
    """Shared password gating writes to the validated (shared) library.

    Configurable via the ``UNCERTAINTY_LIBRARY_PASSWORD`` env/setting; defaults
    to a well-known dev value. This is the deliberately-simple "for now" gate —
    swap for per-user permissions later without touching call sites.
    """
    return getattr(settings, "UNCERTAINTY_LIBRARY_PASSWORD", "calibrate")


SME_GROUP = "Uncertalytics SME"
INTERIM_REVIEW_GROUP = "Metrology Software Owners"


def _can_validate(request):
    if not request.user.is_authenticated:
        return False
    memberships = set(request.user.groups.values_list("name", flat=True))
    if SME_GROUP in memberships:
        return True
    if INTERIM_REVIEW_GROUP not in memberships:
        return False
    # Compare names exactly even on databases with case-insensitive collation.
    return SME_GROUP not in Group.objects.filter(name=SME_GROUP).values_list("name", flat=True)


def _review_owner(request, create=False):
    if request.user.is_authenticated:
        return f"user:{request.user.pk}"
    # Standalone Django installations also support anonymous device sessions.
    # The private bearer credential never enters a session document or a listing.
    prefix = "InstrumentDevice "
    header = request.headers.get("Authorization", "")
    if header.startswith(prefix) and 32 <= len(header[len(prefix):]) <= 128:
        return "device:" + hashlib.sha256(header[len(prefix):].encode()).hexdigest()
    # Older same-origin API clients use their session cookie for ownership.
    token = request.session.get("instrument_owner")
    if not token and create:
        token = secrets.token_hex(32)
        request.session["instrument_owner"] = token
    return f"session:{token}" if token else ""


@api_view(["GET", "POST"])
@permission_classes([AllowAny])
def instruments(request):
    owner = request.query_params.get("owner") if request.method == "GET" else request.data.get("owner")
    reviewer = _review_owner(request, create=request.method == "POST")
    if request.method == "GET":
        visible = Q(scope="validated")
        if reviewer and (owner or request.user.is_authenticated):
            local = Q(scope="local", review_owner=reviewer)
            visible |= local if request.user.is_authenticated else local & Q(owner=owner)
        if reviewer:
            visible |= Q(scope="pending", review_owner=reviewer)
        legacy = models.LegacyInstrumentUse.objects.filter(actor=reviewer) if reviewer else models.LegacyInstrumentUse.objects.none()
        if owner:
            visible |= Q(scope="local", owner=owner, review_owner="") & ~Q(pk__in=legacy.values("legacy_id"))
        private_origins = {str(private): original for private, original in legacy.values_list("private_id", "legacy_id")}
        qs = models.Instrument.objects.filter(visible)
        scope = request.query_params.get("scope")
        if scope:
            qs = qs.filter(scope=scope)
        return Response([{**serializers.instrument_to_dict(i), **({"legacyLocalId": private_origins[i.id]} if i.id in private_origins else {})}
                         for i in qs])

    data = request.data
    if not data.get("id"):
        return Response({"detail": "An instrument ID is required."}, status=400)
    requested_scope = data.get("scope")
    if requested_scope == "validated":
        return Response({"detail": "Submit a local copy for SME validation."}, status=403)
    if requested_scope and requested_scope not in {"local", "pending"}:
        return Response({"detail": "Unknown library scope."}, status=400)
    with transaction.atomic(using=router.db_for_write(models.Instrument)):
        existing = models.Instrument.objects.select_for_update().filter(pk=data["id"]).first()
        legacy_id = None
        if existing and existing.scope == "local" and not existing.review_owner:
            if not owner or owner != existing.owner:
                return Response(status=404)
            # Old records had only a device key. Keep the original immutable
            # and give each authenticated actor its own successor on first use.
            successor, _ = models.LegacyInstrumentUse.objects.get_or_create(actor=reviewer, legacy_id=existing.id)
            legacy_id = existing.id
            data = {**serializers.instrument_to_dict(existing), **data, "id": str(successor.private_id)}
            if str(data.get("sourceId") or "") == legacy_id:
                data["sourceId"] = ""
            existing = models.Instrument.objects.select_for_update().filter(pk=data["id"]).first()
        scope = data.get("scope") or (existing.scope if existing else "local")
        if existing and existing.scope == "validated":
            return Response({"detail": "Submit a local copy for SME validation."}, status=403)
        if existing and (not reviewer or existing.review_owner != reviewer):
            return Response(status=404)
        if existing and existing.scope == "pending" and scope == "local" and existing.updated_at.isoformat() != data.get("reviewVersion"):
            return Response({"detail": "This instrument has already been submitted. Reopen it to edit the current submission."}, status=409)
        obj = serializers.save_instrument({**data, "scope": scope}, actor=reviewer, reuse_linked=legacy_id is None)
        result = serializers.instrument_to_dict(obj)
        if legacy_id:
            result["legacyLocalId"] = legacy_id
        return Response(result, status=status.HTTP_201_CREATED)


@api_view(["GET"])
@permission_classes([AllowAny])
def instrument_reviews(request):
    can_validate = _can_validate(request)
    rows = models.Instrument.objects.filter(scope="pending") if can_validate else []
    return Response({"canValidate": can_validate, "reviews": [serializers.instrument_to_dict(i) for i in rows]})


@api_view(["POST"])
@permission_classes([AllowAny])
def validate_instrument(request, instrument_id):
    if not _can_validate(request):
        return Response({"detail": "You do not have instrument validation access."}, status=403)
    with transaction.atomic(using=router.db_for_write(models.Instrument)):
        submitted = get_object_or_404(models.Instrument.objects.select_for_update(), pk=instrument_id, scope="pending")
        if submitted.updated_at.isoformat() != request.data.get("reviewVersion"):
            return Response({"detail": "This submission changed. Reopen the inbox to review it again."}, status=409)
        target_id = submitted.source_id or submitted.id
        target = models.Instrument.objects.select_for_update().filter(pk=target_id).first()
        if submitted.source_id and target_id != submitted.id and target is None:
            return Response({"detail": "The original shared instrument no longer exists."}, status=409)
        if target and target.id != submitted.id and target.scope != "validated":
            return Response({"detail": "The target is a private instrument."}, status=409)
        definition = serializers.instrument_to_dict(submitted)
        snapshot_fields = ("manufacturer", "model", "description", "functions", "typeBComponents",
                           "ranges", "tmdeSecondaryUncertainties", "qualifierColumnNames", "customColumns")
        obj = serializers.save_instrument({
            **definition, "id": target_id, "sourceId": target_id, "scope": "validated",
            "owner": "", "validatedSnapshot": {key: definition[key] for key in snapshot_fields if key in definition},
            "localOverride": False,
        })
        # Keep the original submitter on the server through later approvals by
        # other authors. The public representation omits this ownership.
        origin = target or submitted
        obj.owner, obj.review_owner = origin.owner, origin.review_owner
        obj.save(update_fields=["owner", "review_owner"])
        if submitted.pk != obj.pk:
            submitted.delete()
        return Response(serializers.instrument_to_dict(obj))


@api_view(["DELETE"])
@permission_classes([AllowAny])
def instrument_detail(request, instrument_id):
    with transaction.atomic(using=router.db_for_write(models.Instrument)):
        instrument = models.Instrument.objects.select_for_update().filter(pk=str(instrument_id)).first()
        if instrument and instrument.scope == "validated":
            if (request.data.get("password") or "") != _library_password():
                return Response({"detail": "Invalid shared-library password."}, status=403)
            # Old approvals cleared ownership. Upgraded legacy drafts also
            # have a durable actor-to-successor mapping and can be recovered.
            if not instrument.review_owner:
                try:
                    successor_id = UUID(instrument.id)
                except ValueError:
                    successor_id = None
                successor = models.LegacyInstrumentUse.objects.filter(private_id=successor_id).first() if successor_id else None
                if successor:
                    instrument.review_owner = successor.actor
                    instrument.owner = models.Instrument.objects.filter(pk=successor.legacy_id).values_list("owner", flat=True).first() or ""
            if instrument.review_owner:
                instrument.scope = "local"
                instrument.source_id = ""
                instrument.validated_snapshot = None
                instrument.local_override = True
                instrument.save(update_fields=["scope", "owner", "review_owner", "source_id", "validated_snapshot", "local_override", "updated_at"])
                if instrument.review_owner == _review_owner(request):
                    return Response(serializers.instrument_to_dict(instrument))
                return Response(status=status.HTTP_204_NO_CONTENT)
        if instrument and instrument.scope in {"local", "pending"}:
            if request.data.get("password"):
                # A retry of shared removal must not delete the restored draft.
                if (instrument.scope == "local" and instrument.review_owner and instrument.review_owner == _review_owner(request)
                        and request.data["password"] == _library_password()):
                    return Response(serializers.instrument_to_dict(instrument))
                return Response(status=status.HTTP_204_NO_CONTENT)
            if instrument.scope == "local" and not instrument.review_owner:
                if not instrument.owner or request.query_params.get("owner") != instrument.owner:
                    return Response(status=404)
                models.LegacyInstrumentUse.objects.get_or_create(actor=_review_owner(request, create=True), legacy_id=instrument.id)
                return Response(status=status.HTTP_204_NO_CONTENT)
            actor = _review_owner(request)
            if not actor or actor != instrument.review_owner:
                return Response(status=404)
            if instrument.scope == "local" and not request.user.is_authenticated and request.query_params.get("owner") != instrument.owner:
                return Response(status=404)
        if instrument:
            instrument.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


# --------------------------------------------------------------------------- #
# Custom equations (global measurement-equation library)
# --------------------------------------------------------------------------- #
@api_view(["GET", "POST"])
@permission_classes([AllowAny])
def equations(request):
    if request.method == "GET":
        return Response(
            [
                serializers.custom_equation_to_dict(e)
                for e in models.CustomEquation.objects.all()
            ]
        )
    obj = serializers.save_custom_equation(request.data)
    return Response(
        serializers.custom_equation_to_dict(obj), status=status.HTTP_201_CREATED
    )


@api_view(["DELETE"])
@permission_classes([AllowAny])
def equation_detail(request, equation_id):
    models.CustomEquation.objects.filter(pk=str(equation_id)).delete()
    return Response(status=status.HTTP_204_NO_CONTENT)


# --------------------------------------------------------------------------- #
# Bug reports
# --------------------------------------------------------------------------- #
@api_view(["GET", "POST"])
@permission_classes([AllowAny])
def bug_reports(request):
    if request.method == "GET":
        return Response(
            [serializers.bug_report_to_dict(b) for b in models.BugReport.objects.all()]
        )
    obj = serializers.save_bug_report(request.data)
    return Response(serializers.bug_report_to_dict(obj), status=status.HTTP_201_CREATED)


@api_view(["DELETE"])
@permission_classes([AllowAny])
def bug_report_detail(request, report_id):
    models.BugReport.objects.filter(pk=str(report_id)).delete()
    return Response(status=status.HTTP_204_NO_CONTENT)


# --------------------------------------------------------------------------- #
# Session note images (base64 data fetched/saved separately from the session)
# --------------------------------------------------------------------------- #
@api_view(["GET", "PATCH", "PUT"])
@permission_classes([AllowAny])
def session_notes(request, session_id):
    """Read or update only a session's rich-text notes document.

    Notes autosave while the user types.  Keeping this endpoint separate from
    the full nested-session PUT avoids rebuilding every instrument, point, and
    budget row for each edit while still using the same session transaction
    queue on the client.
    """
    session = get_object_or_404(models.Session, pk=session_id)
    if request.method == "GET":
        return Response({"notes": session.notes or ""})

    notes = request.data.get("notes")
    if not isinstance(notes, str):
        return Response(
            {"detail": "notes must be a string"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    session.notes = notes
    session.save(update_fields=["notes"])
    return Response({"notes": session.notes})


# --------------------------------------------------------------------------- #
@api_view(["GET", "POST"])
@permission_classes([AllowAny])
def session_images(request, session_id):
    session = get_object_or_404(models.Session, pk=session_id)
    if request.method == "GET":
        return Response([
            {"id": serializers._coerce_id(img.cid), "data": img.data}
            for img in session.note_images.all()
            if img.data
        ])

    image_id = request.data.get("imageId")
    data_b64 = request.data.get("dataBase64", "")
    obj, _ = models.NoteImage.objects.get_or_create(
        session=session, cid=serializers._cid(image_id)
    )
    obj.data = data_b64 or obj.data
    if request.data.get("fileName"):
        obj.file_name = request.data.get("fileName")
    obj.save()
    return Response({"id": serializers._coerce_id(obj.cid)}, status=status.HTTP_201_CREATED)


@api_view(["DELETE"])
@permission_classes([AllowAny])
def session_image_detail(request, session_id, image_id):
    models.NoteImage.objects.filter(
        session_id=session_id, cid=serializers._cid(image_id)
    ).delete()
    return Response(status=status.HTTP_204_NO_CONTENT)
