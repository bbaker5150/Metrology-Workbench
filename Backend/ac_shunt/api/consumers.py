# api/consumers.py

import json
import asyncio
import time
import traceback
import re
from channels.generic.websocket import AsyncWebsocketConsumer
from asgiref.sync import sync_to_async
from channels.db import database_sync_to_async
from collections import deque
import statistics
import math
import numpy as np

from django.conf import settings
from urllib.parse import unquote, parse_qs

from api.session_supervisor import (
    SessionSupervisor,
    get_or_create_supervisor,
    peek_supervisor,
)
from api import session_state


def _parse_client_role(scope) -> str:
    """Extract the client-declared role from a WebSocket ``scope``.

    The frontend appends ``?role=remote`` to WS URLs when the browser is in
    Observer Mode (see InstrumentContext). Anything else — including the
    absence of the query param — is treated as ``host``. Used by consumers
    that need to reject state-mutating commands from remote sockets as a
    defense-in-depth layer over the UI-level gate.
    """
    try:
        raw = (scope.get('query_string') or b'').decode('utf-8', errors='ignore')
        params = parse_qs(raw)
        role = (params.get('role') or ['host'])[0]
        return 'remote' if role == 'remote' else 'host'
    except Exception:
        return 'host'


# Commands on ``CalibrationConsumer`` that a remote observer must never be
# allowed to execute. Anything that starts a run, stops a run, or touches
# physical instrumentation lives here. Read-only operations like
# ``request_live_sync`` stay off the list so observers can still pull the
# live-state snapshot the frontend relies on for mid-run joins.
CALIBRATION_HOST_ONLY_COMMANDS = frozenset({
    'start_collection',
    'start_full_calibration',
    'start_single_stage_batch',
    'start_full_calibration_batch',
    'tvc_characterization',
    'stop_collection',
    'set_amplifier_range',
    'amplifier_confirmed',
    'operation_cancelled',
})

from npsl_tools.instruments import (
    Instrument11713C,
    Instrument3458A,
    Instrument5730A,
    Instrument5790B,
    Instrument34420A,
    Instrument8508A,
    Instrument8100,
)
from .models import (
    CalibrationReadings,
    CalibrationResults,
    CalibrationResultsCycle,
    CalibrationSession,
    CalibrationSettings,
    TestPoint,
    TestPointSet,
    Workstation,
    compute_delta_uut_ppm,
    welford_mean_stddev,
)
from .mock_instruments import is_mock_address, mock_isr_for_model
from .mock_calibration_instruments import resolve_calibration_instrument
from . import outbox as outbox_module


def _inst(real_cls, **kwargs):
    """Construct ``real_cls`` unless MOCK_INSTRUMENTS is on AND the ``gpib``
    address is in the mock inventory, in which case return the matching mock
    drop-in from :mod:`mock_calibration_instruments`.

    Every instrument instantiation inside ``CalibrationConsumer`` routes
    through here, which is what lets the consumer run a full calibration
    sequence against a seeded mock session without any real hardware.
    """
    address = kwargs.get('gpib')
    if getattr(settings, "MOCK_INSTRUMENTS", False) and is_mock_address(address):
        cls = resolve_calibration_instrument(real_cls, address)
    else:
        cls = real_cls
    return cls(**kwargs)

# --- Live-state helper shims ---
# Thin delegators to :mod:`api.session_state` so the existing
# CalibrationConsumer call sites (there are several) don't have to be
# rewritten. Keeping the underscore-prefixed names makes the indirection
# invisible in the hot-path code below while still routing every read/write
# through the accessor layer that Phase 5 will later swap for Redis.
def _get_live_state(session_id):
    return session_state.get_live_state(session_id)


def _peek_live_state(session_id):
    return session_state.peek_live_state(session_id)


def _clear_live_state(session_id):
    session_state.clear_live_state(session_id)


INSTRUMENT_CLASS_MAP = {
    '5730A': Instrument5730A,
    '5790B': Instrument5790B,
    '3458A': Instrument3458A,
    '34420A': Instrument34420A,
    '8508A': Instrument8508A,
    '11713C': Instrument11713C,
    '8100': Instrument8100
}


def _open_reader(reader_class, model, address, input_terminal=None):
    """Construct a reader using its model-specific connection contract."""

    if reader_class == Instrument34420A:
        return _inst(reader_class, gpib=address)
    if reader_class == Instrument8508A:
        return _inst(
            reader_class,
            gpib=address,
            input_terminal=input_terminal or "FRONT",
        )
    return _inst(reader_class, model=model, gpib=address)


def _8508_ac_filter_for_frequency(frequency):
    """Choose the highest 8508A RMS filter that supports the source."""

    frequency = abs(float(frequency or 0))
    if frequency < 40:
        return 10
    if frequency < 100:
        return 40
    return 100


def _8508_ac_scan_delay(filter_hz, resolution=6):
    """Return the manual Table 4-2 FRONT/REAR scan delay in seconds."""

    scan_delays = {
        5: {100: 0.5, 40: 1.25, 10: 5.0, 1: 50.0},
        6: {100: 1.25, 40: 3.25, 10: 12.5, 1: 125.0},
    }
    return scan_delays[resolution][filter_hz]


def _8508_dc_delay(filter_enabled=True, resolution=7):
    delays = {
        5: {False: 0.08, True: 0.8},
        6: {False: 0.1, True: 1.0},
        7: {False: 1.0, True: 5.0},
        8: {False: 5.0, True: 10.0},
    }
    return delays[int(resolution)][bool(filter_enabled)]


def _8508_expected_y5020_voltage(test_point_data):
    """Return the nominal Y5020 output (10 mOhm shunt) for a test point."""

    try:
        current = abs(float((test_point_data or {}).get('current')))
    except (TypeError, ValueError):
        raise ValueError("The selected test point does not contain a valid current.")
    if not math.isfinite(current) or current <= 0:
        raise ValueError("The selected test-point current must be greater than 0.")
    return current * 0.01


def _8508_profile_settings(measurement_params, frequency):
    """Normalize a persisted 8508A AC/DC profile for one test point."""

    params = measurement_params or {}
    ac_filter = int(
        params.get('f8508_ac_filter_hz')
        or _8508_ac_filter_for_frequency(frequency)
    )
    if ac_filter not in (10, 40, 100):
        ac_filter = _8508_ac_filter_for_frequency(frequency)
    ac_resolution = int(params.get('f8508_ac_resolution') or 6)
    if ac_resolution not in (5, 6):
        ac_resolution = 6
    dc_resolution = int(params.get('f8508_dc_resolution') or 7)
    if dc_resolution not in (5, 6, 7, 8):
        dc_resolution = 7

    dc_filter = bool(params.get('f8508_dc_filter_enabled', True))
    return {
        'dc_filter_enabled': dc_filter,
        'dc_resolution': dc_resolution,
        'dc_fast_enabled': bool(params.get('f8508_dc_fast_enabled', False)),
        'ac_filter_hz': ac_filter,
        'ac_resolution': ac_resolution,
        'ac_transfer_enabled': bool(
            params.get('f8508_ac_transfer_enabled', True)
        ),
        'ac_dc_coupled': bool(
            params.get('f8508_ac_dc_coupled', float(frequency or 0) < 40)
        ),
    }


def _8508_recommended_switch_delay(measurement_params, frequency):
    """Recommend one FRONT/REAR delay safe for both AC and DC stages."""

    profile = _8508_profile_settings(measurement_params, frequency)
    return max(
        _8508_ac_scan_delay(
            profile['ac_filter_hz'], profile['ac_resolution']
        ),
        _8508_dc_delay(
            profile['dc_filter_enabled'], profile['dc_resolution']
        ),
    )


def _configure_8508_for_y5020(
    instrument,
    is_ac_reading,
    frequency,
    expected_voltage,
    measurement_params=None,
):
    """Program an 8508A to read the Y5020 shunt output directly."""

    range_setting = abs(float(expected_voltage))
    profile = _8508_profile_settings(measurement_params, frequency)
    recommended_delay = _8508_recommended_switch_delay(
        measurement_params, frequency
    )
    requested_delay = (measurement_params or {}).get(
        'input_switch_settling_time'
    )
    try:
        switch_delay = float(requested_delay)
    except (TypeError, ValueError):
        switch_delay = recommended_delay
    if not math.isfinite(switch_delay) or switch_delay < 0:
        switch_delay = recommended_delay

    instrument.set_trigger_source("INT")

    if is_ac_reading:
        instrument.configure_ac_voltage(
            range_setting=range_setting,
            filter_hz=profile['ac_filter_hz'],
            resolution=profile['ac_resolution'],
            transfer=profile['ac_transfer_enabled'],
            two_wire=True,
            dc_coupled=profile['ac_dc_coupled'],
            spot_correction=False,
        )
    else:
        instrument.configure_dc_voltage(
            range_setting=range_setting,
            resolution=profile['dc_resolution'],
            filter_enabled=profile['dc_filter_enabled'],
            fast=profile['dc_fast_enabled'],
            two_wire=True,
        )
    instrument.set_input_switch_delay(min(65_000.0, switch_delay))


class InstrumentStatusConsumer(AsyncWebsocketConsumer):
    instrument_instance = None
    instrument_class = None

    async def connect(self):
        self.instrument_model = self.scope['url_route']['kwargs']['instrument_model']
        # gpib_address comes in URL-encoded (visa:// addresses contain /), undo
        # that once here so downstream comparisons see the canonical value.
        self.gpib_address = unquote(self.scope['url_route']['kwargs']['gpib_address'])
        # Same role gate as CalibrationConsumer: remotes read status but must
        # not be able to trigger zero-cal or any future state-mutating op.
        self.client_role = _parse_client_role(self.scope)
        self.instrument_class = INSTRUMENT_CLASS_MAP.get(self.instrument_model)
        if not self.instrument_class:
            await self.close(code=4001)
            return

        # Mock-mode fast path: no pyvisa, no hardware. The frontend treats a
        # "Status Received" WS message as "Connected", so simply accepting the
        # socket and letting get_status_sync return a canned ISR is enough to
        # populate the entire Instrument Status page.
        self.is_mock = getattr(settings, "MOCK_INSTRUMENTS", False) and is_mock_address(self.gpib_address)
        if self.is_mock:
            await self.accept()
            await self.send(text_data=json.dumps({
                'connection_status': 'instrument_connected',
                'instrument_model': self.instrument_model,
                'gpib_address': self.gpib_address,
            }))
            return

        self.instrument_instance = await self.connect_instrument_sync()
        if self.instrument_instance:
            await self.accept()
            await self.send(text_data=json.dumps({
                'connection_status': 'instrument_connected',
                'instrument_model': self.instrument_model,
                'gpib_address': self.gpib_address,
            }))
        else:
            await self.close(code=4004)

    async def disconnect(self, close_code):
        if getattr(self, "is_mock", False):
            return
        if self.instrument_instance:
            await self.close_instrument_sync()
            self.instrument_instance = None

    async def receive(self, text_data):
        data = json.loads(text_data)
        command = data.get('command')

        if command == 'get_instrument_status':
            if getattr(self, "is_mock", False):
                payload = {
                    'instrument_model': self.instrument_model,
                    'gpib_address': self.gpib_address,
                    'timestamp': time.time(),
                    'status_report': 'ok',
                    'raw_isr': mock_isr_for_model(self.instrument_model),
                }
            else:
                status_result = await self.get_status_sync()
                payload = {'instrument_model': self.instrument_model, 'gpib_address': self.gpib_address, 'timestamp': time.time(), **status_result}
            await self.send(text_data=json.dumps(payload))
        elif command == 'run_zero_cal':
            if getattr(self, 'client_role', 'host') == 'remote':
                await self.send(text_data=json.dumps({
                    'type': 'warning',
                    'message': 'Observer mode: controls are read-only.',
                }))
                return
            print(f"[StatusConsumer] Processing Zero Cal request for {self.gpib_address}...")
            # 1. Notify Frontend it started
            await self.send(text_data=json.dumps({
                'type': 'zero_cal_started', 
                'message': 'Zero Calibration started. Please wait...'
            }))

            # 2. Run the BLOCKING driver call (or simulate in mock mode)
            if getattr(self, "is_mock", False):
                # Give the UI a few seconds to show the "Zeroing..." banner
                # so the warning styling can be visually verified.
                await asyncio.sleep(2.5)
                success = True
            else:
                success = await self.run_zero_cal_sync()
            
            if success:
                print(f"[StatusConsumer] Zero Cal complete for {self.gpib_address}")
                # 3. Notify Frontend it finished
                await self.send(text_data=json.dumps({
                    'type': 'zero_cal_complete', 
                    'message': 'Zero Calibration Complete.'
                }))
            else:
                print(f"[StatusConsumer] Zero Cal FAILED for {self.gpib_address}")
                await self.send(text_data=json.dumps({
                    'type': 'error', 
                    'message_text': 'Zero Calibration Failed or Timed Out.'
                }))
            await self.send(text_data=json.dumps({'type': 'status_update', 'message': 'Zero Cal Command Sent'}))
        else:
            await self.send(text_data=json.dumps({'error': 'Unknown command'}))

    @sync_to_async(thread_sensitive=True)
    def connect_instrument_sync(self):
        try:
            if self.instrument_class in [Instrument34420A, Instrument11713C]:
                instance = self.instrument_class(gpib=self.gpib_address)
            elif self.instrument_class == Instrument8508A:
                instance = self.instrument_class(gpib=self.gpib_address)
            else: # Classes that do take a 'model' argument
                instance = self.instrument_class(model=self.instrument_model, gpib=self.gpib_address)
            return instance
        except Exception as e:
            print(f"StatusConsumer: Error instantiating/connecting to {self.gpib_address}: {e}")
            return None

    @sync_to_async(thread_sensitive=True)
    def close_instrument_sync(self):
        if self.instrument_instance:
            close = getattr(self.instrument_instance, "close", None)
            if callable(close):
                close()
            else:
                connection = getattr(self.instrument_instance, 'resource', None) or getattr(self.instrument_instance, 'device', None)
                if connection and hasattr(connection, 'close'):
                    connection.close()

    @sync_to_async(thread_sensitive=True)
    def get_status_sync(self):
        if not self.instrument_instance:
            return {'status_report': 'error', 'error_message': 'Instrument not connected.'}
        try:
            if hasattr(self.instrument_instance, 'get_instrument_status'):
                raw_status = self.instrument_instance.get_instrument_status()
                return {'status_report': 'ok', 'raw_isr': raw_status}
            else:
                return {'status_report': 'ok', 'raw_isr': 'N/A'}
        except Exception as e:
            return {'status_report': 'error', 'error_message': str(e)}

    @sync_to_async(thread_sensitive=False)
    def run_zero_cal_sync(self):
        if self.instrument_instance and hasattr(self.instrument_instance, 'run_zero_cal'):
            try:
                print(f"[StatusConsumer] Calling .run_zero_cal() on instance: {self.instrument_instance}")
                self.instrument_instance.run_zero_cal()
                return True 
                
            except Exception as e:
                print(f"[StatusConsumer] EXCEPTION during .run_zero_cal(): {e}")
                traceback.print_exc()
                return False
        return False


