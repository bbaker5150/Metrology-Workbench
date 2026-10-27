"""Compare full-result retrieval through Django and its existing ODBC connection."""
import json
import sys
import tempfile
import time
from copy import deepcopy
from datetime import datetime, timezone
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError
from django.db import connections


def readings_sql(session_id):
    if not isinstance(session_id, int) or not 0 < session_id < 2**63:
        raise ValueError("Session ID must be a positive SQL bigint.")
    # Match the SSMS statement, including its literal session predicate. The
    # bounded integer above is the only interpolated value; no arbitrary SQL.
    return f"""SELECT r.*
FROM dbo.api_calibrationreadings AS r
JOIN dbo.api_testpoint AS p ON p.id = r.test_point_id
JOIN dbo.api_testpointset AS s ON s.id = p.test_point_set_id
WHERE s.session_id = {session_id};"""


def run_trial(cursor_factory, sql):
    started = time.perf_counter()
    cursor = cursor_factory()
    opened = time.perf_counter()
    result = {"cursor_open_ms": round((opened - started) * 1000, 3)}
    try:
        cursor.execute(sql)
        result["execute_ms"] = round((time.perf_counter() - opened) * 1000, 3)
        fetch_seconds = max_fetch = 0.0
        calls = rows = text_chars = 0
        while True:
            before = time.perf_counter()
            batch = cursor.fetchmany(100)
            elapsed = time.perf_counter() - before
            fetch_seconds += elapsed
            max_fetch = max(max_fetch, elapsed)
            calls += 1
            if not batch:
                break
            rows += len(batch)
            # Inspect only lengths, after timing the fetch. Never retain row
            # values in results, logs, exceptions or the output file.
            text_chars += sum(len(value) for row in batch for value in row if isinstance(value, str))
        result.update(fetch_ms=round(fetch_seconds * 1000, 3),
                      max_fetch_ms=round(max_fetch * 1000, 3),
                      fetch_calls=calls, rows=rows, text_characters=text_chars)
    finally:
        before = time.perf_counter()
        cursor.close()
        result["close_ms"] = round((time.perf_counter() - before) * 1000, 3)
    result["total_ms"] = round((time.perf_counter() - started) * 1000, 3)
    return result


def package_versions():
    result = {"python": sys.version.split()[0]}
    for package in ("Django", "mssql-django", "pyodbc"):
        try:
            result[package] = version(package)
        except PackageNotFoundError:
            result[package] = "unavailable"
    return result


def with_mars(connection_string, enabled):
    """Replace the MARS keyword without touching semicolons in braced secrets."""
    parts = []
    start = index = 0
    braced = False
    while index < len(connection_string):
        char = connection_string[index]
        if braced:
            if char == "}":
                if connection_string[index:index + 2] == "}}":
                    index += 2
                    continue
                braced = False
        elif char == "{":
            prefix = connection_string[start:index].partition("=")
            if prefix[1] and not prefix[2].strip():
                braced = True
        elif char == ";":
            parts.append(connection_string[start:index])
            start = index + 1
        index += 1
    if braced:
        raise ValueError("Unterminated braced ODBC value.")
    parts.append(connection_string[start:])
    aliases = {"mars_connection", "multipleactiveresultsets"}
    preserved = [part for part in parts if part.strip()
                 and part.partition("=")[0].strip().lower() not in aliases]
    preserved.append("MARS_Connection=" + ("yes" if enabled else "no"))
    return ";".join(preserved)


def run_mars_trial(connection, sql, enabled):
    # Use a private wrapper, preserving backend converters, initialization and
    # all existing authentication/TLS/driver options. Never mutate the live alias.
    private = type(connection)(deepcopy(connection.settings_dict), alias="sql_fetch_comparison")
    try:
        build = private._build_connection_string
        private._build_connection_string = lambda *a, **kw: with_mars(build(*a, **kw), enabled)
        started = time.perf_counter()
        private.ensure_connection()
        connected_ms = round((time.perf_counter() - started) * 1000, 3)
        result = run_trial(private.connection.cursor, sql)
        return {"mars_requested": enabled, "ensure_connection_ms": connected_ms, **result}
    finally:
        private.close()


class Command(BaseCommand):
    help = "Read one session's stored readings through Django and raw ODBC; save timings only."
    requires_system_checks = []
    requires_migrations_checks = False

    def add_arguments(self, parser):
        parser.add_argument("--session", type=int, required=True)
        parser.add_argument("--compare-mars", action="store_true",
                            help="Compare MARS on/off on private connections; leave application settings unchanged.")

    def handle(self, *args, **options):
        try:
            sql = readings_sql(options["session"])
        except ValueError as exc:
            raise CommandError(str(exc)) from None
        connection = connections["default"]
        if connection.vendor != "microsoft":
            raise CommandError("Default database is not MSSQL. Check the startup connection message; no test was run.")
        report = {"event": "sql_fetch_comparison", "schema_version": 2,
                  "comparison": "mars" if options.get("compare_mars") else "cursor",
                  "captured_utc": datetime.now(timezone.utc).isoformat(),
                  "session_id": options["session"], "versions": package_versions(), "trials": []}
        try:
            started = time.perf_counter()
            connection.ensure_connection()
            report["ensure_connection_ms"] = round((time.perf_counter() - started) * 1000, 3)
            import pyodbc
            report["driver"] = {}
            for label, code in (("name", pyodbc.SQL_DRIVER_NAME), ("version", pyodbc.SQL_DRIVER_VER),
                                ("dbms_version", pyodbc.SQL_DBMS_VER)):
                try:
                    report["driver"][label] = connection.connection.getinfo(code)
                except Exception:
                    report["driver"][label] = "unavailable"
            factories = {"django_cursor": connection.cursor,
                         "raw_odbc_cursor": connection.connection.cursor}
            # Reverse the order for the second pair to reduce first-run bias.
            modes = (("mars_on", "mars_off", "mars_off", "mars_on") if options.get("compare_mars")
                     else ("django_cursor", "raw_odbc_cursor", "raw_odbc_cursor", "django_cursor"))
            for index, mode in enumerate(modes, 1):
                self.stdout.write(f"Trial {index}/4: {mode} (fetching all readings)...")
                self.stdout.flush()
                result = (run_mars_trial(connection, sql, mode == "mars_on") if options.get("compare_mars")
                          else run_trial(factories[mode], sql))
                report["trials"].append({"trial": index, "mode": mode, **result})
                self.stdout.write(json.dumps(report["trials"][-1]))
        except Exception as exc:
            # Driver errors can contain connection details; report only type.
            report["error_type"] = type(exc).__name__
        finally:
            connection.close()
        filename = "ac-shunt-sql-comparison-" + datetime.now().strftime("%Y%m%d-%H%M%S-%f") + ".json"
        output = Path(tempfile.gettempdir()) / filename
        with output.open("x", encoding="utf-8") as stream:
            json.dump(report, stream, indent=2)
        self.stdout.write(f"Send this file: {output}")
        if "error_type" in report:
            raise CommandError(f"Comparison stopped ({report['error_type']}); partial timings saved.")
