"""Session reads keep a fixed query budget as documents and points grow."""
from copy import deepcopy

from django.db import connections
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APITestCase

from . import models, serializers
from .tests import SAMPLE_SESSION


class SessionQueryPerformanceTests(APITestCase):
    databases = {"default", "uncertainty"}
    image_data = "data:image/png;base64," + "a" * 10000

    @classmethod
    def setUpTestData(cls):
        for session_id in (101, 102, 103):
            payload = deepcopy(SAMPLE_SESSION)
            payload["id"] = session_id
            payload["name"] = f"Session {session_id}"
            payload["testPoints"] = [
                {**deepcopy(SAMPLE_SESSION["testPoints"][0]), "id": point_id}
                for point_id in (1, 2, 3)
            ]
            payload["noteImages"] = [
                {"id": "image-1", "fileName": "specification.png", "fileObject": cls.image_data},
            ]
            serializers.save_session(payload)

    def test_list_batches_nested_rows_across_multiple_sessions(self):
        # One query each for sessions, areas, UUTs, TMDEs, points, components
        # and image references. This must not grow by two queries per session.
        with self.assertNumQueries(7, using="uncertainty"):
            response = self.client.get("/api/uncertainty/sessions/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual([session["id"] for session in response.data], [103, 102, 101])
        for session in response.data:
            self.assertEqual([point["id"] for point in session["testPoints"]], [1, 2, 3])
            for point in session["testPoints"]:
                self.assertEqual([component["id"] for component in point["components"]],
                                 [555000222, "instrTypeB_tmde-uuid-1_typeb-1"])
                self.assertEqual(point["components"][1]["typeBSourceTmdeId"], "tmde-uuid-1")
            self.assertEqual(session["noteImages"], [{"id": "image-1", "fileName": "specification.png"}])

    def test_document_reads_defer_image_bodies_but_image_endpoint_retains_them(self):
        for url in ("/api/uncertainty/sessions/", "/api/uncertainty/sessions/101/"):
            with self.subTest(url=url), CaptureQueriesContext(connections["uncertainty"]) as queries:
                response = self.client.get(url)
            self.assertEqual(response.status_code, 200)
            image_queries = [query["sql"] for query in queries if "uncertainty_noteimage" in query["sql"]]
            self.assertEqual(len(image_queries), 1)
            column = connections["uncertainty"].ops.quote_name
            self.assertNotIn(f'{column("uncertainty_noteimage")}.{column("data")}', image_queries[0])
            self.assertNotIn(self.image_data.encode(), response.content)

        # A normal metadata save must preserve the separately stored image.
        document = self.client.get("/api/uncertainty/sessions/101/").data
        document["name"] = "Updated metadata"
        saved = self.client.put("/api/uncertainty/sessions/101/", document, format="json")
        self.assertEqual(saved.status_code, 200)
        self.assertEqual(saved.data, document)
        images = self.client.get("/api/uncertainty/sessions/101/images/")
        self.assertEqual(images.data, [{"id": "image-1", "data": self.image_data}])

    def test_direct_serialization_batches_components_without_endpoint_prefetch(self):
        session = models.Session.objects.get(pk=101)
        with self.assertNumQueries(6, using="uncertainty"):
            document = serializers.session_to_dict(session)
        self.assertEqual(document, self.client.get("/api/uncertainty/sessions/101/").data)

    def test_partial_prefetch_keeps_points_and_fetches_missing_components_once(self):
        session = models.Session.objects.prefetch_related("test_points").get(pk=101)
        with self.assertNumQueries(5, using="uncertainty"):
            document = serializers.session_to_dict(session)
        self.assertEqual(document, self.client.get("/api/uncertainty/sessions/101/").data)
