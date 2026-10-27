"""Microsoft ODBC backend with an explicit, consistent MARS connection mode.

mssql-django 1.7.2 enables MARS unconditionally on Windows and advertises
chunked reads even if the connection string disables it. Keep those aligned
without changing the installed driver or authentication/encryption settings.
"""
from mssql.base import CursorWrapper, DatabaseWrapper as MSSQLDatabaseWrapper

from .options import with_mars


class MicrosoftCursorWrapper(CursorWrapper):
    def fetchone(self):
        # Upstream's non-MARS branch discards the remaining rows for FreeTDS.
        # This app uses Microsoft ODBC 17/18: preserve normal fetchone semantics.
        row = self.cursor.fetchone()
        return self.format_row(row) if row is not None else None


class DatabaseWrapper(MSSQLDatabaseWrapper):
    # mssql-django 1.7.2 reads these descriptors via type(self).__dict__ in
    # _fetch_server_properties(), bypassing normal inheritance. Bind the original
    # descriptors here so both metadata caches remain available on cold startup.
    sql_server_version = MSSQLDatabaseWrapper.sql_server_version
    to_azure_sql_db = MSSQLDatabaseWrapper.to_azure_sql_db

    @property
    def mars_enabled(self):
        return self.settings_dict.get("OPTIONS", {}).get("mars_enabled", False)

    def _build_connection_string(self, conn_params, driver):
        return with_mars(super()._build_connection_string(conn_params, driver),
                         self.mars_enabled)

    def init_connection_state(self):
        super().init_connection_state()
        self.supports_mars = self.mars_enabled
        # Django exhausts and closes the outer ORM cursor before yielding rows
        # when this is false, allowing nested queries on the same connection.
        self.features.can_use_chunked_reads = self.mars_enabled

    def create_cursor(self, name=None):
        return MicrosoftCursorWrapper(self.connection.cursor(), self)
