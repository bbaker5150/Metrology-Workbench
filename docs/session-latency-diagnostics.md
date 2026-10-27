# Collect slow-session timings

This optional mode measures only GET requests to a session's `test_points/` and
`information/` endpoints. It needs no SQL Server monitoring permissions. It uses
the running application's existing database connection and does not issue extra
diagnostic queries or change endpoint behavior. The existing information endpoint
can initialize missing configuration rows as before.

## Enable

Pull the latest `main` and stop the local backend. In the PowerShell window used
to launch it, set:

```powershell
$env:AC_SHUNT_PROFILE_REQUESTS = "1"
$env:AC_SHUNT_DIAGNOSTICS_DIR = Join-Path $env:TEMP "ac-shunt-latency"
```

Start the backend with your usual command **from that same window**, so it inherits
these variables. Use the updated Python source; an older packaged executable will
not contain this change. No frontend build is needed.

Open a small session once, then the slow session. Wait for requests to finish.
Replay each slow GET individually twice, waiting between requests. In DevTools,
the response's `X-AC-Shunt-Request-ID` matches the diagnostic record. `Server-Timing`
shows `app` (time inside the middleware) and `dbexec` (execute calls only).

## Collect

After reproducing, run this in the same PowerShell window (or another window with
the same `AC_SHUNT_DIAGNOSTICS_DIR` value). It extracts only the new latency records
from the existing rotating logs:

```powershell
$capture = Join-Path $env:TEMP ("ac-shunt-latency-" + (Get-Date -Format "yyyyMMdd-HHmmss") + ".jsonl")
Get-ChildItem -LiteralPath $env:AC_SHUNT_DIAGNOSTICS_DIR -Filter "backend-*.jsonl*" |
    Select-String -SimpleMatch 'request_latency' |
    ForEach-Object { $_.Line } |
    Set-Content -LiteralPath $capture -Encoding utf8
Write-Host "Send this file: $capture"
```

Send that file plus the small/large session IDs and approximate reproduction time.
If it is empty, verify that the restarted backend inherited the environment
variables and that you loaded one of the two target endpoints.

## What it measures (schema version 2)

- App duration, response size, request ID, database vendor (including an unexpected
  SQLite fallback), and whether each connection was already open.
- SQL execute count/time/errors and the most repeated and slowest query templates,
  represented by hashes. Parameters and SQL text are not recorded.
- Direct elapsed time, call count, error count and row count for cursor fetches;
  elapsed time for opening connections, creating cursors and closing cursors.
  Instrumentation is scoped to each request's Django connection objects.

These are elapsed times, not CPU usage or pure SQL Server execution time.
`dbexec` excludes later fetches, connection setup and Python processing; time
outside it is **not automatically Python CPU time**. Driver calls can include
network waits, server work and conversion of returned values. Connection setup
can itself call cursor operations, so do not blindly sum all categories.
Timings cover the synchronous request worker, not background threads. Time before
that worker starts and browser transfer are outside `app`; compare browser timing
and the existing `http_finished` record using the request ID. Streaming bodies are
not measured, although these two endpoints normally render JSON before returning.

Instrumentation adds some overhead. Compare patterns and call counts, and disable
it before comparing final latency with the baseline. Query groups are bounded.
Latency records contain session paths, but no request bodies, SQL text, query
parameters, credentials or measurement values.

Version 1 used cProfile. On the captured Python 3.13 setup it conflicted with
simultaneous requests ("Another profiling tool is already active") and could mix
function timings across threads. Discard its function profiles. Version 2 removes
cProfile entirely, including when a debugger or external profiler is active.
Existing version 1 records may remain in the log; new records have `schema_version: 2`.

## Disable

Stop the backend, run the following in its launch window, then restart normally:

```powershell
Remove-Item Env:AC_SHUNT_PROFILE_REQUESTS -ErrorAction SilentlyContinue
Remove-Item Env:AC_SHUNT_DIAGNOSTICS_DIR -ErrorAction SilentlyContinue
```

The mode is disabled by default. Logs remain in the temporary directory for review.

## Compare the SSMS query through Django and raw ODBC

With the backend's virtual environment active, run from the repository root:

```powershell
python Backend/ac_shunt/manage.py diagnose_sql_fetch --session 100
```

This standalone command needs no frontend and does not depend on the profiling
environment variables. Use the same environment and credentials as the backend.
It skips application startup outbox migration and workstation-claim cleanup,
refuses a SQLite fallback, and only reads the chosen session. Normal settings
startup still checks connectivity.

