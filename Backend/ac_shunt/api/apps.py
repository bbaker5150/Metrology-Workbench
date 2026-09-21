import os
import sys

from django.apps import AppConfig


class ApiConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'api'

    def ready(self):
        """
        App initialization logic.
        """
        # Connect cross-row sync signals (e.g. CalibrationSettings.n_cycles
        # mirror between Fwd/Rev TestPoint siblings). Importing the module
        # is sufficient — the receivers register themselves via @receiver.
        from . import signals  # noqa: F401

        return self._actual_ready()

    def _actual_ready(self):
        """Original ready() body — heavy startup work kept separate so signal
        registration above happens unconditionally, even for management
        commands that short-circuit the rest.

        Most heavy startup (default DB migration, corrections sync) lives in
        entry_point.py to avoid RuntimeWarnings and to keep ``manage.py``
        commands fast. But the local write-outbox is critical for data
        durability even when the server was launched via plain
        ``manage.py runserver`` (developer mode, tests, etc.), so we make
        sure its schema is in place here as well.

        This is cheap (a single table on a local SQLite file) and idempotent,
        and is guarded so management commands like ``migrate`` /
        ``makemigrations`` don't recursively trigger it.
        """
        if os.environ.get('AC_SHUNT_SKIP_OUTBOX_BOOTSTRAP') == '1':
            return

        argv = sys.argv or []
        skip_commands = {'makemigrations', 'migrate', 'collectstatic',
                         'showmigrations', 'sqlmigrate', 'flush',
                         'configure_corrections_password'}
        if any(cmd in argv for cmd in skip_commands):
            return

        try:
            from django.db import connections
            from django.core.management import call_command

            outbox_conn = connections['outbox']
            outbox_conn.cursor()
            tables = outbox_conn.introspection.table_names()
            if 'api_pendingreadingwrite' not in tables:
                call_command('migrate', database='outbox', interactive=False, verbosity=0)
        except Exception as e:
            print(f"api.apps.ready: outbox bootstrap skipped ({e}).")

        # Clear any ``WorkstationClaim`` rows left behind by a previous
        # Daphne process. Their ``owner_channel`` names refer to dead
        # sockets that can never reconnect, so they would falsely
        # populate the admin and confuse operators trying to spot a
        # stuck claim. Guarded so tests (which run their own migrations
        # lazily) and non-server management commands don't trigger it.
        if 'test' not in argv and 'shell' not in argv:
            try:
                from api import session_state as _session_state
                from django.db import connections as _connections

                default_conn = _connections['default']
                default_conn.cursor()
                if 'api_workstationclaim' in default_conn.introspection.table_names():
                    wiped = _session_state.wipe_stale_claims()
                    if wiped:
                        print(f"api.apps.ready: wiped {wiped} stale WorkstationClaim "
                              "row(s) from prior process.")
            except Exception as claim_err:
                print(f"api.apps.ready: stale claim wipe skipped ({claim_err}).")
