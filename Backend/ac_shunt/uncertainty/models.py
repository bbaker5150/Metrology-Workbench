"""
Relational models for the Uncertainty Budget module.

These mirror the data shapes the frontend (``modules/uncertainty``) produces.
The frontend treats a *session* as one deeply-nested document that it loads and
saves whole, so the API exposes whole-session nested serializers (see
``serializers.py``). To keep the frontend's data shape and id values stable
across the relational boundary:

  - ``Session`` is keyed by the frontend-provided id (``Date.now()`` big int).
  - ``Instrument`` (library) and ``BugReport`` are keyed by the frontend id,
    which may be a uuid or a numeric string, so their PK is a ``CharField``.
  - Every child row stores the frontend's original id in ``cid`` and the
    serializer round-trips it (coercing all-digit ids back to ints), so test
    points keep numeric ids and areas/uuts keep uuid ids exactly as created.

Top-level entities are normalized into tables; irregular, never-queried nested
leaves (tolerances, ``variableMappings``, ``testPointInfo``, computed budget
snapshots, ``riskMetrics``, instrument function/range trees) are kept as
``JSONField`` blobs — the same relational/JSON mix used by the AC-Shunt ``api``
app. WorkbenchRouter routes every table here to the dedicated ``uncertainty``
database alias (SQLite by default, MSSQL when configured).
"""
from django.db import models


class Session(models.Model):
    """Top-level uncertainty analysis session (one document in the UI)."""

    # PK is the frontend-provided id (Date.now()); the client owns ids so the
    # whole-session save/load round-trips without an id-adoption dance.
    id = models.BigIntegerField(primary_key=True)

    name = models.CharField(max_length=255, default="New Session")
    analyst = models.CharField(max_length=255, blank=True, default="")
    organization = models.CharField(max_length=255, blank=True, default="")
    document = models.CharField(max_length=255, blank=True, default="")
    document_date = models.CharField(max_length=64, blank=True, default="")
    notes = models.TextField(blank=True, default="")

    # Legacy/fallback session-level UUT fields kept for backward compatibility
    # with older imported sessions.
    uut_description = models.CharField(max_length=255, blank=True, default="")
    uut_tolerance = models.JSONField(default=dict, blank=True)

    # Function subsections the user added explicitly (name/unit/kind/color).
    # Instrument- and point-derived functions are recomputed client-side; this
    # only holds the empty scaffolding + saved colors, so a JSON blob suffices.
    function_groups = models.JSONField(default=list, blank=True)

    # uncReq — risk/uncertainty requirements (small fixed shape -> columns).
    uncertainty_confidence = models.FloatField(default=95)
    reliability = models.FloatField(default=85)
    cal_int = models.FloatField(default=12)
    meas_rel_calc_assumed = models.FloatField(default=85)
    needed_tur = models.FloatField(default=4)
    req_pfa = models.FloatField(default=2)
    guard_band_multiplier = models.FloatField(default=1)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at"]

    def __str__(self):
        return f"{self.name} (#{self.id})"


class MeasurementArea(models.Model):
    session = models.ForeignKey(
        Session, on_delete=models.CASCADE, related_name="measurement_areas"
    )
    cid = models.CharField(max_length=64)
    name = models.CharField(max_length=255, blank=True, default="")
    color = models.CharField(max_length=32, blank=True, default="")
    hidden_from_sidebar = models.BooleanField(default=False)

    class Meta:
        ordering = ["id"]


class Uut(models.Model):
    session = models.ForeignKey(
        Session, on_delete=models.CASCADE, related_name="uuts"
    )
    cid = models.CharField(max_length=64)
    name = models.CharField(max_length=255, blank=True, default="")
    description = models.CharField(max_length=255, blank=True, default="")
    measurement_area_cid = models.CharField(max_length=64, blank=True, default="")
    measurement_area = models.CharField(max_length=255, blank=True, default="")
    measurement_area_color = models.CharField(max_length=32, blank=True, default="")
    # Snapshot of the chosen instrument definition (irregular nested tree).
    instrument = models.JSONField(default=dict, blank=True, null=True)

    class Meta:
        ordering = ["id"]


