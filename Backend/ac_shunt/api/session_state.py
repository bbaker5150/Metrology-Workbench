"""Process-local shared-state accessor layer.

All mutable module-level dicts that used to live in ``api.consumers`` are
consolidated here. Each public function is a thin wrapper over an
underlying dict, which gives us three things the ad-hoc globals couldn't:

1. A single surface to later plug in locking or instrumentation.
2. A clean seam for Phase 5 — swap the backing storage to Redis by
   re-implementing this module without touching any callsite.
3. A test surface (:func:`reset_for_tests`) that doesn't require
   reaching into consumer internals.

Four storage concerns live here:

1. **Host active sessions** (per-host ``channel_name`` → ``session_id``).
   Superseded the single-valued ``HOST_ACTIVE_SESSION_ID`` global that
   Phase 3 removed; the dict form is what lets multiple hosts run
   parallel calibrations on different benches.
2. **Connected viewers** — presence registry driving the host-side
   "N observers" pill. Populated on connect, upgraded on identify,
   pruned on disconnect.
3. **Live session state** — authoritative snapshot of the live-reading
   payload the host has broadcast so a remote joining mid-run can
   rehydrate without waiting for the next tick.
4. **Workstation claims** — hardware-lock registry. Writes are
   mirrored into the :class:`~api.models.WorkstationClaim` DB table
   (Phase 5a) so the admin and any future cross-process worker can
   observe live locks. The in-memory dict stays as the wire-shape
   source-of-truth (IP-keyed broadcast payload) and as a hot cache
   for the snapshot path so the per-frame broadcast never issues a
   query. The DB is authoritative for durability / crash recovery;
   the dict is authoritative for the wire.

Scope is deliberately limited to storage access. Business logic
(deciding when to broadcast, filtering roles, enforcing lock
ownership) stays in the consumers — that separation is what makes the
eventual Redis swap a drop-in replacement.
"""
from __future__ import annotations

import re
from typing import Any, Optional

from django.conf import settings
from django.db import IntegrityError, transaction
from django.utils import timezone


# ---------------------------------------------------------------------------
# Host active sessions
# ---------------------------------------------------------------------------
# Keyed by the ``HostSyncConsumer`` ``channel_name`` of each currently-
# connected host socket. Value is the ``session_id`` that host most recently
# asserted via ``set_session`` (``None`` means the host hasn't picked a run).
_HOST_ACTIVE_SESSIONS: dict[str, Optional[int]] = {}


def set_host_session(channel_name: str, session_id: Optional[int]) -> None:
    """Record or update a host's currently-selected session."""
    _HOST_ACTIVE_SESSIONS[channel_name] = session_id


def clear_host_session(channel_name: str) -> Optional[int]:
    """Drop a host's entry (typically on disconnect). Returns prior value."""
    return _HOST_ACTIVE_SESSIONS.pop(channel_name, None)


def host_sessions_snapshot() -> dict[str, Optional[int]]:
    """Return an immutable copy of the ``channel_name → session_id`` map."""
    return dict(_HOST_ACTIVE_SESSIONS)


def get_host_session(channel_name: str) -> Optional[int]:
    """Return the session_id (or ``None``) a given host channel is on."""
    return _HOST_ACTIVE_SESSIONS.get(channel_name)


def legacy_session_id() -> Optional[int]:
    """Pick one session_id to serve the legacy scalar ``session_changed`` wire.

    The single-host Electron frontend expects a scalar ``session_id`` on
    the ``session_changed`` message. With multiple hosts there is no
    single answer, so we return the earliest-connected host's active
    session — deterministic per-process, and collapses to the only entry
    in single-host installs, which is the overwhelmingly common case.
    Sophisticated clients should consume the richer
    ``active_sessions`` map instead.
    """
    if not _HOST_ACTIVE_SESSIONS:
        return None
    return next(iter(_HOST_ACTIVE_SESSIONS.values()))


# ---------------------------------------------------------------------------
# Connected viewers (presence registry)
# ---------------------------------------------------------------------------
# Keyed by ``channel_name``. Each entry captures whoever currently holds a
# ``HostSyncConsumer`` socket. Populated on connect, upgraded on identify, and
# pruned on disconnect. Drives the host-side "N observers" pill: whenever
# the registry changes we push the subset of remote-role entries to every
# host-role channel.
_CONNECTED_VIEWERS: dict[str, dict] = {}


