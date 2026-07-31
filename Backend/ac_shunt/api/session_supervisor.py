"""
Session Supervisor — decouples a calibration run from the host WebSocket.

A ``SessionSupervisor`` owns the long-running calibration ``asyncio.Task``
and the state it mutates while running (``stop_event``,
``confirmation_event``, ``state``). The ``CalibrationConsumer`` no longer
holds these itself; instead, it looks up the supervisor for its
``session_id`` and delegates through proxy properties, so the existing
~1400 lines of task code keep working without touching ``self.*``
references.

This is the single architectural change that makes concurrent multi-host
calibration possible: before, a host pulling its network cable or
closing the tab would call ``self.collection_task.cancel()`` in
``CalibrationConsumer.disconnect``, stranding the hardware mid-stage.
After, the task lives on the supervisor, the socket only "attaches" and
"detaches", and a configurable grace window lets the host reconnect
without losing the run.

Key invariants
--------------

1.  One supervisor per ``session_id`` per process. The registry is
    protected by an ``asyncio.Lock`` — two hosts racing to ``start_task``
    cannot end up with two tasks writing to the same instrumentation.

2.  The supervisor never cancels a running task on a *single* socket
    close. It only auto-stops if:

    - The explicit ``stop_collection`` command arrives, OR
    - The host-socket set empties AND the grace window expires with no
      new host attaching.

    Remote (observer) disconnects never affect the task — they only come
    out of the ``observer_channels`` set.

3.  Broadcast always goes through ``channel_layer.group_send`` against
    the ``session_<id>`` group. This makes the supervisor independent of
    which specific ``CalibrationConsumer`` spawned the task — when the
    originating socket dies, any other host attached to the same group
    still receives every subsequent status message the task emits.

4.  On process restart (daphne reboot, machine reboot), all supervisors
    are lost. That is *correct* for Phase 2: a process restart is a
    hard stop and the frontend already handles the resulting socket
    failure. Phase 5 (Redis channel layer + multi-worker) is where
    cross-process task handoff becomes a thing to consider; at that
    point the supervisor still keys on session_id so the Redis-backed
    registry slots in without touching the consumer.
"""

from __future__ import annotations

import asyncio
import logging
import traceback
from typing import Awaitable, Callable, Optional

from channels.db import database_sync_to_async
from channels.layers import get_channel_layer
from django.conf import settings

logger = logging.getLogger(__name__)

# Process-wide registry. Keyed by the int session_id so the lookup matches
# the URL-route value ``CalibrationConsumer`` receives without any casting.
# Mutations go through ``_REGISTRY_LOCK`` — two concurrent ``connect()``
# calls for the same session would otherwise race on ``get_or_create``.
_SUPERVISORS: dict[int, "SessionSupervisor"] = {}
_REGISTRY_LOCK: Optional[asyncio.Lock] = None

# --- Public accessors --------------------------------------------------------

async def get_or_create_supervisor(session_id: int) -> "SessionSupervisor":
    """Return the singleton supervisor for ``session_id``, creating on first use."""
    global _REGISTRY_LOCK
    if _REGISTRY_LOCK is None:
        _REGISTRY_LOCK = asyncio.Lock()

    async with _REGISTRY_LOCK:
        sup = _SUPERVISORS.get(session_id)
        if sup is None:
            sup = SessionSupervisor(session_id)
            _SUPERVISORS[session_id] = sup
        return sup

def peek_supervisor(session_id: int) -> Optional["SessionSupervisor"]:
    """Non-blocking peek used for tests and diagnostics.

    Returns ``None`` when no supervisor has been created yet — typically
    because no consumer for that ``session_id`` has connected since the
    process started.
    """
    return _SUPERVISORS.get(session_id)


def _drop_supervisor(session_id: int) -> None:
    """Test-only helper: evict a supervisor from the registry."""
    _SUPERVISORS.pop(session_id, None)


def reset_registry_for_tests() -> None:
    """Clear the whole registry — test fixtures only."""
    _SUPERVISORS.clear()


# --- SessionSupervisor -------------------------------------------------------