class SessionTmde(models.Model):
    """Session-level TMDE catalog entry."""

    session = models.ForeignKey(
        Session, on_delete=models.CASCADE, related_name="tmdes"
    )
    cid = models.CharField(max_length=64)
    name = models.CharField(max_length=255, blank=True, default="")
    quantity = models.FloatField(default=1)
    asset_id = models.CharField(max_length=255, blank=True, default="")
    is_instrument_based = models.BooleanField(default=False)
    instrument = models.JSONField(default=dict, blank=True, null=True)

    class Meta:
        ordering = ["id"]


class TestPoint(models.Model):
    session = models.ForeignKey(
        Session, on_delete=models.CASCADE, related_name="test_points"
    )
    cid = models.CharField(max_length=64)
    section = models.CharField(max_length=255, blank=True, default="")
    tmde_description = models.CharField(max_length=255, blank=True, default="")

    # Linkage (ids reference area/uut cids within the same session).
    measurement_area_id = models.CharField(max_length=64, blank=True, default="")
    associated_uut_ids = models.JSONField(default=list, blank=True)

    # Identity / parameter info.
    test_point_info = models.JSONField(default=dict, blank=True)
    specifications = models.JSONField(default=dict, blank=True)

    # Measurement mode.
    measurement_type = models.CharField(max_length=32, default="direct")
    equation_string = models.TextField(blank=True, default="")
    variable_mappings = models.JSONField(default=dict, blank=True)
    variable_nominals = models.JSONField(default=dict, blank=True)
    # Optional correlation matrix between derived-equation inputs. Sparse,
    # symmetric, keyed by sorted "<idA>|<idB>" pairs (e.g. {"Length|Weight": 1}).
    # Empty {} = independent inputs (RSS).
    input_correlations = models.JSONField(default=dict, blank=True)

    # Tolerances (irregular flat objects -> JSON).
    uut_tolerance = models.JSONField(default=dict, blank=True, null=True)
    tmde_tolerances = models.JSONField(default=list, blank=True)

    # Computed uncertainty results (snapshot persisted by the UI).
    is_detailed_uncertainty_calculated = models.BooleanField(default=False)
    combined_uncertainty = models.FloatField(null=True, blank=True)
    combined_uncertainty_absolute_base = models.FloatField(null=True, blank=True)
    combined_uncertainty_inputs_native = models.FloatField(null=True, blank=True)
    combined_uncertainty_inputs_base = models.FloatField(null=True, blank=True)
    effective_dof = models.FloatField(null=True, blank=True)
    k_value = models.FloatField(null=True, blank=True)
    coverage_factor_mode = models.CharField(max_length=16, blank=True, default="auto")
    coverage_factor_override = models.FloatField(null=True, blank=True)
    expanded_uncertainty = models.FloatField(null=True, blank=True)
    expanded_uncertainty_absolute_base = models.FloatField(null=True, blank=True)
    calculated_nominal_value = models.FloatField(null=True, blank=True)
    calculated_budget_components = models.JSONField(default=list, blank=True, null=True)
    calculated_budget_groups = models.JSONField(default=list, blank=True, null=True)

    # Risk snapshot (large irregular DTO -> JSON).
    risk_metrics = models.JSONField(default=dict, blank=True, null=True)

    class Meta:
        ordering = ["id"]


class ManualComponent(models.Model):
    """A user-entered / repeatability uncertainty row on a test point."""

    test_point = models.ForeignKey(
        TestPoint, on_delete=models.CASCADE, related_name="components"
    )
    cid = models.CharField(max_length=64)
    name = models.CharField(max_length=255, blank=True, default="")
    component_type = models.CharField(max_length=8, blank=True, default="B")  # "A"|"B"
    value = models.FloatField(null=True, blank=True)
    value_native = models.FloatField(null=True, blank=True)
    unit_native = models.CharField(max_length=64, blank=True, default="")
    # null == Infinity (matches the frontend's JSON.stringify behavior).
    dof = models.FloatField(null=True, blank=True)
    distribution = models.CharField(max_length=64, blank=True, default="")
    is_core = models.BooleanField(default=False)
    source_point_label = models.CharField(max_length=255, blank=True, default="")
    variable_type = models.CharField(max_length=64, blank=True, default="")
    original_input = models.JSONField(default=dict, blank=True, null=True)
    saved_inputs = models.JSONField(default=dict, blank=True, null=True)
    extra = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ["id"]


class NoteImage(models.Model):
    session = models.ForeignKey(
        Session, on_delete=models.CASCADE, related_name="note_images"
    )
    cid = models.CharField(max_length=64)
    file_name = models.CharField(max_length=255, blank=True, default="")
    # Base64 data URL; large, so loaded lazily by a dedicated endpoint.
    data = models.TextField(blank=True, default="")

    class Meta:
        ordering = ["id"]


