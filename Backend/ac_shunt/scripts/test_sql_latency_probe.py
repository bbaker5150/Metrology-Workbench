"""Focused tests for the standalone probe; no Django or real SQL required."""

import contextlib
import io
import json
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from urllib.error import HTTPError

import sql_latency_probe as probe


class ProbeTests(unittest.TestCase):
    def test_password_cannot_inject_connection_options(self):
        credentials = dict(server="sql", database="db", user="user", password="x};SERVER=other;{")
        value = probe.connection_string(credentials, "ODBC Driver 18 for SQL Server")
        self.assertIn("PWD={x}};SERVER=other;{};", value)
        self.assertIn("TrustServerCertificate=yes;", value)

    def test_driver_errors_do_not_disclose_credentials(self):
        report = {"samples": []}
        def fail():
            raise RuntimeError("08001", "PWD=private-password;UID=private-user")
        with self.assertRaises(RuntimeError):
            probe.measure(report, "fresh_connect", fail)
        self.assertEqual(report["samples"][0]["sqlstate"], "08001")
        self.assertNotIn("private", json.dumps(report))
        self.assertFalse(report["samples"][0]["ok"])

    def test_sql_only_selects_and_closes_connections(self):
        executed = []
        connections = []
        class Cursor:
            closed = False
            def execute(self, sql):
                executed.append(sql)
                self.sql = sql
            def fetchone(self):
                if "SERVERPROPERTY" in self.sql:
                    return ("server", "17.0", "db")
                return ("x" * 262144,) if "REPLICATE" in self.sql else (1,)
            def close(self):
                self.closed = True
        class Connection:
            closed = False
            def __init__(self):
                self.cur = Cursor()
            def cursor(self):
                return self.cur
            def close(self):
                self.closed = True
        driver = SimpleNamespace(pooling=True)
        def connect(*args, **kwargs):
            self.assertFalse(driver.pooling)
            self.assertTrue(kwargs["autocommit"])
            self.assertEqual(kwargs["timeout"], 10)
            connection = Connection()
            connections.append(connection)
            return connection
        driver.connect = connect
        report = {"samples": []}
        with patch.object(probe.time, "sleep"):
            probe.sql_tests(report, dict(server="s", database="d", user="u", password="secret"),
                            "ODBC Driver 18 for SQL Server", driver,
                            SimpleNamespace(connects=2, samples=2, timeout=10))
        self.assertTrue(all(sql.startswith("SELECT ") and " FROM " not in sql for sql in executed))
        self.assertTrue(all(conn.closed and conn.cur.closed for conn in connections))
        self.assertEqual(probe.summarize(report["samples"])["fresh_connect"]["successes"], 2)
        self.assertEqual(report["server"]["database"], "db")
        self.assertNotIn("secret", json.dumps(report))

    def test_missing_configuration_does_not_start_django(self):
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder) / "report.json"
            with contextlib.redirect_stdout(io.StringIO()):
                code = probe.main(["--credentials-dir", folder, "--output", str(output)])
            result = json.loads(output.read_text())
        self.assertEqual(code, 1)
        self.assertEqual(result["sql_error"]["error_type"], "SetupError")
        self.assertEqual(result["samples"], [])

    def test_api_records_timing_and_engine_without_body(self):
        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                body = b'{"database_type":"sqlite3","private_data":"never-export"}'
                self.send_response(200)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            def log_message(self, *args):
                pass
        server = HTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            result = probe.api_test(f"http://127.0.0.1:{server.server_port}/api/system_info/", 3)
        finally:
            server.shutdown()
            server.server_close()
            thread.join()
        self.assertEqual(result["database_type"], "sqlite3")
        self.assertEqual(result["status"], 200)
        self.assertGreater(result["response_bytes"], 0)
        self.assertNotIn("never-export", json.dumps(result))

    def test_api_does_not_follow_redirects(self):
        class Handler(BaseHTTPRequestHandler):
            calls = 0
            def do_GET(self):
                Handler.calls += 1
                self.send_response(302)
                self.send_header("Location", "/different-endpoint")
                self.end_headers()
            def log_message(self, *args):
                pass
        server = HTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with self.assertRaises(HTTPError) as raised:
                probe.api_test(f"http://127.0.0.1:{server.server_port}/", 3)
            self.assertEqual(probe.safe_error(raised.exception)["http_status"], 302)
            self.assertEqual(Handler.calls, 1)
        finally:
            server.shutdown()
            server.server_close()
            thread.join()


if __name__ == "__main__":
    unittest.main()
