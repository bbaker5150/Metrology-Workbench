"""Smoke tests for the Report of Calibration module."""
from io import BytesIO

from django.apps import apps
from django.core.management import call_command
from django.test import TestCase
from openpyxl import load_workbook
from rest_framework.test import APIRequestFactory

from . import views
from .models import MeasurementArea, ROCRecord


class ReportsScaffoldTests(TestCase):
    def test_app_is_installed(self):
        self.assertTrue(apps.is_installed("reports"))

    def test_module_info_endpoint(self):
        request = APIRequestFactory().get("/api/reports/info/")
        response = views.module_info(request)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["module"], "reports")


class ReportsCrudTests(TestCase):
    databases = {"default", "reports"}

    def test_seed_command_is_idempotent(self):
        call_command("seed_rocs")
        self.assertEqual(MeasurementArea.objects.count(), 3)
        self.assertEqual(ROCRecord.objects.count(), 3)
        call_command("seed_rocs")  # re-running must not duplicate rows
        self.assertEqual(MeasurementArea.objects.count(), 3)
        self.assertEqual(ROCRecord.objects.count(), 3)

    def test_areas_endpoint_lists_seeded_areas(self):
        call_command("seed_rocs")
        request = APIRequestFactory().get("/api/reports/areas/")
        response = views.areas(request)
        self.assertEqual(response.status_code, 200)
        codes = {area["code"] for area in response.data}
        self.assertEqual(codes, {"AC_SHUNT", "RESISTANCE", "TEMPERATURE"})

    def test_roc_create_and_delete_round_trip(self):
        request = APIRequestFactory().post("/api/reports/rocs/", {
            "roc_number": "2026-999999",
            "nomenclature": "Test Instrument",
        }, format="json")
        response = views.rocs(request)
        self.assertEqual(response.status_code, 201)
        roc_id = response.data["id"]

        detail_request = APIRequestFactory().delete(f"/api/reports/rocs/{roc_id}/")
        detail_response = views.roc_detail(detail_request, roc_id=roc_id)
        self.assertEqual(detail_response.status_code, 204)
        self.assertFalse(ROCRecord.objects.filter(pk=roc_id).exists())


class ReportsExcelTests(TestCase):
    databases = {"default", "reports"}

    def test_roc_generate_produces_a_valid_workbook(self):
        payload = {
            "roc_number": "2026-000123",
            "nomenclature": "Current Shunt",
            "statements": [{"kind": "technical", "text": "Test statement."}],
            "tables": [{
                "title": "Data",
                "columns": [{"header": "Current", "unit": "(A)"}],
                "rows": [[1.0], [2.0]],
            }],
        }
        request = APIRequestFactory().post("/api/reports/roc/generate/", payload, format="json")
        response = views.roc_generate(request)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response["Content-Type"],
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )
        # A corrupt/empty workbook would raise here.
        workbook = load_workbook(BytesIO(response.content))
        self.assertIn("Report of Calibration", workbook.sheetnames)

    def test_roc_excel_from_saved_record(self):
        call_command("seed_rocs")
        record = ROCRecord.objects.first()
        request = APIRequestFactory().get(f"/api/reports/rocs/{record.pk}/excel/")
        response = views.roc_excel(request, roc_id=record.pk)
        self.assertEqual(response.status_code, 200)
        load_workbook(BytesIO(response.content))  # raises if malformed

    def test_roc_template_for_a_known_area(self):
        call_command("seed_rocs")
        request = APIRequestFactory().get("/api/reports/roc/template/", {"area": "AC_SHUNT"})
        response = views.roc_template(request)
        self.assertEqual(response.status_code, 200)
        load_workbook(BytesIO(response.content))  # raises if malformed


class ReportsAcShuntPullTests(TestCase):
    databases = {"default", "reports"}

    def test_sessions_list_and_pull_the_seeded_mock_session(self):
        call_command("seed_mock_calibration_session")
        from api.management.commands.seed_mock_calibration_session import MOCK_SESSION_NAME
        from api.models import CalibrationSession

        session = CalibrationSession.objects.get(session_name=MOCK_SESSION_NAME)

        list_request = APIRequestFactory().get("/api/reports/ac-shunt/sessions/")
        list_response = views.ac_shunt_sessions(list_request)
        self.assertEqual(list_response.status_code, 200)
        self.assertTrue(list_response.data["available"])
        self.assertTrue(any(s["id"] == session.pk for s in list_response.data["sessions"]))

        pull_request = APIRequestFactory().get(f"/api/reports/ac-shunt/sessions/{session.pk}/pull/")
        pull_response = views.ac_shunt_session_pull(pull_request, session_id=session.pk)
        self.assertEqual(pull_response.status_code, 200)
        self.assertEqual(pull_response.data["serial_number"], "MOCK-UUT")
        self.assertEqual(len(pull_response.data["tables"]), 1)
        self.assertEqual(len(pull_response.data["tables"][0]["rows"]), 10)  # 5 pairs x Forward/Reverse

    def test_pull_missing_session_returns_404(self):
        request = APIRequestFactory().get("/api/reports/ac-shunt/sessions/999999/pull/")
        response = views.ac_shunt_session_pull(request, session_id=999999)
        self.assertEqual(response.status_code, 404)
