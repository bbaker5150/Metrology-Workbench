import os
import sys
import pyodbc
from pathlib import Path

# Build paths inside the project like this: BASE_DIR / 'subdir'.
BASE_DIR = Path(__file__).resolve().parent.parent

# ---------------------------------------------------------
# 1. RESOURCE RESOLUTION HELPER
# ---------------------------------------------------------
def get_resource_path(relative_path):
    """
    Get absolute path to resource, works for dev and for PyInstaller.
    PyInstaller 6+ maps '.' to the '_internal' folder in COLLECT mode.
    """
    if hasattr(sys, '_MEIPASS'):
        # In production (bundled EXE), sys._MEIPASS points to the _internal folder
        return os.path.join(sys._MEIPASS, relative_path)
    # In development, look relative to the BASE_DIR
    return os.path.join(BASE_DIR, relative_path)

# Use these variables in your views/logic to access your data files
UNCERTAINTY_FILE = get_resource_path("uncertainty_data.json")

# ---------------------------------------------------------
# 2. DATABASE CONFIGURATION & VERBOSE DEBUGGING
# ---------------------------------------------------------
def _resolve_portal_dir() -> Path:
    """
    Portal data (SQL creds + local SQLite) lives in a user-writable folder.
    Prefer OneDrive\\Documents\\Portal when that tree exists (common on test machines),
    else ~/Documents/Portal. Override with AC_SHUNT_PORTAL_DIR for a fixed path.
    """
    override = os.environ.get("AC_SHUNT_PORTAL_DIR", "").strip()
    if override:
        return Path(override).expanduser().resolve()
    home = Path.home()
    # Windows: match OneDrive - Personal, OneDrive - Work, or plain OneDrive
    for one_drive_root in sorted(home.glob("OneDrive*")):
        docs = one_drive_root / "Documents"
        if docs.is_dir():
            return docs / "Portal"
    return home / "Documents" / "Portal"


CREDENTIALS_DIR = _resolve_portal_dir()
CREDENTIALS_DIR.mkdir(parents=True, exist_ok=True)

def get_db_cred(filename):
    """Helper to safely read credential files and strip whitespace."""
    filepath = CREDENTIALS_DIR / filename
    try:
        if filepath.exists():
            with open(filepath, 'r') as f:
                return f.read().strip()
    except Exception as e:
        print(f"Warning: Could not read {filename}: {e}")
    return None

print("\n" + "="*50)
print("DATABASE DEBUGGING MODE")
print(f"Current OS User: {os.getlogin() if hasattr(os, 'getlogin') else os.environ.get('USERNAME')}")
print(f"Credentials Directory: {CREDENTIALS_DIR}")

MSSQL_USER = get_db_cred("SQLUSER.txt")
MSSQL_PASS = get_db_cred("SQLPASS.txt")
MSSQL_HOST = get_db_cred("SQLHOST.txt")
MSSQL_NAME = get_db_cred("SQLNAME2.txt")

print(f"Found Host: {MSSQL_HOST}")
print(f"Found User: {MSSQL_USER}")
print(f"Found DB Name: {MSSQL_NAME}")
print(f"Found Password: {'***' if MSSQL_PASS else 'NONE'}")
print("="*50 + "\n")

IS_BUILDING = 'PyInstaller' in sys.modules or os.environ.get('PYINSTALLER_BUILD') == '1'
USE_MSSQL = False

# Global driver variables to be used in DATABASES dictionary later
active_driver = None
trust_cert_flag = ""

if not IS_BUILDING and all([MSSQL_USER, MSSQL_PASS, MSSQL_HOST, MSSQL_NAME]):
    # Dynamically detect available ODBC drivers
    available_drivers = pyodbc.drivers()
    
    if 'ODBC Driver 18 for SQL Server' in available_drivers:
        active_driver = 'ODBC Driver 18 for SQL Server'
        trust_cert_flag = "TrustServerCertificate=yes;"
    elif 'ODBC Driver 17 for SQL Server' in available_drivers:
        active_driver = 'ODBC Driver 17 for SQL Server'
        trust_cert_flag = "" # Driver 17 doesn't strictly need it
    
    if active_driver:
        try:
            # Constructing the connection string dynamically based on the detected driver
            conn_str = (
                f"DRIVER={{{active_driver}}};"
                f"SERVER={MSSQL_HOST};"
                f"DATABASE={MSSQL_NAME};"
                f"UID={MSSQL_USER};"
                f"PWD={MSSQL_PASS};"
                f"LoginTimeout=10;"
                f"{trust_cert_flag}" 
            )
            
            print(f"DEBUG: Attempting pyodbc.connect using {active_driver} to SERVER={MSSQL_HOST}...")
            # Diagnostic test connection
            test_conn = pyodbc.connect(conn_str, timeout=10)
            test_conn.close()
            USE_MSSQL = True
            print("SUCCESS: MSSQL Connection test passed.")
        except Exception as e:
            print(f"CRITICAL ERROR during MSSQL connection test:")
            print(f"Error Type: {type(e).__name__}")
            print(f"Error Details: {e}")
            print("Falling back to local SQLite database.")
    else:
        print("CRITICAL ERROR: Neither ODBC Driver 17 nor 18 found on this machine.")
        print("Falling back to local SQLite database.")

