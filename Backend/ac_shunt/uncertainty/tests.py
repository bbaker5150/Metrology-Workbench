"""Tests for the Uncertainty Budget module backend.

Covers the scaffold endpoints, a whole-session round-trip through the relational
models, and database isolation (uncertainty tables live on the ``uncertainty``
alias, not ``default``).
"""
from django.apps import apps
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.db import connections
from rest_framework import status
from rest_framework.test import APIClient, APITestCase

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
    "detailSectionOrder": ["budget", "instruments", "equation"],
    "detailCollapsedSections": ["equation", "budget"],
    "qualifierColumnNames": {"uut": ["Frequency", "Calibration interval"], "tmde": ["Mode"]},
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

    def test_measurement_area_organization_round_trip(self):
        from copy import deepcopy
        payload = deepcopy(SAMPLE_SESSION)
        payload["instrumentOnboarding"] = {"uut": {"firstAreaKey": "torque", "completed": True}, "tmde": {"firstAreaKey": "torque", "completed": False}}
        payload["measurementAreaGroups"] = [
            {"name": "Torque", "kind": "uut", "color": "#abcdef",
             "pointCreationSettings": {"mode": "derived"}},
            {"name": "Torque", "kind": "tmde", "color": "#abcdef"},
        ]
        payload["uuts"][0]["measurementAreaNames"] = ["Torque", "Inspection"]
        payload["tmdes"][0]["measurementAreaNames"] = ["Torque"]
        payload["uuts"][0]["instrument"] = {"functions": [{"name": "Length", "ranges": [{"unit": "m"}]}]}
        payload["tmdes"][0]["instrument"] = {"functions": [{"name": "Weight", "ranges": [{"unit": "kg"}]}]}
        payload["testPoints"][0]["testPointInfo"]["measurementArea"] = "Torque"
        create = self.client.post("/api/uncertainty/sessions/", payload, format="json")
        self.assertEqual(create.status_code, status.HTTP_201_CREATED)
        url = f"/api/uncertainty/sessions/{payload['id']}/"
        saved = self.client.get(url).data
        self.assertEqual(saved["measurementAreaGroups"], payload["measurementAreaGroups"])
        self.assertEqual(saved["instrumentOnboarding"], payload["instrumentOnboarding"])
        for key in ("uuts", "tmdes"):
            self.assertEqual(saved[key][0]["measurementAreaNames"], payload[key][0]["measurementAreaNames"])
            self.assertEqual(saved[key][0]["instrument"], payload[key][0]["instrument"])
        self.assertEqual(saved["testPoints"][0]["testPointInfo"], payload["testPoints"][0]["testPointInfo"])
        saved["measurementAreaGroups"] = []
        saved["uuts"][0]["measurementAreaNames"] = []
        self.assertEqual(self.client.put(url, saved, format="json").status_code, 200)
        self.assertEqual(self.client.get(url).data["measurementAreaGroups"], [])
        self.assertEqual(self.client.get(url).data["instrumentOnboarding"], payload["instrumentOnboarding"])
        self.assertEqual(self.client.get(url).data["uuts"][0]["measurementAreaNames"], [])

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
        self.assertEqual(
            data["detailSectionOrder"],
            ["budget", "instruments", "equation"],
        )
        self.assertEqual(data["detailCollapsedSections"], ["equation", "budget"])
        self.assertEqual(data["qualifierColumnNames"], SAMPLE_SESSION["qualifierColumnNames"])
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

    def test_rich_notes_update_without_rebuilding_session_children(self):
        self.client.post("/api/uncertainty/sessions/", SAMPLE_SESSION, format="json")
        point_ids_before = list(models.TestPoint.objects.values_list("pk", flat=True))
        rich_notes = (
            '<h2>OEM specification</h2><p>Part <strong>ABC-123</strong></p>'
            '<figure data-note-image-id="image-1"><img '
            'data-note-image-id="image-1"><figcaption>Limit table</figcaption></figure>'
        )

        patch = self.client.patch(
            f"/api/uncertainty/sessions/{SAMPLE_SESSION['id']}/notes/",
            {"notes": rich_notes},
            format="json",
        )
        self.assertEqual(patch.status_code, status.HTTP_200_OK)
        self.assertEqual(patch.data["notes"], rich_notes)
        self.assertEqual(
            list(models.TestPoint.objects.values_list("pk", flat=True)),
            point_ids_before,
        )

        get = self.client.get(
            f"/api/uncertainty/sessions/{SAMPLE_SESSION['id']}/notes/"
        )
        self.assertEqual(get.status_code, status.HTTP_200_OK)
        self.assertEqual(get.data["notes"], rich_notes)

    def test_rich_notes_reject_non_string_payload(self):
        self.client.post("/api/uncertainty/sessions/", SAMPLE_SESSION, format="json")
        response = self.client.patch(
            f"/api/uncertainty/sessions/{SAMPLE_SESSION['id']}/notes/",
            {"notes": {"unexpected": "object"}},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_database_isolation(self):
        """Uncertainty tables exist on the uncertainty alias, not on default."""
        uncertainty_tables = connections["uncertainty"].introspection.table_names()
        default_tables = connections["default"].introspection.table_names()
        self.assertIn("uncertainty_session", uncertainty_tables)
        self.assertNotIn("uncertainty_session", default_tables)


INSTRUMENTS = "/api/uncertainty/instruments/"
REVIEWS = "/api/uncertainty/instrument-reviews/"
DEVICE_AUTH = {"HTTP_AUTHORIZATION": "InstrumentDevice 114ff326-e6a7-426f-8942-57941310c661"}


def sme_client():
    reviewer = get_user_model().objects.create_user(username="reviewer")
    reviewer.groups.add(Group.objects.get_or_create(name="Uncertalytics SME")[0])
    client = APIClient()
    client.force_authenticate(user=reviewer)
    return client


class InstrumentAndBugReportTests(APITestCase):
    databases = {"default", "uncertainty"}

    def test_instrument_crud(self):
        payload = {
            "id": "inst-uuid-1", "manufacturer": "Fluke", "model": "5790B",
            "description": "AC Measurement Standard",
            "owner": "bench-1",
            "functions": [{"name": "ACV", "ranges": []}],
        }
        post = self.client.post("/api/uncertainty/instruments/", payload, format="json")
        self.assertEqual(post.status_code, status.HTTP_201_CREATED)

        listing = self.client.get("/api/uncertainty/instruments/", {"owner": "bench-1"})
        self.assertEqual(len(listing.data), 1)
        self.assertEqual(listing.data[0]["description"], "AC Measurement Standard")

        delete = self.client.delete(
            "/api/uncertainty/instruments/inst-uuid-1/?owner=bench-1"
        )
        self.assertEqual(delete.status_code, status.HTTP_204_NO_CONTENT)
        self.assertEqual(models.Instrument.objects.count(), 0)

    def test_instrument_column_metadata_round_trip(self):
        columns = {"qualifierColumnNames": ["Frequency"],
                   "customColumns": [{"key": "interval", "label": "Interval", "insertAfter": "range"}],
                   "customFields": {"interval": "12 months"}, "rangeCustomFields": {"r1": {"interval": "6 months"}}}
        payload = {"id": "column-spec", "owner": "bench-1", "scope": "local", **columns}
        post = self.client.post("/api/uncertainty/instruments/", payload, format="json")
        self.assertEqual(post.status_code, status.HTTP_201_CREATED)
        listing = self.client.get("/api/uncertainty/instruments/", {"owner": "bench-1"})
        for key, value in columns.items():
            self.assertEqual(listing.data[0][key], value)
        # A partial edit must not erase saved header names.
        self.client.post("/api/uncertainty/instruments/", {"id": "column-spec", "owner": "bench-1", "model": "Updated"}, format="json")
        listing = self.client.get("/api/uncertainty/instruments/", {"owner": "bench-1"})
        self.assertEqual(listing.data[0]["qualifierColumnNames"], ["Frequency"])

    def test_global_listing_and_foreign_delete_do_not_expose_local_instruments(self):
        self.client.post(
            "/api/uncertainty/instruments/",
            {"id": "private", "model": "Local", "scope": "local", "owner": "userA"},
            format="json",
        )
        models.Instrument.objects.create(id="shared", model="Shared", scope="validated")

        listing = self.client.get("/api/uncertainty/instruments/")
        self.assertEqual({item["id"] for item in listing.data}, {"shared"})

        denied = self.client.delete(
            "/api/uncertainty/instruments/private/?owner=userB"
        )
        self.assertEqual(denied.status_code, status.HTTP_404_NOT_FOUND)
        self.assertTrue(models.Instrument.objects.filter(id="private").exists())

    def test_linked_local_instrument_upserts_by_source_id(self):
        models.Instrument.objects.create(
            id="shared-1140a", manufacturer="Ectron", model="1140A",
            description="Ectron 1140A", scope="validated",
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

        self.client.credentials(**DEVICE_AUTH)
        self.client.post(INSTRUMENTS, first_local, format="json")
        self.client.post(INSTRUMENTS, second_local, format="json")

        linked_locals = models.Instrument.objects.filter(
            scope=models.Instrument.SCOPE_LOCAL,
            owner="bench-1",
            source_id="shared-1140a",
        )
        self.assertEqual(linked_locals.count(), 1)
        self.assertEqual(linked_locals.first().id, "local-copy-1")
        self.assertEqual(linked_locals.first().description, "Ectron 1140A edited again")

        submitted = self.client.post(
            INSTRUMENTS, {**second_local, "id": "local-copy-1", "scope": "pending"},
            format="json", **DEVICE_AUTH,
        )
        self.assertEqual(submitted.status_code, status.HTTP_201_CREATED)
        self.assertEqual(models.Instrument.objects.get(pk="shared-1140a").description, "Ectron 1140A")
        sync = sme_client().post(
            REVIEWS + "local-copy-1/validate/", {"reviewVersion": submitted.data["reviewVersion"]}, format="json",
        )
        self.assertEqual(sync.status_code, status.HTTP_200_OK)
        self.assertEqual(sync.data["id"], "shared-1140a")
        self.assertFalse(models.Instrument.objects.filter(pk="local-copy-1").exists())
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
    """Local visibility, authenticated submission ownership and SME validation."""

    databases = {"default", "uncertainty"}

    def test_demoted_local_copy_preserves_override_and_snapshot_after_reload(self):
        snapshot = {"model": "Meter", "functions": []}
        shared = {"id": "shared", "scope": "validated", "model": "Meter",
                  "owner": "userA", "validatedSnapshot": snapshot, "localOverride": False}
        models.Instrument.objects.create(id="shared", scope="validated", model="Meter", validated_snapshot=snapshot)
        local = {**shared, "id": "local-copy", "scope": "local",
                 "sourceId": "shared", "localOverride": True}
        self.client.credentials(**DEVICE_AUTH)
        self.client.post(INSTRUMENTS, local, format="json")
        records = {record["id"]: record for record in self.client.get(
            "/api/uncertainty/instruments/", {"owner": "userA"}).data}
        self.assertTrue(records["local-copy"]["localOverride"])
        self.assertEqual(records["local-copy"]["validatedSnapshot"], snapshot)
        self.assertEqual(records["shared"]["scope"], "validated")
        self.assertFalse(records["shared"]["localOverride"])
        pending = self.client.post(INSTRUMENTS, {**local, "scope": "pending"}, format="json", **DEVICE_AUTH)
        self.assertEqual(pending.status_code, status.HTTP_201_CREATED)
        promoted = sme_client().post(
            REVIEWS + "local-copy/validate/", {"reviewVersion": pending.data["reviewVersion"]}, format="json",
        )
        self.assertEqual(promoted.status_code, status.HTTP_200_OK)
        self.assertFalse(promoted.data["localOverride"])
        self.assertFalse(models.Instrument.objects.filter(id="local-copy").exists())

    def test_private_instrument_cannot_be_listed_edited_submitted_or_deleted_with_a_spoofed_owner(self):
        local = {"id": "private-local", "scope": "local", "owner": "public-owner-label", "model": "Lab gauge"}
        saved = self.client.post(INSTRUMENTS, local, format="json", **DEVICE_AUTH)
        self.assertEqual(saved.status_code, status.HTTP_201_CREATED)

        other = APIClient()
        other.credentials(HTTP_AUTHORIZATION="InstrumentDevice 03544d15-563a-4180-81a1-eeda9702f503")
        self.assertEqual(other.get(INSTRUMENTS, {"owner": local["owner"]}).data, [])
        for scope in ("local", "pending"):
            denied = other.post(INSTRUMENTS, {**local, "scope": scope, "model": "Foreign edit"}, format="json")
            self.assertEqual(denied.status_code, status.HTTP_404_NOT_FOUND)
        denied = other.delete(INSTRUMENTS + "private-local/?owner=public-owner-label")
        self.assertEqual(denied.status_code, status.HTTP_404_NOT_FOUND)
        stored = models.Instrument.objects.get(pk="private-local")
        self.assertEqual((stored.scope, stored.model), ("local", "Lab gauge"))

    def test_legacy_owner_can_use_and_submit_an_old_local_without_changing_the_original(self):
        original = models.Instrument.objects.create(id="pre-upgrade", scope="local", owner="old-owner-key", model="Original")
        listing = self.client.get(INSTRUMENTS, {"owner": original.owner}, **DEVICE_AUTH)
        self.assertEqual([row["id"] for row in listing.data], [original.pk])
        self.assertEqual(self.client.get(INSTRUMENTS, {"owner": "wrong-key"}, **DEVICE_AUTH).data, [])
        payload = {"id": original.pk, "scope": "pending", "model": "Reviewed revision"}
        denied = self.client.post(INSTRUMENTS, {**payload, "owner": "wrong-key"}, format="json", **DEVICE_AUTH)
        self.assertEqual(denied.status_code, status.HTTP_404_NOT_FOUND)
        submitted = self.client.post(INSTRUMENTS, {**payload, "owner": original.owner}, format="json", **DEVICE_AUTH)
        self.assertEqual(submitted.status_code, status.HTTP_201_CREATED)
        self.assertNotEqual(submitted.data["id"], original.pk)
        self.assertEqual(submitted.data["scope"], "pending")
        original.refresh_from_db()
        self.assertEqual((original.scope, original.model), ("local", "Original"))
        listing = self.client.get(INSTRUMENTS, {"owner": original.owner}, **DEVICE_AUTH)
        self.assertEqual([row["id"] for row in listing.data], [submitted.data["id"]])
        self.assertEqual(listing.data[0]["legacyLocalId"], original.pk)
        other = APIClient()
        other.credentials(HTTP_AUTHORIZATION="InstrumentDevice 03544d15-563a-4180-81a1-eeda9702f503")
        legacy_list = other.get(INSTRUMENTS, {"owner": original.owner}).data
        self.assertEqual([(row["id"], row["model"]) for row in legacy_list], [(original.pk, "Original")])
        edited = other.post(INSTRUMENTS, {"id": original.pk, "owner": original.owner, "model": "Personal edit"}, format="json")
        self.assertEqual(edited.status_code, status.HTTP_201_CREATED)
        self.assertNotIn(edited.data["id"], (original.pk, submitted.data["id"]))
        self.assertEqual(edited.data["scope"], "local")
        original.refresh_from_db()
        self.assertEqual(original.model, "Original")

    def test_new_instrument_without_scope_defaults_to_local(self):
        post = self.client.post(
            "/api/uncertainty/instruments/",
            {"id": "loc-1", "manufacturer": "Keysight", "model": "34470A", "owner": "userA"},
            format="json",
        )
        self.assertEqual(post.status_code, status.HTTP_201_CREATED)
        self.assertEqual(post.data["scope"], "local")
        self.assertEqual(post.data["owner"], "userA")

    def test_smes_can_validate_the_reviewed_submission(self):
        device = self.client
        reviewer = sme_client()
        regular = APIClient()
        user = get_user_model().objects.create_user(username="analyst")
        user.groups.add(Group.objects.create(name="Metrology App User"))
        regular.force_authenticate(user=user)

        payload = {"id": "val-1", "manufacturer": "Fluke", "model": "5730A", "owner": "bench-1"}
        for client in (device, regular, reviewer):
            denied = client.post(INSTRUMENTS, {**payload, "scope": "validated", "password": "calibrate"}, format="json")
            self.assertEqual(denied.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(models.Instrument.objects.count(), 0)
        submitted = device.post(INSTRUMENTS, {**payload, "scope": "pending"}, format="json", **DEVICE_AUTH)
        self.assertEqual(submitted.status_code, status.HTTP_201_CREATED)
        approve_url = REVIEWS + "val-1/validate/"
        original_version = submitted.data["reviewVersion"]

        # Matching the public owner string does not grant access to a pending definition.
        for client in (regular, reviewer):
            self.assertEqual(client.get(INSTRUMENTS, {"owner": "bench-1"}).data, [])
        self.assertEqual(device.get(INSTRUMENTS, **DEVICE_AUTH).data[0]["scope"], "pending")
        for client in (device, regular):
            self.assertEqual(client.get(REVIEWS).data, {"canValidate": False, "reviews": []})
            self.assertEqual(client.post(approve_url, {"reviewVersion": original_version}, format="json").status_code, 403)
        self.assertEqual(regular.post(INSTRUMENTS, {**payload, "scope": "local"}, format="json").status_code, 404)
        self.assertEqual(regular.delete(INSTRUMENTS + "val-1/?owner=bench-1").status_code, 404)
        inbox = reviewer.get(REVIEWS).data
        self.assertTrue(inbox["canValidate"])
        self.assertEqual([record["id"] for record in inbox["reviews"]], ["val-1"])
        self.assertEqual(inbox["reviews"][0]["reviewVersion"], original_version)

        updated = device.post(INSTRUMENTS, {**payload, "scope": "pending", "model": "5730A amended"}, format="json", **DEVICE_AUTH)
        self.assertEqual(updated.status_code, status.HTTP_201_CREATED)
        self.assertEqual(reviewer.post(approve_url, {"reviewVersion": original_version}, format="json").status_code, 409)
        approved = reviewer.post(approve_url, {"reviewVersion": updated.data["reviewVersion"]}, format="json")
        self.assertEqual(approved.status_code, status.HTTP_200_OK)
        self.assertEqual(approved.data["scope"], "validated")
        self.assertEqual(approved.data["validatedSnapshot"]["model"], "5730A amended")
        self.assertEqual(reviewer.get(REVIEWS).data["reviews"], [])
        self.assertEqual(regular.get(INSTRUMENTS).data[0]["id"], "val-1")

    def test_general_user_can_withdraw_their_current_submission_without_changing_its_specs(self):
        author = get_user_model().objects.create_user(username="withdraw-author")
        author.groups.add(Group.objects.create(name="Metrology App User"))
        self.client.force_authenticate(user=author)
        reviewer = sme_client()
        payload = {"id": "withdraw-meter", "scope": "pending", "model": "Submitted meter", "owner": "bench",
                   "functions": [{"name": "Torque", "ranges": [{"min": 0, "max": 60, "unit": "lbf·ft"}]}]}
        submitted = self.client.post(INSTRUMENTS, payload, format="json").data
        withdrawal = {"id": submitted["id"], "scope": "local", "action": "withdraw", "reviewVersion": submitted["reviewVersion"],
                      "model": "Stale session specs", "functions": []}
        foreign = APIClient()
        foreign.force_authenticate(user=get_user_model().objects.create_user(username="withdraw-other"))
        self.assertEqual(foreign.post(INSTRUMENTS, withdrawal, format="json").status_code, 404)
        self.assertEqual(self.client.post(INSTRUMENTS, {**withdrawal, "reviewVersion": "stale"}, format="json").status_code, 409)
        withdrawn = self.client.post(INSTRUMENTS, withdrawal, format="json")
        self.assertEqual(withdrawn.status_code, 201)
        self.assertEqual(withdrawn.data["scope"], "local")
        self.assertTrue(withdrawn.data["localOverride"])
        self.assertEqual(withdrawn.data["model"], submitted["model"])
        self.assertEqual(withdrawn.data["functions"], submitted["functions"])
        self.assertNotIn("reviewVersion", withdrawn.data)
        self.assertEqual(reviewer.get(REVIEWS).data["reviews"], [])
        self.assertEqual(reviewer.post(REVIEWS + submitted["id"] + "/validate/",
                                      {"reviewVersion": submitted["reviewVersion"]}, format="json").status_code, 404)
        self.assertEqual(self.client.post(INSTRUMENTS, withdrawal, format="json").status_code, 409)
        self.assertEqual(self.client.get(INSTRUMENTS).data[0]["scope"], "local")

    def test_withdrawal_cannot_demote_an_already_validated_instrument(self):
        author = get_user_model().objects.create_user(username="approved-author")
        self.client.force_authenticate(user=author)
        submitted = self.client.post(INSTRUMENTS, {"id": "approved-meter", "scope": "pending", "model": "Approved specs"}, format="json").data
        reviewer = sme_client()
        approved = reviewer.post(REVIEWS + submitted["id"] + "/validate/", {"reviewVersion": submitted["reviewVersion"]}, format="json")
        self.assertEqual(approved.status_code, 200)
        denied = self.client.post(INSTRUMENTS, {"id": submitted["id"], "scope": "local", "action": "withdraw", "reviewVersion": submitted["reviewVersion"]}, format="json")
        self.assertEqual(denied.status_code, 409)
        self.assertEqual(models.Instrument.objects.get(pk=submitted["id"]).scope, "validated")

    def test_software_owners_can_validate_until_the_sme_group_exists(self):
        user = get_user_model().objects.create_user(username="software-owner")
        user.groups.add(Group.objects.create(name="Metrology Software Owners Backup"))
        self.client.force_authenticate(user=user)
        submitted = self.client.post(INSTRUMENTS, {"id": "owner-review", "scope": "pending", "model": "DMM"}, format="json")
        self.assertEqual(submitted.status_code, status.HTTP_201_CREATED)
        approve_url = REVIEWS + "owner-review/validate/"
        version = {"reviewVersion": submitted.data["reviewVersion"]}
        self.assertEqual(self.client.get(REVIEWS).data, {"canValidate": False, "reviews": []})
        self.assertEqual(self.client.post(approve_url, version, format="json").status_code, 403)

        user.groups.add(Group.objects.create(name="Metrology Software Owners"))
        inbox = self.client.get(REVIEWS).data
        self.assertTrue(inbox["canValidate"])
        self.assertEqual([row["id"] for row in inbox["reviews"]], ["owner-review"])
        approved = self.client.post(approve_url, version, format="json")
        self.assertEqual(approved.status_code, status.HTTP_200_OK)
        self.assertEqual(approved.data["scope"], "validated")

        submitted = self.client.post(INSTRUMENTS, {"id": "at-cutover", "scope": "pending"}, format="json")
        current_inbox = self.client.get(REVIEWS).data
        self.assertEqual([row["id"] for row in current_inbox["reviews"]], ["at-cutover"])
        Group.objects.create(name="Uncertalytics SME")
        self.assertEqual(self.client.get(REVIEWS).data, {"canValidate": False, "reviews": []})
        rejected = self.client.post(REVIEWS + "at-cutover/validate/", {"reviewVersion": submitted.data["reviewVersion"]}, format="json")
        self.assertEqual(rejected.status_code, 403)
        self.assertEqual(models.Instrument.objects.get(pk="at-cutover").scope, "pending")

    def test_validated_delete_requires_password(self):
        models.Instrument.objects.create(id="delete-shared", scope="validated", model="Meter")
        url = "/api/uncertainty/instruments/delete-shared/"
        for payload in ({}, {"password": "wrong"}):
            response = self.client.delete(url, payload, format="json")
            self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
            self.assertTrue(models.Instrument.objects.filter(id="delete-shared").exists())
        response = self.client.delete(url, {"password": "calibrate"}, format="json")
        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(models.Instrument.objects.filter(id="delete-shared").exists())

    def test_shared_removal_restores_latest_definition_to_original_submitter(self):
        reviewer = sme_client()
        author = self.client
        author.credentials(**DEVICE_AUTH)
        other = APIClient()
        other.credentials(HTTP_AUTHORIZATION="InstrumentDevice 03544d15-563a-4180-81a1-eeda9702f503")
        for client, submission in [(author, {"id": "meter", "model": "Original"}),
                                   (other, {"id": "amendment", "sourceId": "meter", "model": "Revised"})]:
            pending = client.post(INSTRUMENTS, {**submission, "scope": "pending", "owner": "bench"}, format="json")
            self.assertEqual(pending.status_code, 201)
            approved = reviewer.post(REVIEWS + submission["id"] + "/validate/",
                                     {"reviewVersion": pending.data["reviewVersion"]}, format="json")
            self.assertEqual(approved.status_code, 200)
            self.assertEqual(approved.data["owner"], "")
        removal = reviewer.delete(INSTRUMENTS + "meter/", {"password": "calibrate"}, format="json")
        self.assertEqual(removal.status_code, 204)
        self.assertEqual(other.get(INSTRUMENTS, {"owner": "bench"}).data, [])
        [local] = author.get(INSTRUMENTS, {"owner": "bench"}).data
        self.assertEqual((local["id"], local["scope"], local["model"], local["sourceId"]), ("meter", "local", "Revised", ""))
        self.assertIsNone(local["validatedSnapshot"])
        self.assertTrue(local["localOverride"])
        self.assertEqual(author.post(INSTRUMENTS, {**local, "scope": "pending"}, format="json").status_code, 201)

    def test_shared_removal_recovers_the_recorded_owner_of_an_old_legacy_submission(self):
        models.Instrument.objects.create(id="old-private", scope="local", owner="bench", model="Legacy")
        self.client.credentials(**DEVICE_AUTH)
        pending = self.client.post(INSTRUMENTS, {"id":"old-private", "owner":"bench", "scope":"pending"}, format="json").data
        reviewer = sme_client()
        response = reviewer.post(REVIEWS + pending["id"] + "/validate/", {"reviewVersion":pending["reviewVersion"]}, format="json")
        self.assertEqual(response.status_code, 200)
        models.Instrument.objects.filter(pk=pending["id"]).update(review_owner="", owner="")
        removed = reviewer.delete(INSTRUMENTS + pending["id"] + "/", {"password":"calibrate"}, format="json")
        self.assertEqual(removed.status_code, 204)
        [restored] = self.client.get(INSTRUMENTS, {"owner":"bench"}).data
        self.assertEqual((restored["id"], restored["scope"], restored["owner"]), (pending["id"], "local", "bench"))

    def test_legacy_resave_does_not_demote_validated(self):
        models.Instrument.objects.create(id="val-2", scope="validated", model="3458A", description="original")
        # A scope-less re-save (legacy path) must keep it validated.
        resave = self.client.post(
            "/api/uncertainty/instruments/",
            {"id": "val-2", "model": "3458A", "description": "edited"},
            format="json",
        )
        self.assertEqual(resave.status_code, status.HTTP_403_FORBIDDEN)
        stored = models.Instrument.objects.get(pk="val-2")
        self.assertEqual(stored.scope, "validated")
        self.assertEqual(stored.description, "original")

    def test_owner_filter_returns_validated_plus_own_local(self):
        models.Instrument.objects.create(id="v", scope="validated", model="V")
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


class InstrumentReviewAccessTests(APITestCase):
    databases = {"default", "uncertainty"}
    url = "/api/uncertainty/instrument-review-access/"

    def assert_access(self, client, expected):
        with self.assertNumQueries(0, using="uncertainty"):
            response = client.get(self.url)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data, {"canValidate": expected})

    def test_anonymous_and_general_users_are_not_reviewers(self):
        self.assert_access(self.client, False)
        user = get_user_model().objects.create_user(username="access-analyst")
        user.groups.add(Group.objects.create(name="Metrology App User"))
        self.client.force_authenticate(user=user)
        self.assert_access(self.client, False)

    def test_sme_eligibility_does_not_read_instrument_records(self):
        models.Instrument.objects.create(id="private-submission", scope="pending", model="Private specifications")
        self.assert_access(sme_client(), True)

    def test_interim_owner_eligibility_is_rechecked_after_sme_group_creation(self):
        user = get_user_model().objects.create_user(username="access-owner")
        user.groups.add(Group.objects.create(name="Metrology Software Owners Backup"))
        self.client.force_authenticate(user=user)
        self.assert_access(self.client, False)
        user.groups.add(Group.objects.create(name="Metrology Software Owners"))
        self.assert_access(self.client, True)
        group = Group.objects.create(name="Uncertalytics SME")
        self.assert_access(self.client, False)
        user.groups.add(group)
        self.assert_access(self.client, True)

    def test_access_endpoint_is_read_only(self):
        with self.assertNumQueries(0, using="uncertainty"):
            response = self.client.post(self.url, {"canValidate": True}, format="json")
        self.assertEqual(response.status_code, 405)


class InstrumentSharedDemotionTests(APITestCase):
    databases = {"default", "uncertainty"}

    def setUp(self):
        models.Instrument.objects.create(id="shared-source", scope="validated", model="Shared specifications")
        self.published = models.Instrument.objects.values().get(pk="shared-source")
        self.payload = {"id": "private-demotion", "sourceId": "shared-source", "scope": "local",
                        "model": "Shared specifications", "action": "demote-shared"}

    def assert_catalog_unchanged(self):
        self.assertEqual(models.Instrument.objects.values().get(pk="shared-source"), self.published)

    def test_anonymous_and_general_users_cannot_explicitly_demote_shared_instruments(self):
        general = APIClient()
        user = get_user_model().objects.create_user(username="demote-analyst")
        user.groups.add(Group.objects.create(name="Metrology App User"))
        general.force_authenticate(user=user)
        for client in (self.client, general):
            with self.assertNumQueries(0, using="uncertainty"):
                response = client.post(INSTRUMENTS, self.payload, format="json")
            self.assertEqual(response.status_code, 403)
        self.assertFalse(models.Instrument.objects.filter(pk=self.payload["id"]).exists())
        self.assert_catalog_unchanged()

    def test_sme_can_save_the_private_copy_without_saving_the_action_or_changing_publication(self):
        response = sme_client().post(INSTRUMENTS, self.payload, format="json")
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["scope"], "local")
        self.assertEqual(response.data["sourceId"], "shared-source")
        self.assertNotIn("action", response.data)
        private = models.Instrument.objects.get(pk=response.data["id"])
        self.assertNotIn("action", private.column_metadata)
        self.assert_catalog_unchanged()

    def test_owner_eligibility_is_rechecked_at_write_after_the_sme_group_cutover(self):
        user = get_user_model().objects.create_user(username="demote-owner")
        user.groups.add(Group.objects.create(name="Metrology Software Owners"))
        self.client.force_authenticate(user=user)
        self.assertEqual(self.client.get("/api/uncertainty/instrument-review-access/").data, {"canValidate": True})
        Group.objects.create(name="Uncertalytics SME")
        with self.assertNumQueries(0, using="uncertainty"):
            response = self.client.post(INSTRUMENTS, self.payload, format="json")
        self.assertEqual(response.status_code, 403)
        self.assertFalse(models.Instrument.objects.filter(pk=self.payload["id"]).exists())
        self.assert_catalog_unchanged()

    def test_general_user_can_still_save_an_edited_session_copy_to_local(self):
        user = get_user_model().objects.create_user(username="edited-session-author")
        self.client.force_authenticate(user=user)
        payload = {key: value for key, value in self.payload.items() if key != "action"}
        response = self.client.post(INSTRUMENTS, {**payload, "model": "Session edits"}, format="json")
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["scope"], "local")
        self.assertEqual(response.data["model"], "Session edits")
        self.assertEqual(response.data["sourceId"], "shared-source")
        self.assertEqual(models.Instrument.objects.get(pk=response.data["id"]).review_owner, f"user:{user.pk}")
        self.assert_catalog_unchanged()


