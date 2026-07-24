"""Fluke 8508A/8508A-01 reference multimeter support.

The 8508A-01 has one measurement engine and two independently selectable
terminal sets.  It cannot return independent front and rear readings from one
trigger: the scan commands return only a ratio, difference, or deviation.
Consequently this driver exposes channel-bound logical readers backed by one
shared VISA resource.  A process-wide lock makes ``INPUT ...; X?`` atomic so
the AC Shunt collector can keep its existing Standard/TI reader abstraction
without issuing concurrent commands to the same physical meter.

Command spellings and defaults follow the 8508A Users Manual, chapter 4
("Remote Operations Using the IEEE 488 Interface").
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
import math
import threading
from typing import ClassVar

import pyvisa


class InputTerminal(str, Enum):
    FRONT = "FRONT"
    REAR = "REAR"


class TriggerSource(str, Enum):
    INTERNAL = "INT"
    EXTERNAL = "EXT"


class ScanMode(str, Enum):
    """8508A dual-input calculations (each is sequential, not simultaneous)."""

    RATIO = "DIV_REAR"
    DIFFERENCE = "SUB_REAR"
    DEVIATION = "DEVTN"


@dataclass
class _SharedConnection:
    resource_manager: object
    device: object
    io_lock: threading.RLock = field(default_factory=threading.RLock)
    ref_count: int = 0
    initialized: bool = False
    has_rear_input: bool | None = None
    selected_input: InputTerminal | None = None
    measurement_command: str | None = None
    reading_invalidated: bool = True


class Instrument8508A:
    """Channel-bound Fluke 8508A reader.

    ``input_terminal`` makes an instance behave like a logical Standard or TI
    reader.  Two instances opened against the same VISA address share one
    resource and serialize all I/O.
    """

    DEFAULT_TIMEOUT_MS = 120_000
    OVERLOAD_SENTINEL = 200.0e33

    _connections: ClassVar[dict[str, _SharedConnection]] = {}
    _registry_lock: ClassVar[threading.RLock] = threading.RLock()

    def __init__(
        self,
        gpib: str,
        input_terminal: str | InputTerminal = InputTerminal.FRONT,
        timeout: int = DEFAULT_TIMEOUT_MS,
        *,
        reset_on_connect: bool = True,
    ):
        self.gpib = gpib
        self.timeout = timeout
        self.input_terminal = self._coerce_terminal(input_terminal)
        self._closed = False

        with self._registry_lock:
            shared = self._connections.get(gpib)
            if shared is None:
                rm = pyvisa.ResourceManager()
                device = rm.open_resource(gpib)
                device.timeout = timeout
                device.read_termination = "\n"
                device.write_termination = "\n"
                shared = _SharedConnection(rm, device)
                self._connections[gpib] = shared
            shared.ref_count += 1
            self._shared = shared

        try:
            with self._shared.io_lock:
                if not self._shared.initialized:
                    if reset_on_connect:
                        self._shared.device.write("*RST")
                    self._shared.device.write("*CLS")
                    self._initialize_ac_shunt_mode_unlocked()
                    self._shared.initialized = True
                self._validate_terminal_unlocked(self.input_terminal)
        except Exception:
            self.close()
            raise

    @staticmethod
    def _coerce_terminal(value: str | InputTerminal) -> InputTerminal:
        if isinstance(value, InputTerminal):
            return value
        try:
            return InputTerminal(str(value or "").strip().upper())
        except ValueError as exc:
            raise ValueError("8508A input terminal must be FRONT or REAR") from exc

    @property
    def device(self):
        """Compatibility alias used by the existing AC Shunt cleanup code."""

        return self._shared.device

    @property
    def resource(self):
        return self._shared.device

    def _initialize_ac_shunt_mode_unlocked(self) -> None:
        # Explicitly program every required state even though these happen to
        # match the ACV reset defaults. This makes initialization auditable and
        # immune to retained front-panel settings.
        measurement_command = "ACV AUTO,FILT40HZ,RESL6,TFER_ON,TWO_WR"
        self._shared.device.write(measurement_command)
        self._shared.device.write("TRG_SRCE EXT")
        self._shared.device.write("DELAY DFLT")
        # *RST selects FRONT. The first conversion is deliberately discarded
        # because a reset/function change invalidates any previously completed
        # conversion in the meter's reading store.
        self._shared.selected_input = InputTerminal.FRONT
        self._shared.measurement_command = measurement_command
        self._shared.reading_invalidated = True

    def initialize_ac_shunt_mode(self) -> None:
        with self._shared.io_lock:
            self._initialize_ac_shunt_mode_unlocked()
            self._shared.initialized = True

    def _validate_terminal_unlocked(self, terminal: InputTerminal) -> None:
        if terminal is not InputTerminal.REAR:
            return
        if self._shared.has_rear_input is None:
            options = self._shared.device.query("*OPT?").strip().upper()
            self._shared.has_rear_input = "8508A/01" in options
        if not self._shared.has_rear_input:
            raise RuntimeError(
                "Rear input requires the Fluke 8508A/01 rear-terminal option."
            )

    def get_identity(self) -> str:
        return self.query_command("*IDN?")

    def get_options(self) -> str:
        return self.query_command("*OPT?")

    def write_command(self, command: str) -> None:
        """Send any programming command documented by the 8508A manual."""

        with self._shared.io_lock:
            self._shared.device.write(command)

    def query_command(self, command: str) -> str:
        """Send any documented 8508A query and return its raw response."""

        with self._shared.io_lock:
            return self._shared.device.query(command).strip()

    def reset(self) -> None:
        with self._shared.io_lock:
            self._shared.device.write("*RST")
            self._initialize_ac_shunt_mode_unlocked()
            self._shared.initialized = True

    def clear(self) -> None:
        self.write_command("*CLS")

    def set_input(self, terminal: str | InputTerminal) -> None:
        selected = self._coerce_terminal(terminal)
        with self._shared.io_lock:
            self._validate_terminal_unlocked(selected)
            self._select_input_unlocked(selected)
            self.input_terminal = selected

    def input_off(self) -> None:
        with self._shared.io_lock:
            self._shared.device.write("INPUT OFF")
            self._shared.selected_input = None
            self._shared.reading_invalidated = True

    def set_scan_mode(self, mode: str | ScanMode) -> None:
        selected = mode if isinstance(mode, ScanMode) else ScanMode(str(mode).upper())
        with self._shared.io_lock:
            self._shared.device.write(f"INPUT {selected.value}")
            self._shared.selected_input = None
            self._shared.reading_invalidated = True

    def set_trigger_source(self, source: str | TriggerSource) -> None:
        selected = source if isinstance(source, TriggerSource) else TriggerSource(str(source).upper())
        self.write_command(f"TRG_SRCE {selected.value}")

    def set_settling_delay(self, seconds: float | None = None) -> None:
        if seconds is None:
            self.write_command("DELAY DFLT")
            return
        value = float(seconds)
        if not 0 <= value <= 65_000:
            raise ValueError("8508A settling delay must be between 0 and 65000 seconds")
        self.write_command(f"DELAY {value:g}")

    def configure_ac_voltage(
        self,
        range_setting: float | str = "AUTO",
        *,
        filter_hz: int = 40,
        resolution: int = 6,
        transfer: bool = True,
        two_wire: bool = True,
        dc_coupled: bool = False,
        spot_correction: bool = False,
    ) -> None:
        if filter_hz not in (1, 10, 40, 100):
            raise ValueError("8508A ACV filter must be 1, 10, 40, or 100 Hz")
        if resolution not in (5, 6):
            raise ValueError("8508A ACV resolution must be 5 or 6")
        range_token = "AUTO" if str(range_setting).upper() == "AUTO" else f"{float(range_setting):g}"
        commands = [
            range_token,
            f"FILT{filter_hz}HZ",
            f"RESL{resolution}",
            "TFER_ON" if transfer else "TFER_OFF",
            "TWO_WR" if two_wire else "FOUR_WR",
            "DCCP" if dc_coupled else "ACCP",
            "SPOT_ON" if spot_correction else "SPOT_OFF",
        ]
        command = f"ACV {','.join(commands)}"
        with self._shared.io_lock:
            self._set_measurement_command_unlocked(command)

    def configure_dc_voltage(
        self,
        range_setting: float | str = "AUTO",
        *,
        resolution: int = 6,
        filter_enabled: bool = True,
        fast: bool = False,
        two_wire: bool = True,
    ) -> None:
        if resolution not in (5, 6, 7, 8):
            raise ValueError("8508A DCV resolution must be 5, 6, 7, or 8")
        range_token = "AUTO" if str(range_setting).upper() == "AUTO" else f"{float(range_setting):g}"
        commands = [
            range_token,
            "FILT_ON" if filter_enabled else "FILT_OFF",
            f"RESL{resolution}",
            "FAST_ON" if fast else "FAST_OFF",
            "TWO_WR" if two_wire else "FOUR_WR",
        ]
        command = f"DCV {','.join(commands)}"
        with self._shared.io_lock:
            self._set_measurement_command_unlocked(command)

    def trigger(self) -> None:
        self.write_command("*TRG")

    def recall_reading(self) -> float:
        return self._parse_reading(self.query_command("RDG?"))

    def read_instrument(self) -> float:
        """Select this logical channel, trigger, and return one reading.

        The lock intentionally covers both commands. Without that atomic
        section, concurrent Standard/TI tasks could switch the input between
        another task's selection and trigger.
        """

        with self._shared.io_lock:
            self._validate_terminal_unlocked(self.input_terminal)
            self._select_input_unlocked(self.input_terminal)
            return self._take_settled_reading_unlocked()

    def read_pair(
        self,
        other: "Instrument8508A",
        *,
        reverse_order: bool = False,
    ) -> tuple[float, float]:
        """Return readings for two logical channels as one atomic pair.

        Adjacent calls can alternate ``reverse_order`` to produce an
        A-B / B-A sequence. This is the sequential analogue of the existing
        parallel-reader sample and reduces first/second-channel drift bias.
        The returned tuple always follows ``(self, other)`` order.
        """

        if not isinstance(other, Instrument8508A) or other._shared is not self._shared:
            raise ValueError("Paired 8508A readers must share the same VISA resource")
        ordered = (other, self) if reverse_order else (self, other)
        values: dict[int, float] = {}
        with self._shared.io_lock:
            for reader in ordered:
                self._validate_terminal_unlocked(reader.input_terminal)
                self._select_input_unlocked(reader.input_terminal)
                values[id(reader)] = self._take_settled_reading_unlocked()
        return values[id(self)], values[id(other)]

    def _set_measurement_command_unlocked(self, command: str) -> None:
        """Apply a function/profile only when it actually changed."""

        if self._shared.measurement_command == command:
            return
        self._shared.device.write(command)
        self._shared.measurement_command = command
        self._shared.reading_invalidated = True

    def _select_input_unlocked(self, terminal: InputTerminal) -> None:
        """Select a terminal once and invalidate the first conversion."""

        if self._shared.selected_input is terminal:
            return
        self._shared.device.write(f"INPUT {terminal.value}")
        self._shared.selected_input = terminal
        self._shared.reading_invalidated = True

    def _take_settled_reading_unlocked(self) -> float:
        """Return a fresh reading, purging one conversion after a state change.

        ``X?`` performs ``*TRG;RDG?`` and honors the programmed/default delay.
        The unsaved conversion after a relay or function transition lets the
        8508A input path, autorange, RMS converter, and transfer cycle settle
        before a value can enter the calibration arrays.
        """

        if self._shared.reading_invalidated:
            # The purge may legitimately be an overload or a value belonging
            # to the previously selected input, so only require successful
            # bus completion here. Validation applies to the saved conversion.
            self._shared.device.query("X?")
            self._shared.reading_invalidated = False
        return self._parse_reading(self._shared.device.query("X?").strip())

    @classmethod
    def _parse_reading(cls, response: str) -> float:
        value = float(response)
        if not math.isfinite(value) or abs(value) >= cls.OVERLOAD_SENTINEL:
            raise OverflowError(f"8508A returned an overload reading: {response!r}")
        return value

    def get_execution_error(self) -> int:
        return int(float(self.query_command("EXQ?")))

    def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        with self._registry_lock:
            shared = getattr(self, "_shared", None)
            if shared is None:
                return
            shared.ref_count -= 1
            if shared.ref_count <= 0:
                try:
                    shared.device.close()
                finally:
                    close_rm = getattr(shared.resource_manager, "close", None)
                    if callable(close_rm):
                        close_rm()
                    self._connections.pop(self.gpib, None)