class CalibrationConsumer(AsyncWebsocketConsumer):
    """
    Thin WebSocket adapter in front of a per-session :class:`SessionSupervisor`.

    The consumer used to own the long-running calibration ``asyncio.Task``
    and the primitives that coordinate it (stop event, confirmation
    event, BUSY/IDLE state). That coupling meant a host losing its socket
    — tab close, network blip, browser crash — would tear down the task
    in ``disconnect`` and strand the hardware mid-stage.

    Post-Phase 2, those primitives live on the supervisor. The consumer
    is now a presence + command router:

    * ``connect`` attaches this socket (as host or observer) to the
      session's supervisor, creating the supervisor on first use.
    * ``receive`` translates client commands into supervisor method calls
      (``start_task``, ``stop_task``, ``set_confirmation``).
    * ``disconnect`` only detaches; the task keeps running. If this was
      the last host socket on an active run, the supervisor arms a grace
      window before auto-stopping.

    Proxy properties (``stop_event``, ``confirmation_event``,
    ``confirmation_status``, ``state``, ``collection_task``) forward
    reads/writes to the supervisor, letting the ~1400 lines of task
    methods below continue to reference ``self.*`` without any
    line-by-line edits.
    """

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        # Per-socket bookkeeping — *not* owned by the supervisor because
        # it is genuinely per-socket (one ping loop per WebSocket).
        self.heartbeat_task = None
        # Supervisor handle, set in ``connect()``. Cached on the consumer
        # so every property access is O(1) instead of a registry lookup.
        self.supervisor: SessionSupervisor | None = None

    # ------------------------------------------------------------------
    # Proxy properties: forward the "task coordination" attribute surface
    # to the supervisor. Having these as properties means existing task
    # code that reads ``self.stop_event.is_set()`` or writes
    # ``self.state = "BUSY"`` continues to work verbatim after the
    # refactor, while the underlying storage survives a socket close.
    # ------------------------------------------------------------------

    @property
    def stop_event(self) -> asyncio.Event:
        sup = self.supervisor
        # Fall back to a bound event only while ``supervisor`` is None
        # (i.e. before ``connect`` finishes). This keeps ``__init__`` and
        # the hypothetical pre-connect logging path null-safe; any real
        # task code runs strictly after ``connect``.
        if sup is None:
            sup = self._ensure_local_supervisor_stub()
        return sup.stop_event

    @property
    def confirmation_event(self) -> asyncio.Event:
        sup = self.supervisor
        if sup is None:
            sup = self._ensure_local_supervisor_stub()
        return sup.confirmation_event

    @property
    def flip_resume_event(self) -> asyncio.Event:
        sup = self.supervisor
        if sup is None:
            sup = self._ensure_local_supervisor_stub()
        return sup.flip_resume_event

    @property
    def confirmation_status(self):
        sup = self.supervisor
        if sup is None:
            return None
        return sup.confirmation_status

    @confirmation_status.setter
    def confirmation_status(self, value):
        sup = self.supervisor
        if sup is None:
            sup = self._ensure_local_supervisor_stub()
        sup.confirmation_status = value

    @property
    def state(self) -> str:
        sup = self.supervisor
        if sup is None:
            return SessionSupervisor.STATE_IDLE
        return sup.state

    @state.setter
    def state(self, value):
        sup = self.supervisor
        if sup is None:
            return
        sup.state = value

    @property
    def collection_task(self):
        """Shim for legacy task code / tests that peek at the running task."""
        sup = self.supervisor
        return None if sup is None else sup.task

    def _ensure_local_supervisor_stub(self) -> SessionSupervisor:
        """Fabricate a throwaway supervisor for pre-connect property reads.

        ``CalibrationConsumer.__init__`` runs before ``connect``, so
        ``self.session_id`` and therefore ``self.supervisor`` aren't
        available yet. This stub gives property getters something
        consistent to return without special-casing every call site. The
        stub is replaced by the real supervisor in ``connect()``.
        """
        if getattr(self, "_stub_supervisor", None) is None:
            self._stub_supervisor = SessionSupervisor(
                session_id=getattr(self, "session_id", 0) or 0,
            )
        self.supervisor = self._stub_supervisor
        return self._stub_supervisor

    async def connect(self):
        self.session_id = self.scope['url_route']['kwargs']['session_id']
        self.session_group_name = f'session_{self.session_id}'
        
        # --- FIX: Store the parsed string in requested_role ---
        requested_role = _parse_client_role(self.scope)
        
        await self.channel_layer.group_add(self.session_group_name, self.channel_name)
        await self.accept()

        # Attach to (or create) the session's supervisor.
        self.supervisor = await get_or_create_supervisor(self.session_id)
        
        # Pass requested_role to the supervisor, and store the actual granted role
        self.client_role = await self.supervisor.attach(self.channel_name, requested_role)

        # Tell the frontend what its official role is
        await self.send(text_data=json.dumps({
            'type': 'role_assigned',
            'role': self.client_role
        }))

        # Alert the user if the supervisor downgraded them to a remote viewer
        if requested_role == "host" and self.client_role == "remote":
            await self.send(text_data=json.dumps({
                'type': 'warning',
                'message': 'This session is actively being controlled by another user. You are now in Observer mode.'
            }))

        # Guarantee the outbox drainer is alive on the ASGI loop. Safe to call
        # on every connect — subsequent calls are no-ops.
        outbox_module.ensure_drainer_running()

        await self.send_session_sync_status()
        self.heartbeat_task = asyncio.create_task(self.send_heartbeat())

    async def send_session_sync_status(self):
        try:
            session_data = await self.get_session_sync_data(self.session_id)
            if session_data:
                await self.send(text_data=json.dumps({
                    'type': 'connection_sync',
                    'is_complete': session_data['is_complete'],
                    'message': 'Session state synchronized.'
                }))
        except Exception as e:
            print(f"Error sending sync status: {e}")
    
    async def connection_sync(self, event):
        is_complete = event.get('is_complete', False)
        message = event.get('message', 'Session state synchronized.')
        await self.send(text_data=json.dumps({
            'type': 'connection_sync',
            'is_complete': is_complete,
            'message': message
        }))

    @database_sync_to_async
    def get_session_sync_data(self, session_id):
        try:
            session = CalibrationSession.objects.get(pk=session_id)
            return {
                'is_complete': getattr(session, 'is_complete', False) 
            }
        except Exception:
            return None

    async def disconnect(self, close_code):
        # Per-socket heartbeat is still owned by this consumer and must
        # end with the socket; everything else (task, stop_event,
        # confirmation machinery) lives on the supervisor and must
        # survive across short host reconnects. ``detach`` arms the
        # grace window when appropriate — we deliberately do NOT cancel
        # the running task here any more.
        if self.heartbeat_task:
            self.heartbeat_task.cancel()
        if self.supervisor is not None:
            try:
                await self.supervisor.detach(self.channel_name)
            except Exception:
                # detach is best-effort; a bug here should never mask a
                # real disconnect reason.
                pass
        await self.channel_layer.group_discard(self.session_group_name, self.channel_name)

    async def send_heartbeat(self):
        while True:
            try:
                await asyncio.sleep(25)
                await self.send(text_data=json.dumps({'type': 'ping'}))
                # Keep this bench's run lock alive while the host is driving an
                # active run, so a long calibration isn't reaped as stale and
                # another session can't steal the bench mid-run. Only the host
                # of a BUSY session refreshes it.
                if (
                    getattr(self, 'client_role', 'host') == 'host'
                    and self.supervisor is not None
                    and self.supervisor.state == SessionSupervisor.STATE_BUSY
                ):
                    await database_sync_to_async(session_state.touch_run_lock)(self.session_id)
            except asyncio.CancelledError:
                break
            except Exception as e:
                print(f"Error in heartbeat task: {e}")
                break

    async def receive(self, text_data):
        data = json.loads(text_data)
        command = data.get('command')

        # Live chart sync for session observers (remotes on collect-readings).
        # The server itself is the source of truth for the in-flight buffer, so
        # a remote joining mid-run gets a complete snapshot directly from the
        # consumer's state — no host-browser relay required. Runs regardless of
        # self.state so late joiners can still catch up during an active run.
        if command == 'request_live_sync':
            state = _peek_live_state(self.session_id)
            await self.send(text_data=json.dumps({
                'type': 'live_state_sync',
                # Server clock so the client can convert the warm-up timer's
                # absolute ``endsAt`` into a skew-tolerant remaining duration.
                'serverNow': time.time(),
                **state,
            }))
            return

        # Defense-in-depth: the UI disables these controls for remote viewers,
        # but a hand-crafted client could still send them directly. Drop any
        # host-only command that arrives on a remote-role socket before it
        # can touch instrumentation or flip ``self.state``.
        if getattr(self, 'client_role', 'host') == 'remote' and command in CALIBRATION_HOST_ONLY_COMMANDS:
            await self.send(text_data=json.dumps({
                'type': 'warning',
                'message': 'Observer mode: controls are read-only.',
            }))
            return

        if command in ['amplifier_confirmed', 'operation_cancelled']:
            # Route through the supervisor so the running task (which
            # may be owned by a previous socket that has since dropped)
            # observes the confirmation regardless of which consumer the
            # operator clicked from.
            if self.supervisor is not None:
                await self.supervisor.set_confirmation(
                    'confirmed' if command == 'amplifier_confirmed' else 'cancelled'
                )
            return

        if command == 'paired_run_resume':
            # Operator confirmed they flipped the AC-DC adapter. Release the
            # paired-batch task from its mid-run pause so the reverse pass
            # starts. Like amplifier confirmation, this is routed via the
            # supervisor so a host that reconnected mid-run still works.
            if self.supervisor is not None:
                await self.supervisor.signal_flip_resume()
                await self.broadcast(text_data=json.dumps({
                    'type': 'paired_run_resuming',
                    'message': 'Adapter flip acknowledged — starting reverse pass.',
                }))
            return

        if command == 'stop_collection':
            if self.supervisor is not None:
                await self.supervisor.stop_task()
            await self.broadcast(text_data=json.dumps({'type': 'collection_stopped', 'message': 'Collection stopped by user.'}))
            return

        if self.state == "BUSY":
            await self.send(text_data=json.dumps({'type': 'error', 'message': 'A collection is already in progress.'}))
            return

        # Map command -> (kind, coroutine factory). Building the coroutine
        # up front — and handing it to the supervisor to own — keeps task
        # creation atomic: once ``start_task`` returns True the
        # supervisor has committed to running it, so a racing second
        # start from another host socket cleanly bounces off.
        task_dispatch = {
            'start_collection': ('collection', self.collect_single_reading_set),
            'start_full_calibration': ('full_calibration', self.run_full_calibration_sequence),
            'start_single_stage_batch': ('single_stage_batch', self.run_single_stage_batch),
            'start_full_calibration_batch': ('full_calibration_batch', self.run_full_calibration_batch),
            'start_paired_batch': ('paired_batch', self.run_paired_batch),
            'tvc_characterization': ('tvc_characterization', self.run_tvc_characterization),
        }
        if command in task_dispatch:
            if self.supervisor is None:  # pragma: no cover — connect() always sets it
                await self.send(text_data=json.dumps({'type': 'error', 'message': 'Session supervisor missing; reconnect and try again.'}))
                return
            # Per-bench single-flight: refuse to drive a bench another live
            # session is already calibrating. DB-backed so the guarantee holds
            # across ASGI workers; the lock is released when the run ends (see
            # SessionSupervisor._run_wrapped) and reaped via heartbeat TTL if a
            # worker dies mid-run.
            acquired, holder = await database_sync_to_async(session_state.acquire_run_lock)(
                self.session_id, self.channel_name
            )
            if not acquired:
                await self.send(text_data=json.dumps({
                    'type': 'error',
                    'message': (
                        'This bench is already running a calibration'
                        + (f' (session {holder})' if holder else '')
                        + '. Wait for it to finish or stop it first.'
                    ),
                }))
                return
            kind, factory = task_dispatch[command]
            started = await self.supervisor.start_task(kind, factory(data))
            if not started:
                # Already running for this session — our lock re-acquire above
                # was idempotent, so leave it; the active run will release it.
                await self.send(text_data=json.dumps({'type': 'error', 'message': 'A collection is already in progress.'}))
        elif command == 'set_amplifier_range':
            await self.set_amplifier_range(data)

    async def _handle_amplifier_confirmation(self, amplifier_instrument, amplifier_range, data):
        if data.get('bypass_amplifier_confirmation'):
            return True

        if not amplifier_instrument or not amplifier_range:
            return True

        await self.broadcast(text_data=json.dumps({'type': 'status_update', 'message': f"Setting amplifier range to {amplifier_range} A..."}))
        await sync_to_async(amplifier_instrument.set_range, thread_sensitive=True)(range_amps=float(amplifier_range))

        self.confirmation_event.clear()
        self.confirmation_status = None

        await self.broadcast(text_data=json.dumps({'type': 'awaiting_amplifier_confirmation', 'range': amplifier_range}))
        await self.confirmation_event.wait()

        if self.confirmation_status != 'confirmed':
            await self.broadcast(text_data=json.dumps({'type': 'collection_stopped', 'message': 'Operation cancelled by user.'}))
            return False 

        await self.broadcast(text_data=json.dumps({'type': 'status_update', 'message': "Amplifier range confirmed by user."}))
        return True 

    async def set_amplifier_range(self, data):
        amplifier = None
        try:
            session_details = await self.get_session_details()
            amp_address = session_details.get('amplifier_address')
            amp_range = data.get('amplifier_range')
            if amp_address and amp_range:
                amplifier = await sync_to_async(_inst, thread_sensitive=True)(Instrument8100, model='8100', gpib=amp_address)
                await sync_to_async(amplifier.set_range, thread_sensitive=True)(range_amps=float(amp_range))
                await self.broadcast(text_data=json.dumps({'type': 'amplifier_range_set', 'message': 'Amplifier range set successfully.'}))
            else:
                await self.broadcast(text_data=json.dumps({'type': 'error', 'message': 'Amplifier address or range not configured for this session.'}))
        except Exception as e:
            traceback.print_exc()
            await self.broadcast(text_data=json.dumps({'type': 'error', 'message': f"Failed to set amplifier range: {e}"}))
        finally:
            if amplifier and hasattr(amplifier, 'close'):
                await sync_to_async(amplifier.close, thread_sensitive=True)()

    @sync_to_async(thread_sensitive=False)
    def _take_one_reading(self, instrument):
        return instrument.read_instrument()

    async def _take_reader_pair(
        self,
        std_reader,
        ti_reader,
        target_tvc="BOTH",
        *,
        reverse_order=False,
    ):
        """Read Standard/TI channels, serializing a shared 8508A correctly."""

        take_std = target_tvc in ("STD", "BOTH") and std_reader is not None
        take_ti = target_tvc in ("TI", "BOTH") and ti_reader is not None
        if (
            take_std
            and take_ti
            and isinstance(std_reader, Instrument8508A)
            and isinstance(ti_reader, Instrument8508A)
            and std_reader.gpib == ti_reader.gpib
        ):
            return await sync_to_async(std_reader.read_pair, thread_sensitive=False)(
                ti_reader,
                reverse_order=reverse_order,
            )

        tasks = [
            self._take_one_reading(std_reader) if take_std else asyncio.sleep(0),
            self._take_one_reading(ti_reader) if take_ti else asyncio.sleep(0),
        ]
        results = await asyncio.gather(*tasks)
        return (
            results[0] if take_std else None,
            results[1] if take_ti else None,
        )

    @staticmethod
    def _project_dc_from_ripple(samples, frequency, harmonics=2):
        """Recover the DC component from a noisy time-series that contains a
        coherent thermal ripple at exactly ``2 * frequency`` Hz.

        Background (the math, in one place so future maintainers can audit it):

          1. The bench drives a single-junction TVC with v(t) = V_pk * sin(wt),
             w = 2*pi*frequency. The TVC heater dissipates instantaneous power
             p(t) = v(t)**2 / R, so by the cosine-squared identity::

                p(t) = (V_pk**2 / 2R) * (1 - cos(2 w t))

             The TVC's thermocouple temperature, and therefore the DC voltage
             read by the 34420A, is a low-pass-filtered copy of p(t). The
             unfiltered components are exactly the DC term we want plus a
             coherent tone at 2f. Higher harmonics (4f, 6f, ...) creep in only
             via TVC nonlinearity; in practice 2f dominates and a small 4f
             cleanup helps at low currents.

          2. We have N timestamped readings ``y_i`` taken at irregular times
             ``t_i``. Standard "average all of them" implicitly assumes the 2f
             tone integrates to zero over the capture window, which is only
             true when the window spans exactly an integer number of ripple
             periods AND every NPLC sample also covers an integer number of
             ripple periods. Neither holds in practice, so the arithmetic mean
             is biased by however much ripple was unbalanced at the window
             edges.

          3. Instead of relying on cancellation, we *fit* the model::

                y_i ~ a + b*t' + c*cos(2*w*t_i) + d*sin(2*w*t_i)      (4 param)
                       + e*cos(4*w*t_i) + f*sin(4*w*t_i)               (6 param)

             where t' = t_i - T/2 is mean-centered time (zero at window
             midpoint). The linear ``b*t'`` term captures slow thermal drift
             during the capture window — important because cold TVCs (e.g.
             running at 0.8 V on a 1.0 V rated device, or partial-load shunt
             tests) may still be settling even after the minimum dwell time.
             Mean-centering ensures the constant ``a`` gives DC at the window
             midpoint, not the start, which is the more representative value
             under a drift scenario.

             via ordinary least squares. The closed-form solution is one
             ``numpy.linalg.lstsq`` call. The returned ``a`` is the DC
             estimate at the window midpoint; all other coefficients describe
             drift and ripple shape and are discarded. This is mathematically
             a single-bin DFT evaluated on a non-uniform grid: it does not
             assume integer-cycle alignment, it does not care that NPLC
             integration smeared each sample, and it does not care that the
             11 Hz analog filter on the 34420A shifted the ripple's phase -
             the cos/sin basis vectors absorb all of that, and the constant
             column captures only the DC.

          4. As a quality metric we also return the residual RMS::

                fit_residual_ppm = sqrt(SSR / (N-K)) / |a| * 1e6

             where SSR = sum((y_i - y_hat_i)**2) and K is the parameter count.
             This is the *random* noise that the fit could not explain and is
             the honest replacement for "stdev of the mean" on LF AC points -
             unlike stdev, it is not contaminated by the ripple itself.

        Args:
            samples: list of dicts, each shaped like
                ``{'value': float, 'timestamp': float_seconds}``
                (matches the ``std_point`` / ``ti_point`` records assembled in
                ``_perform_single_measurement``).
            frequency: the AC source's fundamental frequency (Hz). The ripple
                lives at ``2 * frequency``.
            harmonics: 1 fits only the 2f tone (4 LSQ parameters: DC + drift +
                2f); 2 also fits the 4f tone (6 parameters); 3 adds 6f (8
                parameters). Defaults to 2 for safety.

        Returns:
            ``(dc_value, fit_residual_ppm, n_used)`` tuple. ``dc_value`` is the
            recovered DC voltage in the same units as ``samples[i]['value']``.
            ``fit_residual_ppm`` is float('inf') when the fit is
            under-determined; in that case ``dc_value`` falls back to the
            arithmetic mean so the caller still gets *something* usable.
            ``n_used`` is the count of samples that survived NaN filtering.
        """
        cleaned = [
            (float(s['timestamp']), float(s['value']))
            for s in samples
            if s is not None
            and s.get('value') is not None
            and s.get('timestamp') is not None
            and math.isfinite(s.get('value', float('nan')))
        ]
        n = len(cleaned)
        if n == 0:
            return 0.0, float('inf'), 0

        # +1 for the linear drift term; model is now: a + b*t' + ripple harmonics
        n_params = 2 + 2 * max(1, int(harmonics))
        if n < n_params + 1 or frequency <= 0:
            mean_val = sum(v for _, v in cleaned) / n
            return mean_val, float('inf'), n

        t = np.array([t for t, _ in cleaned], dtype=np.float64)
        y = np.array([v for _, v in cleaned], dtype=np.float64)
        # Re-zero time so the cos/sin arguments stay numerically small.
        t -= t[0]
        # Mean-center time for the drift column: t_drift = 0 at the window
        # midpoint, so the constant term 'a' gives DC at the window center
        # rather than the start — the more representative value when the TVC
        # is still slowly settling during the capture window.
        t_drift = t - (t[-1] / 2.0)

        ripple_omega = 2.0 * 2.0 * math.pi * float(frequency)

        cols = [np.ones_like(t)]
        cols.append(t_drift)  # linear drift term — captures slow thermal settling
        for h in range(1, int(harmonics) + 1):
            cols.append(np.cos(h * ripple_omega * t))
            cols.append(np.sin(h * ripple_omega * t))
        design = np.column_stack(cols)

        try:
            coeffs, _residuals, rank, _sv = np.linalg.lstsq(design, y, rcond=None)
        except np.linalg.LinAlgError:
            return float(y.mean()), float('inf'), n

        if rank < n_params:
            return float(y.mean()), float('inf'), n

        dc_value = float(coeffs[0])
        y_hat = design @ coeffs
        ssr = float(np.sum((y - y_hat) ** 2))
        dof = max(n - n_params, 1)
        residual_rms = math.sqrt(ssr / dof)
        fit_residual_ppm = (
            (residual_rms / abs(dc_value)) * 1_000_000.0
            if abs(dc_value) > 1e-12
            else float('inf')
        )
        return dc_value, fit_residual_ppm, n

    # --- Server-side live buffer helpers ---
    # Mirror the frontend's InstrumentContext live state inside the consumer so
    # any viewer joining mid-run gets an authoritative snapshot from a single
    # source of truth (see ``request_live_sync`` handler in ``receive``).

    def _buffer_set_stage(self, stage, tp_id=None, total=0):
        """Record that ``stage`` is now in flight for ``tp_id`` and reset its arrays."""
        state = _get_live_state(self.session_id)
        state['isCollecting'] = True
        # The stage is now underway — retire any warm-up/settling countdown
        # so a late joiner sees "Collecting", not a stale timer.
        state['timerState'] = {'isActive': False}
        state['activeCollectionDetails'] = {'stage': stage, 'tpId': tp_id, 'readingKey': stage}
        state['liveReadings'][stage] = []
        state['tiLiveReadings'][stage] = []
        state['collectionProgress'] = {'count': 0, 'total': total}

    def _buffer_set_batch_point(self, test_point):
        """Mark a new test point in a batch run: wipe per-TP live arrays and refresh focus."""
        state = _get_live_state(self.session_id)
        state['isCollecting'] = True
        state['liveReadings'] = {}
        state['tiLiveReadings'] = {}
        if test_point:
            current = test_point.get('current')
            frequency = test_point.get('frequency')
            state['focusedTPKey'] = f"{current}-{frequency}"

    def _buffer_append_sample(self, stage, std_raw, ti_raw, count, total):
        """Upsert the latest STD/TI sample into the buffer, deduped by x=count."""
        state = _get_live_state(self.session_id)

        def _to_cached(raw):
            if raw is None:
                return None
            ts = raw.get('timestamp', 0) or 0
            return {
                'x': count,
                'y': raw.get('value'),
                't': int(ts * 1000),
                'is_stable': raw.get('is_stable', True),
            }

        def _upsert(bucket, point):
            if point is None:
                return
            arr = bucket.setdefault(stage, [])
            x = point.get('x')
            for i, existing in enumerate(arr):
                if existing.get('x') == x:
                    arr[i] = point
                    return
            arr.append(point)

        _upsert(state['liveReadings'], _to_cached(std_raw))
        _upsert(state['tiLiveReadings'], _to_cached(ti_raw))
        state['collectionProgress'] = {'count': count, 'total': total}

    def _buffer_clear(self):
        _clear_live_state(self.session_id)

    @database_sync_to_async
    def get_session_details(self):
        try:
            session = CalibrationSession.objects.get(pk=self.session_id)
            # Resolve every instrument address through the session's bench so a
            # centrally-hosted VM opens each instrument on the correct NI-VISA
            # remote host (visa://<host>/<addr>). Falls back to the default
            # (local) bench, whose blank visa_host leaves addresses untouched —
            # single-machine installs are unaffected. Skipped entirely under
            # MOCK_INSTRUMENTS so mock-address detection keeps working.
            ws = session.workstation or Workstation.get_default()
            mock = getattr(settings, "MOCK_INSTRUMENTS", False)

            def _addr(value):
                return value if mock else ws.resolve_resource(value)

            return {
                'ac_source_address': _addr(session.ac_source_address),
                'dc_source_address': _addr(session.dc_source_address),
                'std_reader_address': _addr(session.standard_reader_address),
                'std_reader_model': session.standard_reader_model,
                'std_reader_input': session.standard_reader_input,
                'ti_reader_address': _addr(session.test_reader_address),
                'ti_reader_model': session.test_reader_model,
                'ti_reader_input': session.test_reader_input,
                'amplifier_address': _addr(session.amplifier_address),
                'switch_driver_address': _addr(session.switch_driver_address),
            }
        except CalibrationSession.DoesNotExist: return None

    async def _verify_initial_reading(self, instrument, instrument_name, expected_value, tolerance=0.10):
        await self.broadcast(text_data=json.dumps({'type': 'status_update', 'message': f"Taking pre-check sample from {instrument_name}..."}))
        reading = await self._take_one_reading(instrument)
        
        lower_bound = expected_value * (1 - tolerance)
        upper_bound = expected_value * (1 + tolerance)
        reading_abs = abs(reading)

        if lower_bound <= reading_abs <= upper_bound:
            await self.broadcast(text_data=json.dumps({'type': 'status_update', 'message': f"{instrument_name} check passed. Reading: {reading_abs:.4f}V"}))
            return True
        else:
            await self.broadcast(text_data=json.dumps({'type': 'error', 'message': f"{instrument_name} pre-check failed. Reading: {reading_abs:.4f}V, Expected: ~{expected_value:.4f}V"}))
            return False

    async def _configure_sources(
        self,
        test_point_data,
        bypass_tvc,
        amplifier_range,
        ac_source=None,
        dc_source=None,
        measurement_params=None,
    ):
        if isinstance(test_point_data, list) and test_point_data:
            config_point = test_point_data[0]
        elif isinstance(test_point_data, dict):
            config_point = test_point_data
        else:
            print("[CONFIGURE_SOURCES] Warning: No valid test point data provided. Skipping.")
            return

        input_current = float(config_point.get('current'))
        voltage = (input_current / float(amplifier_range)) * 2

        if ac_source:
            frequency = float(config_point.get('frequency', 0))
            # Set initial voltage and frequency while in standby
            await sync_to_async(ac_source.set_output, thread_sensitive=True)(voltage=voltage, frequency=frequency)
            
            # ---> Send the XFER command immediately after configuring the AC source <---
            if hasattr(ac_source, 'set_ac_transfer'):
                await sync_to_async(ac_source.set_ac_transfer, thread_sensitive=True)(enabled=False)
        
        if dc_source:
            await sync_to_async(dc_source.set_output, thread_sensitive=True)(voltage=voltage, frequency=0)

    @staticmethod
    def _validate_reader_assignments(data, session_details):
        """Validate the model-selected 34420A or 8508A acquisition workflow."""

        measurement_params = dict(data.get('measurement_params') or {})
        measurement_params.pop('direct_source_test_mode', None)
        measurement_params.pop('direct_source_voltage', None)
        data['measurement_params'] = measurement_params

        details = session_details or {}
        std_is_8508 = '8508' in str(details.get('std_reader_model') or '').upper()
        ti_is_8508 = '8508' in str(details.get('ti_reader_model') or '').upper()
        if std_is_8508 != ti_is_8508:
            raise RuntimeError(
                "Use the 8508A for both Standard and Test reader roles, or use "
                "the existing 34420A workflow for both roles."
            )
        if not std_is_8508:
            return
        # TVC characterization belongs exclusively to the preserved
        # 34420A/A40B workflow. Ignore stale per-point flags when a session is
        # reassigned to the direct Y5020/8508A workflow.
        measurement_params['characterize_std_first'] = False
        measurement_params['characterize_test_first'] = False
        if details.get('std_reader_address') != details.get('ti_reader_address'):
            raise RuntimeError(
                "The 8508A workflow requires both reader roles to use the same "
                "physical 8508A."
            )
        terminals = {
            str(details.get('std_reader_input') or '').upper(),
            str(details.get('ti_reader_input') or '').upper(),
        }
        if terminals != {'FRONT', 'REAR'}:
            raise RuntimeError(
                "Assign the 8508A Standard and Test roles to opposite FRONT/REAR inputs."
            )

    async def _report_source_routing_state(self, session_details):
        """Make an un-routed dual-source setup visible before acquisition."""

        ac_address = session_details.get("ac_source_address")
        dc_address = session_details.get("dc_source_address")
        if (
            ac_address
            and dc_address
            and ac_address != dc_address
            and not session_details.get("switch_driver_address")
        ):
            message = (
                "Source routing warning: separate AC and DC calibrators are "
                "assigned, but no switch driver is assigned. Both sources are "
                "placed in OPERATE and the app cannot reroute them between "
                "AC/DC stages; verify an independent hardware routing method "
                "before accepting these readings."
            )
            print(f"[SOURCE ROUTING] {message}", flush=True)
            await self.broadcast(text_data=json.dumps({
                "type": "status_update",
                "message": message,
            }))

    async def _activate_sources(self, ac_source=None, dc_source=None):
        if ac_source:
            await sync_to_async(ac_source.set_operate, thread_sensitive=True)()
        if dc_source:
            if ac_source is not dc_source:
                await sync_to_async(dc_source.set_operate, thread_sensitive=True)()

    async def _perform_warmup(self, warmup_time, tp_id=None):
        if not warmup_time or warmup_time <= 0:
            return

        # Reflect the warm-up in the server-side live buffer *before* the
        # broadcast so a remote that joins (or reconnects) mid-warm-up gets
        # an authoritative snapshot showing the run is active and the timer
        # is counting down. The transient ``status_update`` below only
        # reaches sockets already connected; the buffer is what late joiners
        # replay from via ``request_live_sync``.
        #
        # ``tp_id`` is the point being warmed up (the run's first point). The
        # host pulses this point during warm-up because it set
        # ``activeCollectionDetails`` optimistically on start; recording it
        # here — and shipping it on the broadcast below — lets observers pulse
        # the same point before any ``calibration_stage_update`` has fired.
        state = _get_live_state(self.session_id)
        state['isCollecting'] = True
        if tp_id is not None:
            state['activeCollectionDetails'] = {'stage': None, 'tpId': tp_id, 'readingKey': None}
        state['timerState'] = {
            'isActive': True,
            'label': 'Warm-up',
            'duration': warmup_time,
            'endsAt': time.time() + warmup_time,
        }

        await self.broadcast(text_data=json.dumps({'type': 'status_update', 'message': f"Initial warm-up period started for {warmup_time}s...", 'tpId': tp_id}))

        try:
            await asyncio.sleep(warmup_time)
        except asyncio.CancelledError:
            # The timer no longer applies once the run is cancelled. Leave the
            # rest of the buffer alone — the stop/cleanup path clears it.
            state['timerState'] = {'isActive': False}
            raise

        # Warm-up finished: retire the countdown in the buffer so a remote
        # joining in the gap before the first stage update doesn't replay a
        # stale, already-expired timer.
        state['timerState'] = {'isActive': False}

        if not self.stop_event.is_set():
            await self.broadcast(text_data=json.dumps({'type': 'status_update', 'message': "Warm-up complete. Starting measurement."}))
    
    async def run_tvc_characterization(self, data):
        print(f"[TVC_CHAR] Entering run_tvc_characterization with data: {data}", flush=True)
        ac_source, dc_source, std_reader, ti_reader, amplifier, switch_driver = None, None, None, None, None, None
        characterization_completed = False
        try:
            print("[TVC_CHAR] Fetching session details...", flush=True)
            session_details = await self.get_session_details()
            if not session_details: raise Exception("Session not found.")
            self._validate_reader_assignments(data, session_details)
            if '8508' in str(session_details.get('std_reader_model') or '').upper():
                raise RuntimeError(
                    "TVC characterization is available only for the 34420A/A40B workflow."
                )

            std_addr, ti_addr = session_details.get('std_reader_address'), session_details.get('ti_reader_address')
            std_model, ti_model = session_details.get('std_reader_model'), session_details.get('ti_reader_model')

            # --- Source routing driven by the "characterization_source" setting ---
            # Default is "DC" (more stable, frequency-independent shunt gain);
            # "AC" preserves the legacy per-frequency behavior for users who
            # explicitly opt in from the Characterization section of Settings.
            char_source_kind = (data.get('characterization_source') or 'DC').upper()
            if char_source_kind not in ('AC', 'DC'):
                char_source_kind = 'DC'
            print(f"[TVC_CHAR] Source kind: {char_source_kind}", flush=True)

            ac_source_address = session_details.get('ac_source_address')
            dc_source_address = session_details.get('dc_source_address')

            # Handle the common case where the same physical unit (e.g. 5730A)
            # serves as both AC and DC source.
            if ac_source_address and dc_source_address and ac_source_address == dc_source_address:
                shared_source = await sync_to_async(_inst, thread_sensitive=True)(Instrument5730A, model="5730A", gpib=ac_source_address)
                ac_source, dc_source = shared_source, shared_source
            else:
                if ac_source_address:
                    ac_source = await sync_to_async(_inst, thread_sensitive=True)(Instrument5730A, model="5730A", gpib=ac_source_address)
                if dc_source_address:
                    dc_source = await sync_to_async(_inst, thread_sensitive=True)(Instrument5730A, model="5730A", gpib=dc_source_address)

            std_reader_class, ti_reader_class = INSTRUMENT_CLASS_MAP.get(std_model), INSTRUMENT_CLASS_MAP.get(ti_model)
            std_reader = await sync_to_async(_open_reader, thread_sensitive=True)(
                std_reader_class, std_model, std_addr, session_details.get("std_reader_input")
            )
            ti_reader = await sync_to_async(_open_reader, thread_sensitive=True)(
                ti_reader_class, ti_model, ti_addr, session_details.get("ti_reader_input")
            )

            if session_details.get('switch_driver_address'):
                switch_driver = await sync_to_async(_inst, thread_sensitive=True)(Instrument11713C, gpib=session_details.get('switch_driver_address'))
                await self.broadcast(text_data=json.dumps({'type': 'status_update', 'message': f"Switching to {char_source_kind} source for Characterization..."}))
                if char_source_kind == 'AC':
                    await sync_to_async(switch_driver.select_ac_source, thread_sensitive=True)()
                else:
                    await sync_to_async(switch_driver.select_dc_source, thread_sensitive=True)()
                await self.broadcast(text_data=json.dumps({'type': 'switch_status_update', 'active_source': char_source_kind}))
                await asyncio.sleep(1)

            original_tp = data.get('test_point')
            nominal_current = float(original_tp.get('current'))

            # --- EXTRACT TARGET FROM PAYLOAD ---
            target_tvc = data.get('target_tvc', 'BOTH')
            print(f"[TVC_CHAR] Targeting: {target_tvc}", flush=True)

            # ``dict.get`` only returns the default when the key is missing,
            # not when the value is present-but-``None``. Frontend payloads
            # often send ``initial_warm_up_time: null`` which would crash the
            # ``warmup_time > 0`` comparison; ``or 0`` coerces null/0/'' to 0.
            warmup_time = data.get('initial_warm_up_time') or 0

            # During warm-up, always energize/configure both AC and DC sources so
            # the timer preconditions the full source chain before calibration.
            # For no-warmup characterization runs, keep existing single-source behavior.
            if warmup_time > 0:
                await self._configure_sources(
                    original_tp,
                    data.get('bypass_tvc'),
                    data.get('amplifier_range'),
                    ac_source=ac_source,
                    dc_source=dc_source
                )
            else:
                configure_kwargs = {'ac_source': ac_source} if char_source_kind == 'AC' else {'dc_source': dc_source}
                await self._configure_sources(original_tp, data.get('bypass_tvc'), data.get('amplifier_range'), **configure_kwargs)

            if session_details.get('amplifier_address'):
                amplifier = await sync_to_async(_inst, thread_sensitive=True)(
                    Instrument8100,
                    model='8100',
                    gpib=session_details.get('amplifier_address'),
                    reset_on_connect=not data.get('bypass_amplifier_confirmation')
                )
                if not await self._handle_amplifier_confirmation(amplifier, data.get('amplifier_range'), data): return

            if warmup_time > 0:
                await self._activate_sources(ac_source=ac_source, dc_source=dc_source)
            else:
                activate_kwargs = {'ac_source': ac_source} if char_source_kind == 'AC' else {'dc_source': dc_source}
                await self._activate_sources(**activate_kwargs)

            if warmup_time > 0:
                await self._perform_warmup(warmup_time, tp_id=original_tp.get('id'))

            settling_time, num_samples = float(data.get('settling_time', 5.0)), data.get('num_samples', 8)
            nplc_setting, measurement_params = data.get('nplc'), data.get('measurement_params')

            # === TARGETED DB CLEANUP BLOCK ===
            try:
                tp_id = original_tp.get('id')
                if tp_id:
                    readings_obj = await database_sync_to_async(CalibrationReadings.objects.get)(test_point__id=tp_id)
                    # Only wipe the arrays for the instrument we are actively characterizing
                    if target_tvc in ['STD', 'BOTH']:
                        readings_obj.std_char_plus1_readings = []
                        readings_obj.std_char_minus_readings = []
                        readings_obj.std_char_plus2_readings = []
                    if target_tvc in ['TI', 'BOTH']:
                        readings_obj.ti_char_plus1_readings = []
                        readings_obj.ti_char_minus_readings = []
                        readings_obj.ti_char_plus2_readings = []
                    await database_sync_to_async(readings_obj.save)()
                    print(f"[TVC_CHAR] Wiped previous {target_tvc} characterization data.", flush=True)
            except Exception as e:
                pass
            # === END CLEANUP ===

            tvc_sequence = [
                ('char_plus1', 1.0005),
                ('char_minus', 0.9995),
                ('char_plus2', 1.0005)
            ]

            print("[TVC_CHAR] ===== STARTING CHARACTERIZATION LOOP =====", flush=True)
            active_source = ac_source if char_source_kind == 'AC' else dc_source
            all_stages_completed = True
            for stage, ppm_multiplier in tvc_sequence:
                if self.stop_event.is_set():
                    all_stages_completed = False
                    break

                ppm_shifted_tp = original_tp.copy()
                ppm_shifted_tp['current'] = nominal_current * ppm_multiplier

                # --- INJECT TARGET + SOURCE KIND INTO TEST POINT ---
                # characterization_source lets _perform_single_measurement
                # decide whether this char stage should be treated as an AC
                # or DC reading (instrument config, reader mode, etc.).
                ppm_shifted_tp['target_tvc'] = target_tvc
                ppm_shifted_tp['characterization_source'] = char_source_kind

                self._buffer_set_stage(stage, tp_id=original_tp.get('id'), total=num_samples)
                await self.broadcast(text_data=json.dumps({'type': 'calibration_stage_update', 'stage': stage, 'total': num_samples, 'tpId': original_tp.get('id')}))

                success = await self._perform_single_measurement(
                    stage, num_samples, ppm_shifted_tp, data.get('bypass_tvc'),
                    data.get('amplifier_range'), active_source, std_reader, ti_reader,
                    amplifier, settling_time, nplc_setting, measurement_params,
                )
                
                if not success: 
                    all_stages_completed = False
                    if not self.stop_event.is_set():
                        await self.broadcast(text_data=json.dumps({'type': 'error', 'message': f"Characterization aborted: Stability limit reached on {stage}."}))
                    break 

            if all_stages_completed and not self.stop_event.is_set():
                print("[TVC_CHAR] Sequence completed successfully!", flush=True)

                # --- Propagate freshly-computed eta to sibling points in the session ---
                # update_related_results() in save_readings_to_db has already written
                # eta_std / eta_ti onto this TP's CalibrationResults row. For a batch
                # that only characterizes once (e.g. "Characterize Test TVC before run"),
                # every other selected point would otherwise fall back to eta=1.0
                # inside calculate_ac_dc_difference(). Backfill them now so the real
                # gain is used downstream.
                try:
                    tp_id_for_prop = (original_tp or {}).get('id')
                    if tp_id_for_prop:
                        await self._propagate_characterization_eta(
                            tp_id_for_prop, target_tvc, char_source_kind
                        )
                except Exception as prop_err:
                    # Propagation is best-effort; never block the user-visible
                    # "characterization complete" signal because of it.
                    print(f"[TVC_CHAR] Eta propagation step failed: {prop_err}", flush=True)

                await self.broadcast(text_data=json.dumps({'type': 'collection_finished', 'message': 'Sensitivity Characterization complete.'}))
                characterization_completed = True

        except asyncio.CancelledError:
            print(f"[TVC_CHAR] Task cancelled.", flush=True)
        except Exception as e:
            traceback.print_exc()
            await self.broadcast(text_data=json.dumps({'type': 'error', 'message': f"An instrument error occurred: {e}"}))
        finally:
            self.state = "IDLE"
            self._buffer_clear()
            if switch_driver and hasattr(switch_driver, 'close'):
                await sync_to_async(switch_driver.close, thread_sensitive=True)()
            # Reset whichever source(s) we actually instantiated. When
            # AC and DC share the same physical unit, the set dedupes for us.
            for src in filter(None, {ac_source, dc_source}):
                await sync_to_async(src.reset, thread_sensitive=True)()
            if amplifier and not characterization_completed:
                await sync_to_async(amplifier.set_standby, thread_sensitive=True)()
            for inst in filter(None, {std_reader, ti_reader, amplifier, ac_source, dc_source}):
                if hasattr(inst, 'close'):
                    if inst is amplifier and characterization_completed:
                        await sync_to_async(inst.close, thread_sensitive=True)(reset=False)
                    else:
                        await sync_to_async(inst.close, thread_sensitive=True)()

    def _is_low_frequency_ac(self, reading_type_base, test_point_data):
        """Helper to detect if the current stage is low-frequency AC."""
        # Mirror the exact AC detection logic from the main function
        if 'char' in reading_type_base:
            char_source = (test_point_data.get('characterization_source') or 'DC').upper()
            is_ac_reading = (char_source == 'AC')
        else:
            is_ac_reading = 'ac' in reading_type_base

        if not is_ac_reading:
            return False
            
        freq = float(test_point_data.get('frequency', 0))
        return 0 < freq <= 40

    def _cycle_average_duration(self, frequency, num_samples, nplc_setting=None, line_freq=60.0):
        """Compute the wall-clock duration of the LF AC capture window.
        
        Translates the user's requested number of samples into a time duration 
        based on NPLC speed, pads for GPIB overhead, and mathematically snaps
        up to the nearest perfect integer cycle to guarantee matrix orthogonality.
        """
        if frequency <= 0:
            return 1.0

        target_samples = float(num_samples)
        
        # Calculate time per reading based on NPLC
        if nplc_setting is not None:
            try:
                nplc_seconds = float(nplc_setting) / float(line_freq)
            except (TypeError, ValueError):
                nplc_seconds = 0.333
        else:
            nplc_seconds = 0.333

        # 1. Raw time required to gather the requested samples
        raw_target_time = target_samples * nplc_seconds
        
        # 2. Add 1.0s buffer for analog filter settle and GPIB overhead
        safe_target_time = raw_target_time + 1.0

        # 3. Snap up to the next perfect integer cycle
        required_cycles = math.ceil(safe_target_time * frequency)
        duration = required_cycles / frequency

        return max(duration, 1.0)

    # ------------------------------------------------------------------
    # N-cycle helpers (Type A uncertainty for AC-DC difference)
    # ------------------------------------------------------------------
    def _tag_readings_with_cycle(self, readings, cycle_index):
        """Attach a 1-based `cycle` key to every reading dict in-place and
        return the same list. Idempotent — if a reading already has a
        `cycle`, leave it alone (e.g. for re-saves or merges)."""
        if cycle_index is None:
            return readings
        for r in readings or []:
            if isinstance(r, dict) and 'cycle' not in r:
                r['cycle'] = cycle_index
        return readings

    def _drop_cycle_from_readings(self, readings, cycle_index):
        """Return a copy of ``readings`` with every entry tagged for
        ``cycle_index`` removed. Used before re-appending a freshly-collected
        cycle so re-running a cycle *replaces* its readings instead of
        duplicating them (which otherwise inflates the per-cycle sample count,
        e.g. cycle 1 showing 12 readings instead of 6). Untagged legacy
        readings count as cycle 1, matching the chart's bucketing. When
        ``cycle_index`` is None there is nothing to scope to, so the list is
        returned unchanged."""
        if cycle_index is None:
            return list(readings or [])
        return [
            r for r in (readings or [])
            if not (isinstance(r, dict) and int(r.get('cycle', 1)) == cycle_index)
        ]

    @database_sync_to_async
    def _read_existing_phase_readings(self, test_point_data, reading_type_full):
        """Return the currently-persisted JSON list for a phase, or [] if
        the row doesn't exist yet. Used to merge prior cycles' readings
        before the outbox overwrites the field."""
        tp_id = (test_point_data or {}).get('id')
        try:
            if tp_id:
                readings = CalibrationReadings.objects.get(test_point_id=tp_id)
            else:
                tps = TestPointSet.objects.get(session_id=self.session_id)
                tp = TestPoint.objects.get(
                    test_point_set=tps,
                    current=test_point_data.get('current'),
                    frequency=test_point_data.get('frequency'),
                    direction=test_point_data.get('direction', 'Forward'),
                )
                readings = CalibrationReadings.objects.get(test_point=tp)
        except (CalibrationReadings.DoesNotExist, TestPointSet.DoesNotExist, TestPoint.DoesNotExist):
            return []
        return getattr(readings, f"{reading_type_full}_readings", []) or []

    @database_sync_to_async
    def _finalize_cycle_sync(self, test_point_data, cycle_index):
        """Compute and persist one CalibrationResultsCycle row from the
        readings that were just captured for `cycle_index`.

        Pulls the readings JSON, slices by `cycle == cycle_index`,
        Welfords per-phase avg/stddev, and uses the shared pure δ
        formula. Idempotent: re-running for the same (test point, cycle)
        updates the existing row."""
        tp_id = (test_point_data or {}).get('id')
        if not tp_id:
            return None
        try:
            tp = TestPoint.objects.get(pk=tp_id)
            readings_obj = CalibrationReadings.objects.get(test_point=tp)
        except (TestPoint.DoesNotExist, CalibrationReadings.DoesNotExist):
            return None

        results, _ = CalibrationResults.objects.get_or_create(test_point=tp)
        # Make sure the gain / correction fields are populated so the per-
        # cycle δ uses the same eta / delta_std / delta_ti / delta_std_known
        # the aggregate calculation would use.
        results.fetch_automatic_corrections()
        results.refresh_from_db()

        phase_keys = (
            'std_ac_open', 'std_dc_pos', 'std_dc_neg', 'std_ac_close',
            'ti_ac_open', 'ti_dc_pos', 'ti_dc_neg', 'ti_ac_close',
        )
        cycle_row, _ = CalibrationResultsCycle.objects.get_or_create(
            results=results, cycle_index=cycle_index,
        )

        phase_avgs = {}
        for phase in phase_keys:
            raw = getattr(readings_obj, f"{phase}_readings", None) or []
            # Treat un-tagged legacy readings as cycle 1 so old data still renders.
            cycle_vals = [
                r['value']
                for r in raw
                if isinstance(r, dict)
                and 'value' in r
                and r.get('is_stable', True)
                and int(r.get('cycle', 1)) == cycle_index
            ]
            mean_val, std_dev = welford_mean_stddev(cycle_vals)
            setattr(cycle_row, f"{phase}_avg", mean_val)
            setattr(cycle_row, f"{phase}_stddev", std_dev)
            phase_avgs[f"{phase}_avg"] = mean_val

        cycle_row.delta_uut_ppm = compute_delta_uut_ppm(
            phase_avgs,
            eta_std=results.eta_std,
            eta_ti=results.eta_ti,
            delta_std=results.delta_std,
            delta_ti=results.delta_ti,
            delta_std_known=results.delta_std_known,
        )
        cycle_row.save()

        # Roll up onto the parent results row, then onto the pair-level
        # aggregate so the CycleStatisticsTracker headline (mean / u_A / N)
        # updates live alongside the chart instead of staying blank until
        # the operator toggles an analytics control. Early-returns when the
        # sibling direction has no results yet, so partial pairs are safe.
        results.recompute_cycle_aggregates()
        results.recompute_pair_aggregate()
        return cycle_row.delta_uut_ppm

    async def _finalize_cycle(self, test_point_data, cycle_index):
        """Async wrapper that also broadcasts a status update so the UI
        can populate the new statistics modal in real time."""
        delta = await self._finalize_cycle_sync(test_point_data, cycle_index)
        try:
            await self.broadcast(text_data=json.dumps({
                'type': 'cycle_finalized',
                'tpId': (test_point_data or {}).get('id'),
                'cycle_index': cycle_index,
                'delta_uut_ppm': delta,
            }))
        except Exception:
            pass
        return delta

    async def _resolve_n_cycles(self, test_point_data, fallback=3):
        """Pick the N for a test point: explicit setting on the TestPoint
        wins, then `data.get('n_cycles')` (frontend per-run override),
        then fallback. Floor at 2."""
        tp_id = (test_point_data or {}).get('id')
        if tp_id:
            n = await database_sync_to_async(
                lambda: CalibrationSettings.objects.filter(test_point_id=tp_id)
                .values_list('n_cycles', flat=True).first()
            )()
            if n:
                return max(2, int(n))
        override = (test_point_data or {}).get('n_cycles')
        if override:
            return max(2, int(override))
        return max(2, int(fallback))

    async def _perform_single_measurement(self, reading_type_base, num_samples, test_point_data, bypass_tvc, amplifier_range, source_instrument, std_reader_instrument, ti_reader_instrument, amplifier_instrument=None, settling_time=0, nplc_setting=None, measurement_params=None, cycle_index=None):
        """
        Refactored measurement logic: 
        1. Phase 1 (Search): Discards samples (slides window) until initial stability is found.
        2. Phase 2 (Collection): Collects num_samples while monitoring stability.
        3. Abort: Returns False if max_attempts is reached.
        """
        measurement_params = measurement_params or {}

        # Standard stages are classified purely by their name; characterization
        # stages ("char_*") defer to the caller's chosen source kind.
        if 'char' in reading_type_base:
            char_source = (test_point_data.get('characterization_source') or 'DC').upper()
            is_ac_reading = (char_source == 'AC')
        else:
            is_ac_reading = 'ac' in reading_type_base
        target_tvc = test_point_data.get('target_tvc', 'BOTH')
        
        # --- 1. Calculate Source Drive Voltage ---
        input_current = float(test_point_data.get('current'))
        if amplifier_range is None:
            raise ValueError(
                "An amplifier range is required for the AC Shunt signal path."
            )
        source_drive_voltage = (input_current / float(amplifier_range)) * 2
        if 'neg' in reading_type_base: 
            source_drive_voltage = -source_drive_voltage
        
        abs_source_drive = abs(source_drive_voltage)
        point_frequency = float(test_point_data.get('frequency', 0))
        source_frequency = point_frequency if is_ac_reading else 0
        ignore_after_lock = measurement_params.get('ignore_instability_after_lock', False)

        # Instrument Configuration (Standard and TI) - Targeted Isolation
        instruments_to_config = []
        if target_tvc in ['STD', 'BOTH'] and std_reader_instrument:
            instruments_to_config.append(std_reader_instrument)
        if target_tvc in ['TI', 'BOTH'] and ti_reader_instrument:
            instruments_to_config.append(ti_reader_instrument)

        # --- Low Frequency AC Detection ---
        # Harmonic projection is part of the legacy 34420A/A40B path only.
        uses_only_34420_readers = bool(instruments_to_config) and all(
            isinstance(instrument, Instrument34420A)
            for instrument in instruments_to_config
        )
        is_lf_ac = self._is_low_frequency_ac(reading_type_base, test_point_data)
        lf_settings_enabled = bool(measurement_params.get('enable_low_frequency_settings', False))
        effective_lf_ac = is_lf_ac and lf_settings_enabled and uses_only_34420_readers
        enable_11hz_filter = effective_lf_ac and bool(measurement_params.get('enable_11hz_filter', False))
        hp_enabled = effective_lf_ac and bool(measurement_params.get('lf_harmonic_projection', False))

        # --- 2. Determine Expected TVC Output Voltage ---
        # Used strictly for the 34420A on the real workbench to safely engage the analog filter
        expected_tvc_output_v = float(test_point_data.get('expected_tvc_output_mv', 10.0)) / 1000.0
        expected_y5020_output_v = _8508_expected_y5020_voltage(test_point_data)

        for instrument in instruments_to_config:
            if isinstance(instrument, Instrument34420A) and nplc_setting is not None:
                await sync_to_async(instrument.set_integration, thread_sensitive=True)(setting=nplc_setting)
                await sync_to_async(instrument.device.write, thread_sensitive=True)(f"SENSe:VOLTage:DC:RANGe {expected_tvc_output_v}")
                
                # WORKBENCH: Engage analog filter for LF AC if explicitly requested and under 120mV.
                if effective_lf_ac and enable_11hz_filter and expected_tvc_output_v <= 0.12:
                    try:
                        await sync_to_async(instrument.device.write, thread_sensitive=True)("INP:FILT:TYPE ANAL")
                        await sync_to_async(instrument.device.write, thread_sensitive=True)("INP:FILT:STAT ON")
                    except Exception as e:
                        print(f"Failed to enable 34420A analog filter: {e}")
                else:
                    try:
                        await sync_to_async(instrument.device.write, thread_sensitive=True)("INP:FILT:STAT OFF")
                    except Exception as e:
                        pass
            
            elif isinstance(instrument, Instrument5790B): 
                # TEST LAB: The 5790B reads the RAW source voltage directly.
                await sync_to_async(instrument.set_range, thread_sensitive=True)(value=abs_source_drive)
                await sync_to_async(instrument.resource.write, thread_sensitive=True)("HIRES OFF")
                # Automatically apply SLOW digital filter for LF AC to combat ripple
                if effective_lf_ac:
                    await sync_to_async(instrument.resource.write, thread_sensitive=True)("DFILT SLOW,COARSE")
                else:
                    await sync_to_async(instrument.resource.write, thread_sensitive=True)("DFILT FAST,COARSE")
            
            elif isinstance(instrument, Instrument3458A): 
                # TEST LAB: The 3458A reads the RAW source voltage directly.
                await sync_to_async(instrument.configure_measurement, thread_sensitive=True)(
                    **{'function': 'ACV' if is_ac_reading else 'DCV', 'expected_value': abs_source_drive, 'frequency': source_frequency}
                )

            elif isinstance(instrument, Instrument8508A):
                await sync_to_async(
                    _configure_8508_for_y5020,
                    thread_sensitive=True,
                )(
                    instrument,
                    is_ac_reading,
                    point_frequency,
                    expected_y5020_output_v,
                    measurement_params,
                )

        configured_8508 = next(
            (
                instrument
                for instrument in instruments_to_config
                if isinstance(instrument, Instrument8508A)
            ),
            None,
        )
        if configured_8508 is not None:
            profile = await sync_to_async(
                configured_8508.get_acquisition_profile,
                thread_sensitive=True,
            )()
            std_terminal = getattr(std_reader_instrument, "input_terminal", None)
            ti_terminal = getattr(ti_reader_instrument, "input_terminal", None)
            message = (
                f"8508A profile: {profile['measurement_command']}; "
                f"trigger {profile['trigger_source']}; "
                f"terminal-switch settle {profile['input_switch_delay_s']:g}s; "
                f"Standard={getattr(std_terminal, 'value', std_terminal) or 'N/A'}, "
                f"TI={getattr(ti_terminal, 'value', ti_terminal) or 'N/A'}."
            )
            print(f"[8508A] {reading_type_base}: {message}", flush=True)
            await self.broadcast(text_data=json.dumps({
                "type": "status_update",
                "message": message,
            }))

        # The selected source continues through the existing switch/8100 path.
        await sync_to_async(source_instrument.set_output, thread_sensitive=True)(voltage=source_drive_voltage, frequency=source_frequency)
        
        try:
            await asyncio.sleep(1.5)
        except asyncio.CancelledError:
            raise
        
        # Enforce longer settling times for LF AC
        actual_settling_time = float(settling_time)
        if effective_lf_ac:
            lf_settling = float(measurement_params.get('min_low_freq_settling_time', 30.0))
            if lf_settling > actual_settling_time:
                actual_settling_time = lf_settling

        if actual_settling_time > 0:
            await self.broadcast(text_data=json.dumps({'type': 'status_update', 'message': f"Settling for {actual_settling_time}s..."}))
            await asyncio.sleep(actual_settling_time)

        tp_id = test_point_data.get('id')
        if tp_id:
            await self.set_test_point_failed_status(tp_id, False)

        # Final saved array
        final_std_readings = []
        final_ti_readings = []

        def get_target_length():
            return len(final_std_readings) if target_tvc in ['STD', 'BOTH'] else len(final_ti_readings)

        # =====================================================================
        # BRANCH 1: LOW FREQUENCY AC - HARMONIC PROJECTION
        # =====================================================================
        # The TVC produces DC + a coherent 2f thermal ripple. We collect
        # timestamped samples for a window long enough to (a) span several
        # ripple periods and (b) gather >= ``lf_min_samples`` readings at the
        # operator's chosen NPLC, then either:
        #   * fit  y = a + sum_h ( b_h cos(2 pi 2f h t) + c_h sin(...) )
        #     and report ``a`` as the DC answer (default), or
        #   * fall back to the legacy arithmetic mean if the operator turned
        #     ``lf_harmonic_projection`` off for an A/B comparison.
        # See ``_project_dc_from_ripple`` for the full derivation.
        if effective_lf_ac and hp_enabled:
            harmonic_projection = True # Hardcoded to true since we only enter this branch if enabled
            harmonics = int(measurement_params.get('lf_harmonics', 2))
            
            # Calculate the mathematically perfect duration
            duration = self._cycle_average_duration(
                point_frequency, num_samples, nplc_setting=nplc_setting,
            )

            await self.broadcast(text_data=json.dumps({
                'type': 'status_update',
                'message': f"Capturing {point_frequency}Hz for {duration:.1f}s (Harmonic Projection)...",
            }))

            start_time = time.time()
            collected_std = []
            collected_ti = []
            sample_count = 0

            while (time.time() - start_time) < duration and not self.stop_event.is_set():
                std_reading_val, ti_reading_val = await self._take_reader_pair(
                    std_reader_instrument,
                    ti_reader_instrument,
                    target_tvc,
                    reverse_order=bool(sample_count % 2),
                )
                # Approximate the integration midpoint: the gather completes at
                # end-of-integration, so subtract half the integration window.
                # This matters for the drift term, which evaluates at a specific
                # position within the capture window.
                half_integration = float(nplc_setting or 20) / (60.0 * 2.0)
                ts = time.time() - half_integration

                std_point = {'value': std_reading_val, 'timestamp': ts, 'is_stable': True} if std_reading_val is not None else None
                ti_point = {'value': ti_reading_val, 'timestamp': ts, 'is_stable': True} if ti_reading_val is not None else None

                if std_point: collected_std.append(std_point)
                if ti_point: collected_ti.append(ti_point)
                sample_count += 1

                self._buffer_append_sample(reading_type_base, std_point, ti_point, sample_count, sample_count)

                await self.broadcast(text_data=json.dumps({
                    'type': 'dual_reading_update',
                    'std_reading': std_point,
                    'ti_reading': ti_point,
                    'count': sample_count,
                    'stable_count': sample_count,
                    'total': '∞',
                    'stage': reading_type_base
                }))
                await asyncio.sleep(0.05)

            if not self.stop_event.is_set():
                final_ts = time.time()

                def _condense(points, label):
                    """Project DC out of the ripple."""
                    if not points:
                        return None
                    dc_value, residual_ppm, n_used = CalibrationConsumer._project_dc_from_ripple(
                        points, point_frequency, harmonics=harmonics,
                    )
                    if math.isfinite(residual_ppm):
                        note = (
                            f"{label}: harmonic fit DC = {dc_value:.6g} "
                            f"(residual {residual_ppm:.2f} ppm, N={n_used}, "
                            f"{harmonics} harmonic{'s' if harmonics != 1 else ''})"
                        )
                    else:
                        note = (
                            f"{label}: harmonic fit fell back to mean = {dc_value:.6g} "
                            f"(N={n_used}, fit under-determined)"
                        )
                    return dc_value, residual_ppm, note

                std_summary = _condense(collected_std, 'STD')
                ti_summary = _condense(collected_ti, 'TI')

                if std_summary is not None:
                    final_std_readings.append({'value': std_summary[0], 'timestamp': final_ts, 'is_stable': True})
                if ti_summary is not None:
                    final_ti_readings.append({'value': ti_summary[0], 'timestamp': final_ts, 'is_stable': True})

                primary_summary = std_summary if (target_tvc in ['STD', 'BOTH'] and std_summary) else ti_summary
                if primary_summary is not None:
                    _dc, primary_residual_ppm, primary_note = primary_summary
                    await self.broadcast(text_data=json.dumps({
                        'type': 'sliding_window_update',
                        'ppm': None if not math.isfinite(primary_residual_ppm) else primary_residual_ppm,
                        'stdev_ppm': None if not math.isfinite(primary_residual_ppm) else primary_residual_ppm,
                        'fit_residual_ppm': None if not math.isfinite(primary_residual_ppm) else primary_residual_ppm,
                        'is_stable': True,
                        'instability_events': 0,
                        'max_retries': measurement_params.get('max_attempts', 0),
                        'mode': 'harmonic_projection',
                    }))
                    await self.broadcast(text_data=json.dumps({
                        'type': 'status_update',
                        'message': primary_note,
                    }))

        # =====================================================================
        # BRANCH 2: STANDARD SLIDING WINDOW (DC & High Freq AC)
        # =====================================================================
        else:
            # Stability Logic Setup
            stability_method = measurement_params.get('stability_check_method', 'sliding_window')
            max_retries = measurement_params.get('max_attempts', 50)
            instability_events = 0
            window_size = measurement_params.get('window', 30)
            threshold_ppm = measurement_params.get('threshold_ppm', 10)

            # Temporary buffers for search phase
            stable_candidate_std = []
            stable_candidate_ti = []

           # Treat the first characterization stage like "Cycle 1" (finds lock), 
            # and subsequent stages like "Cycle 2+" (bypasses lock to avoid thermal shock aborts).
            is_subsequent_char_stage = ('char' in reading_type_base) and (reading_type_base != 'char_plus1')

            # When the operator has bypass-after-initial enabled and we're on
            # any cycle past the first (or a subsequent char stage), skip the initial-stability search
            # entirely...
            skip_initial_check = (
                stability_method == 'sliding_window'
                and ignore_after_lock
                and (
                    (cycle_index is not None and cycle_index > 1) or
                    is_subsequent_char_stage
                )
            )

            # --- LOGGING INSTRUMENTATION ---
            if skip_initial_check:
                print(f"[STABILITY] Bypassing search phase for stage: {reading_type_base} (Cycle: {cycle_index})", flush=True)
            else:
                print(f"[STABILITY] Search phase ENABLED for stage: {reading_type_base} (Cycle: {cycle_index})", flush=True)
            # -------------------------------

            initial_stability_achieved = skip_initial_check

            def calc_ppm(points):
                """Welford's Algorithm for high-precision variance calculation."""
                if len(points) < 2: return float('inf')
                mean_val = 0.0
                M2 = 0.0
                for index, p in enumerate(points):
                    val = p['value']
                    delta = val - mean_val
                    mean_val += delta / (index + 1)
                    M2 += delta * (val - mean_val)
                variance = M2 / (len(points) - 1)
                stdev_val = math.sqrt(variance)
                return (stdev_val / abs(mean_val)) * 1_000_000 if abs(mean_val) > 1e-9 else 0

            await self.broadcast(text_data=json.dumps({'type': 'status_update', 'message': "Monitoring stability..."}))

            # Replaces raw final_std_readings length with the dynamic targeted check
            pair_index = 0
            while get_target_length() < num_samples and not self.stop_event.is_set():
                # 1. Global Abort Check (Applies to both Search and Collection phases)
                if instability_events >= max_retries:
                    tp_key = f"{test_point_data.get('current')}-{test_point_data.get('frequency')}"
                    if tp_id:
                        await self.set_test_point_failed_status(tp_id, True)
                    await self.broadcast(text_data=json.dumps({
                        'type': 'warning',
                        'message': f"Test point aborted: Stability limit ({max_retries}) reached.",
                        'tpKey': tp_key
                    }))
                    return False

                # 2. Take Readings (Targeted Instrument Querying)
                std_reading_val, ti_reading_val = await self._take_reader_pair(
                    std_reader_instrument,
                    ti_reader_instrument,
                    target_tvc,
                    reverse_order=bool(pair_index % 2),
                )
                pair_index += 1
                
                timestamp = time.time()
                
                # None creation protects downstream arrays from bloating with fake points
                std_point = {'value': std_reading_val, 'timestamp': timestamp, 'is_stable': True} if std_reading_val is not None else None
                ti_point = {'value': ti_reading_val, 'timestamp': timestamp, 'is_stable': True} if ti_reading_val is not None else None

                if stability_method == 'sliding_window':
                    if std_point: stable_candidate_std.append(std_point)
                    if ti_point: stable_candidate_ti.append(ti_point)

                    # Route the window length checks and math to whichever array is actively growing
                    primary_candidates = stable_candidate_std if target_tvc in ['STD', 'BOTH'] else stable_candidate_ti

                    if skip_initial_check:
                        # Bypass-mode follow-up cycles: no search phase, no
                        # failure path — collect num_samples directly. The
                        # rolling candidate buffer is only kept around so the
                        # live UI ppm reading stays representative.
                        if std_point: final_std_readings.append(std_point)
                        if ti_point: final_ti_readings.append(ti_point)
                        if len(stable_candidate_std) > window_size:
                            stable_candidate_std.pop(0)
                        if len(stable_candidate_ti) > window_size:
                            stable_candidate_ti.pop(0)
                        current_ppm = (
                            calc_ppm(primary_candidates[-window_size:])
                            if len(primary_candidates) >= 2 else None
                        )
                        await self.broadcast(text_data=json.dumps({
                            'type': 'sliding_window_update',
                            'ppm': current_ppm,
                            'stdev_ppm': current_ppm,
                            'is_stable': True,
                            'instability_events': 0,
                            'max_retries': max_retries,
                        }))
                        # Keep the status bar informative — show the rolling
                        # PPM so an operator can still eyeball stability even
                        # though we're not gating collection on it.
                        ppm_text = (
                            f"{current_ppm:.2f} PPM" if current_ppm is not None else "--"
                        )
                        await self.broadcast(text_data=json.dumps({
                            'type': 'status_update',
                            'message': (
                                f"Stdev: {ppm_text} "
                                f"(cycle {cycle_index}, initial check skipped)"
                            ),
                        }))
                    elif len(primary_candidates) >= window_size:
                        # Analyze current window
                        current_window = primary_candidates[-window_size:]
                        current_ppm = calc_ppm(current_window)
                        is_currently_stable = current_ppm < threshold_ppm

                        # --- EVALUATE STABILITY & INCREMENT BEFORE SENDING ---
                        if not initial_stability_achieved:
                            if is_currently_stable:
                                initial_stability_achieved = True
                                if std_point: final_std_readings.extend(stable_candidate_std)
                                if ti_point: final_ti_readings.extend(stable_candidate_ti)
                            else:
                                # SEARCH PHASE: Unstable. Increment retry count and slide window
                                instability_events += 1
                                if std_point: stable_candidate_std.pop(0)
                                if ti_point: stable_candidate_ti.pop(0)
                        else:
                            # COLLECTION PHASE: Monitor but keep all samples
                            if not is_currently_stable and not ignore_after_lock:
                                instability_events += 1
                            if std_point: final_std_readings.append(std_point)
                            if ti_point: final_ti_readings.append(ti_point)

                        # --- NOW SEND UPDATES WITH THE ACCURATE METRICS ---
                        await self.broadcast(text_data=json.dumps({
                            'type': 'sliding_window_update',
                            'ppm': current_ppm,
                            'stdev_ppm': current_ppm,
                            'is_stable': is_currently_stable,
                            'instability_events': instability_events,
                            'max_retries': max_retries
                        }))
                        
                        await self.broadcast(text_data=json.dumps({
                            'type': 'status_update',
                            'message': f"Stdev: {current_ppm:.2f} PPM [{instability_events}/{max_retries}]"
                        }))

                        # Announce stability ONLY exactly when it is found
                        if initial_stability_achieved and is_currently_stable and get_target_length() == window_size:
                            await self.broadcast(text_data=json.dumps({'type': 'status_update', 'message': "Initial stability achieved."}))

                    else:
                        # Still filling initial window
                        await self.broadcast(text_data=json.dumps({
                            'type': 'status_update',
                            'message': f"Filling initial window... [{len(primary_candidates)}/{window_size}]"
                        }))
                        
                        temp_ppm = calc_ppm(primary_candidates) if len(primary_candidates) > 1 else None
                        temp_is_stable = (temp_ppm < threshold_ppm) if temp_ppm is not None else True
                        
                        await self.broadcast(text_data=json.dumps({
                            'type': 'sliding_window_update',
                            'ppm': temp_ppm,
                            'stdev_ppm': temp_ppm,
                            'is_stable': temp_is_stable,
                            'instability_events': instability_events,
                            'max_retries': max_retries
                        }))
                else:
                    if std_point: final_std_readings.append(std_point)
                    if ti_point: final_ti_readings.append(ti_point)

                # Update the UI with the latest points depending on targeted length
                if initial_stability_achieved:
                    current_count = get_target_length()
                else:
                    current_count = len(stable_candidate_std) if target_tvc in ['STD', 'BOTH'] else len(stable_candidate_ti)

                # Mirror every sample into the server-side live buffer so late-
                # joining remotes reconstruct the chart from a single source of
                # truth instead of stitching a host snapshot to DB historicals.
                self._buffer_append_sample(reading_type_base, std_point, ti_point, current_count, num_samples)

                await self.broadcast(text_data=json.dumps({
                    'type': 'dual_reading_update',
                    'std_reading': std_point,
                    'ti_reading': ti_point,
                    'count': current_count,
                    'stable_count': get_target_length(),
                    'total': num_samples,
                    'stage': reading_type_base
                }))

                await asyncio.sleep(0.05)
        
        # Save the final (locked) sets to the database (respects skip targets).
        # In N-cycle mode (cycle_index is set), tag each new reading with the
        # cycle ordinal and merge with whatever was already persisted from
        # earlier cycles so the outbox's overwrite-on-save doesn't drop them.
        if not self.stop_event.is_set():
            if target_tvc in ['STD', 'BOTH'] and final_std_readings:
                payload = final_std_readings
                rt_full = f"std_{reading_type_base}"
                if cycle_index is not None:
                    self._tag_readings_with_cycle(payload, cycle_index)
                    existing = await self._read_existing_phase_readings(test_point_data, rt_full)
                    payload = self._drop_cycle_from_readings(existing, cycle_index) + payload
                await self.save_readings_to_db(rt_full, payload, test_point_data)
            if target_tvc in ['TI', 'BOTH'] and final_ti_readings:
                payload = final_ti_readings
                rt_full = f"ti_{reading_type_base}"
                if cycle_index is not None:
                    self._tag_readings_with_cycle(payload, cycle_index)
                    existing = await self._read_existing_phase_readings(test_point_data, rt_full)
                    payload = self._drop_cycle_from_readings(existing, cycle_index) + payload
                await self.save_readings_to_db(rt_full, payload, test_point_data)
            
            await self.broadcast(text_data=json.dumps({
                'type': 'connection_sync',
                'is_complete': False,
                'message': f'{reading_type_base} stage data saved.'
            }))
        
        return True
    
    async def collect_single_reading_set(self, data):
        ac_source, dc_source, std_reader_instrument, ti_reader_instrument, amplifier_instrument, switch_driver = None, None, None, None, None, None
        try:
            session_details = await self.get_session_details()
            if not session_details: raise Exception("Session not found.")
            self._validate_reader_assignments(data, session_details)
            await self._report_source_routing_state(session_details)
            
            std_addr = session_details.get('std_reader_address')
            ti_addr = session_details.get('ti_reader_address')
            std_model = session_details.get('std_reader_model')
            ti_model = session_details.get('ti_reader_model')
            
            if session_details.get('switch_driver_address'):
                switch_driver = await sync_to_async(_inst, thread_sensitive=True)(Instrument11713C, gpib=session_details.get('switch_driver_address'))

            reading_type_base = data.get('reading_type')
            is_ac_reading = 'ac' in reading_type_base

            if switch_driver:
                required_state = 'AC' if is_ac_reading else 'DC'
                await self.broadcast(text_data=json.dumps({'type': 'status_update', 'message': f"Switching to {required_state} source..."}))
                if required_state == 'AC':
                    await sync_to_async(switch_driver.select_ac_source, thread_sensitive=True)()
                else:
                    await sync_to_async(switch_driver.select_dc_source, thread_sensitive=True)()
                
                await self.broadcast(text_data=json.dumps({'type': 'switch_status_update', 'active_source': required_state}))
                await asyncio.sleep(1)

            ac_source_address = session_details.get('ac_source_address')
            dc_source_address = session_details.get('dc_source_address')

            if ac_source_address and ac_source_address == dc_source_address:
                shared_source = await sync_to_async(_inst, thread_sensitive=True)(Instrument5730A, model="5730A", gpib=ac_source_address)
                ac_source, dc_source = shared_source, shared_source
            else:
                if ac_source_address: 
                    ac_source = await sync_to_async(_inst, thread_sensitive=True)(Instrument5730A, model="5730A", gpib=ac_source_address)
                if dc_source_address: 
                    dc_source = await sync_to_async(_inst, thread_sensitive=True)(Instrument5730A, model="5730A", gpib=dc_source_address)

            std_reader_class, ti_reader_class = INSTRUMENT_CLASS_MAP.get(std_model), INSTRUMENT_CLASS_MAP.get(ti_model)
            std_reader_instrument = await sync_to_async(_open_reader, thread_sensitive=True)(
                std_reader_class, std_model, std_addr, session_details.get("std_reader_input")
            )
            ti_reader_instrument = await sync_to_async(_open_reader, thread_sensitive=True)(
                ti_reader_class, ti_model, ti_addr, session_details.get("ti_reader_input")
            )
            
            await self._configure_sources(
                data.get('test_point'), 
                data.get('bypass_tvc'), 
                data.get('amplifier_range'), 
                ac_source=ac_source, 
                dc_source=dc_source,
                measurement_params=data.get('measurement_params'),
            )

            if session_details.get('amplifier_address'):
                amplifier_instrument = await sync_to_async(_inst, thread_sensitive=True)(
                    Instrument8100,
                    model='8100',
                    gpib=session_details.get('amplifier_address'),
                    reset_on_connect=not data.get('bypass_amplifier_confirmation')
                )
                if not await self._handle_amplifier_confirmation(amplifier_instrument, data.get('amplifier_range'), data): return

            await self._activate_sources(ac_source=ac_source, dc_source=dc_source)

            # ``dict.get`` only returns the default when the key is missing,
            # not when the value is present-but-``None``. Frontend payloads
            # often send ``initial_warm_up_time: null`` which would crash the
            # ``warmup_time > 0`` comparison; ``or 0`` coerces null/0/'' to 0.
            warmup_time = data.get('initial_warm_up_time') or 0
            
            if warmup_time > 0:
                await self._perform_warmup(warmup_time, tp_id=(data.get('test_point') or {}).get('id'))

            source_instrument = ac_source if is_ac_reading else dc_source
            if not source_instrument:
                raise Exception(f"Required {'AC' if is_ac_reading else 'DC'} Source is not assigned.")

            self._buffer_set_stage(
                reading_type_base,
                tp_id=(data.get('test_point') or {}).get('id'),
                total=data.get('num_samples') or 0,
            )
            await self.broadcast(text_data=json.dumps({
                'type': 'calibration_stage_update',
                'stage': reading_type_base,
                'total': data.get('num_samples'),
                'tpId': (data.get('test_point') or {}).get('id'),
            }))

            success = await self._perform_single_measurement(
                reading_type_base, 
                data.get('num_samples'), 
                data.get('test_point'), 
                data.get('bypass_tvc'), 
                data.get('amplifier_range'), 
                source_instrument, 
                std_reader_instrument, 
                ti_reader_instrument, 
                amplifier_instrument, 
                float(data.get('settling_time', 0.0)), 
                data.get('nplc'), 
                data.get('measurement_params'),
            )
            
            if success and not self.stop_event.is_set():
                await self.broadcast(text_data=json.dumps({'type': 'collection_finished', 'message': 'All readings complete.'}))
            elif not success and not self.stop_event.is_set():
                await self.broadcast(text_data=json.dumps({'type': 'error', 'message': 'Test point aborted due to stability limit.'}))

        except asyncio.CancelledError:
            print(f"Collection task cancelled for session {self.session_id}.")
        except Exception as e:
            traceback.print_exc()
            await self.broadcast(text_data=json.dumps({'type': 'error', 'message': f"An instrument error occurred: {e}"}))
        finally:
            self.state = "IDLE"
            self._buffer_clear()
            if switch_driver:
                await sync_to_async(switch_driver.deactivate_all, thread_sensitive=True)()
                await self.broadcast(text_data=json.dumps({'type': 'switch_status_update', 'active_source': 'AC'}))
                if hasattr(switch_driver, 'close'): await sync_to_async(switch_driver.close, thread_sensitive=True)()
            
            sources_to_shutdown = list(filter(None, {ac_source, dc_source}))
            for source in sources_to_shutdown:
                await sync_to_async(source.reset, thread_sensitive=True)()

            if amplifier_instrument: await sync_to_async(amplifier_instrument.set_standby, thread_sensitive=True)()
            
            for inst in filter(None, {std_reader_instrument, ti_reader_instrument, amplifier_instrument, ac_source, dc_source}):
                if hasattr(inst, 'close'):
                    await sync_to_async(inst.close, thread_sensitive=True)()

    async def run_full_calibration_sequence(self, data):
        ac_source, dc_source, std_reader, ti_reader, amplifier = None, None, None, None, None
        try:
            session_details = await self.get_session_details()
            if not session_details: raise Exception("Session not found.")
            self._validate_reader_assignments(data, session_details)
            await self._report_source_routing_state(session_details)

            std_addr, ti_addr = session_details.get('std_reader_address'), session_details.get('ti_reader_address')
            std_model, ti_model = session_details.get('std_reader_model'), session_details.get('ti_reader_model')

            ac_source_address, dc_source_address = session_details.get('ac_source_address'), session_details.get('dc_source_address')
            
            if ac_source_address and ac_source_address == dc_source_address:
                shared_source = await sync_to_async(_inst, thread_sensitive=True)(Instrument5730A, model="5730A", gpib=ac_source_address)
                ac_source, dc_source = shared_source, shared_source
            else:
                if ac_source_address: ac_source = await sync_to_async(_inst, thread_sensitive=True)(Instrument5730A, model="5730A", gpib=ac_source_address)
                if dc_source_address: dc_source = await sync_to_async(_inst, thread_sensitive=True)(Instrument5730A, model="5730A", gpib=dc_source_address)

            std_reader_class, ti_reader_class = INSTRUMENT_CLASS_MAP.get(std_model), INSTRUMENT_CLASS_MAP.get(ti_model)
            std_reader = await sync_to_async(_open_reader, thread_sensitive=True)(
                std_reader_class, std_model, std_addr, session_details.get("std_reader_input")
            )
            ti_reader = await sync_to_async(_open_reader, thread_sensitive=True)(
                ti_reader_class, ti_model, ti_addr, session_details.get("ti_reader_input")
            )

            await self._configure_sources(
                data.get('test_point'), 
                data.get('bypass_tvc'), 
                data.get('amplifier_range'), 
                ac_source=ac_source, 
                dc_source=dc_source,
                measurement_params=data.get('measurement_params'),
            )
            
            if session_details.get('amplifier_address'):
                amplifier = await sync_to_async(_inst, thread_sensitive=True)(
                    Instrument8100,
                    model='8100',
                    gpib=session_details.get('amplifier_address'),
                    reset_on_connect=not data.get('bypass_amplifier_confirmation')
                )
                if not await self._handle_amplifier_confirmation(amplifier, data.get('amplifier_range'), data): return
            
            await self._activate_sources(ac_source=ac_source, dc_source=dc_source)
            
            # ``dict.get`` only returns the default when the key is missing,
            # not when the value is present-but-``None``. Frontend payloads
            # often send ``initial_warm_up_time: null`` which would crash the
            # ``warmup_time > 0`` comparison; ``or 0`` coerces null/0/'' to 0.
            warmup_time = data.get('initial_warm_up_time') or 0
            
            if warmup_time > 0:
                await self._perform_warmup(warmup_time, tp_id=(data.get('test_point') or {}).get('id'))

            settling_time, num_samples, nplc_setting, measurement_params = float(data.get('settling_time', 5.0)), data.get('num_samples', 8), data.get('nplc'), data.get('measurement_params')

            n_cycles = await self._resolve_n_cycles(data.get('test_point'), fallback=data.get('n_cycles') or 3)

            cycles_completed = False
            for cycle_index in range(1, n_cycles + 1):
                if self.stop_event.is_set(): break

                await self.broadcast(text_data=json.dumps({
                    'type': 'cycle_progress_update',
                    'cycle_index': cycle_index,
                    'total_cycles': n_cycles,
                    'tpId': (data.get('test_point') or {}).get('id'),
                }))
                await self.broadcast(text_data=json.dumps({
                    'type': 'status_update',
                    'message': f"Cycle {cycle_index} of {n_cycles}",
                }))

                cycle_aborted = False
                for stage in ['ac_open', 'dc_pos', 'dc_neg', 'ac_close']:
                    if self.stop_event.is_set(): break

                    switch_driver = None
                    try:
                        if session_details.get('switch_driver_address'):
                            switch_driver = await sync_to_async(_inst, thread_sensitive=True)(Instrument11713C, gpib=session_details.get('switch_driver_address'))
                            required_switch_state = 'AC' if 'ac' in stage else 'DC'
                            await self.broadcast(text_data=json.dumps({'type': 'status_update', 'message': f"Switching to {required_switch_state} source..."}))
                            if required_switch_state == 'AC': await sync_to_async(switch_driver.select_ac_source, thread_sensitive=True)()
                            else: await sync_to_async(switch_driver.select_dc_source, thread_sensitive=True)()
                            await self.broadcast(text_data=json.dumps({'type': 'switch_status_update', 'active_source': required_switch_state}))
                            await asyncio.sleep(1)

                        source_instrument = ac_source if 'ac' in stage else dc_source
                        if not source_instrument: raise Exception(f"Required {'AC' if 'ac' in stage else 'DC'} Source is not assigned.")

                        self._buffer_set_stage(stage, tp_id=(data.get('test_point') or {}).get('id'), total=num_samples)
                        await self.broadcast(text_data=json.dumps({'type': 'calibration_stage_update', 'stage': stage, 'total': num_samples, 'cycle_index': cycle_index, 'tpId': (data.get('test_point') or {}).get('id')}))

                        success = await self._perform_single_measurement(
                            stage, num_samples, data.get('test_point'),
                            data.get('bypass_tvc'), data.get('amplifier_range'),
                            source_instrument, std_reader, ti_reader, amplifier,
                            settling_time, nplc_setting, measurement_params,
                            cycle_index=cycle_index,
                        )

                        # Stop sequence if measurement fails due to instability limits
                        if not success:
                            if not self.stop_event.is_set():
                                await self.broadcast(text_data=json.dumps({'type': 'error', 'message': f"Sequence aborted on cycle {cycle_index}: Stability limit reached on {stage}."}))
                            cycle_aborted = True
                            break
                    finally:
                        if switch_driver and hasattr(switch_driver, 'close'): await sync_to_async(switch_driver.close, thread_sensitive=True)()

                if cycle_aborted or self.stop_event.is_set():
                    break

                # All four phases of this cycle completed — persist per-cycle results.
                await self._finalize_cycle(data.get('test_point'), cycle_index)

                if cycle_index == n_cycles:
                    cycles_completed = True

            if cycles_completed and not self.stop_event.is_set():
                # If this single-direction run was the Reverse half of a pair
                # whose Forward already has cycles, recompute the pair-level
                # aggregate so the headline updates without needing the new
                # paired batch flow.
                await self._maybe_recompute_pair_for_single_direction(data.get('test_point'))
                await self.broadcast(text_data=json.dumps({'type': 'collection_finished', 'message': f'All {n_cycles} cycles complete.'}))
            elif not self.stop_event.is_set():
                # Partial completion (one cycle aborted mid-run); still notify so UI unblocks.
                await self.broadcast(text_data=json.dumps({'type': 'collection_finished', 'message': 'Collection ended early.'}))

        except asyncio.CancelledError:
            print(f"Collection task cancelled for session {self.session_id}.")
        except Exception as e:
            traceback.print_exc()
            await self.broadcast(text_data=json.dumps({'type': 'error', 'message': f"An instrument error occurred: {e}"}))
        finally:
            self.state = "IDLE"
            self._buffer_clear()
            sources_to_shutdown = list(filter(None, {ac_source, dc_source}))
            for source in sources_to_shutdown:
                await sync_to_async(source.reset, thread_sensitive=True)()
            if amplifier: await sync_to_async(amplifier.set_standby, thread_sensitive=True)()
            
            for inst in filter(None, {std_reader, ti_reader, amplifier, ac_source, dc_source}):
                if hasattr(inst, 'close'):
                    await sync_to_async(inst.close, thread_sensitive=True)()

    async def run_full_calibration_batch(self, data):
        ac_source, dc_source, std_reader, ti_reader, amplifier, switch_driver = None, None, None, None, None, None
        try:
            session_details = await self.get_session_details()
            if not session_details: raise Exception("Session not found.")

            self._validate_reader_assignments(data, session_details)
            test_points_to_run = data.get('test_points', [])
            if not test_points_to_run:
                raise Exception("No test points provided for batch run.")

            std_addr, ti_addr = session_details.get('std_reader_address'), session_details.get('ti_reader_address')
            std_model, ti_model = session_details.get('std_reader_model'), session_details.get('ti_reader_model')

            ac_source_address, dc_source_address = session_details.get('ac_source_address'), session_details.get('dc_source_address')
            if ac_source_address and ac_source_address == dc_source_address:
                shared_source = await sync_to_async(_inst, thread_sensitive=True)(Instrument5730A, model="5730A", gpib=ac_source_address)
                ac_source, dc_source = shared_source, shared_source
            else:
                if ac_source_address: ac_source = await sync_to_async(_inst, thread_sensitive=True)(Instrument5730A, model="5730A", gpib=ac_source_address)
                if dc_source_address: dc_source = await sync_to_async(_inst, thread_sensitive=True)(Instrument5730A, model="5730A", gpib=dc_source_address)
            
            std_reader_class, ti_reader_class = INSTRUMENT_CLASS_MAP.get(std_model), INSTRUMENT_CLASS_MAP.get(ti_model)
            std_reader = await sync_to_async(_open_reader, thread_sensitive=True)(
                std_reader_class, std_model, std_addr, session_details.get("std_reader_input")
            )
            ti_reader = await sync_to_async(_open_reader, thread_sensitive=True)(
                ti_reader_class, ti_model, ti_addr, session_details.get("ti_reader_input")
            )

            if session_details.get('switch_driver_address'):
                switch_driver = await sync_to_async(_inst, thread_sensitive=True)(Instrument11713C, gpib=session_details.get('switch_driver_address'))
            
            await self._configure_sources(
                test_points_to_run,
                data.get('bypass_tvc'), 
                data.get('amplifier_range'), 
                ac_source=ac_source, 
                dc_source=dc_source,
                measurement_params=data.get('measurement_params'),
            )
            
            if session_details.get('amplifier_address'):
                amplifier = await sync_to_async(_inst, thread_sensitive=True)(
                    Instrument8100,
                    model='8100',
                    gpib=session_details.get('amplifier_address'),
                    reset_on_connect=not data.get('bypass_amplifier_confirmation')
                )
                if not await self._handle_amplifier_confirmation(amplifier, data.get('amplifier_range'), data): return
            
            await self._activate_sources(ac_source=ac_source, dc_source=dc_source)
            
            # ``dict.get`` only returns the default when the key is missing,
            # not when the value is present-but-``None``. Frontend payloads
            # often send ``initial_warm_up_time: null`` which would crash the
            # ``warmup_time > 0`` comparison; ``or 0`` coerces null/0/'' to 0.
            warmup_time = data.get('initial_warm_up_time') or 0
            if warmup_time > 0:
                await self._perform_warmup(warmup_time, tp_id=(test_points_to_run[0].get('id') if test_points_to_run else None))

            nplc_setting, measurement_params = data.get('nplc'), data.get('measurement_params')

            for i, point_data in enumerate(test_points_to_run):
                if self.stop_event.is_set(): break
                
                current_settling_time = float(point_data.get('settling_time', data.get('settling_time', 5.0)))
                current_num_samples = int(point_data.get('num_samples', data.get('num_samples', 8)))
                point_nplc = point_data.get('nplc', nplc_setting)
                point_measurement_params = (
                    point_data.get('measurement_params') or measurement_params
                )

                self._buffer_set_batch_point(point_data)
                await self.broadcast(text_data=json.dumps({
                    'type': 'batch_progress_update',
                    'test_point': point_data,
                    'current': i + 1,
                    'total': len(test_points_to_run)
                }))

                point_aborted = False
                point_n_cycles = await self._resolve_n_cycles(point_data, fallback=data.get('n_cycles') or 3)

                for cycle_index in range(1, point_n_cycles + 1):
                    if self.stop_event.is_set(): break

                    await self.broadcast(text_data=json.dumps({
                        'type': 'cycle_progress_update',
                        'cycle_index': cycle_index,
                        'total_cycles': point_n_cycles,
                        'tpId': point_data.get('id'),
                    }))
                    await self.broadcast(text_data=json.dumps({
                        'type': 'status_update',
                        'message': f"Cycle {cycle_index} of {point_n_cycles}",
                    }))

                    cycle_aborted = False
                    for stage in ['ac_open', 'dc_pos', 'dc_neg', 'ac_close']:
                        if self.stop_event.is_set(): break

                        required_switch_state = 'AC' if 'ac' in stage else 'DC'
                        if switch_driver:
                            await self.broadcast(text_data=json.dumps({'type': 'status_update', 'message': f"Switching to {required_switch_state} source..."}))
                            if required_switch_state == 'AC': await sync_to_async(switch_driver.select_ac_source, thread_sensitive=True)()
                            else: await sync_to_async(switch_driver.select_dc_source, thread_sensitive=True)()
                            await self.broadcast(text_data=json.dumps({'type': 'switch_status_update', 'active_source': required_switch_state}))
                            await asyncio.sleep(1)

                        source_instrument = ac_source if 'ac' in stage else dc_source
                        if not source_instrument: raise Exception(f"Required source for stage '{stage}' is not assigned.")

                        self._buffer_set_stage(stage, tp_id=point_data.get('id'), total=current_num_samples)
                        await self.broadcast(text_data=json.dumps({
                            'type': 'calibration_stage_update',
                            'stage': stage,
                            'total': current_num_samples,
                            'tpId': point_data.get('id'),
                            'cycle_index': cycle_index,
                        }))

                        success = await self._perform_single_measurement(
                            stage,
                            current_num_samples,
                            point_data,
                            data.get('bypass_tvc'),
                            data.get('amplifier_range'),
                            source_instrument, std_reader, ti_reader, amplifier,
                            current_settling_time,
                            point_nplc,
                            point_measurement_params,
                            cycle_index=cycle_index,
                        )

                        if not success:
                            print(f"[DEBUG - BACKEND] Batch caught failure on cycle {cycle_index} stage {stage}. Breaking inner loops and moving to next point.", flush=True)
                            cycle_aborted = True
                            point_aborted = True
                            break

                    if cycle_aborted or self.stop_event.is_set():
                        break

                    # Cycle's four phases done — persist cycle row + roll-up.
                    await self._finalize_cycle(point_data, cycle_index)

                # Gracefully move on to the next test point if max retry limit failed
                if point_aborted: continue

            if not self.stop_event.is_set():
                await self.broadcast(text_data=json.dumps({'type': 'collection_finished', 'message': 'Batch calibration complete.'}))

        except asyncio.CancelledError:
            print(f"Collection task cancelled for session {self.session_id}.")
        except Exception as e:
            traceback.print_exc()
            await self.broadcast(text_data=json.dumps({'type': 'error', 'message': f"An instrument error occurred during batch run: {e}"}))
        finally:
            self.state = "IDLE"
            self._buffer_clear()
            if switch_driver:
                await sync_to_async(switch_driver.deactivate_all, thread_sensitive=True)()
                if hasattr(switch_driver, 'close'): await sync_to_async(switch_driver.close, thread_sensitive=True)()

            sources_to_shutdown = list(filter(None, {ac_source, dc_source}))
            for source in sources_to_shutdown:
                await sync_to_async(source.reset, thread_sensitive=True)()

            if amplifier: await sync_to_async(amplifier.set_standby, thread_sensitive=True)()

            for inst in filter(None, {std_reader, ti_reader, amplifier, ac_source, dc_source}):
                if hasattr(inst, 'close'):
                    await sync_to_async(inst.close, thread_sensitive=True)()

    # ------------------------------------------------------------------
    # Paired AC-DC batch (Forward pass → flip prompt → Reverse pass).
    # See plan: AC-DC δ is defined per Fwd+Rev pair, so we run the whole
    # session's Forward halves first, pause for the operator to flip the
    # adapter, then run the Reverse halves in reverse test-point order.
    # Reverse pairing (Fwd_i ↔ Rev_{N+1-i}) then cancels linear drift
    # across the whole run when CalibrationResults.recompute_pair_aggregate
    # rolls the cycle deltas up.
    # ------------------------------------------------------------------
    async def _run_direction_pass(
        self,
        test_points,
        direction,
        data,
        ac_source, dc_source,
        std_reader, ti_reader,
        amplifier, switch_driver,
        session_details,
    ):
        """Run the N-cycle loop for every test point in ``test_points`` in
        the order given, restricted to one ``direction``. Reused by both the
        forward and reverse passes of ``run_paired_batch``.

        Returns True on full completion, False on user-stop or in-flight
        failure (matches the existing batch contract — caller decides what
        to do next based on stop_event).
        """
        nplc_setting = data.get('nplc')
        measurement_params = data.get('measurement_params')
        bypass_tvc = data.get('bypass_tvc')
        amplifier_range = data.get('amplifier_range')

        for i, point_data in enumerate(test_points):
            if self.stop_event.is_set():
                return False
            if point_data.get('direction') != direction:
                # Defensive: the caller already filtered, but skip just in case.
                continue

            current_settling_time = float(point_data.get('settling_time', data.get('settling_time', 5.0)))
            current_num_samples = int(point_data.get('num_samples', data.get('num_samples', 8)))
            point_nplc = point_data.get('nplc', nplc_setting)
            point_measurement_params = (
                point_data.get('measurement_params') or measurement_params
            )

            self._buffer_set_batch_point(point_data)
            await self.broadcast(text_data=json.dumps({
                'type': 'batch_progress_update',
                'test_point': point_data,
                'current': i + 1,
                'total': len(test_points),
                'pass_direction': direction,
            }))

            point_n_cycles = await self._resolve_n_cycles(point_data, fallback=data.get('n_cycles') or 3)
            point_aborted = False

            for cycle_index in range(1, point_n_cycles + 1):
                if self.stop_event.is_set():
                    return False

                await self.broadcast(text_data=json.dumps({
                    'type': 'cycle_progress_update',
                    'cycle_index': cycle_index,
                    'total_cycles': point_n_cycles,
                    'tpId': point_data.get('id'),
                    'pass_direction': direction,
                }))
                await self.broadcast(text_data=json.dumps({
                    'type': 'status_update',
                    'message': f"{direction} cycle {cycle_index} of {point_n_cycles}",
                }))

                cycle_aborted = False
                for stage in ['ac_open', 'dc_pos', 'dc_neg', 'ac_close']:
                    if self.stop_event.is_set():
                        return False

                    required_switch_state = 'AC' if 'ac' in stage else 'DC'
                    if switch_driver:
                        await self.broadcast(text_data=json.dumps({
                            'type': 'status_update',
                            'message': f"Switching to {required_switch_state} source...",
                        }))
                        if required_switch_state == 'AC':
                            await sync_to_async(switch_driver.select_ac_source, thread_sensitive=True)()
                        else:
                            await sync_to_async(switch_driver.select_dc_source, thread_sensitive=True)()
                        await self.broadcast(text_data=json.dumps({
                            'type': 'switch_status_update',
                            'active_source': required_switch_state,
                        }))
                        await asyncio.sleep(1)

                    source_instrument = ac_source if 'ac' in stage else dc_source
                    if not source_instrument:
                        raise Exception(f"Required source for stage '{stage}' is not assigned.")

                    self._buffer_set_stage(stage, tp_id=point_data.get('id'), total=current_num_samples)
                    await self.broadcast(text_data=json.dumps({
                        'type': 'calibration_stage_update',
                        'stage': stage,
                        'total': current_num_samples,
                        'tpId': point_data.get('id'),
                        'cycle_index': cycle_index,
                    }))

                    success = await self._perform_single_measurement(
                        stage,
                        current_num_samples,
                        point_data,
                        bypass_tvc,
                        amplifier_range,
                        source_instrument, std_reader, ti_reader, amplifier,
                        current_settling_time,
                        point_nplc,
                        point_measurement_params,
                        cycle_index=cycle_index,
                    )
                    if not success:
                        cycle_aborted = True
                        point_aborted = True
                        break

                if cycle_aborted or self.stop_event.is_set():
                    break

                # Persist per-direction cycle row.
                await self._finalize_cycle(point_data, cycle_index)

            if point_aborted:
                # Carry on with the next point (matches run_full_calibration_batch behavior).
                continue

        return True

    async def run_paired_batch(self, data):
        """Single-flip paired AC-DC batch.

        Payload:
            data['forward_points'] : list of Forward TestPoint dicts (with id, current, frequency, settings)
            data['reverse_points'] : list of Reverse TestPoint dicts, in the same (current, frequency) order
            plus the standard batch keys (nplc, settling_time, num_samples, measurement_params, ...).

        Order of operations:
            1. Forward pass over forward_points in natural order.
            2. Broadcast 'paired_run_awaiting_flip' + status, then await flip_resume_event.
            3. Reverse pass over reverse_points in REVERSE order so each
               (current, frequency) pair has a symmetric midpoint time across
               Fwd and Rev. Within each point cycles run 1..N as usual; the
               cycle reverse-pairing happens in aggregate_paired_cycles.
            4. After each Reverse point's cycles finish, recompute_pair_aggregate
               mirrors the pair-level mean δ and u_A onto both rows.
        """
        ac_source, dc_source, std_reader, ti_reader, amplifier, switch_driver = None, None, None, None, None, None
        try:
            session_details = await self.get_session_details()
            if not session_details:
                raise Exception("Session not found.")

            self._validate_reader_assignments(data, session_details)
            forward_points = data.get('forward_points') or []
            reverse_points = data.get('reverse_points') or []
            if not forward_points or not reverse_points:
                raise Exception("run_paired_batch requires forward_points and reverse_points.")
            if len(forward_points) != len(reverse_points):
                raise Exception(
                    "Mismatched forward/reverse point counts in paired batch. "
                    "Every (current, frequency) pair must have both directions defined."
                )

            # ----- Instrument setup (same as run_full_calibration_batch) -----
            std_addr, ti_addr = session_details.get('std_reader_address'), session_details.get('ti_reader_address')
            std_model, ti_model = session_details.get('std_reader_model'), session_details.get('ti_reader_model')

            ac_source_address, dc_source_address = session_details.get('ac_source_address'), session_details.get('dc_source_address')
            if ac_source_address and ac_source_address == dc_source_address:
                shared_source = await sync_to_async(_inst, thread_sensitive=True)(Instrument5730A, model="5730A", gpib=ac_source_address)
                ac_source, dc_source = shared_source, shared_source
            else:
                if ac_source_address: ac_source = await sync_to_async(_inst, thread_sensitive=True)(Instrument5730A, model="5730A", gpib=ac_source_address)
                if dc_source_address: dc_source = await sync_to_async(_inst, thread_sensitive=True)(Instrument5730A, model="5730A", gpib=dc_source_address)

            std_reader_class, ti_reader_class = INSTRUMENT_CLASS_MAP.get(std_model), INSTRUMENT_CLASS_MAP.get(ti_model)
            std_reader = await sync_to_async(_open_reader, thread_sensitive=True)(
                std_reader_class, std_model, std_addr, session_details.get("std_reader_input")
            )
            ti_reader = await sync_to_async(_open_reader, thread_sensitive=True)(
                ti_reader_class, ti_model, ti_addr, session_details.get("ti_reader_input")
            )

            if session_details.get('switch_driver_address'):
                switch_driver = await sync_to_async(_inst, thread_sensitive=True)(Instrument11713C, gpib=session_details.get('switch_driver_address'))

            # Configure sources / amplifier using the first point as a probe
            # (matches run_full_calibration_batch's behavior).
            all_points = forward_points + reverse_points
            await self._configure_sources(
                all_points,
                data.get('bypass_tvc'),
                data.get('amplifier_range'),
                ac_source=ac_source,
                dc_source=dc_source,
                measurement_params=data.get('measurement_params'),
            )

            if session_details.get('amplifier_address'):
                amplifier = await sync_to_async(_inst, thread_sensitive=True)(
                    Instrument8100,
                    model='8100',
                    gpib=session_details.get('amplifier_address'),
                    reset_on_connect=not data.get('bypass_amplifier_confirmation')
                )
                if not await self._handle_amplifier_confirmation(amplifier, data.get('amplifier_range'), data):
                    return

            await self._activate_sources(ac_source=ac_source, dc_source=dc_source)

            warmup_time = data.get('initial_warm_up_time') or 0
            if warmup_time > 0:
                await self._perform_warmup(warmup_time, tp_id=(forward_points[0].get('id') if forward_points else None))

            # ----- Forward pass -----
            await self.broadcast(text_data=json.dumps({
                'type': 'paired_run_pass_started',
                'pass_direction': 'Forward',
                'total_points': len(forward_points),
            }))
            fwd_ok = await self._run_direction_pass(
                forward_points, 'Forward', data,
                ac_source, dc_source, std_reader, ti_reader,
                amplifier, switch_driver, session_details,
            )
            if not fwd_ok or self.stop_event.is_set():
                return

            # ----- Pause for adapter flip -----
            self.flip_resume_event.clear()
            await self.broadcast(text_data=json.dumps({
                'type': 'paired_run_awaiting_flip',
                'message': (
                    "Forward pass complete. Flip the AC-DC adapter, "
                    "then click \"Resume reverse pass\"."
                ),
            }))
            # Wait either for the operator's resume click or a stop.
            stop_wait = asyncio.create_task(self.stop_event.wait())
            flip_wait = asyncio.create_task(self.flip_resume_event.wait())
            done, pending = await asyncio.wait(
                {stop_wait, flip_wait}, return_when=asyncio.FIRST_COMPLETED,
            )
            for t in pending:
                t.cancel()
            if self.stop_event.is_set():
                return

            # ----- Reverse pass, in REVERSE test-point order -----
            reverse_in_reverse = list(reversed(reverse_points))
            await self.broadcast(text_data=json.dumps({
                'type': 'paired_run_pass_started',
                'pass_direction': 'Reverse',
                'total_points': len(reverse_in_reverse),
            }))
            rev_ok = await self._run_direction_pass(
                reverse_in_reverse, 'Reverse', data,
                ac_source, dc_source, std_reader, ti_reader,
                amplifier, switch_driver, session_details,
            )
            if not rev_ok or self.stop_event.is_set():
                return

            # ----- Pair-level aggregation -----
            await self._recompute_pair_aggregates_for_points(reverse_in_reverse)

            await self.broadcast(text_data=json.dumps({
                'type': 'paired_run_complete',
                'message': 'Paired AC-DC run complete. Per-pair aggregates updated.',
            }))

        except asyncio.CancelledError:
            print(f"Paired batch cancelled for session {self.session_id}.")
        except Exception as e:
            traceback.print_exc()
            await self.broadcast(text_data=json.dumps({'type': 'error', 'message': f"Paired batch error: {e}"}))
        finally:
            self.state = "IDLE"
            self._buffer_clear()
            if switch_driver:
                try:
                    await sync_to_async(switch_driver.deactivate_all, thread_sensitive=True)()
                except Exception:
                    pass
                if hasattr(switch_driver, 'close'):
                    await sync_to_async(switch_driver.close, thread_sensitive=True)()

            sources_to_shutdown = list(filter(None, {ac_source, dc_source}))
            for source in sources_to_shutdown:
                try:
                    await sync_to_async(source.reset, thread_sensitive=True)()
                except Exception:
                    pass

            if amplifier:
                try:
                    await sync_to_async(amplifier.set_standby, thread_sensitive=True)()
                except Exception:
                    pass

            for inst in filter(None, {std_reader, ti_reader, amplifier, ac_source, dc_source}):
                if hasattr(inst, 'close'):
                    try:
                        await sync_to_async(inst.close, thread_sensitive=True)()
                    except Exception:
                        pass

    @database_sync_to_async
    def _maybe_recompute_pair_for_single_direction(self, test_point_data):
        """Convenience: after a single-direction `run_single_collection`
        finishes, if a Reverse half is now present alongside an existing
        Forward, mirror the paired aggregate onto both rows. Idempotent —
        if the pair is incomplete the helper persists null fields.
        """
        if not isinstance(test_point_data, dict):
            return
        tp_id = test_point_data.get('id')
        if not tp_id:
            return
        try:
            tp = TestPoint.objects.select_related('results').get(pk=tp_id)
        except TestPoint.DoesNotExist:
            return
        results = getattr(tp, 'results', None)
        if results is not None:
            results.recompute_pair_aggregate()

    @database_sync_to_async
    def _recompute_pair_aggregates_for_points(self, reverse_points):
        """For each Reverse point in the batch, recompute the pair aggregate
        (mirrored onto both Fwd and Rev CalibrationResults rows). Called once
        after the reverse pass completes.
        """
        for rev_point in reverse_points:
            tp_id = rev_point.get('id') if isinstance(rev_point, dict) else None
            if not tp_id:
                continue
            try:
                tp = TestPoint.objects.select_related('results').get(pk=tp_id)
                results = getattr(tp, 'results', None)
                if results is not None:
                    results.recompute_pair_aggregate()
            except TestPoint.DoesNotExist:
                continue

    async def run_single_stage_batch(self, data):
        ac_source, dc_source, std_reader, ti_reader, amplifier = None, None, None, None, None
        try:
            session_details = await self.get_session_details()
            if not session_details: raise Exception("Session not found.")

            self._validate_reader_assignments(data, session_details)
            stage = data.get('reading_type')
            test_points_to_run = data.get('test_points', [])
            if not stage or not test_points_to_run:
                raise Exception("Missing reading type or test points for batch run.")

            std_addr, ti_addr = session_details.get('std_reader_address'), session_details.get('ti_reader_address')
            std_model, ti_model = session_details.get('std_reader_model'), session_details.get('ti_reader_model')

            ac_source_address, dc_source_address = session_details.get('ac_source_address'), session_details.get('dc_source_address')
            if ac_source_address and ac_source_address == dc_source_address:
                shared_source = await sync_to_async(_inst, thread_sensitive=True)(Instrument5730A, model="5730A", gpib=ac_source_address)
                ac_source, dc_source = shared_source, shared_source
            else:
                if ac_source_address: ac_source = await sync_to_async(_inst, thread_sensitive=True)(Instrument5730A, model="5730A", gpib=ac_source_address)
                if dc_source_address: dc_source = await sync_to_async(_inst, thread_sensitive=True)(Instrument5730A, model="5730A", gpib=dc_source_address)

            std_reader_class, ti_reader_class = INSTRUMENT_CLASS_MAP.get(std_model), INSTRUMENT_CLASS_MAP.get(ti_model)
            std_reader = await sync_to_async(_open_reader, thread_sensitive=True)(
                std_reader_class, std_model, std_addr, session_details.get("std_reader_input")
            )
            ti_reader = await sync_to_async(_open_reader, thread_sensitive=True)(
                ti_reader_class, ti_model, ti_addr, session_details.get("ti_reader_input")
            )

            await self._configure_sources(
                test_points_to_run,
                data.get('bypass_tvc'), 
                data.get('amplifier_range'), 
                ac_source=ac_source, 
                dc_source=dc_source,
                measurement_params=data.get('measurement_params'),
            )
            
            if session_details.get('amplifier_address'):
                amplifier = await sync_to_async(_inst, thread_sensitive=True)(
                    Instrument8100,
                    model='8100',
                    gpib=session_details.get('amplifier_address'),
                    reset_on_connect=not data.get('bypass_amplifier_confirmation')
                )
                if not await self._handle_amplifier_confirmation(amplifier, data.get('amplifier_range'), data): return
            
            await self._activate_sources(ac_source=ac_source, dc_source=dc_source)
            
            # ``dict.get`` only returns the default when the key is missing,
            # not when the value is present-but-``None``. Frontend payloads
            # often send ``initial_warm_up_time: null`` which would crash the
            # ``warmup_time > 0`` comparison; ``or 0`` coerces null/0/'' to 0.
            warmup_time = data.get('initial_warm_up_time') or 0
            if warmup_time > 0:
                await self._perform_warmup(warmup_time, tp_id=(test_points_to_run[0].get('id') if test_points_to_run else None))

            source_instrument = ac_source if 'ac' in stage else dc_source
            if not source_instrument: raise Exception(f"Required source for stage '{stage}' is not assigned.")

            switch_driver = None
            if session_details.get('switch_driver_address'):
                switch_driver = await sync_to_async(_inst, thread_sensitive=True)(Instrument11713C, gpib=session_details.get('switch_driver_address'))
                required_switch_state = 'AC' if 'ac' in stage else 'DC'
                await self.broadcast(text_data=json.dumps({'type': 'status_update', 'message': f"Switching to {required_switch_state} source for batch run..."}))
                if required_switch_state == 'AC': await sync_to_async(switch_driver.select_ac_source, thread_sensitive=True)()
                else: await sync_to_async(switch_driver.select_dc_source, thread_sensitive=True)()
                await self.broadcast(text_data=json.dumps({'type': 'switch_status_update', 'active_source': required_switch_state}))
                await asyncio.sleep(1)

            nplc_setting, measurement_params = data.get('nplc'), data.get('measurement_params')

            for i, point_data in enumerate(test_points_to_run):
                if self.stop_event.is_set(): break

                current_settling_time = float(point_data.get('settling_time', data.get('settling_time', 5.0)))
                current_num_samples = int(point_data.get('num_samples', data.get('num_samples', 8)))
                point_nplc = point_data.get('nplc', nplc_setting)
                point_measurement_params = (
                    point_data.get('measurement_params') or measurement_params
                )

                self._buffer_set_batch_point(point_data)
                await self.broadcast(text_data=json.dumps({
                    'type': 'batch_progress_update',
                    'test_point': point_data,
                    'current': i + 1,
                    'total': len(test_points_to_run)
                }))

                self._buffer_set_stage(stage, tp_id=point_data.get('id'), total=current_num_samples)
                await self.broadcast(text_data=json.dumps({
                    'type': 'calibration_stage_update', 
                    'stage': stage, 
                    'total': current_num_samples,
                    'tpId': point_data.get('id')
                }))

                success = await self._perform_single_measurement(
                    stage, 
                    current_num_samples, 
                    point_data, 
                    data.get('bypass_tvc'), 
                    data.get('amplifier_range'), 
                    source_instrument, std_reader, ti_reader, amplifier, 
                    current_settling_time, 
                    point_nplc,
                    point_measurement_params,
                )
                
                if not success: continue

            if not self.stop_event.is_set():
                await self.broadcast(text_data=json.dumps({'type': 'collection_finished', 'message': 'Batch readings complete.'}))

        except asyncio.CancelledError:
            print(f"Collection task cancelled for session {self.session_id}.")
        except Exception as e:
            traceback.print_exc()
            await self.broadcast(text_data=json.dumps({'type': 'error', 'message': f"An instrument error occurred during batch run: {e}"}))
        finally:
            self.state = "IDLE"
            self._buffer_clear()
            if switch_driver:
                await sync_to_async(switch_driver.deactivate_all, thread_sensitive=True)()
                if hasattr(switch_driver, 'close'): await sync_to_async(switch_driver.close, thread_sensitive=True)()

            sources_to_shutdown = list(filter(None, {ac_source, dc_source}))
            for source in sources_to_shutdown:
                await sync_to_async(source.reset, thread_sensitive=True)()

            if amplifier: await sync_to_async(amplifier.set_standby, thread_sensitive=True)()
            
            for inst in filter(None, {std_reader, ti_reader, amplifier, ac_source, dc_source}):
                if hasattr(inst, 'close'):
                    await sync_to_async(inst.close, thread_sensitive=True)()

    async def save_readings_to_db(self, reading_type_full, readings_list, test_point):
        """
        Durable stage-save path.

        Step 1: enqueue the payload to the local SQLite outbox. This is fast
        and does NOT touch MSSQL, so a down server cannot lose data here.

        Step 2: immediately try to replay the row against the default DB. If
        it works we mark the row done and the UI just sees a normal save; if
        it fails the row stays pending and the background drainer retries it
        with exponential backoff until the server is reachable again.

        This replaces the old single-attempt pattern which silently dropped
        readings on any DB exception.
        """
        print(f"[SAVE-TRACE] 1. Initiating save for {reading_type_full} with {len(readings_list)} readings.", flush=True)
        row_id = await sync_to_async(outbox_module.enqueue, thread_sensitive=True)(
            self.session_id, test_point, reading_type_full, readings_list,
        )
        if row_id is None:
            # Catastrophic: local SQLite write failed. Fall back to a direct
            # attempt and a loud log so the user at least sees the error.
            print(
                f"[OUTBOX] CRITICAL: could not enqueue stage save for "
                f"{reading_type_full}; attempting direct write as a last resort.",
                flush=True,
            )
            await sync_to_async(self._direct_save_readings_fallback, thread_sensitive=True)(
                reading_type_full, readings_list, test_point,
            )
            return

        # Try the real write now. If it fails (MSSQL down) the row stays
        # pending and the drainer picks it up later — either way the payload
        # is durable.
        print(f"[SAVE-TRACE] 3. Calling attempt_replay_row for row_id={row_id}", flush=True)
        ok = await sync_to_async(outbox_module.attempt_replay_row, thread_sensitive=True)(row_id)
        print(f"[SAVE-TRACE] 4. Replay completed. Success={ok} for row_id={row_id}", flush=True)
        if not ok:
            # Make sure the drainer is alive and will retry, and push a status
            # update so the UI's "Buffered: N" badge lights up immediately.
            print(f"[SAVE-TRACE] 5. Replay failed. Ensuring drainer is running and broadcasting DB status.", flush=True)
            outbox_module.ensure_drainer_running()
            await outbox_module.broadcast_db_status()

    def _direct_save_readings_fallback(self, reading_type_full, readings_list, test_point):
        """
        Legacy best-effort write used only when the local outbox itself
        can't accept a row (disk broken). Kept so we never silently lose the
        very first write even if the outbox fails to initialize.
        """
        try:
            session = CalibrationSession.objects.get(pk=self.session_id)
            test_point_set, _ = TestPointSet.objects.get_or_create(session=session)
            tp_id = test_point.get('id')
            if tp_id:
                test_point_obj = TestPoint.objects.get(pk=tp_id)
            else:
                current, frequency, direction = (
                    test_point.get('current'),
                    test_point.get('frequency'),
                    test_point.get('direction', 'Forward'),
                )
                test_point_obj, _ = TestPoint.objects.get_or_create(
                    test_point_set=test_point_set,
                    current=current,
                    frequency=frequency,
                    direction=direction,
                )
            readings, _ = CalibrationReadings.objects.get_or_create(test_point=test_point_obj)
            setattr(readings, f"{reading_type_full}_readings", readings_list)
            readings.save()
            readings.update_related_results()
        except Exception as e:
            print(f"[OUTBOX FALLBACK] direct save failed: {e}", flush=True)
    
    @database_sync_to_async
    def _propagate_characterization_eta(self, characterized_tp_id, target_tvc, char_source_kind):
        """
        After a successful characterization run on `characterized_tp_id`, copy the
        freshly-computed eta_std / eta_ti onto every other TestPoint in the same
        session that shares the same physical characterization context, so the
        downstream AC-DC math uses the real gain instead of silently defaulting
        to 1.0.

        Match rules:
          - Same session
          - DC characterization: same nominal current (freq-independent).
          - AC characterization: same nominal current AND same frequency
            (AC gain is frequency-dependent, so it only applies per-frequency).
          - Direction is ignored (Forward/Reverse share the same physical gain).

        Guardrail: never overwrite a sibling that has its own characterization
        readings for the targeted side - that point will compute its own eta
        from its own data, and that value must win.

        Returns the number of sibling rows updated (for logging).
        """
        try:
            source_tp = TestPoint.objects.select_related(
                'results', 'test_point_set__session'
            ).get(pk=characterized_tp_id)
        except TestPoint.DoesNotExist:
            print(f"[PROP_ETA] Source TP {characterized_tp_id} not found, nothing to propagate.", flush=True)
            return 0

        source_results = getattr(source_tp, 'results', None)
        if source_results is None:
            print("[PROP_ETA] Source TP has no results row; skipping propagation.", flush=True)
            return 0

        session = source_tp.test_point_set.session
        source_eta_std = source_results.eta_std if target_tvc in ('STD', 'BOTH') else None
        source_eta_ti = source_results.eta_ti if target_tvc in ('TI', 'BOTH') else None

        if source_eta_std is None and source_eta_ti is None:
            print("[PROP_ETA] No fresh eta values on source TP; nothing to propagate.", flush=True)
            return 0

        # Build sibling filter
        sibling_qs = TestPoint.objects.filter(
            test_point_set__session=session,
            current=source_tp.current,
        ).exclude(pk=source_tp.pk)

        if char_source_kind == 'AC':
            sibling_qs = sibling_qs.filter(frequency=source_tp.frequency)

        sibling_qs = sibling_qs.select_related('results')

        updated = 0
        for sibling in sibling_qs:
            sib_results = getattr(sibling, 'results', None)
            if sib_results is None:
                # No results row yet -> create one so eta can be pinned;
                # calculate_ac_dc_difference will early-return if avgs aren't ready.
                sib_results = CalibrationResults.objects.create(test_point=sibling)

            # Inspect the sibling's own char readings; if they've characterized
            # themselves, don't clobber their values.
            sib_readings = CalibrationReadings.objects.filter(test_point=sibling).first()

            changed_fields = []

            if source_eta_std is not None:
                sib_has_own_std_char = bool(
                    sib_readings and (
                        sib_readings.std_char_plus1_readings or
                        sib_readings.std_char_minus_readings or
                        sib_readings.std_char_plus2_readings
                    )
                )
                if not sib_has_own_std_char:
                    if sib_results.eta_std is None or abs((sib_results.eta_std or 0.0) - source_eta_std) > 1e-12:
                        sib_results.eta_std = source_eta_std
                        changed_fields.append('eta_std')

            if source_eta_ti is not None:
                sib_has_own_ti_char = bool(
                    sib_readings and (
                        sib_readings.ti_char_plus1_readings or
                        sib_readings.ti_char_minus_readings or
                        sib_readings.ti_char_plus2_readings
                    )
                )
                if not sib_has_own_ti_char:
                    if sib_results.eta_ti is None or abs((sib_results.eta_ti or 0.0) - source_eta_ti) > 1e-12:
                        sib_results.eta_ti = source_eta_ti
                        changed_fields.append('eta_ti')

            if changed_fields:
                sib_results.save(update_fields=changed_fields)
                # Recompute delta_uut_ppm with the new gain. If averages are
                # not ready yet, calculate_ac_dc_difference short-circuits.
                try:
                    sib_results.calculate_ac_dc_difference()
                except Exception as calc_err:
                    print(f"[PROP_ETA] Recalc failed for TP {sibling.pk}: {calc_err}", flush=True)
                updated += 1

        if updated:
            print(
                f"[PROP_ETA] Propagated {char_source_kind} eta ({target_tvc}) from TP "
                f"{source_tp.pk} to {updated} sibling point(s).",
                flush=True,
            )
        else:
            print(
                f"[PROP_ETA] No sibling points eligible for {char_source_kind} "
                f"eta propagation from TP {source_tp.pk}.",
                flush=True,
            )
        return updated

    @database_sync_to_async
    def set_test_point_failed_status(self, test_point_id, status: bool):
        if not test_point_id: 
            return
        try:
            tp = TestPoint.objects.get(pk=test_point_id)
            tp.is_stability_failed = status
            tp.save(update_fields=['is_stability_failed'])
        except TestPoint.DoesNotExist:
            pass
        except Exception as e:
            # Catch DB disconnection errors so they don't crash the measurement loop
            print(f"[CONSUMER] Could not update stability status for TP {test_point_id} (DB offline): {e}", flush=True)

    async def broadcast(self, text_data):
        """Intercepts the text_data and broadcasts it to ALL clients in the session."""
        await self.channel_layer.group_send(
            self.session_group_name,
            {
                'type': 'forward_to_group',
                'text_data': text_data
            }
        )

    async def forward_to_group(self, event):
        """Channels event handler that receives the group message and pushes it down the WebSocket."""
        await self.send(text_data=event['text_data'])