def register_viewer(
    channel_name: str,
    *,
    ip: str,
    connected_at: float,
    role: str = 'unknown',
) -> None:
    """Insert a fresh presence entry. Role starts ``unknown`` until identify."""
    _CONNECTED_VIEWERS[channel_name] = {
        'role': role,
        'ip': ip,
        'connected_at': connected_at,
    }


def update_viewer_role(channel_name: str, role: str) -> bool:
    """Promote an existing entry to ``host`` or ``remote``.

    Returns ``False`` if the socket was already gone (race with
    disconnect) so the caller can skip the follow-up broadcast.
    """
    entry = _CONNECTED_VIEWERS.get(channel_name)
    if entry is None:
        return False
    entry['role'] = role
    return True


def get_viewer(channel_name: str) -> Optional[dict]:
    """Return the presence entry (or ``None``) for a given socket."""
    return _CONNECTED_VIEWERS.get(channel_name)


def unregister_viewer(channel_name: str) -> bool:
    """Drop a presence entry. Returns ``True`` if something was removed."""
    return _CONNECTED_VIEWERS.pop(channel_name, None) is not None


def viewers_snapshot() -> dict[str, dict]:
    """Return a copy of the full presence map."""
    return dict(_CONNECTED_VIEWERS)


def iter_viewers():
    """Iterate ``(channel_name, entry)`` pairs. Snapshot to avoid RuntimeError."""
    return list(_CONNECTED_VIEWERS.items())


# ---------------------------------------------------------------------------
# Live session state (live-reading snapshot buffer)
# ---------------------------------------------------------------------------
# Keyed by session_id (stringified). Holds the exact shape the frontend
# expects on ``live_state_sync`` so a remote joining mid-run can receive a
# complete, coherent snapshot of every stage without relying on the host
# browser to relay its React state.
_LIVE_SESSION_STATE: dict[str, dict] = {}


def _initial_live_state() -> dict:
    """Factory for an empty live-state record."""
    return {
        'isCollecting': False,
        'activeCollectionDetails': None,
        'liveReadings': {},
        'tiLiveReadings': {},
        'collectionProgress': {'count': 0, 'total': 0},
        'focusedTPKey': None,
        # Latest operator-facing stability payloads. Live clients receive
        # these incrementally, while a client joining mid-cycle needs the
        # current values included in its authoritative snapshot.
        'slidingWindowStatus': None,
        'stabilizationStatus': None,
        # Pre-measurement countdown (warm-up / settling). Carried in the
        # snapshot so a remote joining mid-warm-up — which has missed the
        # one-shot ``status_update`` broadcast — still sees the timer and
        # the "run active" UI. ``endsAt`` is a server epoch (seconds); the
        # frontend reconciles it against the ``serverNow`` we ship alongside.
        'timerState': {'isActive': False},
    }


def get_live_state(session_id: Any) -> dict:
    """Read-write accessor. Creates a default entry if none exists yet.

    Returns the underlying dict so callers can mutate fields in place
    (the existing live-reading logic heavily relies on this pattern).
    """
    key = str(session_id)
    state = _LIVE_SESSION_STATE.get(key)
    if state is None:
        state = _initial_live_state()
        _LIVE_SESSION_STATE[key] = state
    return state


def peek_live_state(session_id: Any) -> dict:
    """Read-only accessor. Returns a fresh default dict when unseeded.

    Never mutates the registry — safe to call from paths that shouldn't
    create state as a side-effect (e.g. responding to a remote's
    ``request_live_state`` on a session that's never been started).
    """
    return _LIVE_SESSION_STATE.get(str(session_id)) or _initial_live_state()


def clear_live_state(session_id: Any) -> None:
    """Drop a session's live-state record. Idempotent."""
    _LIVE_SESSION_STATE.pop(str(session_id), None)


# ---------------------------------------------------------------------------
# Workstation claims (hardware-lock registry, DB-mirrored)
# ---------------------------------------------------------------------------
# Keyed by workstation IP. Maps to metadata about the socket that currently
# holds the lock. The in-memory dict is authoritative for the wire format
# (the ``workstation_claims_update`` broadcast is IP-keyed to match the
# frontend, which claims one IP at a time). Every mutation is mirrored
# into the ``WorkstationClaim`` DB table for durability / admin visibility /
# future cross-process workers. The DB uses a ``Workstation``-keyed
# OneToOne row, so multiple IPs that physically live at the same bench
# collapse to a single DB row (first-IP-wins for the timestamp, last-IP
# release drops the row).
_CLAIMED_WORKSTATIONS: dict[str, dict] = {}


