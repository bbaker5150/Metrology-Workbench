"""Opt-in profiling of the two session GETs; never log SQL or parameter values."""
import cProfile
import hashlib
import os
import re
import sys
import time
import uuid
from contextlib import ExitStack

from django.conf import settings
from django.db import connections

from .diagnostics import event


TARGET = re.compile(r"/calibration_sessions/\d+/(test_points|information)/?$")


class QuerySummary:
    """Measure execute calls only. Fetch, connect and Python work are separate."""

    def __init__(self):
        self.count = self.errors = self.untracked_calls = 0
        self.execute_ms = 0.0
        self.groups = {}

    def __call__(self, execute, sql, params, many, context):
        # Fingerprint the template, never its parameters. Even literal SQL is
        # represented only by a digest; neither SQL nor exceptions are retained.
        fingerprint = hashlib.sha256(" ".join(sql.split()).encode()).hexdigest()[:16]
        key = (context["connection"].alias, fingerprint, bool(many))
        started = time.perf_counter()
        failed = False
        try:
            return execute(sql, params, many, context)
        except Exception:
            failed = True
            raise
        finally:
            elapsed = (time.perf_counter() - started) * 1000
            self.count += 1
            self.errors += int(failed)
            self.execute_ms += elapsed
            if key not in self.groups and len(self.groups) >= 100:
                self.untracked_calls += 1
            else:
                group = self.groups.setdefault(key, {
                    "alias": key[0], "fingerprint": key[1], "executemany": key[2],
                    "calls": 0, "execute_ms": 0.0, "max_execute_ms": 0.0,
                })
                group["calls"] += 1
                group["execute_ms"] += elapsed
                group["max_execute_ms"] = max(group["max_execute_ms"], elapsed)

    def report(self):
        groups = [{**g, "execute_ms": round(g["execute_ms"], 3),
                   "max_execute_ms": round(g["max_execute_ms"], 3)}
                  for g in self.groups.values()]
        return {
            "calls": self.count, "errors": self.errors,
            "execute_ms": round(self.execute_ms, 3),
            "untracked_group_calls": self.untracked_calls,
            "slowest_groups": sorted(groups, key=lambda g: g["execute_ms"], reverse=True)[:10],
            "most_repeated_groups": sorted(groups, key=lambda g: g["calls"], reverse=True)[:10],
        }


def profile_report(profiler):
    rows = []
    for entry in profiler.getstats():
        code = entry.code
        if isinstance(code, str):
            name, source, line = code[:200], "builtin", 0
        else:
            name, source, line = code.co_name, os.path.basename(code.co_filename), code.co_firstlineno
        rows.append({"function": name, "file": source, "line": line,
                     "calls": entry.callcount, "self_ms": round(entry.inlinetime * 1000, 3),
                     "cumulative_ms": round(entry.totaltime * 1000, 3)})
    # Keep DB connection/fetch frames even if they fall below the top functions.
    io_rows = [r for r in rows if any(word in r["function"].lower()
                                    for word in ("fetch", "connect"))]
    return {
        "top_cumulative": sorted(rows, key=lambda r: r["cumulative_ms"], reverse=True)[:25],
        "top_self": sorted(rows, key=lambda r: r["self_ms"], reverse=True)[:25],
        "connection_and_fetch": sorted(io_rows, key=lambda r: r["cumulative_ms"], reverse=True)[:25],
    }


class RequestLatencyMiddleware:
    # These endpoints are synchronous. Profiling and execute wrappers stay on
    # their request's Django worker thread, including under the ASGI adapter.
    sync_capable = True
    async_capable = False

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if (not getattr(settings, "PROFILE_SESSION_REQUESTS", False)
                or request.method != "GET" or not TARGET.search(request.path_info)):
            return self.get_response(request)

        request_id = getattr(request, "scope", {}).get("ac_shunt_request_id") or uuid.uuid4().hex[:12]
        queries = QuerySummary()
        # Do not replace a debugger/profiler already installed on this thread.
        profiler = cProfile.Profile() if sys.getprofile() is None else None
        started = time.perf_counter()
        response = None
        db_info = []
        try:
            with ExitStack() as stack:
                for connection in connections.all():
                    db_info.append({"alias": connection.alias, "vendor": connection.vendor,
                                    "already_connected": connection.connection is not None})
                    stack.enter_context(connection.execute_wrapper(queries))
                if profiler:
                    profiler.enable()
                try:
                    response = self.get_response(request)
                finally:
                    if profiler:
                        profiler.disable()
            elapsed = (time.perf_counter() - started) * 1000
            response["X-AC-Shunt-Request-ID"] = request_id
            timing = f'app;dur={elapsed:.3f}, dbexec;dur={queries.execute_ms:.3f}'
            previous = response.get("Server-Timing")
            response["Server-Timing"] = f"{previous}, {timing}" if previous else timing
            return response
        finally:
            elapsed = (time.perf_counter() - started) * 1000
            # Diagnostic output must not turn a successful response into a 500.
            try:
                event("request_latency", schema_version=1, request_id=request_id,
                      path=request.path_info, status=getattr(response, "status_code", None),
                      app_ms=round(elapsed, 3), databases=db_info,
                      response_bytes=(len(response.content) if response is not None
                                      and not response.streaming else None),
                      sql=queries.report(), profile=profile_report(profiler) if profiler else None,
                      profile_skipped=profiler is None)
            except Exception:
                pass
