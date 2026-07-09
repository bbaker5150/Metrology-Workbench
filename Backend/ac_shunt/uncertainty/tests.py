"""Tests for the Uncertainty Budget module backend.

Covers the scaffold endpoints, a whole-session round-trip through the relational
models, and database isolation (uncertainty tables live on the ``uncertainty``
alias, not ``default``).
"""
from django.apps import apps
from django.db import connections
from rest_framework import status
from rest_framework.test import APITestCase

from . import models


SAMPLE_SESSION = {
    "id": 1712345678901,
    "name": "Round Trip Session",
    "analyst": "Tester",
    "organization": "NPSL",
    "document": "DOC-1",
    "documentDate": "2026-06-02",
    "notes": "hello",
    "uutDescription": "legacy",
    "uutTolerance": {"reading": {"high": "0.05", "unit": "%"}},
    "uncReq": {
        "uncertaintyConfidence": 95, "reliability": 90, "calInt": 6,
        "measRelCalcAssumed": 85, "neededTUR": 4, "reqPFA": 2,
        "guardBandMultiplier": 1,
    },
    "measurementAreas": [{"id": "area-uuid-1", "name": "DC", "color": "#3498db"}],
    "uuts": [{
        "id": "uut-uuid-1", "name": "Fluke", "description": "DMM",
        "measurementAreaId": "area-uuid-1", "measurementArea": "DC",
        "measurementAreaColor": "#3498db", "instrument": {"model": "8588A"},
    }],
    "tmdes": [{
        "id": "tmde-uuid-1", "name": "Standard", "quantity": 1,
        "assetId": "A-100", "isInstrumentBased": True, "instrument": {"model": "5790B"},
    }],
    "testPoints": [{
        "id": 999000111,
        "section": "4.1.a",
        "measurementAreaId": "area-uuid-1",
        "associatedUutIds": ["uut-uuid-1"],
        "testPointInfo": {"parameter": {"name": "Voltage", "value": "10", "unit": "V"}, "qualifier": None},
        "measurementType": "direct",
        "equationString": "",
        "variableMappings": {},
        "variableNominals": {"a": {"value": "10", "unit": "V"}},
        "uutTolerance": {"reading": {"high": "0.1", "unit": "%"}},
        "tmdeTolerances": [{"id": "tol-1", "reading": {"high": "0.05", "unit": "%"}}],
        "is_detailed_uncertainty_calculated": True,
        "combined_uncertainty": 12.5,
        "effective_dof": None,
        "k_value": 2.0,
        "expanded_uncertainty": 25.0,
        "calculatedNominalValue": 10.0,
        "calculatedBudgetComponents": [{"id": "c1", "name": "Accuracy", "value": 12.5}],
        "riskMetrics": {"pfa": 1.2, "tur": 4.1},
        "components": [{
            "id": 555000222, "name": "UUT Stability", "type": "A", "value": 3.3,
            "value_native": 0.0003, "unit_native": "V", "dof": 9,
            "distribution": "Normal", "isCore": False, "sourcePointLabel": "Manual",
        }, {
            "id": "instrTypeB_tmde-uuid-1_typeb-1",
            "name": "Nozzle Pressure",
            "type": "B",
            "value": 57.7,
            "value_native": 0.001,
            "unit_native": "psig",
            "distribution": "Rectangular (resolution)",
            "distributionDivisor": "3.464",
            "isCore": False,
            "isManual": True,
            "typeBSourceId": "typeb-1",
            "typeBSourceTmdeId": "tmde-uuid-1",
            "sourcePointLabel": "Nozzle Pressure",
            "originalInput": {
                "inputMode": "tolerance",
                "toleranceLimit": "0.003464",
                "errorDistributionDivisor": "3.464",
                "unit": "psig",
            },
        }],
    }],
    "noteImages": [],
}


