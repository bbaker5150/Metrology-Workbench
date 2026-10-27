import asyncio
import cProfile
import json
import sys
import threading
from unittest import TestCase
from unittest.mock import patch

from asgiref.sync import ThreadSensitiveContext
from django.db import connection
from django.http import JsonResponse
from django.test import AsyncClient, RequestFactory, override_settings
from django.urls import path

from .request_latency import DatabaseIO, QuerySummary, RequestLatencyMiddleware, TimedCursor


_overlap_barrier = None


def latency_view(request, session_id):
    with connection.cursor() as cursor:
        for _ in range(session_id):
            cursor.execute("SELECT %s", ["private-measurement"])
            cursor.fetchone()
        if _overlap_barrier is not None:
            _overlap_barrier.wait(timeout=5)
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
        fetch = next(r for r in data["database_io"] if r["operation"] == "fetchone")
        self.assertEqual(fetch["calls"], 2)
        self.assertEqual(fetch["rows"], 2)
        self.assertEqual(data["response_bytes"], len(response.content))
        serialized = json.dumps(data)
        for forbidden in ("private-measurement", "private-token", "SELECT", "token="):
            self.assertNotIn(forbidden, serialized)
        self.assertEqual(connection.execute_wrappers, [])
        self.assertNotIn("create_cursor", connection.__dict__)
        self.assertNotIn("get_new_connection", connection.__dict__)
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
        self.assertNotIn("create_cursor", connection.__dict__)
        self.assertNotIn("get_new_connection", connection.__dict__)
        self.assertIsNone(sys.getprofile())

    def test_existing_profiler_is_not_replaced(self):
        hook = lambda *args: None
        sys.setprofile(hook)
        try:
            with override_settings(PROFILE_SESSION_REQUESTS=True), patch("api.request_latency.event") as log:
                RequestLatencyMiddleware(lambda r: JsonResponse({}))(self.request())
            self.assertIs(sys.getprofile(), hook)
            self.assertEqual(log.call_args.kwargs["schema_version"], 2)
        finally:
            sys.setprofile(None)

    def test_active_cprofile_does_not_break_request(self):
        # Reproduces the real Python 3.13 conflict missed by sys.getprofile().
        with cProfile.Profile(), override_settings(PROFILE_SESSION_REQUESTS=True), \
                patch("api.request_latency.event"):
            response = RequestLatencyMiddleware(lambda r: latency_view(r, 2))(self.request())
        self.assertEqual(response.status_code, 200)

    def test_cursor_fetch_timing_and_delegation(self):
        class Cursor:
            arraysize = 10
            def __iter__(self):
                return iter([(1,), (2,)])
            def fetchmany(self, size):
                return [("private-reading",)] * size
            def fetchone(self):
                raise ValueError("private-error")
        raw = Cursor()
        io = DatabaseIO()
        cursor = TimedCursor(raw, io, "default")
        cursor.arraysize = 20
        self.assertEqual(raw.arraysize, 20)
        with patch("api.request_latency.time.perf_counter", side_effect=[1.0, 1.25]):
            self.assertEqual(len(cursor.fetchmany(3)), 3)
        result = io.report()[0]
        self.assertEqual(result["elapsed_ms"], 250.0)
        self.assertEqual(result["rows"], 3)
        with self.assertRaises(ValueError):
            cursor.fetchone()
        self.assertEqual(io.report()[1]["errors"], 1)
        self.assertNotIn("private", json.dumps(io.report()))
        self.assertEqual(list(cursor), [(1,), (2,)])
        iteration = next(r for r in io.report() if r["operation"] == "next")
        self.assertEqual(iteration["rows"], 2)
        self.assertEqual(iteration["errors"], 0)

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
        async def request(n):
            # AsyncClient bypasses ASGIHandler.__call__, which normally supplies
            # this per-request context. Force real overlap using the barrier.
            async with ThreadSensitiveContext():
                return await AsyncClient().get(f"/api/calibration_sessions/{n}/test_points/")

        async def run():
            return await asyncio.gather(*[request(n) for n in (2, 5)])
        with override_settings(PROFILE_SESSION_REQUESTS=True, ROOT_URLCONF=__name__,
                               MIDDLEWARE=["api.request_latency.RequestLatencyMiddleware"]), \
                patch(__name__ + "._overlap_barrier", threading.Barrier(2)), \
                patch("api.request_latency.event") as log:
            responses = asyncio.run(run())
        self.assertEqual([r.status_code for r in responses], [200, 200])
        reports = {call.kwargs["path"]: call.kwargs for call in log.call_args_list}
        for n in (2, 5):
            report = reports[f"/api/calibration_sessions/{n}/test_points/"]
            self.assertEqual(report["sql"]["calls"], n)
            fetch = next(r for r in report["database_io"] if r["operation"] == "fetchone")
            self.assertEqual(fetch["calls"], n)
        self.assertNotEqual(responses[0]["X-AC-Shunt-Request-ID"], responses[1]["X-AC-Shunt-Request-ID"])
