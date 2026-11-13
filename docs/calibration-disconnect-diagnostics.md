# Calibration disconnect diagnostics

The client preserves an observer's selected session in tab-scoped
browser storage without an expiration. A readings reconnect remains an observer;
it cannot start or stop hardware. Explicitly leaving observer mode clears the
saved selection. Host-sync retry timers and readings watchdogs are cancelled
when their connection scope is disposed.

There is no observer idle timeout in the current client. Capture logs before
attributing an interruption to a reload, network loss, process restart, or
overlapping host reconnections. A network scan alone is not evidence of a
process restart; transport and lifecycle records establish which process and
connection changed first.

## Files to collect after the next incident

On the backend machine, copy the `diagnostics` folder beneath its Portal data
directory, normally `OneDrive/Documents/Portal/diagnostics` or
`Documents/Portal/diagnostics`. `AC_SHUNT_DIAGNOSTICS_DIR` overrides this location;
an inaccessible folder falls back to the system temporary directory under
`ac-shunt-diagnostics`.

- `backend-<pid>.jsonl` and its numbered rotations: UTC timestamps, process and
  boot IDs, uptime, server logs, request path/status/peer/user agent, WebSocket
  connections/disconnect codes, frontend attach/detach/reload/visibility/error
  events, and an independent backend heartbeat every minute. Each process has a
  separate file, with five 10 MB rotations. Copy files for both the old and new
  process if a restart occurred.
- `fault-<pid>.log`: Python/native crash tracebacks when the runtime can capture
  them. A forcibly killed process or power loss may leave no exit record.
- Electron's `diagnostics/electron-lifecycle.jsonl` in its user-data directory:
  application start/quit, renderer failures, navigation, bundled backend
  child-process exits, and memory samples. Preserve both this file and its
  `.previous` rotation; the active file rotates at 5 MB. Development backends launched
  outside Electron are covered by backend logs, not Electron child-process logs.

Request bodies, query strings, cookies, authorization headers and instrument
readings are excluded from transport diagnostics. Frontend events accept only a
small whitelist with bounded values. Instrument shutdown/grace safeguards remain
in place; diagnostics do not issue hardware commands or restart the server.

## Electron memory and renderer failures

Standard Electron launches enable memory diagnostics automatically. The startup
record includes `diagnosticsVersion: 2` and the actual Electron/Chrome/Node
versions. Restart the normal Electron launch command between runs when loading
updated code; the startup console prints the actual diagnostics location.

The main process records `memory_sample` about once a minute, including process
and system memory in **KiB**, renderer PID, and whether DevTools is open.
`renderer_heap_sample` uses explicitly named **byte** fields (`usedBytes`,
`totalBytes`, `limitBytes`). Compare units before combining or charting samples.
The implementation is `Frontend/workbench/public/memory-diagnostics.cjs`.

Only one renderer heap probe may be outstanding. An unresponsive renderer can
therefore stop returning heap samples while main-process OS samples continue.
A missing heap sample alone does not prove a memory leak. Closing the window
stops sampling and discards late results. Samples contain numeric totals, not
session contents, readings, credentials, console objects, or heap snapshots.

DevTools does not open automatically during a normal development launch. Use
F12/Inspect Element, or set `ELECTRON_OPEN_DEVTOOLS=1` when intentionally
investigating. Record whether it was open when comparing long-running samples.

After a renderer failure, preserve the active and previous Electron logs along
with backend logs and fault logs. Inspect the `renderer_gone` reason/exit code,
heap trend, process-memory trend, and available system memory. These distinguish
renderer-heap growth from native/process growth or system-wide memory pressure.
Correlate them with backend heartbeat and host-loss messages to determine which
process stopped first. Overlapping network probes establish timing, not the
cause of an out-of-memory failure.

Diagnostics do not suppress host-loss shutdown safeguards or automatically
restart or resume a calibration. The isolated
`Frontend/workbench/scripts/smoke-electron-memory.cjs`
check exercises Electron's memory APIs without contacting instruments; it is
not a substitute for a long-duration run on the actual bench.

## Reading the evidence

1. Compare boot IDs/PIDs around the incident. A new boot record proves a backend
   process started; frontend `view_detached` alone does not.
2. Compare request activity from each peer with socket losses and supervisor
   grace-period messages. Repeated unusual paths or 404s provide evidence of HTTP
   probing, but temporal proximity alone does not establish causation.
3. `pagehide`, navigation or renderer failure followed by detach suggests a
   frontend interruption. A backend heartbeat continuing through the event rules
   out a backend restart during that interval.
4. If an old process has no exit/exception, correlate its final UTC timestamp with
   Windows Event Viewer (Application/System), endpoint-protection logs, scheduled
   tasks, and machine suspend/reboot records. Raw TCP probes rejected before ASGI
   are outside application request logging.

Focused regression coverage uses simulated transports, a six-hour fake-clock
observer regression, and an isolated in-memory Django configuration. This checks
connection behavior; it does not establish the cause of a field incident or
substitute for a physical overnight run.

Deploy backend changes between runs so logging is active before the next
overnight observation. Both `npm run electron:dev` and
`npm run electron:dev:remote` (including their mock variants) enable diagnostics
automatically and launch the backend with `--noreload`. The packaged backend
also uses `--noreload`. The terminal prints `Backend diagnostics active:` and
`Electron diagnostics active:` with the actual log paths; no extra flag or UI
setting is needed. Restart the full launch command between runs to load changed
code. The frontend uses Vite during development, so avoid source edits
during an unattended run. Ordinary browser `dev` commands retain backend reloads.
After an incident, copy the log folder before investigating
or starting more runs. Use the recorded cause to address the specific source
(frontend reload, network loss, OS/service termination, or host-role overlap).
