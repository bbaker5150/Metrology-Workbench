# Diagnose SQL latency without server monitoring permissions

Run this on the workstation where the slowdown occurs, using its normal Python
environment and SQL credentials. No `VIEW SERVER STATE`, `VIEW SERVER PERFORMANCE
STATE`, or `SHOWPLAN` grant is needed. Your ordinary SQL login is sufficient.

From the repository root in PowerShell:

```powershell
.\venv\Scripts\python.exe Backend\ac_shunt\scripts\sql_latency_probe.py --api-url http://127.0.0.1:8000/api/system_info/ --output "$env:TEMP\sql-latency.json"
```

Leave your existing Django backend running for the optional API test. If your
working Python interpreter has another location, use that interpreter instead.
The standalone probe requires `pyodbc` and the installed Microsoft ODBC Driver
17 or 18 already used by the app. It does not import Django settings, start the
server, run migrations, replay the outbox, or change the app's configuration.

The probe finds `SQLHOST.txt`, `SQLNAME2.txt`, `SQLUSER.txt`, and `SQLPASS.txt`
using the same directory preference as settings.py. Use `--credentials-dir
"C:\path\to\Portal"` if needed. Never put passwords on the command line. SQL
credentials, connection strings, response bodies, and raw driver errors are
excluded from the output. Server/database names and timestamps are included.

## Measurements

| Stage | What it measures | Interpretation |
| --- | --- | --- |
| `fresh_connect` | Opening a new ODBC connection, with pooling disabled in the probe only | Includes name resolution, transport/TLS, login and driver setup; cannot distinguish these individually |
| `first_select_1` | First tiny query after each fresh connection | Detects first-use delay |
| `reused_select_1` | Ten tiny queries on the same open connection | Client-to-SQL round trip plus server handling and client scheduling |
| `fetch_256k` | Generate and fetch a 256 KiB string, three times | Result transfer plus SQL generation/driver work; not a pure bandwidth test |
| `local_api_get` | Three optional GETs to the existing local API | Full client request time; `headers_ms` measures time until response headers arrive |

The probe performs three fresh connections by default and uses a 10-second
connection/query timeout. Change `--timeout` up to 30 seconds for known slower
operations. There are no retries hidden by the probe. The ODBC driver can still
perform its own connection handling. These are sequential tests, not a load test
or a continuous capture. For intermittent problems, repeat the probe during a
slow period and a normal period with different output filenames.

All SQL queries are synthetic SELECTs and do not touch application tables.
Fast results do not rule out application-query blocking, bad execution plans,
data-volume effects, or intermittent contention. Slow results do not by
themselves prove a network or Hyper-V problem. Fresh-login tests intentionally
do not represent pooled connection acquisition in the running Django process.

## Compare with the slow application operation

1. Check `database_type` in the system-info API samples: `mssql` confirms the
   running app selected MSSQL; `sqlite3` means it selected the local fallback.
   This endpoint also performs an occasionally cached database health check,
   so it is not a database-free Django baseline.
2. In the browser's Network panel, reproduce one slow operation and find the
   slow Fetch/XHR request. Note its method, URL, duration, response size and UTC
   time. For a read-only GET, rerun this tool with that local URL as `--api-url`
   (quote the URL if it includes query parameters). The tool issues GETs only.
   Only choose an endpoint you know is read-only; it will execute three times.
   Redirects are not followed. Browser authentication/cookies are not copied;
   a redirect or 401/403 requires timing
   the authenticated request in the browser instead. Do not copy a write or
   instrument-control operation into the probe.
3. Existing `http_finished` records in the backend diagnostic JSONL files have
   the request path, status and `duration_ms`. They are under the configured
   Portal/diagnostics directory (or `AC_SHUNT_DIAGNOSTICS_DIR`). Compare the
   same request and timestamp; an unrelated system-info call is not a substitute.
4. Connection slow but reused queries fast: investigate login/DNS/TLS/connection
   setup. Reused tiny queries also slow: investigate shared SQL responsiveness
   and connectivity. Synthetic tests fast but the real API slow: measure that
   endpoint's query count, execution/fetch time, and Python processing next.

Without monitoring rights you can still measure your own permitted SQL in SSMS:

```sql
SET STATISTICS IO ON;
SET STATISTICS TIME ON;
-- Run the exact read-only application query, with the same parameters, here.
SET STATISTICS TIME OFF;
SET STATISTICS IO OFF;
```

Read the Messages tab. Do not infer network timing from these server statistics.
Compare the same query/parameters/session options and workload. An execution
plan may require extra permissions; these statistics do not require SHOWPLAN.
No cache clearing, index changes, or SQL Server reconfiguration is required.

Reference: [Microsoft SET STATISTICS TIME permissions](https://learn.microsoft.com/en-us/sql/t-sql/statements/set-statistics-time-transact-sql#permissions).