The command runs the same `SELECT r.*` readings query used in SSMS, with the same
literal session ID, through both Django's cursor and the underlying ODBC cursor
on the same connection. It runs each twice in reversed order, consumes every row
in batches of 100, and reports execution, fetch, close and total times. It does
not change connection options or driver selection. SSMS can still use different
session options and a different client library.

Send the `ac-shunt-sql-comparison-*.json` file whose complete path the command
prints. It is saved under the Windows temporary directory. It contains timings,
row/text-character counts and package/driver versions, with no reading values,
SQL text or connection credentials. Text-character counts are not wire-byte counts.
Four slow trials may take a couple of minutes; progress prints before each one.

If both cursor paths are slow, investigate the ODBC/connection/large-value
retrieval path. If only Django's cursor is slow, focus on its backend wrapper.
If both are fast, compare the actual ORM query and request context next. These
comparisons guide investigation; no single result proves a root cause.

### Compare MARS on and off

When both Django and raw ODBC fetch slowly, isolate Multiple Active Result Sets
(MARS), which mssql-django 1.7.2 enables by default for Microsoft drivers on Windows:

```powershell
python Backend/ac_shunt/manage.py diagnose_sql_fetch --session 100 --compare-mars
```

This runs four raw-ODBC trials in on/off/off/on order using private connections.
Only the MARS connection keyword changes; the driver, authentication, encryption,
backend converters, initialization and query remain the same. It replaces MARS
keywords instead of appending a conflicting duplicate, preserving braced values
such as passwords containing semicolons. It does not edit settings or change the
running application. Each private connection is closed after its trial.

Send the new JSON file printed by the command. A large, repeatable improvement
with MARS off would identify a connection-mode-dependent problem worth addressing;
it would not by itself distinguish a driver bug from a server/network interaction.

## Application MARS setting and speed test

The application now disables MARS by default on its Microsoft ODBC connection.
The controlled workstation test returned the same 24 rows and 2,885,666 text
characters in every trial: fetches took 10.17/13.04 seconds with MARS on and
53.60/50.14 milliseconds with it off. This establishes a MARS-dependent delay
in that environment, not which part of the server/driver/network caused it.

After pulling the change, stop and restart the Django backend completely using
your normal launch command. Keep the frontend running to load the session.
No dependency upgrade or database migration is needed for this change.
The backend startup should report `MSSQL MARS: disabled` and successful MSSQL
connectivity; a SQLite fallback is not a valid comparison.

For a clean speed comparison, remove profiling and any MARS rollback override
in the PowerShell window used to restart the backend:

```powershell
Remove-Item Env:AC_SHUNT_MARS_ENABLED -ErrorAction SilentlyContinue
Remove-Item Env:AC_SHUNT_PROFILE_REQUESTS -ErrorAction SilentlyContinue
```

Open session 100 three times and record the Network timings for `test_points/`
and `information/`. Also exercise normal session navigation and save/reload a
disposable test session to check nested reads and writes. Share the timings and
any errors. The full endpoints do more work than the isolated fetch, so a
50 ms query does not imply a 50 ms page load.

The small custom backend replaces MARS keywords after mssql-django constructs
the connection string, preserving authentication and encryption. Version 1.7.2
otherwise adds a conflicting Windows default. With MARS off, Django buffers
ORM results before yielding them, so nested queries can reuse the connection.
This can increase memory use for large `QuerySet.iterator()` calls. Raw cursor
callers must still finish or close their result before issuing another query.
The adapter preserves repeated `fetchone()` calls without discarding rows.

To restore the previous connection mode, stop the backend, set this variable in
its launch window, and restart:

```powershell
$env:AC_SHUNT_MARS_ENABLED = "1"
```

Remove that variable and restart again to return to MARS off. The standalone
`--compare-mars` diagnostic continues to test private on/off connections in
either application mode.

Related references (similar behavior, not proof of an identical Hyper-V bug):

- [Microsoft's MARS performance guidance for its PHP SQL drivers](https://github.com/microsoft/msphpsql/wiki/Recommendations-for-improving-the-performance-of-PDO_SQLSRV-and-SQLSRV)
- [SqlClient report of MARS-related slowdowns on Linux VMs](https://github.com/dotnet/SqlClient/issues/422)
- [Microsoft's mssql-django connection options and MARS compatibility notes](https://learn.microsoft.com/en-us/sql/connect/python/mssql-django/connection-options?view=sql-server-ver17)
