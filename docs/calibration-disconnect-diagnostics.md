# Calibration disconnect diagnostics

The September 16 changes preserve an observer's selected session in tab-scoped
browser storage without an expiration. A readings reconnect remains an observer;
it cannot start or stop hardware. Explicitly leaving observer mode clears the
saved selection. Host-sync retry timers and readings watchdogs are cancelled
when their connection scope is disposed.

There is no observer idle timeout in the current client. A component remount or
page reload previously lost observation state. The exact trigger for the reported
overnight interruption is still unknown. A network scan alone is not evidence of
a process restart. Earlier isolated tests also reproduced a separate host reconnect
overlap race: a replacement socket can be downgraded while its previous socket is
still registered. The new transport/lifecycle records can distinguish that case.

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
  application start/quit, renderer failures, navigation, and bundled backend
  child-process exits. This file rotates at 5 MB. Development backends launched
  outside Electron are covered by backend logs, not Electron child-process logs.

Request bodies, query strings, cookies, authorization headers and instrument
readings are excluded from transport diagnostics. Frontend events accept only a
small whitelist with bounded values. Instrument shutdown/grace safeguards remain
in place; diagnostics do not issue hardware commands or restart the server.

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

Validation uses simulated transports, a six-hour fake-clock observer regression,
and an isolated in-memory Django configuration. It does not establish the cause
of the original incident or substitute for a physical overnight run.

Deploy the updated backend between runs so logging is active before the next
overnight observation. Both `npm run electron:dev` and
`npm run electron:dev:remote` (including their mock variants) enable diagnostics
automatically and launch the backend with `--noreload`. The packaged backend
also uses `--noreload`. The terminal prints `Backend diagnostics active:` and
`Electron diagnostics active:` with the actual log paths; no extra flag or UI
setting is needed. Restart the full launch command between runs to load these
changes. The frontend still uses Vite during development, so avoid source edits
during an unattended run. Ordinary browser `dev` commands retain backend reloads.
After an incident, copy the log folder before investigating
or starting more runs. Use the recorded cause to address the specific source
(frontend reload, network loss, OS/service termination, or host-role overlap).