elif IS_BUILDING:
    print("SKIPPING MSSQL: Build Process Detected.")
else:
    print("SKIPPING MSSQL: Missing credentials files in Documents/Portal.")

if USE_MSSQL:
    db_options = {
        'driver': active_driver,
        'connection_timeout': 10,
    }
    
    # Only append the extra parameter if we are using Driver 18
    if trust_cert_flag:
        db_options['extra_params'] = 'TrustServerCertificate=yes'

    DATABASES = {
        'default': {
            'ENGINE': 'mssql',
            'NAME': MSSQL_NAME,
            'USER': MSSQL_USER,
            'PASSWORD': MSSQL_PASS,
            'HOST': MSSQL_HOST,
            'PORT': '',
            'OPTIONS': db_options,
        }
    }
else:
    # Use the writable user directory to avoid permission issues in C:\Program Files\
    DATABASES = {
        'default': {
            'ENGINE': 'django.db.backends.sqlite3',
            # str() ensures sqlite3 opens the file reliably on all Django/sqlite builds
            'NAME': str(CREDENTIALS_DIR / 'ac_shunt_local.db.sqlite3'),
        }
    }

# ---------------------------------------------------------
# 2b. LOCAL WRITE OUTBOX (durability during MSSQL outages)
# ---------------------------------------------------------
# A dedicated SQLite alias that is NEVER the default. Every stage save from a
# calibration run is first persisted here, then attempted against `default`.
# If `default` is unreachable (typical MSSQL outage), the row stays pending
# and a background drainer replays it when the server comes back. The file
# lives in the writable Portal dir so it survives process restarts.
OUTBOX_DB_PATH = CREDENTIALS_DIR / 'ac_shunt_outbox.sqlite3'
DATABASES['outbox'] = {
    'ENGINE': 'django.db.backends.sqlite3',
    'NAME': str(OUTBOX_DB_PATH),
}

# ---------------------------------------------------------
# 2c. PER-MODULE DATABASES (Metrology Workbench modular shell)
# ---------------------------------------------------------
# Each workbench module backend gets its own SQLite database so a module's
# tables stay isolated from the AC-Shunt (`api`) tables on `default` and from
# each other. WorkbenchRouter (api/db_routers.py) pins each mapped app's models
# (reads/writes/migrations) to its alias via APP_DB_MAP. The `api` app is NOT
# mapped, so the AC-Shunt schema/migration history on `default` is untouched.
# These files live in the writable Portal dir, like the outbox.
DATABASES['uncertainty'] = {
    'ENGINE': 'django.db.backends.sqlite3',
    'NAME': str(CREDENTIALS_DIR / 'uncertainty.sqlite3'),
}
DATABASES['reports'] = {
    'ENGINE': 'django.db.backends.sqlite3',
    'NAME': str(CREDENTIALS_DIR / 'reports.sqlite3'),
}

DATABASE_ROUTERS = ['api.db_routers.WorkbenchRouter']

# ---------------------------------------------------------
# 3. STANDARD DJANGO SETTINGS
# ---------------------------------------------------------
SECRET_KEY = 'django-insecure-*#_^+sice+xmm)=9s@(7b%fz#nmtmim+=rap_6g1c_-az5wn_g'
DEBUG = True
ALLOWED_HOSTS = ['10.206.104.144', '127.0.0.1', 'localhost', '*']

INSTALLED_APPS = [
    'daphne',
    # Required so ``get_channel_layer()`` and WebSocket consumers (including
    # DbHealthConsumer) initialize correctly. Without this, handshakes can
    # fail with HTTP 500 even when CHANNEL_LAYERS is set.
    'channels',
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    'rest_framework',
    'corsheaders',
    'api',
    # Workbench module backends (mirror the frontend src/modules/*). Each is a
    # self-contained Django app; see docs/adding-a-module.md.
    'uncertainty',
    'reports',
]

MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'corsheaders.middleware.CorsMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

ROOT_URLCONF = 'ac_shunt.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.debug',
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'ac_shunt.wsgi.application'
ASGI_APPLICATION = 'ac_shunt.asgi.application'

CORS_ALLOW_ALL_ORIGINS = True

# ---------------------------------------------------------
# 4. MOCK MODE (UI development without lab hardware)
# ---------------------------------------------------------
# When MOCK_INSTRUMENTS is truthy, the instrument discovery endpoint and
# the per-instrument status WebSocket short-circuit their pyvisa calls and
# return realistic fixture data instead. This lets the UI be developed
# and visually QA'd from a workstation without any lab equipment attached.
#
# Toggle by setting an environment variable before launching the Django
# server, e.g. (PowerShell):  $env:MOCK_INSTRUMENTS = "1"; python manage.py runserver
MOCK_INSTRUMENTS = os.environ.get("MOCK_INSTRUMENTS", "").strip().lower() in {
    "1", "true", "yes", "on"
}
if MOCK_INSTRUMENTS:
    print("MOCK_INSTRUMENTS is ON - discovery and status WS will return mock fixtures.")

