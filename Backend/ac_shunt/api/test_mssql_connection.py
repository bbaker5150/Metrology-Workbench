"""Connection-mode regressions against the installed mssql-django backend.

The ODBC transport is simulated; no credentials or database server are needed.
"""
from datetime import datetime
from unittest import TestCase
from unittest.mock import Mock, patch

from django.db import models

from ac_shunt.db.backends.mssql.base import DatabaseWrapper


class Probe(models.Model):
    class Meta:
        app_label = "mars_connection_tests"
        managed = False


class SingleResultConnection:
    """Reject overlapping statements as a real non-MARS connection would."""
    def __init__(self):
        self.active = None

    def getinfo(self, code):
        return "MSODBCSQL18.DLL"

    def cursor(self):
        return SingleResultCursor(self)


class SingleResultCursor:
    def __init__(self, connection):
        self.connection = connection
        self.rows = []
        self.closed = False

    def execute(self, sql, params=()):
        if self.connection.active not in (None, self):
            raise AssertionError("Connection is busy with results for another command")
        self.rows = [(1,), (2,), (3,), (4,), (5,)] if sql.startswith("SELECT") else []
        self.connection.active = self if self.rows else None
        return self

    def fetchmany(self, count):
        result, self.rows = self.rows[:count], self.rows[count:]
        if not self.rows:
            self.connection.active = None
        return result

    def fetchone(self):
        result = self.fetchmany(1)
        return result[0] if result else None

    def close(self):
        self.closed = True
        if self.connection.active is self:
            self.connection.active = None


class MSSQLConnectionTests(TestCase):
    def backend(self, enabled=False):
        wrapper = DatabaseWrapper({
            "NAME": "test", "HOST": "test.invalid", "USER": "test",
            "PASSWORD": "a;MARS_Connection=yes;b}c", "PORT": "",
            "OPTIONS": {"driver": "ODBC Driver 18 for SQL Server",
                        "mars_enabled": enabled, "connection_timeout": 10,
                        "extra_params": "Encrypt=yes;TrustServerCertificate=yes;MARS_Connection=yes"},
        })
        wrapper.connection = SingleResultConnection()
        wrapper.get_system_datetime = datetime(2026, 1, 1)
        wrapper.sql_server_version = 2025
        wrapper.init_connection_state()
        return wrapper

    def test_transport_receives_one_mars_option_without_changing_tls_or_password(self):
        wrapper = self.backend()
        # Exercise the real upstream builder and get_new_connection, mocking
        # only the ODBC connection to avoid network/database side effects.
        with patch("mssql.base.Database.connect", return_value=Mock()) as connect:
            wrapper.get_new_connection(wrapper.settings_dict)
        connection_string = connect.call_args.args[0]
        self.assertIn("PWD={a;MARS_Connection=yes;b}}c}", connection_string)
        self.assertIn("Encrypt=yes;TrustServerCertificate=yes", connection_string)
        self.assertTrue(connection_string.endswith(";MARS_Connection=no"))
        self.assertNotIn(";MARS_Connection=yes;", connection_string.replace("PWD={a;MARS_Connection=yes;b}}c}", ""))
        self.assertEqual(connect.call_args.kwargs["timeout"], 10)
        self.assertFalse(wrapper.supports_mars)
        self.assertFalse(wrapper.features.can_use_chunked_reads)

    def test_chunked_orm_read_is_exhausted_before_nested_query(self):
        wrapper = self.backend()
        query = Probe.objects.all().query
        compiler = query.get_compiler(connection=wrapper)
        batches = iter(compiler.execute_sql(chunked_fetch=True, chunk_size=2))
        first = next(batches)
        with wrapper.cursor() as nested:
            nested.execute("SELECT 1")
            self.assertEqual(nested.fetchone(), (1,))
        self.assertEqual(first + [row for batch in batches for row in batch],
                         [(1,), (2,), (3,), (4,), (5,)])
        self.assertIsNone(wrapper.connection.active)

    def test_repeated_fetchone_preserves_all_rows_and_close_releases_connection(self):
        wrapper = self.backend()
        with wrapper.cursor() as cursor:
            cursor.execute("SELECT 1")
            self.assertEqual([cursor.fetchone() for _ in range(6)],
                             [(1,), (2,), (3,), (4,), (5,), None])
        self.assertIsNone(wrapper.connection.active)

    def test_rollback_restores_mars_and_streaming_per_connection(self):
        off = self.backend()
        on = self.backend(enabled=True)
        self.assertTrue(on.supports_mars)
        self.assertTrue(on.features.can_use_chunked_reads)
        self.assertFalse(off.features.can_use_chunked_reads)
        self.assertTrue(on._build_connection_string(on.settings_dict,
                        "ODBC Driver 18 for SQL Server").endswith(";MARS_Connection=yes"))
        # A reconnect must not restore the upstream unconditional MARS flags.
        off.init_connection_state()
        self.assertFalse(off.features.can_use_chunked_reads)
