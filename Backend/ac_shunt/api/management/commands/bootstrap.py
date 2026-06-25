"""
One-shot pre-server bootstrap command.

Runs every piece of startup work that ``entry_point.main`` does for the
PyInstaller build — migrations, outbox schema, Local Workstation seed,
optional mock calibration session — but packaged as a ``manage.py``
command so it composes cleanly with ``runserver``.

Chained in ``Frontend/workbench/package.json`` as::

    manage.py bootstrap && manage.py runserver 0.0.0.0:8000

This way ``npm run dev``, ``npm run dev:mock``, ``npm run electron:dev``,
and ``npm run electron:dev:mock`` all perform the same startup work as a
production ``entry_point.main`` boot — most importantly, pending
migrations are always applied before the server starts, so pulling new
schema onto a lab PC and launching via ``npm run dev`` never hits the
"silent stale schema" failure mode.

All steps are defensive: individual failures are logged but do not
abort the chain, mirroring ``entry_point.main``'s philosophy that a
partially-initialized backend that can still enqueue to the outbox is
strictly better than failing to boot.
"""
from __future__ import annotations

import os
import sys

from django.core.management import call_command
from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = (
        "Run pre-runserver bootstrap work (migrate, outbox, "
        "Local Workstation, optional mock session). Idempotent."
    )

    def handle(self, *args, **options):
        self.stdout.write(self.style.MIGRATE_HEADING("--- ac_shunt bootstrap ---"))

        self._migrate_default_db()
        self._migrate_module_dbs()
        self._bootstrap_outbox()
        self._bootstrap_local_workstation()
        self._bootstrap_mock_session()

        self.stdout.write(self.style.SUCCESS("Bootstrap complete."))

    def _migrate_default_db(self):
        """Apply pending migrations on the default DB.

        The default DB may be MSSQL (lab/prod) or SQLite (fallback when
        MSSQL creds are missing). Either way, migrate is idempotent and
        picks up any new schema shipped in an update. If the default DB
        is unreachable (MSSQL down), we log and continue so the outbox
        drainer can replay once the server comes back — same behavior as
        ``entry_point.main``.
        """
        try:
            from django.db import connections

            db_conn = connections['default']
            engine = db_conn.settings_dict.get('ENGINE', 'unknown')
            self.stdout.write(f"Default DB engine: {engine}")
            db_conn.cursor()  # probe
            self.stdout.write("Applying pending default DB migrations (idempotent)...")
            call_command('migrate', interactive=False, verbosity=1)
        except Exception as exc:
            self.stdout.write(self.style.WARNING(
                f"Default DB migrate skipped ({exc!r}). "
                "Outbox will buffer writes until the server is reachable."
            ))

    def _migrate_module_dbs(self):
        """Apply each per-module app's migrations onto its dedicated alias.

        ``migrate`` (default) only touches the ``default`` alias, and
        WorkbenchRouter keeps module apps (uncertainty, reports, ...) off
        ``default``. So each module DB must be migrated explicitly here, or a
        fresh lab PC would boot with the module tables missing. Idempotent and
        defensive: a single module's failure is logged and never aborts boot.
        """
        try:
            from api.db_routers import APP_DB_MAP
        except Exception as exc:  # pragma: no cover - defensive
            self.stdout.write(self.style.WARNING(
                f"Module DB migrate skipped ({exc!r})."
            ))
            return

        for app_label, alias in APP_DB_MAP.items():
            try:
                self.stdout.write(
                    f"Applying {app_label} migrations on '{alias}' alias..."
                )
                call_command(
                    "migrate", app_label, database=alias,
                    interactive=False, verbosity=1,
                )
            except Exception as exc:
                self.stdout.write(self.style.WARNING(
                    f"Module DB migrate for '{app_label}' skipped ({exc!r})."
                ))

    def _bootstrap_outbox(self):
        """Delegate to entry_point so the outbox schema logic lives once.

        ``ApiConfig.ready()`` already handles this for most launch paths,
        but running it here explicitly closes any edge-case gap (e.g.
        first-time runs where ``ready()`` fires before the outbox file
        has been created).
        """
        try:
            from entry_point import _bootstrap_outbox_db

            _bootstrap_outbox_db()
        except Exception as exc:
            self.stdout.write(self.style.WARNING(
                f"Outbox bootstrap skipped ({exc!r})."
            ))

    def _bootstrap_local_workstation(self):
        """Ensure the Local Workstation row exists and import the optional
        ``Documents/Portal/workstations.json`` seed on a fresh install.

        Post-Phase-5-follow-up the auto-provision path in
        ``session_state._resolve_workstation`` would eventually create
        Workstation rows on first claim anyway, but explicit bootstrap
        preserves the JSON seed mechanism for multi-bench VM
        deployments that want a reproducible inventory.
        """
        try:
            from entry_point import _bootstrap_local_workstation

            _bootstrap_local_workstation()
        except Exception as exc:
            self.stdout.write(self.style.WARNING(
                f"Local Workstation bootstrap skipped ({exc!r})."
            ))

    def _bootstrap_mock_session(self):
        """Seed the mock calibration session when MOCK_INSTRUMENTS=1.

        No-op when mock mode is off. Idempotent: only seeds when the
        session is missing so UI edits made during a dev session
        survive subsequent boots.
        """
        try:
            from entry_point import _bootstrap_mock_calibration_session

            _bootstrap_mock_calibration_session()
        except Exception as exc:
            self.stdout.write(self.style.WARNING(
                f"Mock session bootstrap skipped ({exc!r})."
            ))