class SwitchDriverConsumer(AsyncWebsocketConsumer):
    instrument_instance = None
    instrument_class = None

    async def connect(self):
        self.instrument_model = self.scope['url_route']['kwargs']['instrument_model']
        self.gpib_address = self.scope['url_route']['kwargs']['gpib_address']
        self.instrument_class = INSTRUMENT_CLASS_MAP.get(self.instrument_model)

        if not self.instrument_class:
            await self.close(code=4001)
            return
            
        self.instrument_instance = await self.connect_instrument_sync()
        if self.instrument_instance:
            await self.accept()
            initial_state = await self.get_status_sync()
            await self.send(text_data=json.dumps({
                'type': 'connection_established',
                'active_source': initial_state,
            }))
        else:
            await self.close(code=4004)

    async def disconnect(self, close_code):
        if self.instrument_instance:
            await self.close_instrument_sync()

    async def receive(self, text_data):
        data = json.loads(text_data)
        command = data.get('command')
        
        if command == 'select_source':
            source = data.get('source')
            if source == 'AC':
                await sync_to_async(self.instrument_instance.select_ac_source, thread_sensitive=True)()
            elif source == 'DC':
                await sync_to_async(self.instrument_instance.select_dc_source, thread_sensitive=True)()
            elif source == 'Standby':
                await sync_to_async(self.instrument_instance.deactivate_all, thread_sensitive=True)()
            
            new_state = await self.get_status_sync()
            await self.send(text_data=json.dumps({'type': 'source_changed', 'active_source': new_state}))
        
        elif command == 'get_status':
            current_state = await self.get_status_sync()
            await self.send(text_data=json.dumps({'type': 'status_update', 'active_source': current_state}))

    @sync_to_async(thread_sensitive=True)
    def connect_instrument_sync(self):
        try:
            instance = self.instrument_class(gpib=self.gpib_address)
            return instance
        except Exception as e:
            print(f"SwitchDriverConsumer: Error connecting to {self.gpib_address}: {e}")
            return None

    @sync_to_async(thread_sensitive=True)
    def close_instrument_sync(self):
        if self.instrument_instance:
            connection = getattr(self.instrument_instance, 'resource', None)
            if connection and hasattr(connection, 'close'):
                connection.close()

    @sync_to_async(thread_sensitive=True)
    def get_status_sync(self):
        return self.instrument_instance.get_active_source()


