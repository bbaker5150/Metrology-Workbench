"""
Seed the Report of Calibration module with real NPSL measurement areas and
sample ROC records for local development.

The frontend's empty-state message (``SavedRecords.jsx``) points here:
"Run `python manage.py seed_rocs` from the backend to load the sample ROCs."

Statement text and sample record fields (instrument identity, customer,
environment, dates, signatures, and measurement tables) are transcribed
verbatim from four completed NPSL Reports of Calibration reviewed in a
``ROCs/`` folder that sits next to this repo's checkout (not inside it):

    - 3.Resistance_4962002_04-22-2026.xls           (RESISTANCE)
    - ACShunt_A40B10A_407573145_02_MAR_2026.xlsx     (AC_SHUNT)
    - ACShunt_Y5020_3415014_27_APR_2026.xlsx         (AC_SHUNT, not used — see below)
    - Temperature_2026 ROC AM1880 1880117.xlsm       (TEMPERATURE)

AC_SHUNT uses the A40B10A report only (not Y5020) so the sample record's
front page, tables, and identity all come from one consistent, complete
source; Y5020's DC-resistance table has an unresolved template formula bug
(reads 0 Ω) that would otherwise leak a bogus value into the seed.

``MeasurementArea.statements`` hold the neutral default wording (assumes
"found to be in tolerance") that ``ManualInputForm`` pre-fills for a new
record; each ``ROCRecord`` below then owns its own copy and, for
TEMPERATURE, overrides the technical statement to say "out of tolerance"
because that AM1880 SPRT genuinely failed calibration in the source report.

Usage (from Backend/ac_shunt, with the Django venv active):

    python manage.py seed_rocs

Idempotent: areas are upserted by ``code``, records by ``roc_number``, so
re-running refreshes the seed in place instead of duplicating it.
"""
from django.core.management.base import BaseCommand

from reports.models import MeasurementArea, ROCRecord

TRACEABILITY_US = (
    "NPSL maintains traceability to the International System of Units (SI) through an "
    "unbroken chain of comparisons with the National Institute of Standards and Technology "
    "(NIST), National Measurement Institutes (NMIs), US Naval Observatory, or other "
    "Department of the Navy approved sources or intrinsic and derived standards."
)
TRACEABILITY_US_DOT = TRACEABILITY_US.replace("US Naval Observatory", "U.S. Naval Observatory")

UNCERTAINTY_STANDARD = (
    "The expanded uncertainty of the TI is the uncertainty the TI is expected to remain "
    "within for the duration of the calibration interval. All uncertainties were calculated "
    "per NIST Technical Note 1297, “Guidelines for Evaluating and Expressing the "
    "Uncertainty of NIST Measurement Results” using a coverage factor of k=2 for a "
    "confidence level of 95%."
)

