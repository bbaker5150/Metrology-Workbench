"""
Seed the Report of Calibration module with placeholder measurement areas and
sample ROC records for local development.

The frontend's empty-state message (``SavedRecords.jsx``) points here:
"Run `python manage.py seed_rocs` from the backend to load the sample ROCs."

All statement text is a clearly-marked placeholder, NOT lab-approved
language — the previous repo generation had real per-area statement text
sourced from actual ROC workbooks in a since-removed ``ROCs/`` folder; no
such source exists in this checkout, so this seed exists only to unblock UI
wiring against real request/response shapes. Replace the placeholder text
via the admin or the Manual Input tab before treating any of this as usable
report content.

Usage (from Backend/ac_shunt, with the Django venv active):

    python manage.py seed_rocs

Idempotent: areas are upserted by ``code``, records by ``roc_number``, so
re-running refreshes the seed in place instead of duplicating it.
"""
from django.core.management.base import BaseCommand

from reports.models import MeasurementArea, ROCRecord

STATEMENT_KINDS = [
    "technical",
    "results_location",
    "uncertainty",
    "traceability",
    "reproduction",
]

# The three real NPSL measurement areas ROCgen originally targeted (AC Shunt,
# Resistance, Temperature) — see docs/rocgen-project-state memory. Statement
# text below is placeholder only (see module docstring).
AREAS = [
    {
        "code": "AC_SHUNT",
        "name": "AC Shunt",
        "default_nomenclature": "Current Shunt",
    },
    {
        "code": "RESISTANCE",
        "name": "Resistance",
        "default_nomenclature": "Standard Resistor",
    },
    {
        "code": "TEMPERATURE",
        "name": "Temperature",
        "default_nomenclature": "Platinum Resistance Thermometer",
    },
]


def _placeholder_statements(area_name):
    return [
        {
            "kind": kind,
            "text": (
                f"[PLACEHOLDER — {area_name} {kind.replace('_', ' ')} statement. "
                "Replace with lab-approved text before issuing a real ROC.]"
            ),
        }
        for kind in STATEMENT_KINDS
    ]


class Command(BaseCommand):
    help = "Seed placeholder measurement areas and sample ROC records for local development."

    def handle(self, *args, **options):
        areas_created = 0
        for entry in AREAS:
            _, was_created = MeasurementArea.objects.update_or_create(
                code=entry["code"],
                defaults={
                    "name": entry["name"],
                    "default_nomenclature": entry["default_nomenclature"],
                    "submitted_label": "Submitted by:",
                    "statements": _placeholder_statements(entry["name"]),
                },
            )
            areas_created += int(was_created)

        records_created = 0
        for index, entry in enumerate(AREAS, start=1):
            area = MeasurementArea.objects.get(code=entry["code"])
            roc_number = f"2026-{index:06d}"
            _, was_created = ROCRecord.objects.update_or_create(
                roc_number=roc_number,
                defaults={
                    "nomenclature": area.default_nomenclature,
                    "manufacturer": "Sample Manufacturer",
                    "model_number": "MODEL-100",
                    "serial_number": f"SN-{1000 + index}",
                    "procedure_used": f"NPSL 17-55{index:02d}-00",
                    "submitted_label": area.submitted_label,
                    "customer_name": "USS Sample (DDG-000)",
                    "customer_address": "1234 Fleet Ave, Norfolk, VA 23511",
                    "area_code": area.code,
                    "area_name": area.name,
                    "statements": area.statements,
                    "inline_results": [],
                    "tables": [],
                    "ambient_temperature": "23.0",
                    "relative_humidity": "45",
                    "calibration_date": "2026-08-01",
                    "due_date": "2027-08-01",
                    "issue_date": "2026-08-01",
                    "metrologist_name": "J. Metrologist",
                    "metrologist_title": "Metrologist",
                    "approver_name": "A. Approver",
                    "approver_title": "Lab Supervisor",
                },
            )
            records_created += int(was_created)

        self.stdout.write(self.style.SUCCESS(
            f"Measurement areas: {areas_created} created, {len(AREAS)} total. "
            f"ROC records: {records_created} created, {len(AREAS)} total."
        ))