def _resolve_workstation(ip: str):
    """Map an instrument IP/address to the ``Workstation`` it lives at,
    auto-provisioning a row on first sighting.

    Resolution order:

    1. Scan active :class:`~api.models.Workstation` rows for one whose
       ``instrument_addresses`` list contains ``ip``. Small-table scan in
       Python avoids cross-dialect JSON ``contains`` inconsistencies.
    2. If no row matches, create a new per-IP Workstation with a
       deterministic ``auto-<slug>`` identifier so every unique
       instrument bench automatically shows up in the admin the first
       time it's claimed. Operators can rename, merge, or mark inactive
       via ``/admin/api/workstation/`` without touching any wire code.
    3. If the auto-create fails for any reason (DB hiccup, slug
       collision we couldn't recover from, etc.) fall back to the
       bootstrapped "Local Workstation" so the claim path never breaks.

    The auto-provision path is idempotent: if a row with the same
    identifier already exists but somehow didn't list the IP yet, we
    append the IP so future lookups short-circuit in step 1.
    """
    from api.models import Workstation

    for ws in Workstation.objects.filter(is_active=True):
        addrs = ws.instrument_addresses or []
        if isinstance(addrs, list) and ip in addrs:
            return ws

    try:
        slug = re.sub(r'[^a-z0-9]+', '-', ip.lower()).strip('-') or 'unknown'
        identifier = f'auto-{slug}'[:100]
        ws, created = Workstation.objects.get_or_create(
            identifier=identifier,
            defaults={
                'name': f'Bench @ {ip}',
                'is_default': False,
                'is_active': True,
                'instrument_addresses': [ip],
                'notes': (
                    'Auto-provisioned on first workstation claim. '
                    'Rename, merge IPs, or deactivate via admin if needed.'
                ),
            },
        )
        if not created:
            addrs = ws.instrument_addresses or []
            if isinstance(addrs, list) and ip not in addrs:
                addrs.append(ip)
                ws.instrument_addresses = addrs
                ws.save(update_fields=['instrument_addresses'])
        return ws
    except Exception as exc:  # pragma: no cover — defensive fallback
        print(
            f"session_state: auto-provision failed for ip={ip!r} "
            f"({exc!r}); falling back to default bench."
        )
        return Workstation.get_default()


def _write_claim_row(
    ws,
    *,
    channel_name: str,
    client_id: Optional[str],
    owner_label: str,
    active_session_id: Optional[int],
) -> None:
    """Upsert the durable claim row. Never raises — a DB hiccup must not
    take down the live WebSocket path; the in-memory dict is the wire.

    The DB row is best-effort: if it fails, the admin is slightly stale
    until the next successful claim, but the lock broadcast still works.
    """
    from api.models import WorkstationClaim

    try:
        WorkstationClaim.objects.update_or_create(
            workstation=ws,
            defaults={
                'owner_channel': channel_name,
                'owner_client_id': client_id or '',
                'owner_label': owner_label or '',
                'active_session_id': active_session_id,
            },
        )
    except Exception as exc:  # pragma: no cover — defensive only
        print(f"session_state: claim row upsert failed ({exc!r}). "
              "Wire broadcast still applied; admin row may be stale.")


def _delete_claim_row(ws, *, channel_name: str) -> None:
    """Delete the claim row only if it belongs to the caller's channel.

    Mirrors the in-memory ownership check so a stale release from a
    socket that already lost the lock can't remove another host's row.
    """
    from api.models import WorkstationClaim

    try:
        WorkstationClaim.objects.filter(
            workstation=ws, owner_channel=channel_name
        ).delete()
    except Exception as exc:  # pragma: no cover — defensive only
        print(f"session_state: claim row delete failed ({exc!r}).")


def _channel_still_holds_workstation(channel_name: str, ws_pk: int) -> bool:
    """Does ``channel_name`` still own another IP that maps to ``ws_pk``?

    Used by :func:`release_workstation` to decide whether to delete the
    DB row. If the host locked two IPs on the same bench and only
    releases one, the DB row must stay.
    """
    for ip, data in _CLAIMED_WORKSTATIONS.items():
        if data.get('channel_name') != channel_name:
            continue
        try:
            other_ws = _resolve_workstation(ip)
        except Exception:
            continue
        if other_ws.pk == ws_pk:
            return True
    return False