class Instrument(models.Model):
    """Instrument library entry (not session-scoped).

    The library is split into two scopes (feature/inline-instrument-tables):

      - ``validated`` — the curated, shared library. Writing to it is gated
        behind a shared password (see ``views.instruments``). Every user sees
        all validated instruments.
      - ``local`` — a per-user history of instruments that user has created or
        loaded, scoped by ``owner`` (a client-generated device/user key, since
        there is no auth yet). Auto-saved on every edit, never password-gated.
        A user only sees their own local instruments.

    A local instrument that originated from a validated one keeps ``source_id``
    (the validated instrument's id) and ``validated_snapshot`` (the validated
    definition at load/sync time). The frontend diffs the live row against the
    snapshot to drive the green (in sync) / red (diverged) sync indicator.
    """

    SCOPE_LOCAL = "local"
    SCOPE_VALIDATED = "validated"
    SCOPE_CHOICES = [
        (SCOPE_LOCAL, "Local (user)"),
        (SCOPE_VALIDATED, "Validated (shared)"),
    ]

    # Client id may be a uuid or numeric string -> CharField PK.
    id = models.CharField(max_length=64, primary_key=True)
    manufacturer = models.CharField(max_length=255, blank=True, default="")
    model = models.CharField(max_length=255, blank=True, default="")
    description = models.CharField(max_length=255, blank=True, default="")
    measurement_area = models.CharField(max_length=255, blank=True, default="")
    measurement_area_color = models.CharField(max_length=32, blank=True, default="")
    instrument_type = models.CharField(max_length=64, blank=True, default="")
    # functions[] -> ranges[] -> tolerances{} : irregular nested tree -> JSON.
    functions = models.JSONField(default=list, blank=True)

    # Instrument-level associated Type B uncertainty components (e.g. head
    # pressure on a pressure gage). Same shape as a tolerance's manual
    # components; added to a budget whenever this instrument's accuracy
    # contributes. Irregular list of small objects -> JSON.
    type_b_components = models.JSONField(default=list, blank=True)

    # Library scope + sync linkage. Existing rows backfill to "validated" via
    # the data migration (they predate the local library and were the de-facto
    # shared catalog).
    scope = models.CharField(
        max_length=16, choices=SCOPE_CHOICES, default=SCOPE_VALIDATED
    )
    owner = models.CharField(max_length=128, blank=True, default="")
    source_id = models.CharField(max_length=64, blank=True, default="")
    validated_snapshot = models.JSONField(default=dict, blank=True, null=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["manufacturer", "model"]

    def __str__(self):
        return self.description or f"{self.manufacturer} {self.model}".strip()


class CustomEquation(models.Model):
    """Global measurement-equation library entry (not session-scoped).

    Mirrors ``Instrument``: the client owns the id (uuid or numeric string),
    saves whole entries with POST upserts, and groups entries by measurement
    area in the UI. ``variables`` maps each equation symbol to its suggested
    display name (e.g. ``{"V": "Voltage", "Idc": "Current"}``) so inserting an
    equation pre-fills the variable map exactly like the built-in library.
    """

    id = models.CharField(max_length=64, primary_key=True)
    name = models.CharField(max_length=255, blank=True, default="")
    expression = models.TextField(blank=True, default="")
    description = models.TextField(blank=True, default="")
    measurement_area = models.CharField(max_length=255, blank=True, default="")
    measurement_area_color = models.CharField(max_length=32, blank=True, default="")
    variables = models.JSONField(default=dict, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["measurement_area", "name"]

    def __str__(self):
        return self.name or self.expression


class BugReport(models.Model):
    id = models.CharField(max_length=64, primary_key=True)
    title = models.CharField(max_length=255, blank=True, default="")
    report_type = models.CharField(max_length=64, blank=True, default="Bug")
    priority = models.CharField(max_length=64, blank=True, default="Normal")
    description = models.TextField(blank=True, default="")
    steps = models.TextField(blank=True, default="")
    reporter = models.CharField(max_length=255, blank=True, default="")
    date = models.CharField(max_length=64, blank=True, default="")
    timestamp = models.CharField(max_length=64, blank=True, default="")
    status = models.CharField(max_length=32, blank=True, default="Open")

    class Meta:
        ordering = ["-timestamp"]
