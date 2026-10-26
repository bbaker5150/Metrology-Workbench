"""Client-side SQL latency measurements; no Django startup or monitoring grants.

Uses the same SQL*.txt files and ODBC driver preference as settings.py.
Only SELECT statements are sent to SQL Server. No application tables are read.
An optional HTTP GET should target an endpoint you know is read-only.
"""

import argparse
import json
import os
import re
import statistics
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener


class SetupError(Exception):
    """Safe, known configuration message without credential contents."""


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def credentials_directory():
    override = os.environ.get("AC_SHUNT_PORTAL_DIR", "").strip()
    if override:
        return Path(override).expanduser().resolve()
    for root in sorted(Path.home().glob("OneDrive*")):
        if (root / "Documents").is_dir():
            return root / "Documents" / "Portal"
    return Path.home() / "Documents" / "Portal"


def load_credentials(directory):
    result = {}
    for key, filename in (("server", "SQLHOST.txt"), ("database", "SQLNAME2.txt"),
                          ("user", "SQLUSER.txt"), ("password", "SQLPASS.txt")):
        path = directory / filename
        if not path.is_file():
            raise SetupError(f"Missing {filename}; use --credentials-dir for the affected workstation's configuration.")
        value = path.read_text(encoding="utf-8-sig").strip()
        if not value:
            raise SetupError(f"Empty {filename}.")
        result[key] = value
    return result


def odbc_value(value):
    # Bracing prevents semicolons or braces in a password becoming parameters.
    return "{" + value.replace("}", "}}") + "}"


def connection_string(credentials, driver):
    fields = [("DRIVER", driver), ("SERVER", credentials["server"]),
              ("DATABASE", credentials["database"]), ("UID", credentials["user"]),
              ("PWD", credentials["password"])]
    value = ";".join(f"{key}={odbc_value(item)}" for key, item in fields)
    value += ";MARS_Connection=yes;"
    if driver == "ODBC Driver 18 for SQL Server":
        # Match the application's current certificate setting, not a new policy.
        value += "TrustServerCertificate=yes;"
    return value


def safe_error(exc):
    # Driver messages can echo connection details. Record only class/SQLSTATE.
    result = {"error_type": type(exc).__name__}
    if exc.args and re.fullmatch(r"[A-Z0-9]{5}", str(exc.args[0])):
        result["sqlstate"] = str(exc.args[0])
    if isinstance(getattr(exc, "code", None), int):
        result["http_status"] = exc.code
    return result


def measure(report, stage, operation):
    sample = {"stage": stage, "started_utc": datetime.now(timezone.utc).isoformat()}
    started = time.perf_counter()
    try:
        result = operation()
    except Exception as exc:
        sample.update(ok=False, **safe_error(exc))
        report["samples"].append({**sample, "elapsed_ms": round((time.perf_counter() - started) * 1000, 3)})
        raise
    sample.update(ok=True, elapsed_ms=round((time.perf_counter() - started) * 1000, 3))
    report["samples"].append(sample)
    return result


def sql_tests(report, credentials, driver, pyodbc, args):
    # This is a standalone process: disable pooling before its first connection
    # to measure fresh logins. It does not change the running app's pooling.
    pyodbc.pooling = False
    conn_string = connection_string(credentials, driver)
    for index in range(args.connects):
        conn = measure(report, "fresh_connect", lambda: pyodbc.connect(
            conn_string, timeout=args.timeout, autocommit=True))
        try:
            conn.timeout = args.timeout
            cursor = conn.cursor()
            try:
                def scalar(sql):
                    cursor.execute(sql)
                    return cursor.fetchone()[0]

                measure(report, "first_select_1", lambda: scalar("SELECT 1"))
                if index == 0:
                    cursor.execute("SELECT CONVERT(nvarchar(128), SERVERPROPERTY('ServerName')), "
                                   "CONVERT(nvarchar(128), SERVERPROPERTY('ProductVersion')), DB_NAME()")
                    row = cursor.fetchone()
                    report["server"] = {"name": row[0], "version": row[1], "database": row[2]}
                    for _ in range(args.samples):
                        measure(report, "reused_select_1", lambda: scalar("SELECT 1"))
                        time.sleep(0.2)
                    for _ in range(3):
                        # A 256 KiB synthetic result, independent of app tables.
                        payload = measure(report, "fetch_256k", lambda: scalar(
                            "SELECT REPLICATE(CAST('x' AS varchar(max)), 262144)"))
                        if len(payload) != 262144:
                            raise ValueError("Unexpected synthetic result length")
            finally:
                cursor.close()
        finally:
            conn.close()


