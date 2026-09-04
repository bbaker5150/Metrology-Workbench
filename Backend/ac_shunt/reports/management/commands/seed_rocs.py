"""
Seed the Report of Calibration module with sample ROC records for local
development, on top of the measurement areas already defined in
``reports/areas/*.json`` (see ``area_registry.py``).

The frontend's empty-state message (``SavedRecords.jsx``) points here:
"Run `python manage.py seed_rocs` from the backend to load the sample ROCs."

Sample record fields (instrument identity, customer, environment, dates,
signatures, and measurement tables) are transcribed verbatim from four
completed NPSL Reports of Calibration reviewed in a ``ROCs/`` folder that
sits next to this repo's checkout (not inside it):

    - 3.Resistance_4962002_04-22-2026.xls           (RESISTANCE)
    - ACShunt_A40B10A_407573145_02_MAR_2026.xlsx     (AC_SHUNT)
    - ACShunt_Y5020_3415014_27_APR_2026.xlsx         (AC_SHUNT, not used — see below)
    - Temperature_2026 ROC AM1880 1880117.xlsm       (TEMPERATURE)

AC_SHUNT uses the A40B10A report only (not Y5020) so the sample record's
front page, tables, and identity all come from one consistent, complete
source; Y5020's DC-resistance table has an unresolved template formula bug
(reads 0 Ω) that would otherwise leak a bogus value into the seed.

Each area's default statements (neutral wording, assumes "found to be in
tolerance") live in ``reports/areas/<code>.json``; each ``ROCRecord`` below
owns its own copy and, for TEMPERATURE, overrides the technical statement to
say "out of tolerance" because that AM1880 SPRT genuinely failed calibration
in the source report.

Usage (from Backend/ac_shunt, with the Django venv active):

    python manage.py seed_rocs

Idempotent: records are upserted by ``roc_number``, so re-running refreshes
the seed in place instead of duplicating it.
"""
from django.core.management.base import BaseCommand

from reports import area_registry
from reports.models import ROCRecord

