# Collect a slow-session profile

This optional mode profiles only GET requests to a session's `test_points/` and
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

## What it measures

- App duration, response size, request ID, database vendor (including an unexpected
  SQLite fallback), and whether each connection was already open.
- SQL execute count/time/errors and the most repeated and slowest query templates,
  represented by hashes. Parameters and SQL text are not recorded.
- Function call counts, self time and cumulative time, including connection/fetch
  functions, serializer work, pair analytics and JSON rendering when encountered.

Function timings are elapsed time, not CPU usage. Cumulative times overlap: do not
add them together or add them to SQL timing. `dbexec` excludes later fetches,
connection setup and Python processing; time outside it is **not automatically
Python CPU time**. Driver execution can itself include network waits or fetching.
Profiles cover the synchronous request worker, not background threads. Time before
that worker starts and browser transfer are outside `app`; compare browser timing
and the existing `http_finished` record using the request ID. Streaming bodies are
not profiled, although these two endpoints normally render JSON before returning.

Profiling adds overhead. Compare patterns and call counts, and disable it before
comparing final latency with the baseline. A debugger's existing profiler is left
intact; those records say `profile_skipped`. Query groups and profile lists are
bounded. Logs contain session paths and code function names, but no request bodies,
SQL text, query parameters, credentials or measurement values in latency records.

## Disable

Stop the backend, run the following in its launch window, then restart normally:

```powershell
Remove-Item Env:AC_SHUNT_PROFILE_REQUESTS -ErrorAction SilentlyContinue
Remove-Item Env:AC_SHUNT_DIAGNOSTICS_DIR -ErrorAction SilentlyContinue
```

The mode is disabled by default. Logs remain in the temporary directory for review.