def claim_workstation(
    ip: str,
    *,
    channel_name: str,
    client_id: Optional[str],
    role: str,
    owner_label: str = '',
    active_session_id: Optional[int] = None,
) -> None:
    """Record a hardware-lock, mirroring the write to the DB.

    Last writer wins on the wire (the dict is overwritten
    unconditionally) — the caller enforces role-based policy upstream
    in the consumer. The DB row is a best-effort mirror; see
    :func:`_write_claim_row`.
    """
    _CLAIMED_WORKSTATIONS[ip] = {
        'channel_name': channel_name,
        'client_id': client_id,
        'role': role,
    }

    try:
        ws = _resolve_workstation(ip)
    except Exception as exc:  # pragma: no cover — DB outage path
        print(f"session_state: could not resolve workstation for {ip!r} "
              f"({exc!r}). Skipping DB mirror; wire broadcast still applied.")
        return

    _write_claim_row(
        ws,
        channel_name=channel_name,
        client_id=client_id,
        owner_label=owner_label,
        active_session_id=active_session_id,
    )


def release_workstation(ip: str, *, channel_name: str) -> bool:
    """Release a lock only if the caller owns it.

    Returns ``True`` when a release actually happened so the caller can
    decide whether to broadcast. Guards against a stale release from a
    socket that lost the lock in the meantime.
    """
    existing = _CLAIMED_WORKSTATIONS.get(ip)
    if existing is None or existing.get('channel_name') != channel_name:
        return False
    del _CLAIMED_WORKSTATIONS[ip]

    try:
        ws = _resolve_workstation(ip)
    except Exception as exc:  # pragma: no cover — DB outage path
        print(f"session_state: could not resolve workstation for {ip!r} on "
              f"release ({exc!r}). In-memory release applied.")
        return True

    # Only drop the DB row once this host has no other IPs still pointing
    # at the same bench — otherwise a release of instrument A would free
    # the whole bench while instrument B is still actively driven.
    if not _channel_still_holds_workstation(channel_name, ws.pk):
        _delete_claim_row(ws, channel_name=channel_name)
    return True


def release_claims_for(channel_name: str) -> list[str]:
    """Bulk-release every lock held by a given socket.

    Called on ``HostSyncConsumer.disconnect`` to self-heal abrupt
    closures (tab close, browser crash, network loss). Returns the list
    of IPs that were freed so the caller can skip the follow-up
    broadcast when nothing changed.
    """
    released = [
        ip for ip, data in _CLAIMED_WORKSTATIONS.items()
        if data.get('channel_name') == channel_name
    ]
    for ip in released:
        del _CLAIMED_WORKSTATIONS[ip]

    if released:
        # Whole-channel cleanup: drop every DB row this channel owns in
        # one query, regardless of which workstations were involved.
        # This is safe because the in-memory dict for this channel is
        # now empty, so no other IP could still need the row.
        try:
            from api.models import WorkstationClaim
            WorkstationClaim.objects.filter(owner_channel=channel_name).delete()
        except Exception as exc:  # pragma: no cover — DB outage path
            print(f"session_state: bulk claim release failed ({exc!r}).")
    return released


def claims_snapshot() -> dict[str, dict]:
    """Return a copy of the in-memory lock registry.

    Serves the wire payload — the DB is the durable mirror, the dict
    is the broadcast source. Keeping the snapshot dict-only means the
    per-frame broadcast path stays query-free.
    """
    return dict(_CLAIMED_WORKSTATIONS)


def wipe_stale_claims() -> int:
    """Clear every ``WorkstationClaim`` row on process start.

    Rows from a previous Daphne process carry dead ``owner_channel``
    identifiers that can never reconnect, so they would shadow live
    claims and confuse the admin. Called from ``api.apps.ApiConfig.ready``
    with the standard management-command guards. Returns the number of
    rows removed so callers can log it. Never raises — the app boots
    fine with orphans, they're just visually noisy in admin.
    """
    try:
        from api.models import WorkstationClaim
        deleted, _ = WorkstationClaim.objects.all().delete()
        return int(deleted or 0)
    except Exception as exc:  # pragma: no cover — fresh-install / DB outage
        print(f"session_state: stale claim wipe skipped ({exc!r}).")
        return 0


