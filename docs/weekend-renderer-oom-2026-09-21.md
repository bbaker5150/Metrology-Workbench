# Weekend run interruption: evidence and follow-up

## Established sequence

Source: the supplied Diagnostics.zip, reviewed September 21, 2026. Times below
are UTC; Pacific equivalents use PDT (UTC−7). This report does not assume the
bench computer uses Pacific time.

| UTC, September 19 | PDT | Evidence |
| --- | --- | --- |
| 07:46:34–07:57:47 | 00:46:34–00:57:47 | Backend PID 16644 logged 925 HTTP requests from a nonlocal scan source in this interval. Probes included unrelated product pages and Nessus-style paths. These requests overlapped the crash. |
| 07:55:02 | 00:55:02 | Outbox row 36644 was written to MSSQL and marked DONE. |
| 07:55:33.430–.442 | 00:55:33 | The local Electron client's switch, database-health, readings/session 89, and host-sync WebSockets disconnected together (code 1001). Supervisor 89 armed its 30-second host-loss grace timer. |
| 07:55:33.528 | 00:55:33 | `electron-lifecycle.jsonl`: PID 28808 emitted `renderer_gone`, `reason: "oom"`, `exitCode: -536870904`. |
| 07:56:03.433 | 00:56:03 | Supervisor 89: grace expired without a host reconnect; run auto-stopped. |

The renderer had been open about 35 hours 46 minutes. Its runtime identified
itself as Electron 39.2.7 / Chrome 142. The same backend process and boot ID
continued emitting heartbeats through September 21 at 10:59:52 UTC. No native
Python fault was recorded. This was a renderer out-of-memory failure followed
by the intended backend host-loss stop, rather than a backend process crash.

## What the scan does and does not establish

Scan traffic genuinely overlaps the failure. Sampled scan HTTP requests in the
above interval completed in at most 94 ms. Malformed Host and unsupported
WebSocket-route probes produced request-level errors; the backend continued
servicing traffic. Similar probes occurred on preceding and following nights.

The archive has no renderer heap history, OS free-memory history, heap dump,
DevTools-open state, or frontend development-server scan logs. It therefore
cannot identify the allocation that exhausted memory or prove the scan caused
the exhaustion. It does not establish an antivirus process, scanner identity,
memory leak in a particular component, or system-wide memory shortage. Do not
disable security scanning on the strength of timing alone.

## Changes included

- Every standard Electron launch now records runtime versions and samples main,
  renderer and other Electron process memory plus system free memory once a
  minute in the existing rotating lifecycle log. OS figures are KiB; renderer
  heap figures are explicitly named in bytes. Sampling stores no reading data,
  session content, console objects or heap snapshots.
- At most one renderer heap probe can be outstanding. An unresponsive renderer
  cannot accumulate probes; OS samples continue independently. Closing the
  window stops sampling and discards late results.
- DevTools no longer opens automatically during a standard development run.
  This avoids unnecessary diagnostic retention/overhead during unattended work;
  it is a precaution, not an established root-cause fix. F12/Inspect Element
  still work, or set `ELECTRON_OPEN_DEVTOOLS=1` when intentionally debugging.
- The backend's 30-second host-loss safety stop is unchanged. There is no
  automatic restart, resumption of measurement, or suppression of the stop.

## Next long run

After pulling this commit, restart Electron using the usual `npm run
electron:dev` or `npm run electron:dev:remote` command. No separate diagnostic
switch is needed. Preserve `electron-lifecycle.jsonl` **and** its `.previous`
rotation alongside the backend JSONL/rotated JSONL and fault logs. The startup
console prints the diagnostics directory. Confirm the startup record says
`diagnosticsVersion: 2` and contains the actual Electron runtime version.

If another failure occurs, these samples distinguish growing renderer heap,
growing native/process memory, and falling system free memory. They support a
targeted reproduction rather than another timing-only hypothesis. A short
automated smoke is not a substitute for a weekend run on bench hardware.

## Verification

The regression suite exercises periodic sampling, timer cleanup, late results,
failed probes, and a renderer probe stalled for a simulated minute while OS
sampling continues. `scripts/smoke-electron-memory.cjs` exercises the installed
Electron's actual process, system and heap APIs in an isolated hidden window;
it never connects to instruments or starts a calibration.