class DbHealthConsumer(AsyncWebsocketConsumer):
    """
    Streams the current default-DB reachability and outbox backlog to the UI.

    Protocol (server -> client):
        {
            "type": "db_status",
            "reachable": bool,
            "pending_count": int,
            "failed_count": int,
            "timestamp": float,
        }

    The consumer:
      * pushes a snapshot immediately on connect,
      * re-probes on every periodic tick (10s) and when the drainer broadcasts,
      * forwards any ``db.status`` events from the channel-layer group.

    Protocol (client -> server), optional:
        {"command": "refresh"}   -> force a fresh probe + snapshot
        {"command": "retry_failed"} -> flip failed rows back to pending
    """

    GROUP = outbox_module.DB_STATUS_GROUP

    async def connect(self):
        layer = getattr(self, 'channel_layer', None)
        if layer is None:
            print(
                'DbHealthConsumer: channel_layer is None — check INSTALLED_APPS '
                'includes "channels" and CHANNEL_LAYERS is configured.',
                flush=True,
            )
            await self.close(code=4500)
            return
        try:
            await layer.group_add(self.GROUP, self.channel_name)
        except Exception as e:
            print(f'DbHealthConsumer: group_add failed: {e}', flush=True)
            await self.close(code=4500)
            return

        await self.accept()

        # Make sure the drainer is running now that an ASGI loop exists.
        try:
            outbox_module.ensure_drainer_running()
        except Exception as e:
            print(f'DbHealthConsumer: ensure_drainer_running failed: {e}', flush=True)

        # Initial snapshot — never fail the socket after accept(); the UI can
        # still render with a safe fallback payload.
        try:
            payload = await sync_to_async(outbox_module.current_status_payload, thread_sensitive=True)()
        except Exception as e:
            print(f'DbHealthConsumer: current_status_payload failed: {e}', flush=True)
            payload = {
                'type': 'db_status',
                'reachable': True,
                'pending_count': 0,
                'failed_count': 0,
                'timestamp': time.time(),
            }
        await self.send(text_data=json.dumps(payload))

        # Periodic heartbeat so the UI pill keeps itself honest even if the
        # drainer is idle (no new rows to broadcast).
        self._heartbeat_task = asyncio.create_task(self._heartbeat_loop())

    async def disconnect(self, close_code):
        hb = getattr(self, '_heartbeat_task', None)
        if hb:
            hb.cancel()
        layer = getattr(self, 'channel_layer', None)
        if layer is not None:
            try:
                await layer.group_discard(self.GROUP, self.channel_name)
            except Exception:
                pass

    async def receive(self, text_data):
        try:
            data = json.loads(text_data)
        except Exception:
            return
        command = data.get('command')
        if command == 'refresh':
            payload = await sync_to_async(outbox_module.current_status_payload, thread_sensitive=True)()
            await self.send(text_data=json.dumps(payload))
        elif command == 'retry_failed':
            updated = await sync_to_async(outbox_module.retry_failed_rows_sync, thread_sensitive=True)()
            await self.send(text_data=json.dumps({
                'type': 'retry_failed_result',
                'updated': updated,
            }))

    async def _heartbeat_loop(self):
        try:
            while True:
                await asyncio.sleep(10)
                payload = await sync_to_async(outbox_module.current_status_payload, thread_sensitive=True)()
                await self.send(text_data=json.dumps(payload))
        except asyncio.CancelledError:
            return
        except Exception as e:
            print(f"DbHealthConsumer heartbeat error: {e}", flush=True)

    async def db_status(self, event):
        """Channel-layer event handler — forwards broadcasts to the client."""
        payload = event.get('payload') or {}
        if not payload:
            return
        await self.send(text_data=json.dumps(payload))