class SessionSupervisor:
    """Owns the running calibration task and its state for one session.

    Attribute surface intentionally mirrors what the consumer used to
    keep on ``self`` (``stop_event``, ``confirmation_event``,
    ``confirmation_status``, ``state``), so the proxy properties on
    ``CalibrationConsumer`` can pass reads and writes through without
    the task code needing to change.
    """

    #: States the supervisor can be in. ``BUSY`` means a task is running
    #: (or pending cancellation). Anything else counts as idle — a host
    #: attaching while ``IDLE`` is free to start a new task.
    STATE_IDLE = "IDLE"
    STATE_BUSY = "BUSY"

    def __init__(self, session_id: int):
        self.session_id = int(session_id)
        self.group_name = f"session_{self.session_id}"
        self.channel_layer = get_channel_layer()

        # Task-run state. These are the attributes the old consumer used
        # to own directly; task code reads/writes them through the
        # proxy properties on ``CalibrationConsumer``.
        self.stop_event: asyncio.Event = asyncio.Event()
        self.confirmation_event: asyncio.Event = asyncio.Event()
        self.confirmation_status: Optional[str] = None
        # Set by the operator when they click "Resume reverse pass" after
        # flipping the AC-DC adapter mid paired-batch run.
        self.flip_resume_event: asyncio.Event = asyncio.Event()
        self.state: str = self.STATE_IDLE

        self.task: Optional[asyncio.Task] = None
        # Human-readable kind label, purely for diagnostics / test probes.
        self.task_kind: Optional[str] = None

        # Attached sockets, partitioned by role so the grace-window logic
        # can ignore observer-only churn. Stored by ``channel_name`` so
        # the supervisor never holds a strong reference to a consumer
        # instance (which would defeat the whole point of decoupling).
        self.host_channels: set[str] = set()
        self.observer_channels: set[str] = set()

        # Grace-window bookkeeping. ``_grace_task`` is cancelled on host
        # reconnect; it otherwise sleeps for ``grace_window_seconds`` and
        # then stops the run. Configurable via settings so deployments
        # with flaky networks can bump it up.
        self._grace_task: Optional[asyncio.Task] = None
        self.grace_window_seconds: int = int(
            getattr(settings, "CALIBRATION_GRACE_WINDOW_SECONDS", 30)
        )

    # -- host/observer attach/detach -----------------------------------------

    async def attach(self, channel_name: str, client_role: str) -> str:
        """Register a consumer socket against this supervisor.

        Returns the granted role ('host' or 'remote'). If a client requests
        'host' but the session already has an active host, they are downgraded
        to 'remote' to enforce the 1-host-per-session limit.
        """
        # --- Enforce 1-Host Limit per Session ---
        if client_role == "host":
            # If there is already a host, and it's NOT this reconnecting channel
            if self.host_channels and channel_name not in self.host_channels:
                logger.warning(
                    "[supervisor:%s] Session already has an active host. Downgrading %s to observer.",
                    self.session_id, channel_name
                )
                client_role = "remote"  # Forcefully downgrade

        if client_role == "host":
            was_empty = not self.host_channels
            self.host_channels.add(channel_name)
            if self._grace_task and not self._grace_task.done():
                logger.info(
                    "[supervisor:%s] Host reconnected within grace window — cancelling auto-stop.",
                    self.session_id,
                )
                self._grace_task.cancel()
                self._grace_task = None
                await self._broadcast_status(
                    "Host reconnected — calibration continues."
                )
            elif was_empty and self.state == self.STATE_BUSY:
                logger.info(
                    "[supervisor:%s] Host reattached during active run.",
                    self.session_id,
                )
        else:
            self.observer_channels.add(channel_name)

        return client_role

    async def detach(self, channel_name: str) -> None:
        """Remove a consumer socket. Starts the grace timer when relevant.

        Detaching an observer is a pure registry mutation. Detaching the
        last host while the supervisor is ``BUSY`` arms the grace timer;
        the timer, if not cancelled, will auto-stop the task after
        ``grace_window_seconds``.
        """
        was_host = channel_name in self.host_channels
        self.host_channels.discard(channel_name)
        self.observer_channels.discard(channel_name)

        if not was_host:
            return

        if self.state == self.STATE_BUSY and not self.host_channels:
            if self._grace_task and not self._grace_task.done():
                # Already armed — nothing to do.
                return
            logger.warning(
                "[supervisor:%s] Last host left during active run. Arming %ss grace window.",
                self.session_id,
                self.grace_window_seconds,
            )
            self._grace_task = asyncio.create_task(self._grace_window_then_stop())

    # -- task lifecycle ------------------------------------------------------

    async def start_task(
        self,
        kind: str,
        coro: Awaitable,
    ) -> bool:
        """Begin a new calibration task.

        ``coro`` is an already-constructed coroutine (the consumer calls
        e.g. ``self.run_full_calibration_sequence(data)`` and hands the
        result over). We wrap it so ``state`` resets to ``IDLE`` and the
        ``task`` reference clears deterministically on completion or
        cancellation — without the wrapper the finally cleanup would
        need to live in every task method.

        Returns ``True`` if the task was started, ``False`` if one is
        already running (defensive; the consumer also guards against
        this, but a second caller racing here shouldn't be able to
        overwrite ``self.task``).
        """
        if self.state == self.STATE_BUSY or (self.task and not self.task.done()):
            # Close the coroutine we were handed so it doesn't leak as
            # an unawaited warning.
            try:
                coro.close()  # type: ignore[union-attr]
            except Exception:
                pass
            return False

        self.stop_event.clear()
        self.confirmation_event.clear()
        self.flip_resume_event.clear()
        self.confirmation_status = None
        self.state = self.STATE_BUSY
        self.task_kind = kind
        self.task = asyncio.create_task(self._run_wrapped(coro))
        logger.info("[supervisor:%s] Task started (kind=%s).", self.session_id, kind)
        return True

    async def _run_wrapped(self, coro: Awaitable) -> None:
        try:
            await coro
        except asyncio.CancelledError:
            logger.info("[supervisor:%s] Task cancelled.", self.session_id)
        except Exception:  # pragma: no cover - defensive
            logger.error(
                "[supervisor:%s] Task raised unhandled exception:\n%s",
                self.session_id,
                traceback.format_exc(),
            )
        finally:
            self.state = self.STATE_IDLE
            self.task = None
            self.task_kind = None
            # A run that completed cleanly also invalidates any armed
            # grace timer — no point auto-stopping something that's
            # already done.
            if self._grace_task and not self._grace_task.done():
                self._grace_task.cancel()
                self._grace_task = None
            # Release this bench's run lock. This single point covers every way
            # a run ends — normal completion, an explicit stop (task cancelled),
            # and grace-window auto-stop — because the finally always runs. The
            # lock is keyed by session_id, which the supervisor owns.
            try:
                from api import session_state
                await database_sync_to_async(session_state.release_run_lock)(self.session_id)
            except Exception:  # pragma: no cover - defensive
                logger.exception(
                    "[supervisor:%s] run-lock release failed", self.session_id
                )

    async def stop_task(self) -> None:
        """Explicit cancel path (user clicked "Stop Collection")."""
        self.stop_event.set()
        task = self.task
        if task and not task.done():
            task.cancel()
        if self._grace_task and not self._grace_task.done():
            self._grace_task.cancel()
            self._grace_task = None

    async def set_confirmation(self, status: str) -> None:
        """Forward an amplifier-range confirmation decision to the task."""
        self.confirmation_status = status
        self.confirmation_event.set()

    async def signal_flip_resume(self) -> None:
        """Operator clicked 'Adapter flipped, resume reverse pass'."""
        self.flip_resume_event.set()

    # -- grace window --------------------------------------------------------

    async def _grace_window_then_stop(self) -> None:
        """Sleep for the grace window, then cancel the task if still orphaned.

        A host reconnecting during the sleep cancels this coroutine via
        ``attach``; the ``CancelledError`` path is the normal success
        case. Any other wakeup means the run genuinely lost its host.
        """
        try:
            await asyncio.sleep(self.grace_window_seconds)
        except asyncio.CancelledError:
            return

        # Double-check at firing time: a host might have come back and
        # `attach` missed the cancellation window under heavy load.
        if self.host_channels:
            logger.info(
                "[supervisor:%s] Grace window expired but host was re-attached concurrently; no-op.",
                self.session_id,
            )
            self._grace_task = None
            return

        if self.state != self.STATE_BUSY:
            self._grace_task = None
            return

        logger.warning(
            "[supervisor:%s] Grace window expired without a host reconnect. Auto-stopping run.",
            self.session_id,
        )
        self._grace_task = None
        await self._broadcast_status(
            "Host disconnected and did not return within the grace window. "
            "Calibration auto-stopped."
        )
        await self.stop_task()

    # -- broadcast helpers ---------------------------------------------------

    async def _broadcast_status(self, message: str) -> None:
        """Emit a ``status_update`` to the whole session group.

        Uses the same ``forward_to_group`` event shape the consumer's
        ``broadcast`` helper produces, so the existing ``forward_to_group``
        handler on :class:`CalibrationConsumer` dispatches supervisor-
        originated messages identically to consumer-originated ones
        without needing an extra handler.
        """
        if self.channel_layer is None:  # pragma: no cover - safety
            return
        try:
            import json

            await self.channel_layer.group_send(
                self.group_name,
                {
                    "type": "forward_to_group",
                    "text_data": json.dumps(
                        {"type": "status_update", "message": message}
                    ),
                },
            )
        except Exception:
            logger.exception(
                "[supervisor:%s] Failed to broadcast status: %r",
                self.session_id,
                message,
            )

    # -- test / diagnostic utilities ----------------------------------------

    def snapshot(self) -> dict:
        """Return a JSON-safe snapshot. Used by tests and admin tooling."""
        return {
            "session_id": self.session_id,
            "state": self.state,
            "task_kind": self.task_kind,
            "task_running": bool(self.task and not self.task.done()),
            "host_channels": sorted(self.host_channels),
            "observer_channels": sorted(self.observer_channels),
            "grace_armed": bool(
                self._grace_task and not self._grace_task.done()
            ),
            "grace_window_seconds": self.grace_window_seconds,
        }