class UncertaintyScaffoldTests(APITestCase):
    databases = {"default", "uncertainty"}

    def test_app_is_installed(self):
        self.assertTrue(apps.is_installed("uncertainty"))

    def test_module_info_endpoint(self):
        response = self.client.get("/api/uncertainty/info/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["module"], "uncertainty")

    def test_system_info_reports_database(self):
        response = self.client.get("/api/uncertainty/system_info/")
        self.assertEqual(response.status_code, 200)
        self.assertIn(response.data["database_type"], {"sqlite3", "mssql"})


class WholeSessionRoundTripTests(APITestCase):
    databases = {"default", "uncertainty"}

    def test_create_and_retrieve_round_trip(self):
        create = self.client.post(
            "/api/uncertainty/sessions/", SAMPLE_SESSION, format="json"
        )
        self.assertEqual(create.status_code, status.HTTP_201_CREATED)

        get = self.client.get(f"/api/uncertainty/sessions/{SAMPLE_SESSION['id']}/")
        self.assertEqual(get.status_code, 200)
        data = get.data

        # Top-level + nested shape preserved with original id types.
        self.assertEqual(data["id"], SAMPLE_SESSION["id"])
        self.assertEqual(data["name"], "Round Trip Session")
        self.assertEqual(data["uncReq"]["reliability"], 90)
        self.assertEqual(data["measurementAreas"][0]["id"], "area-uuid-1")
        self.assertEqual(data["uuts"][0]["instrument"], {"model": "8588A"})

        tp = data["testPoints"][0]
        self.assertEqual(tp["id"], 999000111)  # numeric id stays numeric
        self.assertEqual(tp["measurementType"], "direct")
        self.assertEqual(tp["variableNominals"], {"a": {"value": "10", "unit": "V"}})
        self.assertTrue(tp["is_detailed_uncertainty_calculated"])
        self.assertEqual(tp["k_value"], 2.0)
        self.assertEqual(tp["riskMetrics"]["pfa"], 1.2)
        self.assertEqual(tp["components"][0]["type"], "A")
        self.assertEqual(tp["components"][0]["name"], "UUT Stability")
        linked_type_b = next(
            c for c in tp["components"] if c["id"] == "instrTypeB_tmde-uuid-1_typeb-1"
        )
        self.assertEqual(linked_type_b["typeBSourceId"], "typeb-1")
        self.assertEqual(linked_type_b["typeBSourceTmdeId"], "tmde-uuid-1")
        self.assertEqual(linked_type_b["distributionDivisor"], "3.464")
        self.assertTrue(linked_type_b["isManual"])
        self.assertEqual(
            linked_type_b["originalInput"]["errorDistributionDivisor"],
            "3.464",
        )

    def test_update_rebuilds_children(self):
        self.client.post("/api/uncertainty/sessions/", SAMPLE_SESSION, format="json")

        edited = dict(SAMPLE_SESSION)
        edited["name"] = "Edited"
        edited["testPoints"] = []  # remove all points
        put = self.client.put(
            f"/api/uncertainty/sessions/{SAMPLE_SESSION['id']}/", edited, format="json"
        )
        self.assertEqual(put.status_code, 200)
        self.assertEqual(put.data["name"], "Edited")
        self.assertEqual(put.data["testPoints"], [])
        # Orphaned children are gone.
        self.assertEqual(models.TestPoint.objects.count(), 0)
        self.assertEqual(models.ManualComponent.objects.count(), 0)

    def test_delete_session(self):
        self.client.post("/api/uncertainty/sessions/", SAMPLE_SESSION, format="json")
        delete = self.client.delete(
            f"/api/uncertainty/sessions/{SAMPLE_SESSION['id']}/"
        )
        self.assertEqual(delete.status_code, status.HTTP_204_NO_CONTENT)
        self.assertEqual(models.Session.objects.count(), 0)

    def test_database_isolation(self):
        """Uncertainty tables exist on the uncertainty alias, not on default."""
        uncertainty_tables = connections["uncertainty"].introspection.table_names()
        default_tables = connections["default"].introspection.table_names()
        self.assertIn("uncertainty_session", uncertainty_tables)
        self.assertNotIn("uncertainty_session", default_tables)


class InstrumentAndBugReportTests(APITestCase):
    databases = {"default", "uncertainty"}

    def test_instrument_crud(self):
        payload = {
            "id": "inst-uuid-1", "manufacturer": "Fluke", "model": "5790B",
            "description": "AC Measurement Standard",
            "functions": [{"name": "ACV", "ranges": []}],
        }
        post = self.client.post("/api/uncertainty/instruments/", payload, format="json")
        self.assertEqual(post.status_code, status.HTTP_201_CREATED)

        listing = self.client.get("/api/uncertainty/instruments/")
        self.assertEqual(len(listing.data), 1)
        self.assertEqual(listing.data[0]["description"], "AC Measurement Standard")

        delete = self.client.delete("/api/uncertainty/instruments/inst-uuid-1/")
        self.assertEqual(delete.status_code, status.HTTP_204_NO_CONTENT)
        self.assertEqual(models.Instrument.objects.count(), 0)

    def test_linked_local_instrument_upserts_by_source_id(self):
        self.client.post(
            "/api/uncertainty/instruments/",
            {
                "id": "shared-1140a",
                "manufacturer": "Ectron",
                "model": "1140A",
                "description": "Ectron 1140A",
                "scope": "validated",
                "owner": "shared",
            },
            format="json",
        )
        first_local = {
            "id": "local-copy-1",
            "manufacturer": "Ectron",
            "model": "1140A",
            "description": "Ectron 1140A edited",
            "scope": "local",
            "owner": "bench-1",
            "sourceId": "shared-1140a",
        }
        second_local = {
            **first_local,
            "id": "local-copy-2",
            "description": "Ectron 1140A edited again",
        }

        self.client.post("/api/uncertainty/instruments/", first_local, format="json")
        self.client.post("/api/uncertainty/instruments/", second_local, format="json")

        linked_locals = models.Instrument.objects.filter(
            scope=models.Instrument.SCOPE_LOCAL,
            owner="bench-1",
            source_id="shared-1140a",
        )
        self.assertEqual(linked_locals.count(), 1)
        self.assertEqual(linked_locals.first().id, "local-copy-1")
        self.assertEqual(linked_locals.first().description, "Ectron 1140A edited again")

        sync = self.client.post(
            "/api/uncertainty/instruments/",
            {
                **second_local,
                "id": "shared-1140a",
                "scope": "validated",
                "sourceId": "shared-1140a",
                "password": "calibrate",
            },
            format="json",
        )
        self.assertEqual(sync.status_code, status.HTTP_201_CREATED)
        self.assertEqual(sync.data["scope"], "validated")
        self.assertEqual(sync.data["description"], "Ectron 1140A edited again")
        self.assertFalse(
            models.Instrument.objects.filter(
                scope=models.Instrument.SCOPE_LOCAL,
                owner="bench-1",
                source_id="shared-1140a",
            ).exists()
        )

    def test_custom_equation_crud(self):
        payload = {
            "id": "eq-uuid-1",
            "name": "Deadweight pressure (corrected)",
            "expression": "m * g / A0 * (1 - rhoA / rhoM)",
            "description": "Pressure with air-buoyancy correction.",
            "measurementArea": "Pressure",
            "measurementAreaColor": "#16a085",
            "variables": {
                "m": "Mass", "g": "Local Gravity", "A0": "Piston Area",
                "rhoA": "Air Density", "rhoM": "Mass Density",
            },
        }
        post = self.client.post("/api/uncertainty/equations/", payload, format="json")
        self.assertEqual(post.status_code, status.HTTP_201_CREATED)
        self.assertEqual(post.data["expression"], payload["expression"])

        listing = self.client.get("/api/uncertainty/equations/")
        self.assertEqual(len(listing.data), 1)
        self.assertEqual(listing.data[0]["measurementArea"], "Pressure")
        self.assertEqual(listing.data[0]["variables"]["rhoM"], "Mass Density")

        # POST with the same id upserts (edit-in-place, like instruments).
        payload["name"] = "Renamed"
        self.client.post("/api/uncertainty/equations/", payload, format="json")
        listing = self.client.get("/api/uncertainty/equations/")
        self.assertEqual(len(listing.data), 1)
        self.assertEqual(listing.data[0]["name"], "Renamed")

        delete = self.client.delete("/api/uncertainty/equations/eq-uuid-1/")
        self.assertEqual(delete.status_code, status.HTTP_204_NO_CONTENT)
        self.assertEqual(models.CustomEquation.objects.count(), 0)

    def test_bug_report_crud(self):
        payload = {
            "id": "1712345000000", "title": "Crash", "type": "Bug",
            "priority": "Critical", "description": "It broke", "status": "Open",
            "timestamp": "2026-06-02T12:00:00Z",
        }
        post = self.client.post("/api/uncertainty/bug_reports/", payload, format="json")
        self.assertEqual(post.status_code, status.HTTP_201_CREATED)
        self.assertEqual(post.data["type"], "Bug")

        listing = self.client.get("/api/uncertainty/bug_reports/")
        self.assertEqual(len(listing.data), 1)


class InstrumentLibraryScopeTests(APITestCase):
    """Local/validated scoping + the shared-library password gate."""

    databases = {"default", "uncertainty"}

    def test_new_instrument_without_scope_defaults_to_local(self):
        post = self.client.post(
            "/api/uncertainty/instruments/",
            {"id": "loc-1", "manufacturer": "Keysight", "model": "34470A", "owner": "userA"},
            format="json",
        )
        self.assertEqual(post.status_code, status.HTTP_201_CREATED)
        self.assertEqual(post.data["scope"], "local")
        self.assertEqual(post.data["owner"], "userA")

    def test_validated_write_requires_password(self):
        denied = self.client.post(
            "/api/uncertainty/instruments/",
            {"id": "val-1", "manufacturer": "Fluke", "model": "5730A", "scope": "validated"},
            format="json",
        )
        self.assertEqual(denied.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(models.Instrument.objects.count(), 0)

        ok = self.client.post(
            "/api/uncertainty/instruments/",
            {
                "id": "val-1", "manufacturer": "Fluke", "model": "5730A",
                "scope": "validated", "password": "calibrate",
            },
            format="json",
        )
        self.assertEqual(ok.status_code, status.HTTP_201_CREATED)
        self.assertEqual(ok.data["scope"], "validated")

    def test_legacy_resave_does_not_demote_validated(self):
        self.client.post(
            "/api/uncertainty/instruments/",
            {"id": "val-2", "model": "3458A", "scope": "validated", "password": "calibrate"},
            format="json",
        )
        # A scope-less re-save (legacy path) must keep it validated.
        resave = self.client.post(
            "/api/uncertainty/instruments/",
            {"id": "val-2", "model": "3458A", "description": "edited"},
            format="json",
        )
        self.assertEqual(resave.data["scope"], "validated")
        self.assertEqual(resave.data["description"], "edited")

    def test_owner_filter_returns_validated_plus_own_local(self):
        self.client.post(
            "/api/uncertainty/instruments/",
            {"id": "v", "model": "V", "scope": "validated", "password": "calibrate"},
            format="json",
        )
        self.client.post(
            "/api/uncertainty/instruments/",
            {"id": "a", "model": "A", "scope": "local", "owner": "userA"},
            format="json",
        )
        self.client.post(
            "/api/uncertainty/instruments/",
            {"id": "b", "model": "B", "scope": "local", "owner": "userB"},
            format="json",
        )
        listing = self.client.get("/api/uncertainty/instruments/", {"owner": "userA"})
        ids = {i["id"] for i in listing.data}
        self.assertEqual(ids, {"v", "a"})  # validated + userA's local, not userB's