# --- Server-authoritative hardware lock registry ---
# Keyed by workstation IP. Maps to the channel_name of the host that currently
# has it selected in their UI. This prevents two hosts from clashing over the
# same physical instrumentation simultaneously.
class HostSyncConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        self.group_name = 'host_sync_group'
        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()

        # Record the socket in the presence registry immediately. Role starts
        # as ``unknown`` and is promoted to ``host`` or ``remote`` once the
        # client sends its ``identify`` message. This lets us disregard
        # ``unknown`` entries in the broadcast below — no noise while the
        # handshake is in flight.
        client = self.scope.get('client') or (None, None)
        session_state.register_viewer(
            self.channel_name,
            ip=client[0] or 'unknown',
            connected_at=time.time(),
        )

        # Always send the current host session on connect — including ``None``
        # when no host has picked a session yet. The frontend treats the
        # mere arrival of this message as "state is now authoritative", so
        # remote viewers can distinguish "waiting on host-sync WS to open"
        # from "host is not in a session" instead of showing a misleading
        # "no test points" empty state. Hosts ignore it on the client.
        #
        # The scalar ``session_id`` is the legacy single-host wire; the
        # ``active_sessions`` map is the multi-host-aware form. We always
        # send both so the two generations of clients coexist.
        await self.send(text_data=json.dumps({
            'type': 'session_changed',
            'session_id': session_state.legacy_session_id(),
            'active_sessions': session_state.host_sessions_snapshot(),
        }))

        # Push the current workstation lock state so a fresh connection
        # instantly knows which hardware IPs are currently claimed by other hosts.
        await self.send(text_data=json.dumps({
            'type': 'workstation_claims_update',
            'claims': session_state.claims_snapshot(),
        }))

    async def disconnect(self, close_code):
        try:
            await self.channel_layer.group_discard(self.group_name, self.channel_name)
        except Exception:
            # Channel layer may already be torn down (daphne shutdown); never
            # let that abort the rest of the cleanup below.
            import logging
            logging.getLogger(__name__).exception(
                "HostSyncConsumer: group_discard failed for %s", self.channel_name,
            )

        # Pop this socket's active-session entry and, if it had one, broadcast
        # the refreshed ``active_sessions`` map so every remaining client
        # removes the stale "(Active)" pill in the session dropdown.
        # Previously this was silent, which meant a host closing their tab
        # left every other user's UI flagging the now-dead session as live —
        # the exact bug that pushed clients into observer mode against a
        # session nobody was actually running anymore.
        had_session = session_state.get_host_session(self.channel_name) is not None
        session_state.clear_host_session(self.channel_name)
        if had_session:
            try:
                await self.channel_layer.group_send(
                    self.group_name,
                    {
                        'type': 'broadcast_session',
                        'session_id': session_state.legacy_session_id(),
                        'active_sessions': session_state.host_sessions_snapshot(),
                    },
                )
            except Exception:
                import logging
                logging.getLogger(__name__).exception(
                    "HostSyncConsumer: post-disconnect session_changed broadcast failed",
                )

        # Drop this socket from the registry and push the fresh observer list
        # so any host still connected updates its pill within a tick.
        if session_state.unregister_viewer(self.channel_name):
            try:
                await self._broadcast_viewer_presence()
            except Exception:
                import logging
                logging.getLogger(__name__).exception(
                    "HostSyncConsumer: presence rebroadcast failed",
                )

        # Self-Healing Lock Release: If this socket abruptly disconnects
        # (e.g., host closes the tab, browser crash, or network loss),
        # automatically release any workstations it had claimed so other
        # hosts aren't permanently locked out of that hardware. Now also
        # clears the mirrored ``WorkstationClaim`` DB row in the same
        # call, which is why this is wrapped in ``database_sync_to_async``.
        # Wrapped defensively because a DB hiccup during release must not
        # leak this channel's presence registry entry (handled above) or
        # abort Channels' own per-consumer teardown.
        try:
            released = await database_sync_to_async(session_state.release_claims_for)(
                self.channel_name
            )
            if released:
                await self.channel_layer.group_send(self.group_name, {
                    'type': 'broadcast_claims',
                    'claims': session_state.claims_snapshot(),
                })
        except Exception:
            import logging
            logging.getLogger(__name__).exception(
                "HostSyncConsumer: workstation release/broadcast failed for %s",
                self.channel_name,
            )

    async def receive(self, text_data):
        data = json.loads(text_data)
        command = data.get('command')

        if command == 'set_session':
            session_id = data.get('session_id')
            client_info = session_state.get_viewer(self.channel_name) or {}
            if client_info.get('role') != 'host':
                return

            # Record this host's current session against its channel_name.
            session_state.set_host_session(self.channel_name, session_id)

            # Broadcast the change. ``session_id`` is the legacy scalar,
            # ``host_channel`` and ``active_sessions`` are the multi-host
            # extensions; legacy remote clients read only the first field.
            await self.channel_layer.group_send(
                self.group_name,
                {
                    'type': 'broadcast_session',
                    'session_id': session_id,
                    'host_channel': self.channel_name,
                    'active_sessions': session_state.host_sessions_snapshot(),
                }
            )

        elif command == 'identify':
            # One-shot handshake: the client declares ``host`` or ``remote``.
            # We promote the registry entry and re-broadcast so hosts see the
            # observer list reflect the new joiner (or their own appearance).
            role = data.get('role')
            if role not in ('host', 'remote'):
                return
            if not session_state.update_viewer_role(self.channel_name, role):
                # Disconnected between connect() and here — nothing to update.
                return
            await self._broadcast_viewer_presence()

        elif command == 'request_session_state':
            # Safety net: remote viewers re-ask for the host's session after a
            # reconnect (or if the auto-send in ``connect()`` was somehow
            # missed). We unicast to just this socket so other clients don't
            # get spammed with redundant session_changed events. Include the
            # full active-sessions map for multi-host-aware clients.
            await self.send(text_data=json.dumps({
                'type': 'session_changed',
                'session_id': session_state.legacy_session_id(),
                'active_sessions': session_state.host_sessions_snapshot(),
            }))

        elif command == 'claim_workstation':
            # Workstation hardware locking. Only an active host can lock a
            # workstation, preventing two hosts from simultaneously polling
            # or driving the same physical instruments.
            ip = data.get('ip')
            client_id = data.get('client_id')
            client_info = session_state.get_viewer(self.channel_name) or {}
            role = client_info.get('role', 'unknown')

            # Enforce role-based security: Observers can't lock hardware.
            if ip and role == 'host':
                # Attach the host's current session so the admin row shows
                # which calibration run this bench is being used for, and a
                # human-readable label (client IP) so an operator can
                # identify a stuck claim without decoding channel_names.
                active_session_id = session_state.get_host_session(self.channel_name)
                owner_label = client_info.get('ip') or ''

                await database_sync_to_async(session_state.claim_workstation)(
                    ip,
                    channel_name=self.channel_name,
                    client_id=client_id,
                    role=role,
                    owner_label=owner_label,
                    active_session_id=active_session_id,
                )
                await self.channel_layer.group_send(self.group_name, {
                    'type': 'broadcast_claims',
                    'claims': session_state.claims_snapshot(),
                })

        elif command == 'release_workstation':
            ip = data.get('ip')

            # Safety check: Only the socket that owns the lock can release it.
            # ``release_workstation`` returns ``False`` if the lock either
            # doesn't exist or belongs to someone else, so we skip the
            # broadcast to avoid spamming no-op updates. Wrapped so the
            # DB mirror delete runs off the event loop thread.
            if not ip:
                return
            released = await database_sync_to_async(session_state.release_workstation)(
                ip, channel_name=self.channel_name,
            )
            if released:
                await self.channel_layer.group_send(self.group_name, {
                    'type': 'broadcast_claims',
                    'claims': session_state.claims_snapshot(),
                })

    # --- Handlers for group_send events ---

    async def broadcast_claims(self, event):
        """Channels event handler to push the claims payload down the WebSocket."""
        await self.send(text_data=json.dumps({
            'type': 'workstation_claims_update',
            'claims': event['claims']
        }))

    def _collect_observers(self):
        """Build the observer list that hosts consume.

        Returns only ``remote``-role entries so hosts never see themselves or
        half-identified ``unknown`` sockets. Deduplicates by client IP so two
        tabs on the same remote machine — or React StrictMode's dev-mode
        double-mount that briefly opens two sockets — count as a single
        observer. The earliest ``connected_at`` wins so the "connected Xm"
        timer in the UI matches when the machine first joined.
        """
        by_ip: dict[str, dict] = {}
        for entry in session_state.viewers_snapshot().values():
            if entry.get('role') != 'remote':
                continue
            ip = entry.get('ip', 'unknown')
            connected_at = entry.get('connected_at', 0)
            existing = by_ip.get(ip)
            if existing is None or connected_at < existing['connected_at']:
                by_ip[ip] = {'ip': ip, 'connected_at': connected_at}
        observers = list(by_ip.values())
        # Stable ordering makes the frontend hover list deterministic.
        observers.sort(key=lambda o: o['connected_at'])
        return observers

    async def _broadcast_viewer_presence(self):
        """Push the observer list to every host-role socket in the group.

        Remotes never receive this — they don't need to know about each
        other, and skipping them keeps the wire traffic minimal.
        """
        observers = self._collect_observers()
        await self.channel_layer.group_send(
            self.group_name,
            {
                'type': 'viewer_presence',
                'observers': observers,
            }
        )

    async def viewer_presence(self, event):
        # Host-only delivery: remotes silently drop the message rather than
        # surfacing presence info that would never be rendered.
        entry = session_state.get_viewer(self.channel_name)
        if entry is None or entry.get('role') != 'host':
            return
        await self.send(text_data=json.dumps({
            'type': 'viewer_presence',
            'observers': event.get('observers', []),
        }))

    async def broadcast_session(self, event):
        payload = {
            'type': 'session_changed',
            'session_id': event['session_id'],
        }
        # Multi-host extensions — legacy clients ignore unknown fields.
        if 'host_channel' in event:
            payload['host_channel'] = event['host_channel']
        if 'active_sessions' in event:
            payload['active_sessions'] = event['active_sessions']
        await self.send(text_data=json.dumps(payload))
