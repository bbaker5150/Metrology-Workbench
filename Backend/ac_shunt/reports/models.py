"""
Relational models for the Report of Calibration module.

Mirrors the flat DTO shape the frontend (``modules/reports``) already speaks
(see ``ManualInputForm.jsx`` / ``SavedRecords.jsx`` / ``api.js``) — regular,
always-present fields are normalized columns; irregular nested content
(front-page statements, inline coefficient rows, page-2 data tables) is kept
as JSONField, the same relational/JSON split used by the ``uncertainty`` app.
WorkbenchRouter (``api.db_routers``) routes both tables here to the dedicated
``reports`` database alias.

A ``ROCRecord`` snapshots its ``area_code``/``area_name``/``statements`` from
the ``MeasurementArea`` it was created from rather than holding a live FK —
a saved ROC must not silently change if someone edits the area's default
statements later; the frontend already assumes this (``ManualInputForm``
copies ``area.statements`` into the record on selection).
"""
from django.db import models


class MeasurementArea(models.Model):
    """A measurement area's default ROC front-page statements.

    ``ManualInputForm`` fetches these to pre-fill a new record; the record
    then owns its own copy (see module docstring).
    """

    code = models.CharField(max_length=32, unique=True)
    name = models.CharField(max_length=255)
    default_nomenclature = models.CharField(max_length=255, blank=True, default="")
    submitted_label = models.CharField(max_length=255, blank=True, default="Submitted by:")
    # [{kind: "technical"|"results_location"|"special"|"uncertainty"|
    #   "traceability"|"reproduction", text: str}, ...]
    statements = models.JSONField(default=list, blank=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


class ROCRecord(models.Model):
    """One saved Report of Calibration."""

    roc_number = models.CharField(max_length=64, blank=True, default="")
    nomenclature = models.CharField(max_length=255, blank=True, default="")
    manufacturer = models.CharField(max_length=255, blank=True, default="")
    model_number = models.CharField(max_length=255, blank=True, default="")
    serial_number = models.CharField(max_length=255, blank=True, default="")
    procedure_used = models.CharField(max_length=255, blank=True, default="")

    submitted_label = models.CharField(max_length=255, blank=True, default="Submitted by:")
    customer_name = models.CharField(max_length=255, blank=True, default="")
    customer_address = models.CharField(max_length=255, blank=True, default="")

    # Snapshot of the area this record was created from (see module docstring).
    area_code = models.CharField(max_length=32, blank=True, default="")
    area_name = models.CharField(max_length=255, blank=True, default="")
    statements = models.JSONField(default=list, blank=True)

    # Free-text: printed verbatim on the ROC, not used for computation here.
    ambient_temperature = models.CharField(max_length=32, blank=True, default="")
    relative_humidity = models.CharField(max_length=32, blank=True, default="")
    calibration_date = models.CharField(max_length=32, blank=True, default="")
    due_date = models.CharField(max_length=32, blank=True, default="")
    issue_date = models.CharField(max_length=32, blank=True, default="")

    metrologist_name = models.CharField(max_length=255, blank=True, default="")
    metrologist_title = models.CharField(max_length=255, blank=True, default="")
    approver_name = models.CharField(max_length=255, blank=True, default="")
    approver_title = models.CharField(max_length=255, blank=True, default="")

    # [[label, value, label2, value2], ...] — inline front-page coefficients.
    inline_results = models.JSONField(default=list, blank=True)
    # [{title, intro_text, columns: [{header, unit}], rows: [[...]]}, ...]
    tables = models.JSONField(default=list, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at"]

    def __str__(self):
        return self.roc_number or f"ROC #{self.pk}"