AUTH_PASSWORD_VALIDATORS = [{'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator'}]
LANGUAGE_CODE = 'en-us'
TIME_ZONE = 'UTC'
USE_I18N = True
USE_TZ = True
STATIC_URL = 'static/'
DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'
# ---------------------------------------------------------
# Channel layer (Phase 5b)
# ---------------------------------------------------------
# When REDIS_URL is set, route all Channels group_send / group_add traffic
# through Redis so multiple Daphne workers (and eventually multiple VMs)
# share broadcast state. When it's unset, fall back to the in-memory layer
# so local dev without Redis keeps working exactly as before.
#
# Examples:
#   PowerShell:  $env:REDIS_URL = "redis://127.0.0.1:6379/0"
#   bash/zsh:    export REDIS_URL="redis://127.0.0.1:6379/0"
#
# We do a synchronous ping on boot so operators see a single, obvious line
# in the server log confirming which backend is active. We do NOT silently
# fall back if the ping fails -- if you set REDIS_URL, we honor it, and any
# subsequent broadcast errors will be loud instead of misleadingly muted.
REDIS_URL = os.environ.get("REDIS_URL", "").strip()

if REDIS_URL:
    CHANNEL_LAYERS = {
        "default": {
            "BACKEND": "channels_redis.core.RedisChannelLayer",
            "CONFIG": {
                "hosts": [REDIS_URL],
                # Keep the default capacity/expiry; tune later if we see
                # dropped broadcasts under load.
            },
        }
    }
    try:
        import redis as _redis_probe  # type: ignore

        _probe_client = _redis_probe.Redis.from_url(
            REDIS_URL, socket_connect_timeout=2, socket_timeout=2
        )
        _probe_client.ping()
        print(f"CHANNEL LAYER: Redis reachable at {REDIS_URL} -- using RedisChannelLayer.")
    except Exception as _exc:  # noqa: BLE001 -- boot-time diagnostic
        print(
            "CHANNEL LAYER WARNING: REDIS_URL is set to "
            f"{REDIS_URL!r} but the ping failed ({_exc!r}). "
            "WebSocket broadcasts will error until Redis is reachable."
        )
else:
    CHANNEL_LAYERS = {"default": {"BACKEND": "channels.layers.InMemoryChannelLayer"}}
    print(
        "CHANNEL LAYER: REDIS_URL not set -- using InMemoryChannelLayer "
        "(single-process only; fine for local dev, not safe for multi-worker)."
    )

# --- Calibration supervisor settings ---
# Number of seconds a SessionSupervisor waits for the host WebSocket to
# reconnect after it goes away mid-run before auto-stopping the
# calibration. Keep generous enough to cover a browser tab refresh or a
# brief network blip but short enough that a genuinely abandoned run
# doesn't tie up instrumentation forever. See
# ``api/session_supervisor.py::SessionSupervisor`` for the full
# reconnect semantics.
CALIBRATION_GRACE_WINDOW_SECONDS = 30

# Per-bench calibration run lock (api.models.CalibrationRunLock). A live run
# refreshes its lock on the host heartbeat (~25s); a lock whose heartbeat is
# older than this many seconds is treated as abandoned (crashed worker) and may
# be taken over by a new run on the same bench. Keep this comfortably larger
# than both the heartbeat interval and CALIBRATION_GRACE_WINDOW_SECONDS so a
# brief host disconnect mid-run never lets another session steal the bench.
CALIBRATION_RUNLOCK_STALE_SECONDS = 90

# Stable physical-host identity used when a local/Electron calibration session
# has no explicit Workstation assignment. Hostname is the default; deployments
# with cloned hostnames can override it per machine.
AC_SHUNT_WORKSTATION_ID = os.environ.get('AC_SHUNT_WORKSTATION_ID', '').strip()

# ---------------------------------------------------------
# 5. LOGGING CONFIGURATION
# ---------------------------------------------------------
LOGGING = {
    'version': 1,
    'disable_existing_loggers': False,
    'formatters': {
        'verbose': {
            'format': '{levelname} {asctime} {module} - {message}',
            'style': '{',
        },
    },
    'handlers': {
        'console': {
            'level': 'INFO',
            'class': 'logging.StreamHandler',
            'formatter': 'verbose',
        },
    },
    'loggers': {
        # This catches all loggers (including your consumers and outbox)
        '': {
            'handlers': ['console'],
            'level': 'INFO',
            'propagate': True,
        },
        # Keeps Django's internal HTTP request logs from getting too noisy
        'django.server': {
            'handlers': ['console'],
            'level': 'INFO',
            'propagate': False,
        },
    },
}