# Sample ROCRecord fields, transcribed from the source workbooks named in the
# module docstring. Dates are ISO (CalibrationPDF/excel.py reformat to
# NPSL's DDMMMYYYY style at render time).
SAMPLE_RECORDS = {
    "AC_SHUNT": {
        "roc_number": "2026-561100",
        "manufacturer": "Fluke",
        "model_number": "A40B-10A",
        "serial_number": "407573145",
        "procedure_used": "NPSL 17-55AI-04, NPSL 17-55AR-04",
        "customer_name": "USS GEORGE WASHINGTON CVN73 (AIMD FCA)",
        "customer_address": "FPO AP 96634-2770",
        "ambient_temperature": "23.32",
        "relative_humidity": "36.06",
        "calibration_date": "2026-03-02",
        "due_date": "2031-03-02",
        "issue_date": "2026-03-05",
        "metrologist_name": "Natalie Garcia",
        "metrologist_title": "Electrical Engineer",
        "approver_name": "Ricardo Valenzuela",
        "approver_title": "Senior Metrology Engineer",
        "inline_results": [],
        "tables": [
            {
                "title": "DC Resistance Data",
                "intro_text": "",
                "columns": [
                    {"header": "TI\nTest Current", "unit": "(Amps)"},
                    {"header": "TI\nResistance", "unit": "(Ω)"},
                    {"header": "Expanded\nUncertainty", "unit": "(µΩ/Ω)"},
                ],
                "rows": [[8.25, 0.0800078349643088, 75]],
            },
            {
                "title": "AC-DC Difference",
                "intro_text": (
                    "The TI was measured to determine its AC-DC difference. In the "
                    "following table a positive sign indicates that more alternating "
                    "current was required to obtain the same emf output."
                ),
                "columns": [
                    {"header": "Test\nCurrent", "unit": "(Amps)"},
                    {"header": "400 Hz", "unit": "(µA/A)"},
                    {"header": "Expanded\nUncertainty", "unit": "(µA/A)"},
                ],
                "rows": [[6.9, -0.6914891293149998, 100]],
            },
        ],
    },
    "RESISTANCE": {
        "roc_number": "2026-607335",
        "manufacturer": "Fluke",
        "model_number": "742A10K",
        "serial_number": "4962002",
        "procedure_used": "NPSL 17-55AR-03",
        "customer_name": "NAVSHIPYD AND IMF PEARL HARBOR",
        "customer_address": "667 SAFEGUARD ST, SUITE 100, PEARL HARBOR HI 96860-5033",
        "ambient_temperature": "23.43",
        "relative_humidity": "46.64",
        "calibration_date": "2026-04-22",
        "due_date": "2027-04-22",
        "issue_date": "2026-04-23",
        "metrologist_name": "F. Sambol",
        "metrologist_title": "Senior Metrologist",
        "approver_name": "R. Valenzuela",
        "approver_title": "Senior Metrology Engineer",
        "inline_results": [],
        "tables": [
            {
                "title": "Measurement Data",
                "intro_text": (
                    "The expanded uncertainty of the TI is 0.000 020 kΩ, the relative "
                    "expanded uncertainty of the TI is 2.0 µΩ/Ω (or ppm)."
                ),
                "columns": [
                    {"header": "TI\nTemperature", "unit": "(°C)"},
                    {"header": "TI\nResistance", "unit": "(kΩ)"},
                ],
                "rows": [
                    [18, "9.999 964"], [19, "9.999 967"], [20, "9.999 970"],
                    [21, "9.999 973"], [22, "9.999 974"], [23, "9.999 976"],
                    [24, "9.999 976"], [25, "9.999 977"], [26, "9.999 976"],
                    [27, "9.999 976"],
                ],
            },
        ],
    },
    "TEMPERATURE": {
        "roc_number": "2026-487489",
        "manufacturer": "Accumac",
        "model_number": "AM1880",
        "serial_number": "1880117",
        "procedure_used": "NPSL 17-55ST-01",
        "customer_name": "FLEET READINESS CENTER SOUTH EAST",
        "customer_address": "NAS AVIONICS SERCC BLDG 101U, JACKSONVILLE FL 32212-0016",
        "ambient_temperature": "22.37",
        "relative_humidity": "41.2",
        "calibration_date": "2026-03-03",
        "due_date": "2028-09-03",
        "issue_date": "2026-03-16",
        "metrologist_name": "K. Rast",
        "metrologist_title": "Mechanical Engineer",
        "approver_name": "J.H. Wagner",
        "approver_title": "Senior Metrology Engineer",
        # Overrides the area default: this SPRT genuinely failed calibration
        # in the source report (see module docstring).
        "statements_override": [
            {
                "kind": "technical",
                "text": (
                    "This Standard Platinum Resistance Thermometer (SPRT) was calibrated "
                    "with a continuous current of 1.0 mA through the thermometer. The "
                    "following values were determined for the coefficients of the W4 and W7 "
                    "subranges of the ITS-90. The instrument was found to be out of "
                    "tolerance. The results in this report relate only to the item(s) "
                    "calibrated and there are no special limitations of use imposed."
                ),
            },
        ],
        "inline_results": [
            ["RTPW (Ω)", 25.49687],
            ["a4", -0.00017330, "b4", 0.00012123],
            ["a7", -0.00034076, "b7", 0.00012779],
            ["c7", -0.00005908],
        ],
        "tables": [
            {
                "title": "ITS-90 Resistance Ratio W(T)",
                "intro_text": "",
                "columns": [
                    {"header": "Temp", "unit": "(°C)"},
                    {"header": "Ratio", "unit": "W(T)"},
                    {"header": "Inverse\nDifference", "unit": ""},
                ],
                "rows": [
                    [-189, 0.21763439, 230.5235], [-188, 0.22197318, 230.4792],
                    [-187, 0.22631241, 230.4555], [-186, 0.23065173, 230.4507],
                    [-185, 0.23499082, 230.4633], [-184, 0.23932937, 230.4918],
                    [-183, 0.24366710, 230.5351], [-182, 0.24800377, 230.5918],
                ],
            },
        ],
    },
}


class Command(BaseCommand):
    help = "Seed sample ROC records for local development."

    def handle(self, *args, **options):
        records_created = 0
        for area_code, sample in SAMPLE_RECORDS.items():
            area = area_registry.get_area(area_code)
            if area is None:
                self.stderr.write(f"No areas/{area_code.lower()}.json found -- skipping its sample record.")
                continue
            overrides_by_kind = {s["kind"]: s for s in sample.get("statements_override") or []}
            statements = [overrides_by_kind.get(s["kind"], s) for s in area["statements"]]
            _, was_created = ROCRecord.objects.update_or_create(
                roc_number=sample["roc_number"],
                defaults={
                    "nomenclature": area["nomenclature"],
                    "manufacturer": sample["manufacturer"],
                    "model_number": sample["model_number"],
                    "serial_number": sample["serial_number"],
                    "procedure_used": sample["procedure_used"],
                    "submitted_label": area["submitted_label"],
                    "customer_name": sample["customer_name"],
                    "customer_address": sample["customer_address"],
                    "area_code": area["area_code"],
                    "area_name": area["area_name"],
                    "statements": statements,
                    "inline_results": sample["inline_results"],
                    "tables": sample["tables"],
                    "ambient_temperature": sample["ambient_temperature"],
                    "relative_humidity": sample["relative_humidity"],
                    "calibration_date": sample["calibration_date"],
                    "due_date": sample["due_date"],
                    "issue_date": sample["issue_date"],
                    "metrologist_name": sample["metrologist_name"],
                    "metrologist_title": sample["metrologist_title"],
                    "approver_name": sample["approver_name"],
                    "approver_title": sample["approver_title"],
                },
            )
            records_created += int(was_created)

        self.stdout.write(self.style.SUCCESS(
            f"ROC records: {records_created} created, {len(SAMPLE_RECORDS)} total."
        ))
