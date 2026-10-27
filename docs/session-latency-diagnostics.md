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
