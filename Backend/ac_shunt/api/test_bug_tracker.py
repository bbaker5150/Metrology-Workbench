from rest_framework.test import APITestCase

from api.models import BugReport


class WorkbenchIssueTrackerTests(APITestCase):
    def test_pagination_reaches_reports_beyond_legacy_limit(self):
        BugReport.objects.bulk_create([
            BugReport(title=f"Issue {index}", description="Reproduction details")
            for index in range(205)
        ])
        legacy = self.client.get("/api/bug_reports/")
        self.assertEqual(legacy.status_code, 200)
        self.assertIsInstance(legacy.data, list)
        self.assertEqual(len(legacy.data), 200)

        seen = set()
        for page, expected_count in [(1, 100), (2, 100), (3, 5)]:
            response = self.client.get(f"/api/bug_reports/?page={page}")
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.data["count"], 205)
            rows = response.data["results"]
            self.assertEqual(len(rows), expected_count)
            self.assertFalse(seen.intersection(row["id"] for row in rows))
            seen.update(row["id"] for row in rows)
        self.assertEqual(len(seen), 205)
        self.assertIsNone(response.data["next"])

    def test_shared_report_round_trip_retains_module_context(self):
        payload = {
            "title": "Report layout", "description": "Header overlaps the table",
            "severity": "High", "category": "UI/UX", "status": "Not Started",
            "system_info": '{"module":"Reports","route":"/report-of-calibration"}',
        }
        created = self.client.post("/api/bug_reports/", payload, format="json")
        self.assertEqual(created.status_code, 201)
        url = f'/api/bug_reports/{created.data["id"]}/'
        updated = self.client.patch(url, {"status": "In Work"}, format="json")
        self.assertEqual(updated.status_code, 200)
        self.assertEqual(updated.data["system_info"], payload["system_info"])
        self.assertEqual(updated.data["status"], "In Work")
        self.assertEqual(self.client.delete(url).status_code, 204)
