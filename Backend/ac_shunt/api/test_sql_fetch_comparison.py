import io
import json
import sqlite3
import sys
import tempfile
from pathlib import Path
from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import Mock, patch

from django.core.management.base import CommandError

from .management.commands.diagnose_sql_fetch import Command, readings_sql, run_trial


class SQLFetchComparisonTests(TestCase):
    def test_fetches_every_batch_without_retaining_values(self):
        database = sqlite3.connect(":memory:")
        try:
            result = run_trial(database.cursor, "WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<205) SELECT 'private-reading' FROM n")
        finally:
            database.close()
        self.assertEqual(result["rows"], 205)
        self.assertEqual(result["fetch_calls"], 4)
        self.assertEqual(result["text_characters"], 205 * len("private-reading"))
        self.assertNotIn("private-reading", json.dumps(result))

    def test_fetch_delay_is_separate_from_execute(self):
        cursor = Mock()
        cursor.fetchmany.side_effect = [[("secret",)], []]
        with patch("api.management.commands.diagnose_sql_fetch.time.perf_counter",
                   side_effect=[0, 1, 3, 3, 8, 8, 9, 9, 10, 10]):
            result = run_trial(lambda: cursor, "SELECT 1")
        self.assertEqual(result["execute_ms"], 2000)
        self.assertEqual(result["fetch_ms"], 6000)
        self.assertEqual(result["close_ms"], 1000)
        cursor.close.assert_called_once()

    def test_failure_closes_cursor(self):
        cursor = Mock()
        cursor.execute.side_effect = ValueError("private error")
        with self.assertRaises(ValueError):
            run_trial(lambda: cursor, "SELECT 1")
        cursor.close.assert_called_once()

    def test_query_accepts_only_positive_integer_id(self):
        for value in ("100; DELETE", 0, -1, 2**63):
            with self.assertRaises(ValueError):
                readings_sql(value)
        self.assertIn("WHERE s.session_id = 100;", readings_sql(100))

    def test_sqlite_fallback_is_rejected(self):
        with patch("api.management.commands.diagnose_sql_fetch.connections", {"default": SimpleNamespace(vendor="sqlite")}):
            with self.assertRaisesRegex(CommandError, "not MSSQL"):
                Command().handle(session=100)

    def test_command_skips_startup_database_writes(self):
        from .apps import ApiConfig
        with patch.object(sys, "argv", ["manage.py", "diagnose_sql_fetch", "--session", "100"]), \
                patch("django.db.connections") as databases:
            ApiConfig._actual_ready(None)
        databases.__getitem__.assert_not_called()

    def test_command_saves_only_summary_and_uses_same_connection(self):
        conn = Mock(vendor="microsoft")
        conn.connection.getinfo.return_value = "test-version"
        fake_odbc = SimpleNamespace(SQL_DRIVER_NAME=1, SQL_DRIVER_VER=2, SQL_DBMS_VER=3)
        stdout = io.StringIO()
        with tempfile.TemporaryDirectory() as folder, \
                patch("api.management.commands.diagnose_sql_fetch.connections", {"default": conn}), \
                patch("api.management.commands.diagnose_sql_fetch.tempfile.gettempdir", return_value=folder), \
                patch("api.management.commands.diagnose_sql_fetch.run_trial", return_value={"rows": 24}) as run, \
                patch.dict(sys.modules, {"pyodbc": fake_odbc}):
            Command(stdout=stdout).handle(session=100)
            report = json.loads(next(Path(folder).glob("*.json")).read_text())
        self.assertEqual([c.args[0] for c in run.call_args_list],
                         [conn.cursor, conn.connection.cursor, conn.connection.cursor, conn.cursor])
        self.assertEqual(len({c.args[1] for c in run.call_args_list}), 1)
        self.assertEqual(len(report["trials"]), 4)
        self.assertNotIn("SELECT", json.dumps(report))
        conn.close.assert_called_once()