class InstrumentReviewReturnTests(APITestCase):
    databases = {"default", "uncertainty"}

    def setUp(self):
        self.author = get_user_model().objects.create_user(username="return-author")
        self.client.force_authenticate(user=self.author)

    def submit(self, **changes):
        payload = {
            "id": "return-meter", "scope": "pending", "owner": "author-bench",
            "manufacturer": "Fluke", "model": "Submitted model", "description": "Reviewed specifications",
            "functions": [{"name": "Flow", "unit": "gpm", "ranges": [{"min": 0, "max": 100}]}],
            "typeBComponents": [{"id": "cal-cert", "unit": "gpm", "standardUncertainty": .001}],
            "qualifierColumnNames": ["Mode"], "customColumns": [{"key": "interval", "label": "Interval"}],
            **changes,
        }
        response = self.client.post(INSTRUMENTS, payload, format="json")
        self.assertEqual(response.status_code, 201)
        return response.data

    def test_reviewer_returns_stored_specs_to_original_author_without_taking_ownership(self):
        pending = self.submit()
        reviewer = sme_client()
        url = REVIEWS + pending["id"] + "/return/"
        before = models.Instrument.objects.values().get(pk=pending["id"])
        returned = reviewer.post(url, {"reviewVersion": pending["reviewVersion"], "owner": "reviewer-bench",
                                       "model": "Unreviewed client edit", "functions": [], "scope": "validated"}, format="json")
        self.assertEqual(returned.status_code, 200)
        self.assertEqual(returned.data["scope"], "local")
        self.assertTrue(returned.data["localOverride"])
        self.assertNotIn("reviewVersion", returned.data)
        after = models.Instrument.objects.values().get(pk=pending["id"])
        for field, value in before.items():
            if field not in {"scope", "local_override", "updated_at"}:
                self.assertEqual(after[field], value, field)
        self.assertEqual(after["review_owner"], f"user:{self.author.pk}")
        self.assertEqual(self.client.get(INSTRUMENTS).data, [returned.data])
        self.assertEqual(reviewer.get(INSTRUMENTS, {"owner": pending["owner"]}).data, [])
        self.assertEqual(reviewer.get(REVIEWS).data["reviews"], [])
        self.assertEqual(reviewer.post(REVIEWS + pending["id"] + "/validate/",
                                       {"reviewVersion": pending["reviewVersion"]}, format="json").status_code, 404)
        self.assertEqual(reviewer.post(url, {"reviewVersion": pending["reviewVersion"]}, format="json").status_code, 409)

    def test_return_requires_current_submission_version_and_does_not_overwrite_newer_specs(self):
        first = self.submit()
        reviewer = sme_client()
        url = REVIEWS + first["id"] + "/return/"
        current = self.submit(model="Updated submission")
        before = models.Instrument.objects.values().get(pk=first["id"])
        for payload in ({}, {"reviewVersion": "stale"}, {"reviewVersion": first["reviewVersion"]}):
            self.assertEqual(reviewer.post(url, payload, format="json").status_code, 409)
            self.assertEqual(models.Instrument.objects.values().get(pk=first["id"]), before)
        returned = reviewer.post(url, {"reviewVersion": current["reviewVersion"]}, format="json")
        self.assertEqual(returned.status_code, 200)
        self.assertEqual(returned.data["model"], "Updated submission")

    def test_return_rejects_approved_local_and_missing_records_without_catalog_changes(self):
        pending = self.submit()
        reviewer = sme_client()
        version = {"reviewVersion": pending["reviewVersion"]}
        self.assertEqual(reviewer.post(REVIEWS + pending["id"] + "/validate/", version, format="json").status_code, 200)
        before = models.Instrument.objects.values().get(pk=pending["id"])
        self.assertEqual(reviewer.post(REVIEWS + pending["id"] + "/return/", version, format="json").status_code, 409)
        self.assertEqual(models.Instrument.objects.values().get(pk=pending["id"]), before)
        local = models.Instrument.objects.create(id="never-submitted", scope="local", owner="author-bench",
                                                 review_owner=f"user:{self.author.pk}", model="Private")
        self.assertEqual(reviewer.post(REVIEWS + local.id + "/return/",
                                       {"reviewVersion": local.updated_at.isoformat()}, format="json").status_code, 409)
        local.refresh_from_db()
        self.assertEqual((local.scope, local.model), ("local", "Private"))
        self.assertEqual(reviewer.post(REVIEWS + "missing/return/", version, format="json").status_code, 404)

    def test_returning_an_amendment_leaves_the_shared_instrument_and_linkage_untouched(self):
        snapshot = {"model": "Published", "functions": [{"name": "Original"}]}
        published = models.Instrument.objects.create(id="shared-meter", scope="validated", model="Published",
                                                     functions=snapshot["functions"], validated_snapshot=snapshot)
        pending = self.submit(sourceId=published.id, validatedSnapshot=snapshot)
        before = models.Instrument.objects.values().get(pk=published.id)
        returned = sme_client().post(REVIEWS + pending["id"] + "/return/",
                                     {"reviewVersion": pending["reviewVersion"]}, format="json")
        self.assertEqual(returned.status_code, 200)
        self.assertEqual(returned.data["sourceId"], published.id)
        self.assertEqual(returned.data["validatedSnapshot"], snapshot)
        self.assertEqual(models.Instrument.objects.values().get(pk=published.id), before)
        self.assertEqual(models.Instrument.objects.count(), 2)

    def test_author_ordinary_users_and_anonymous_clients_cannot_use_reviewer_return(self):
        pending = self.submit()
        ordinary = APIClient()
        user = get_user_model().objects.create_user(username="return-ordinary")
        user.groups.add(Group.objects.create(name="Metrology App User"))
        ordinary.force_authenticate(user=user)
        before = models.Instrument.objects.values().get(pk=pending["id"])
        for client in (self.client, ordinary, APIClient()):
            response = client.post(REVIEWS + pending["id"] + "/return/",
                                   {"reviewVersion": pending["reviewVersion"], "owner": pending["owner"], "password": "calibrate"}, format="json")
            self.assertEqual(response.status_code, 403)
        self.assertEqual(models.Instrument.objects.values().get(pk=pending["id"]), before)

    def test_interim_software_owner_permission_obeys_the_existing_sme_group_cutover(self):
        owner = get_user_model().objects.create_user(username="return-software-owner")
        owner.groups.add(Group.objects.create(name="Metrology Software Owners Backup"))
        reviewer = APIClient()
        reviewer.force_authenticate(user=owner)
        pending = self.submit()
        url = REVIEWS + pending["id"] + "/return/"
        version = {"reviewVersion": pending["reviewVersion"]}
        self.assertEqual(reviewer.post(url, version, format="json").status_code, 403)
        owner.groups.add(Group.objects.create(name="Metrology Software Owners"))
        self.assertEqual(reviewer.post(url, version, format="json").status_code, 200)
        pending = self.submit(id="after-cutover")
        group = Group.objects.create(name="Uncertalytics SME")
        url = REVIEWS + pending["id"] + "/return/"
        version = {"reviewVersion": pending["reviewVersion"]}
        self.assertEqual(reviewer.post(url, version, format="json").status_code, 403)
        self.assertEqual(models.Instrument.objects.get(pk=pending["id"]).scope, "pending")
        owner.groups.add(group)
        self.assertEqual(reviewer.post(url, version, format="json").status_code, 200)

    def test_return_preserves_an_anonymous_device_submitters_private_access(self):
        device = APIClient()
        device.credentials(**DEVICE_AUTH)
        pending = device.post(INSTRUMENTS, {"id": "device-meter", "scope": "pending", "owner": "device-bench"}, format="json").data
        owner = models.Instrument.objects.get(pk=pending["id"]).review_owner
        reviewer = sme_client()
        returned = reviewer.post(REVIEWS + pending["id"] + "/return/",
                                 {"reviewVersion": pending["reviewVersion"]}, format="json")
        self.assertEqual(returned.status_code, 200)
        self.assertTrue(owner.startswith("device:"))
        self.assertEqual(models.Instrument.objects.get(pk=pending["id"]).review_owner, owner)
        self.assertEqual(device.get(INSTRUMENTS, {"owner": "device-bench"}).data, [returned.data])
        self.assertEqual(reviewer.get(INSTRUMENTS, {"owner": "device-bench"}).data, [])
        self.assertEqual(APIClient().get(INSTRUMENTS, {"owner": "device-bench"}).data, [])