def api_test(url, timeout):
    # Avoid routing loopback traffic through a workstation's proxy settings.
    opener = build_opener(ProxyHandler({}), NoRedirect())
    started = time.perf_counter()
    with opener.open(Request(url, method="GET"), timeout=timeout) as response:
        headers_ms = round((time.perf_counter() - started) * 1000, 3)
        size = 0
        body = bytearray()
        while True:
            if time.perf_counter() - started > timeout:
                raise TimeoutError("API response exceeded measurement deadline")
            chunk = response.read(65536)
            if not chunk:
                break
            size += len(chunk)
            if size <= 65536:
                body.extend(chunk)
        result = {"status": response.status, "response_bytes": size, "headers_ms": headers_ms}
        # Confirm MSSQL vs SQLite if the existing system_info endpoint was used.
        if urlsplit(url).path.rstrip("/").endswith("/system_info") and size <= 65536:
            try:
                engine = json.loads(body).get("database_type")
                if engine in ("mssql", "sqlite3"):
                    result["database_type"] = engine
            except (ValueError, AttributeError):
                pass
        return result


def summarize(samples):
    result = {}
    for stage in dict.fromkeys(item["stage"] for item in samples):
        items = [item for item in samples if item["stage"] == stage]
        times = [item["elapsed_ms"] for item in items if item["ok"]]
        result[stage] = {"successes": len(times), "failures": len(items) - len(times)}
        if times:
            result[stage].update(median_ms=round(statistics.median(times), 3), max_ms=max(times))
    return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--credentials-dir", type=Path, default=credentials_directory())
    parser.add_argument("--samples", type=int, choices=range(1, 31), default=10, metavar="1..30")
    parser.add_argument("--connects", type=int, choices=range(1, 6), default=3, metavar="1..5")
    parser.add_argument("--timeout", type=int, choices=range(1, 31), default=10, metavar="1..30")
    parser.add_argument("--api-url", help="Optional read-only HTTP GET on localhost/127.0.0.1/::1")
    parser.add_argument("--output", type=Path, default=Path("sql-latency.json"))
    args = parser.parse_args(argv)
    if args.api_url:
        url = urlsplit(args.api_url)
        if (url.scheme not in ("http", "https") or url.hostname not in ("localhost", "127.0.0.1", "::1")
                or url.username or url.password or url.fragment):
            parser.error("--api-url must be a local HTTP(S) endpoint without embedded credentials or fragment")
    report = {"started_utc": datetime.now(timezone.utc).isoformat(), "samples": [],
              "probe_pooling": False, "timeout_seconds": args.timeout,
              "note": "Client timings, not server-only execution times. No Django startup. Only synthetic SQL SELECTs."}
    try:
        credentials = load_credentials(args.credentials_dir)
        import pyodbc
        # Set before even enumerating drivers, which may allocate an ODBC env.
        pyodbc.pooling = False
        drivers = pyodbc.drivers()
        driver = next((item for item in ("ODBC Driver 18 for SQL Server", "ODBC Driver 17 for SQL Server")
                       if item in drivers), None)
        if driver is None:
            raise SetupError("ODBC Driver 17 or 18 is required; run on the workstation where MSSQL works.")
        report.update(driver=driver, pyodbc_version=pyodbc.version)
        sql_tests(report, credentials, driver, pyodbc, args)
    except SetupError as exc:
        report["sql_error"] = {"error_type": type(exc).__name__, "message": str(exc)}
        print(str(exc))
    except ImportError as exc:
        report["sql_error"] = safe_error(exc)
        print("pyodbc is unavailable. Run with the Python environment used by the working MSSQL application.")
    except Exception as exc:
        report["sql_error"] = safe_error(exc)
        print("SQL measurement failed; see the recorded stage and SQLSTATE. Driver text is withheld.")
    if args.api_url:
        for _ in range(3):
            try:
                metadata = measure(report, "local_api_get", lambda: api_test(args.api_url, args.timeout))
                report["samples"][-1].update(metadata)
            except Exception:
                break
    report["summary"] = summarize(report["samples"])
    args.output.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report["summary"], indent=2))
    print(f"Results saved to: {args.output.resolve()}")
    return int("sql_error" in report or any(not item["ok"] for item in report["samples"]))


if __name__ == "__main__":
    sys.exit(main())
