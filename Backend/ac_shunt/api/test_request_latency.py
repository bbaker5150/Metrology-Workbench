import asyncio
import json
import sys
from unittest import TestCase
from unittest.mock import patch

from django.db import connection
from django.http import JsonResponse
from django.test import AsyncClient, RequestFactory, override_settings
from django.urls import path

from .request_latency import QuerySummary, RequestLatencyMiddleware


def latency_view(request, session_id):
    with connection.cursor() as cursor:
        for _ in range(session_id):
            cursor.execute("SELECT %s", ["private-measurement"])
            cursor.fetchone()
    return JsonResponse({"session": session_id})


urlpatterns = [path("api/calibration_sessions/<int:session_id>/test_points/", latency_view)]


class RequestLatencyTests(TestCase):
    def setUp(self):
        self.factory = RequestFactory()

    def request(self, suffix="test_points/"):
        return self.factory.get("/api/calibration_sessions/2/" + suffix,
                                {"token": "private-token"})

    def test_disabled_and_unrelated_requests_are_untouched(self):
        for enabled, request in [(False, self.request()),
                                 (True, self.factory.get("/api/shunts/")),
                                 (True, self.factory.post(self.request().path))]:
            with override_settings(PROFILE_SESSION_REQUESTS=enabled), patch("api.request_latency.event") as log:
                response = RequestLatencyMiddleware(lambda r: JsonResponse({"ok": True}))(request)
            self.assertNotIn("Server-Timing", response)
            log.assert_not_called()

    def test_counts_queries_preserves_response_and_omits_sensitive_data(self):
        connection.ensure_connection()
        request = self.request()
        request.scope = {"ac_shunt_request_id": "transport-id"}
        with override_settings(PROFILE_SESSION_REQUESTS=True), patch("api.request_latency.event") as log:
            response = RequestLatencyMiddleware(lambda r: latency_view(r, 2))(request)
        data = log.call_args.kwargs
        self.assertEqual(json.loads(response.content), {"session": 2})
        self.assertEqual(response["X-AC-Shunt-Request-ID"], "transport-id")
        self.assertIn("dbexec;dur=", response["Server-Timing"])
        self.assertEqual(data["sql"]["calls"], 2)
        self.assertEqual(data["sql"]["most_repeated_groups"][0]["calls"], 2)
        self.assertTrue(data["profile"]["connection_and_fetch"])
        self.assertEqual(data["response_bytes"], len(response.content))
        serialized = json.dumps(data)
        for forbidden in ("private-measurement", "private-token", "SELECT", "token="):
            self.assertNotIn(forbidden, serialized)
        self.assertEqual(connection.execute_wrappers, [])
        self.assertIsNone(sys.getprofile())

    def test_exception_cleans_up_instrumentation(self):
        def failing_view(request):
            with connection.cursor() as cursor:
                cursor.execute("SELECT * FROM missing_private_table")
        with override_settings(PROFILE_SESSION_REQUESTS=True), patch("api.request_latency.event") as log:
            with self.assertRaises(Exception):
                RequestLatencyMiddleware(failing_view)(self.request("information/"))
        self.assertEqual(log.call_args.kwargs["sql"]["errors"], 1)
        self.assertNotIn("missing_private_table", str(log.call_args))
        self.assertEqual(connection.execute_wrappers, [])
        self.assertIsNone(sys.getprofile())

    def test_existing_profiler_is_not_replaced(self):
        hook = lambda *args: None
        sys.setprofile(hook)
        try:
            with override_settings(PROFILE_SESSION_REQUESTS=True), patch("api.request_latency.event") as log:
                RequestLatencyMiddleware(lambda r: JsonResponse({}))(self.request())
            self.assertIs(sys.getprofile(), hook)
            self.assertTrue(log.call_args.kwargs["profile_skipped"])
        finally:
            sys.setprofile(None)

    def test_log_failure_does_not_break_response(self):
        with override_settings(PROFILE_SESSION_REQUESTS=True), patch("api.request_latency.event", side_effect=OSError):
            response = RequestLatencyMiddleware(lambda r: JsonResponse({"ok": True}))(self.request())
        self.assertEqual(response.status_code, 200)

    def test_query_group_memory_is_bounded_without_losing_totals(self):
        queries = QuerySummary()
        for index in range(110):
            queries(lambda *args: None, f"SELECT {index}", None, False, {"connection": connection})
        self.assertEqual(queries.report()["calls"], 110)
        self.assertEqual(queries.report()["untracked_group_calls"], 10)
        self.assertEqual(len(queries.groups), 100)

    def test_asgi_concurrent_requests_keep_query_counts_separate(self):
        async def run():
            client = AsyncClient()
            return await asyncio.gather(*[
                client.get(f"/api/calibration_sessions/{n}/test_points/") for n in (2, 5)
            ])
        with override_settings(PROFILE_SESSION_REQUESTS=True, ROOT_URLCONF=__name__,
                               MIDDLEWARE=["api.request_latency.RequestLatencyMiddleware"]), \
                patch("api.request_latency.event") as log:
            responses = asyncio.run(run())
        self.assertEqual([r.status_code for r in responses], [200, 200])
        reports = {call.kwargs["path"]: call.kwargs for call in log.call_args_list}
        for n in (2, 5):
            report = reports[f"/api/calibration_sessions/{n}/test_points/"]
            self.assertEqual(report["sql"]["calls"], n)
            self.assertIsNotNone(report["profile"])
        self.assertNotEqual(responses[0]["X-AC-Shunt-Request-ID"], responses[1]["X-AC-Shunt-Request-ID"])