AREAS = [
    {
        "code": "AC_SHUNT",
        "name": "AC Shunt",
        "default_nomenclature": "Current Shunt",
        "submitted_label": "Submitted by:",
        "statements": [
            {
                "kind": "technical",
                "text": (
                    "The DC resistance of this test instrument (TI) was measured at the "
                    "current listed below by comparison to a standard shunt. Measurements "
                    "were taken after the TI exhibited a condition of temperature "
                    "equilibrium. The TI was found to be in tolerance. The results in this "
                    "report relate only to the item(s) calibrated. There are no special "
                    "limitations of use imposed on the calibration item."
                ),
            },
            {"kind": "results_location", "text": "Calibration results are listed on the following page(s)."},
            {"kind": "uncertainty", "text": UNCERTAINTY_STANDARD},
            {"kind": "traceability", "text": TRACEABILITY_US},
            {
                "kind": "reproduction",
                "text": (
                    "This Report of Calibration shall not be reproduced except in full, "
                    "without the written approval of the Navy Primary Standards Laboratory. "
                    "This Report of Calibration shall not be used as an endorsement by "
                    "NIST, or any agency of the Federal Government for any product or service."
                ),
            },
        ],
    },
    {
        "code": "RESISTANCE",
        "name": "Resistance",
        "default_nomenclature": "Resistance Standard",
        "submitted_label": "Submitted by:",
        "statements": [
            {
                "kind": "technical",
                "text": (
                    "A direct comparison technique was used to evaluate the test instrument "
                    "(TI) using a Navy Primary Standards Laboratory (NPSL) resistance "
                    "standard. The reported value is the mean of a series of measurements. "
                    "The TI was calibrated to the specifications in the related ICPs to the "
                    "TI as stated in 17-35MTL-1, except as indicated in the report. In "
                    "tolerance conditions are based on test results falling within specified "
                    "limits with no reduction by the uncertainty of the measurement. The "
                    "results contained herein relate only to the items calibrated. There are "
                    "no special limitations of use imposed on the calibration item. The TI "
                    "was found to be in tolerance."
                ),
            },
            {"kind": "results_location", "text": "See following page for measurement data."},
            {"kind": "uncertainty", "text": UNCERTAINTY_STANDARD},
            {"kind": "traceability", "text": TRACEABILITY_US},
            {
                "kind": "reproduction",
                "text": (
                    "This Report of Calibration shall not be reproduced except in full, "
                    "without the written approval of the Navy Primary Standards Laboratory. "
                    "This Report of Calibration shall not be used as an endorsement by ANAB, "
                    "NIST or any agency of the Federal Government for any product or service."
                ),
            },
        ],
    },
    {
        "code": "TEMPERATURE",
        "name": "Temperature",
        "default_nomenclature": "Standard Platinum Resistance Thermometer",
        "submitted_label": "Operation Interlab for:",
        "statements": [
            {
                "kind": "technical",
                "text": (
                    "This Standard Platinum Resistance Thermometer (SPRT) was calibrated "
                    "with a continuous current of 1.0 mA through the thermometer. The "
                    "following values were determined for the coefficients of the W4 and W7 "
                    "subranges of the ITS-90. The instrument was found to be in tolerance. "
                    "The results in this report relate only to the item(s) calibrated and "
                    "there are no special limitations of use imposed."
                ),
            },
            {"kind": "results_location", "text": "See following page(s) for measurement data."},
            {
                "kind": "uncertainty",
                "text": (
                    "The expanded uncertainty is ±0.02°C (k=2) over a temperature "
                    "range of 419°C to 661°C and ±0.01°C (k=2) over a "
                    "temperature range of -190°C to 419°C when the thermometer "
                    "resistance is measured with an uncertainty of no more than 5 ppm. "
                    "Resubmit this thermometer for calibration if the resistance at 0.01°C "
                    "changes by more than 0.00075 Ω as tested in accordance with the "
                    "Instrument Calibration Procedure (ICP) NAVAIR 17-20ST-18."
                ),
            },
            {"kind": "traceability", "text": TRACEABILITY_US_DOT},
            {
                "kind": "reproduction",
                "text": (
                    "This Report of Calibration shall not be reproduced except in full, "
                    "without the written approval of the Navy Primary Standards Laboratory."
                ),
            },
        ],
    },
]

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
    help = "Seed real NPSL measurement areas and sample ROC records for local development."

    def handle(self, *args, **options):
        areas_created = 0
        for entry in AREAS:
            _, was_created = MeasurementArea.objects.update_or_create(
                code=entry["code"],
                defaults={
                    "name": entry["name"],
                    "default_nomenclature": entry["default_nomenclature"],
                    "submitted_label": entry["submitted_label"],
                    "statements": entry["statements"],
                },
            )
            areas_created += int(was_created)

        records_created = 0
        for entry in AREAS:
            area = MeasurementArea.objects.get(code=entry["code"])
            sample = SAMPLE_RECORDS[entry["code"]]
            overrides_by_kind = {s["kind"]: s for s in sample.get("statements_override") or []}
            statements = [overrides_by_kind.get(s["kind"], s) for s in area.statements]
            _, was_created = ROCRecord.objects.update_or_create(
                roc_number=sample["roc_number"],
                defaults={
                    "nomenclature": area.default_nomenclature,
                    "manufacturer": sample["manufacturer"],
                    "model_number": sample["model_number"],
                    "serial_number": sample["serial_number"],
                    "procedure_used": sample["procedure_used"],
                    "submitted_label": area.submitted_label,
                    "customer_name": sample["customer_name"],
                    "customer_address": sample["customer_address"],
                    "area_code": area.code,
                    "area_name": area.name,
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
            f"Measurement areas: {areas_created} created, {len(AREAS)} total. "
            f"ROC records: {records_created} created, {len(AREAS)} total."
        ))
