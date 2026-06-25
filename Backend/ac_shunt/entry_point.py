# entry_point.py
import os
import sys
import django
import socket
from django.core.management import execute_from_command_line, call_command
from django.db import connections

def is_port_in_use(port):
    """
    Checks if the specified port is already bound on 127.0.0.1.
    """
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        return s.connect_ex(('127.0.0.1', int(port))) == 0


def _bootstrap_outbox_db():
    """
    Ensure the local write-outbox SQLite database has its schema.

    This is completely independent of the default DB — even if MSSQL is
    unreachable at boot, the outbox must still be ready to accept enqueues
    so an in-progress run can buffer stage saves.
    """
    try:
        outbox_conn = connections['outbox']
        outbox_conn.cursor()  # forces connection open / file creation
        tables = outbox_conn.introspection.table_names()
        if 'api_pendingreadingwrite' not in tables:
            print("Bootstrapping outbox SQLite schema...")
            call_command('migrate', database='outbox', interactive=False, verbosity=0)
            print("Outbox schema ready.")
        else:
            print("Outbox schema already present.")
    except Exception as e:
        # The outbox failing is serious but non-fatal — the app still boots,
        # and save_readings_to_db falls back to its direct path. Log loudly.
        print(f"WARNING: outbox bootstrap failed: {e}")


def _bootstrap_local_workstation():
    """
    Ensure the "Local Workstation" row exists, and optionally seed additional
    benches from ``Documents/Portal/workstations.json`` on a fresh install.

    The default bench is the invariant that lets single-user Electron installs
    (and any pre-existing CalibrationSession rows created before the
    Workstation model existed) keep working unchanged: every session with
    ``workstation is None`` falls back to ``Workstation.get_default()`` at
    request time.

    The JSON seed is a one-shot bootstrap for multi-bench VM deployments
    that want a reproducible inventory. It only runs when **no non-default
    rows exist**, so admin-driven edits from the Django admin are never
    clobbered on reboot. Missing or malformed seed files are non-fatal —
    the operator can always add workstations through the admin afterwards.

    Expected seed shape::

        {
          "workstations": [
            {"identifier": "bench-1", "name": "Bench 1", "location": "Room A",
             "instrument_addresses": ["GPIB0::22::INSTR"]},
            ...
          ]
        }
    """
    import json
    from django.conf import settings as dj_settings

    try:
        from api.models import Workstation

        Workstation.get_default()

        seed_path = dj_settings.CREDENTIALS_DIR / 'workstations.json'
        if Workstation.objects.filter(is_default=False).exists():
            # Admin-managed data already present — never overwrite.
            return
        if not seed_path.exists():
            return

        try:
            with open(seed_path, 'r', encoding='utf-8') as f:
                payload = json.load(f)
        except Exception as parse_err:
            print(f"WARNING: could not parse {seed_path}: {parse_err}")
            return

        entries = payload.get('workstations', []) if isinstance(payload, dict) else []
        created = 0
        for entry in entries:
            identifier = (entry or {}).get('identifier')
            name = (entry or {}).get('name')
            if not identifier or not name:
                continue
            _, was_created = Workstation.objects.get_or_create(
                identifier=identifier,
                defaults={
                    'name': name,
                    'location': entry.get('location', ''),
                    'instrument_addresses': entry.get('instrument_addresses', []) or [],
                    'notes': entry.get('notes', '') or '',
                    'is_active': bool(entry.get('is_active', True)),
                },
            )
            if was_created:
                created += 1
        if created:
            print(f"Seeded {created} workstation(s) from {seed_path}.")
    except Exception as e:
        # Non-fatal: local Electron installs with workstation=None still work
        # via Workstation.get_default()'s runtime fallback. Log loudly.
        print(f"WARNING: workstation bootstrap failed: {e}")


