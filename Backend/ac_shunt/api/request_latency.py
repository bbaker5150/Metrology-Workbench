"""Opt-in profiling of the two session GETs; never log SQL or parameter values."""
import hashlib
import re
import time
import uuid
from contextlib import ExitStack, contextmanager

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


class DatabaseIO:
    """Direct wall-clock timings, isolated to one request's connection objects."""

    def __init__(self):
        self.operations = {}

    def call(self, alias, operation, function, *args, **kwargs):
        started = time.perf_counter()
        rows = 0
        failed = False
        try:
            result = function(*args, **kwargs)
            if operation in ("fetchmany", "fetchall"):
                rows = len(result)
            elif operation in ("fetchone", "next"):
                rows = int(result is not None)
            return result
        except StopIteration:
            raise
        except Exception:
            failed = True
            raise
        finally:
            elapsed = (time.perf_counter() - started) * 1000
            group = self.operations.setdefault((alias, operation), {
                "alias": alias, "operation": operation, "calls": 0,
                "elapsed_ms": 0.0, "max_ms": 0.0, "rows": 0, "errors": 0,
            })
            group["calls"] += 1
            group["elapsed_ms"] += elapsed
            group["max_ms"] = max(group["max_ms"], elapsed)
            group["rows"] += rows
            group["errors"] += int(failed)

    def report(self):
        return [{**g, "elapsed_ms": round(g["elapsed_ms"], 3),
                 "max_ms": round(g["max_ms"], 3)} for g in self.operations.values()]


class TimedCursor:
    """Delegate cursor behavior while timing fetches outside execute_wrapper."""

    def __init__(self, cursor, io, alias):
        object.__setattr__(self, "_latency_cursor", cursor)
        object.__setattr__(self, "_latency_io", io)
        object.__setattr__(self, "_latency_alias", alias)

    def __getattr__(self, name):
        return getattr(self._latency_cursor, name)

    def __setattr__(self, name, value):
        setattr(self._latency_cursor, name, value)

    def _call(self, name, *args, **kwargs):
        return self._latency_io.call(self._latency_alias, name,
                                     getattr(self._latency_cursor, name), *args, **kwargs)

    def fetchone(self, *args, **kwargs):
        return self._call("fetchone", *args, **kwargs)

    def fetchmany(self, *args, **kwargs):
        return self._call("fetchmany", *args, **kwargs)

    def fetchall(self, *args, **kwargs):
        return self._call("fetchall", *args, **kwargs)

    def close(self):
        return self._call("close")

    def __iter__(self):
        # Some backend cursor wrappers are iterable without implementing next().
        iterator = iter(self._latency_cursor)
        while True:
            try:
                row = self._latency_io.call(self._latency_alias, "next", next, iterator)
            except StopIteration:
                return
            yield row

    def __next__(self):
        return self._latency_io.call(self._latency_alias, "next", next, self._latency_cursor)

    def __enter__(self):
        result = self._latency_cursor.__enter__()
        return self if result is self._latency_cursor else result

    def __exit__(self, *args):
        return self._latency_cursor.__exit__(*args)


@contextmanager
def instrument_connection(connection, io):
    # Only instance attributes on Django's thread-local connection are changed.
    # Never patch driver classes or process-global tracing/profiling hooks.
    missing = object()
    names = ("create_cursor", "get_new_connection")
    previous = {name: connection.__dict__.get(name, missing) for name in names}
    create_cursor = connection.create_cursor
    get_new_connection = connection.get_new_connection

    def timed_cursor(*args, **kwargs):
        cursor = io.call(connection.alias, "create_cursor", create_cursor, *args, **kwargs)
        return TimedCursor(cursor, io, connection.alias)

    def timed_connection(*args, **kwargs):
        return io.call(connection.alias, "get_new_connection", get_new_connection, *args, **kwargs)

    try:
        connection.create_cursor = timed_cursor
        connection.get_new_connection = timed_connection
        yield
    finally:
        for name, value in previous.items():
            if value is missing:
                connection.__dict__.pop(name, None)
            else:
                setattr(connection, name, value)


class RequestLatencyMiddleware:
    # These endpoints are synchronous. Timing and execute wrappers stay on
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
        io = DatabaseIO()
        started = time.perf_counter()
        response = None
        db_info = []
        try:
            with ExitStack() as stack:
                for connection in connections.all():
                    db_info.append({"alias": connection.alias, "vendor": connection.vendor,
                                    "already_connected": connection.connection is not None})
                    stack.enter_context(connection.execute_wrapper(queries))
                    stack.enter_context(instrument_connection(connection, io))
                response = self.get_response(request)
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
                event("request_latency", schema_version=2, request_id=request_id,
                      path=request.path_info, status=getattr(response, "status_code", None),
                      app_ms=round(elapsed, 3), databases=db_info,
                      response_bytes=(len(response.content) if response is not None
                                      and not response.streaming else None),
                      sql=queries.report(), database_io=io.report())
            except Exception:
                pass