# ---------------------------------------------------------------------------
# Test support
# ---------------------------------------------------------------------------
def reset_for_tests() -> None:
    """Wipe every registry. Safe to call between tests to prevent bleed.

    Intentionally does not reach into supervisor state — the supervisor
    registry has its own :func:`api.session_supervisor.reset_registry_for_tests`.
    Clears the in-memory ``WorkstationClaim`` mirror too so tests that
    exercise the DB-backed claim path start from a clean slate; the
    ``Workstation`` inventory is left alone because many tests rely on
    the default bench fixture.
    """
    _HOST_ACTIVE_SESSIONS.clear()
    _CONNECTED_VIEWERS.clear()
    _LIVE_SESSION_STATE.clear()
    _CLAIMED_WORKSTATIONS.clear()

    try:
        from api.models import CalibrationRunLock, WorkstationClaim
        WorkstationClaim.objects.all().delete()
        CalibrationRunLock.objects.all().delete()
    except Exception:
        # Some unit tests that poke this module directly (e.g. module-
        # level accessor tests) don't spin up the Django test DB at all;
        # an exception here just means we have nothing to clear.
        pass


# ---------------------------------------------------------------------------
# Per-bench calibration run lock
# ---------------------------------------------------------------------------
# DB-backed single-flight lock so two sessions bound to the same bench cannot
# both drive its instruments at once. Unlike the WorkstationClaim helpers above
# (a UI/host reservation owned by the HostSync socket), this lock is owned by
# the calibration RUN and lives only for the duration of that run. The
# ``CalibrationRunLock`` OneToOne on Workstation makes it correct across ASGI
# workers; staleness (a crashed worker) is detected via the heartbeat TTL.


def _runlock_stale_seconds() -> int:
    return int(getattr(settings, 'CALIBRATION_RUNLOCK_STALE_SECONDS', 90))


def acquire_run_lock(session_id, owner_channel) -> tuple[bool, Optional[int]]:
    """Atomically acquire the run lock for ``session_id``'s bench.

    Returns ``(acquired, holder_session_id)``. ``acquired`` is True when this
    session now holds the lock — freshly, by re-acquiring its own lock, or by
    taking over a stale (crashed) one. It is False when a *live* run on another
    session already holds the bench, with ``holder_session_id`` naming it.
    """
    from api.models import CalibrationRunLock, CalibrationSession, Workstation

    session_id = int(session_id)
    try:
        session = CalibrationSession.objects.get(pk=session_id)
    except CalibrationSession.DoesNotExist:
        return False, None

    ws = session.workstation or Workstation.get_default()
    stale = _runlock_stale_seconds()
    now = timezone.now()

    try:
        with transaction.atomic():
            existing = (
                CalibrationRunLock.objects.select_for_update()
                .filter(workstation=ws)
                .first()
            )
            if existing is not None:
                if existing.session_id == session_id:
                    # Re-acquire / refresh our own lock (idempotent).
                    existing.owner_channel = owner_channel
                    existing.last_heartbeat_at = now
                    existing.save(update_fields=['owner_channel', 'last_heartbeat_at'])
                    return True, session_id

                age = (now - existing.last_heartbeat_at).total_seconds()
                if age <= stale:
                    return False, existing.session_id

                # Stale lock from a dead run/worker — take it over.
                existing.session_id = session_id
                existing.owner_channel = owner_channel
                existing.last_heartbeat_at = now
                existing.save(
                    update_fields=['session', 'owner_channel', 'last_heartbeat_at']
                )
                return True, session_id

            CalibrationRunLock.objects.create(
                workstation=ws,
                session_id=session_id,
                owner_channel=owner_channel,
            )
            return True, session_id
    except IntegrityError:
        # Lost a create race against a concurrent acquire — report the winner.
        other = CalibrationRunLock.objects.filter(workstation=ws).first()
        if other and other.session_id == session_id:
            return True, session_id
        return (False, other.session_id) if other else (False, None)


def release_run_lock(session_id) -> None:
    """Release the run lock held by ``session_id`` (idempotent)."""
    from api.models import CalibrationRunLock

    try:
        CalibrationRunLock.objects.filter(session_id=int(session_id)).delete()
    except Exception as exc:  # pragma: no cover — defensive only
        print(f"session_state: run-lock release failed ({exc!r}).")


def touch_run_lock(session_id) -> None:
    """Refresh the heartbeat on ``session_id``'s run lock so it isn't reaped."""
    from api.models import CalibrationRunLock

    try:
        CalibrationRunLock.objects.filter(session_id=int(session_id)).update(
            last_heartbeat_at=timezone.now()
        )
    except Exception as exc:  # pragma: no cover — defensive only
        print(f"session_state: run-lock heartbeat failed ({exc!r}).")