def _bootstrap_mock_calibration_session():
    """
    When ``MOCK_INSTRUMENTS`` is on and the seeded mock session is missing,
    run the ``seed_mock_calibration_session`` management command once so the
    dev loop has a ready-to-open session. Idempotent on subsequent boots:
    if the session already exists we skip, which preserves any changes made
    through the UI between restarts. Developers can force a refresh with
    ``python manage.py seed_mock_calibration_session``.
    """
    from django.conf import settings

    if not getattr(settings, "MOCK_INSTRUMENTS", False):
        return

    try:
        from api.models import CalibrationSession
        from api.management.commands.seed_mock_calibration_session import (
            MOCK_SESSION_NAME,
        )

        if CalibrationSession.objects.filter(session_name=MOCK_SESSION_NAME).exists():
            print(f"Mock session '{MOCK_SESSION_NAME}' already present. Skipping auto-seed.")
            return

        print(f"MOCK_INSTRUMENTS on and '{MOCK_SESSION_NAME}' missing — seeding now...")
        call_command('seed_mock_calibration_session', verbosity=0)
        print("Mock calibration session seeded.")
    except Exception as e:
        # Non-fatal: the app still boots, the developer just won't have a
        # pre-populated session. Log loudly so the reason is obvious.
        print(f"WARNING: mock calibration session auto-seed failed: {e}")


def main():
    # 1. Initialize Django environment
    os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'ac_shunt.settings')
    
    try:
        django.setup()
    except Exception as e:
        print(f"CRITICAL: Django setup failed: {e}")
        sys.exit(1)

    # 2. Check Database Connection & Run Migrations
    db_conn = connections['default']
    print(f"--- Booting with Database Engine: {db_conn.settings_dict['ENGINE']} ---")
    
    try:
        # Attempt to get a cursor to verify the connection is alive
        db_conn.cursor()
        table_names = db_conn.introspection.table_names()
        
        # Always run migrate on boot. It is idempotent when the DB is already
        # up-to-date (Django checks migration state first), but the check is
        # necessary to pick up new migrations shipped in an update — the
        # previous "skip if django_migrations exists" branch silently left
        # upgraded installs running against a stale schema.
        if 'django_migrations' not in table_names:
            print("First run detected. Running initial migrations...")
        else:
            print("Applying any pending migrations...")
        call_command('migrate', interactive=False)

        # Corrections are now fully database-driven (dated Reports of
        # Calibration managed in-app via the Corrections modal). The old
        # Excel-parse-and-sync step has been removed.

    except Exception as e:
        # The default DB being down at boot is EXACTLY the scenario the outbox
        # is designed to survive — we continue booting so the drainer can
        # replay once it comes back.
        print(f"CRITICAL: Default database initialization failed: {e}")
        print("Continuing boot so the outbox can buffer writes until the server returns.")

    # 2b. Always bootstrap the local outbox — independent of default DB state.
    _bootstrap_outbox_db()

    # 2c. Ensure the "Local Workstation" bench exists and optionally import
    # a seed inventory on a fresh install. Runs after migrations so the
    # Workstation table is guaranteed to exist, and after the outbox so a
    # default-DB outage doesn't stop the bench from being registered.
    try:
        _bootstrap_local_workstation()
    except Exception as e:
        # Defensive catch — the runtime fallback on Workstation.get_default()
        # covers us either way, but we don't want a bootstrap exception to
        # crash the boot sequence.
        print(f"WARNING: _bootstrap_local_workstation raised: {e}")

    # 3b. Auto-seed the mock calibration session when running in mock mode,
    # so `npm run electron:dev:mock` produces a ready-to-use session without
    # the developer having to remember the manual seed command. Only seeds
    # when the session is missing so UI-driven edits made during a dev
    # session survive subsequent boots.
    _bootstrap_mock_calibration_session()

    # 4. Handle Port Conflicts
    port = '8000'
    if is_port_in_use(port):
        print(f"ERROR: Port {port} is already in use. Kill the existing process first.")
        sys.exit(1)

    # 5. Start the Daphne/Django Server
    print(f"Starting Django server on 0.0.0.0:{port}...")
    
    # execute_from_command_line expects a list where the first arg is the script name.
    # --noreload is used to prevent the double-boot behavior in the Electron environment.
    server_args = [sys.argv[0], 'runserver', f'0.0.0.0:{port}', '--noreload']
    execute_from_command_line(server_args)

if __name__ == '__main__':
    main()