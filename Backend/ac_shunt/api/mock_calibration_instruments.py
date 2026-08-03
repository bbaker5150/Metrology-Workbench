"""Mock instrument drop-ins for the ``CalibrationConsumer``.

Activated by ``settings.MOCK_INSTRUMENTS`` in combination with the mock GPIB
addresses listed in ``mock_instruments.MOCK_ADDRESS_PREFIXES``. These classes
subclass the real ``npsl_tools`` instruments so ``isinstance`` checks inside
``_perform_single_measurement`` (and friends) keep working, but they skip the
pyvisa connection and produce plausible synthetic readings instead.

The whole point is to exercise the live-data path end-to-end -- source
set_output -> reader read_instrument -> ``dual_reading_update`` -> server
buffer -> remote viewer -- without any real hardware on the bench.

Conventions:

* A module-level ``_STATE`` dict acts as the shared "bus" between mock
  source and mock readers. Whatever voltage/frequency the source is
  commanded to emit is stored there; every reader then returns that value
  with a small, address-seeded bias plus tight gaussian jitter.
* Per-reader bias is derived from a hash of the GPIB address so STD and TI
  readers produce slightly different means, which in turn lets the
  calibration pipeline compute non-degenerate deltas downstream.
* Jitter is tight enough (~0.1 PPM) that the stability window converges
  immediately, so mock runs don't stall waiting to lock in.
"""

from __future__ import annotations

import hashlib
import math
import random
import time
from typing import Optional

from npsl_tools.instruments import (
    Instrument11713C,
    Instrument3458A,
    Instrument5730A,
    Instrument5790A,
    Instrument5790B,
    Instrument34420A,
    Instrument8508A,
    Instrument8100,
)


# --- Shared simulation state -------------------------------------------------
# The mock source writes here; mock readers read from here. This is obviously
# not how real hardware works (the readers have their own physical input),
# but it is the simplest way to keep synthetic readings correlated with
# whatever the run is currently driving.
_STATE = {
    "source_voltage": 1.0,
    "source_frequency": 0.0,
    "active_source": None,  # "AC" or "DC" -- set by the switch driver
    "amp_range": 1.0,
    # Phase offset re-seeded every set_output() call so each run has a fresh,
    # arbitrary ripple phase -- mimics the real bench where time.time() has no
    # phase relationship to the AC source.
    "ripple_phase": 0.0,
}


def _address_bias_ppm(gpib: Optional[str]) -> float:
    """Deterministic per-instrument bias in PPM, seeded from the GPIB string.

    Keeping this deterministic means STD and TI diverge predictably each run,
    so plots/tables don't look identical but still land within sane bounds.
    """
    if not gpib:
        return 0.0
    digest = hashlib.md5(str(gpib).encode("utf-8")).hexdigest()
    # Map the first 4 hex chars (0..65535) onto roughly [-8, 8] PPM.
    raw = int(digest[:4], 16) / 65535.0  # 0..1
    return (raw - 0.5) * 16.0


def _synthetic_reading(gpib: Optional[str], *, inject_lf_ripple: bool = False) -> float:
    """Return source_voltage * (1 + bias) + gaussian jitter, plus an optional
    synthetic LF AC thermal ripple.

    When ``inject_lf_ripple`` is True and the active source frequency is in
    the LF AC band (0 < f <= 40 Hz), this stacks a coherent ripple at exactly
    ``2 * source_frequency`` on top of the baseline reading. The amplitude
    rolls off with frequency to mimic an SJTVC's thermal low-pass response::

        ripple_amplitude = base * 0.08 / sqrt(1 + (f/5)^2)

    so a 10 Hz drive produces ~6 % of full-scale ripple and a 40 Hz drive
    produces ~1 %. Phase comes from ``_STATE['ripple_phase']`` (re-seeded on
    every ``set_output``) so each run has an arbitrary phase relationship to
    the wall clock - which is exactly what makes the arithmetic mean biased
    and exercises the harmonic-projection fix in
    ``CalibrationConsumer._project_dc_from_ripple``.
    """
    base = _STATE.get("source_voltage", 0.0) or 0.0
    bias_ppm = _address_bias_ppm(gpib)
    jitter = random.gauss(0.0, max(abs(base), 1e-6) * 1e-7)  # ~0.1 PPM
    reading = base * (1.0 + bias_ppm * 1e-6) + jitter

    if inject_lf_ripple:
        f = float(_STATE.get("source_frequency", 0.0) or 0.0)
        if 0.0 < f <= 40.0 and abs(base) > 1e-9:
            roll_off = 1.0 / math.sqrt(1.0 + (f / 5.0) ** 2)
            ripple_amp = abs(base) * 0.08 * roll_off
            phase = float(_STATE.get("ripple_phase", 0.0))
            reading += ripple_amp * math.cos(2.0 * 2.0 * math.pi * f * time.time() + phase)

    return reading


# --- Small shim that stubs out pyvisa for every mock class -------------------
class _MockResource:
    """Stand-in for ``pyvisa.resources.Resource`` -- swallows everything."""

    def write(self, *_args, **_kwargs) -> None:
        return None

    def query(self, *_args, **_kwargs) -> str:
        return ""

    def read(self, *_args, **_kwargs) -> str:
        return ""

    def close(self) -> None:
        return None


def _install_mock_attrs(instance, *, model: Optional[str], gpib: Optional[str], timeout: float = 60000) -> None:
    """Populate the attributes the base ``Instrument`` class would have set,
    but without touching pyvisa. Every mock ``__init__`` calls this instead
    of ``super().__init__`` so mock addresses never go through the VISA path.
    """
    if model is not None:
        instance.model = model
    instance.gpib = gpib
    instance.timeout = timeout
    instance.resource = _MockResource()


# --- Source ------------------------------------------------------------------
class Mock5730A(Instrument5730A):
    """Mock 5730A calibrator -- records commanded voltage/frequency."""

    def __init__(self, model: str = "5730A", gpib: Optional[str] = None, timeout: float = 60000):
        _install_mock_attrs(self, model=model, gpib=gpib, timeout=timeout)

    def set_output(self, voltage: float, frequency: float) -> None:  # type: ignore[override]
        _STATE["source_voltage"] = float(voltage) if voltage is not None else 0.0
        _STATE["source_frequency"] = float(frequency) if frequency is not None else 0.0
        # Re-seed the ripple phase so each commanded output has an arbitrary
        # starting phase (the real bench has no phase lock between commands).
        _STATE["ripple_phase"] = random.uniform(0.0, 2.0 * math.pi)

    def set_operate(self) -> None:  # type: ignore[override]
        return None

    def set_standby(self) -> None:  # type: ignore[override]
        _STATE["source_voltage"] = 0.0

    def set_operate_standby(self, operate: bool) -> None:  # type: ignore[override]
        if not operate:
            _STATE["source_voltage"] = 0.0

    def reset(self) -> None:  # type: ignore[override]
        _STATE["source_voltage"] = 0.0
        _STATE["source_frequency"] = 0.0

    def set_ac_transfer(self, enabled: bool) -> None:  # type: ignore[override]
        return None


# --- Readers -----------------------------------------------------------------
class Mock3458A(Instrument3458A):
    """Mock 3458A DMM -- returns synthetic readings correlated with the source."""

    def __init__(self, model: str = "3458A", gpib: Optional[str] = None, timeout: float = 60000):
        _install_mock_attrs(self, model=model, gpib=gpib, timeout=timeout)

    def configure_measurement(self, function: str, expected_value: float, frequency: float = None) -> None:  # type: ignore[override]
        return None

    def read_instrument(self) -> float:  # type: ignore[override]
        return _synthetic_reading(getattr(self, "gpib", None))


class Mock5790B(Instrument5790B):
    """Mock 5790B AC transfer standard."""

    def __init__(self, model: str = "5790B", gpib: Optional[str] = None, timeout: float = 60000):
        _install_mock_attrs(self, model=model, gpib=gpib, timeout=timeout)

    def set_range(self, value: float) -> None:  # type: ignore[override]
        return None

    def read_instrument(self) -> float:  # type: ignore[override]
        return _synthetic_reading(getattr(self, "gpib", None))

    def reset(self) -> None:  # type: ignore[override]
        return None


class Mock5790A(Mock5790B, Instrument5790A):
    """Mock 5790A using the same measurement behavior as the 5790B mock."""

    def __init__(self, model: str = "5790A", gpib: Optional[str] = None, timeout: float = 60000):
        _install_mock_attrs(self, model=model, gpib=gpib, timeout=timeout)


class Mock34420A(Instrument34420A):
    """Mock 34420A nanovoltmeter.

    Unlike the other mock readers, this one represents the workbench TVC path
    where the thermal ripple physics actually matters - so its synthetic
    readings include an injected 2f ripple when the active source is in the
    LF AC band. This lets the calibration UI exercise the harmonic-projection
    code path end-to-end without real hardware.
    """

    def __init__(self, gpib: Optional[str] = None, timeout: int = 5000):
        _install_mock_attrs(self, model="34420A", gpib=gpib, timeout=timeout)

    def reset(self) -> None:  # type: ignore[override]
        return None

    def set_integration(self, setting: float) -> None:  # type: ignore[override]
        return None

    def read_instrument(self) -> float:  # type: ignore[override]
        return _synthetic_reading(getattr(self, "gpib", None), inject_lf_ripple=True)

    def close(self) -> None:  # type: ignore[override]
        return None


class Mock8508A(Instrument8508A):
    """Mock dual-input 8508A used as two logical readers."""

    def __init__(
        self,
        gpib: Optional[str] = None,
        input_terminal: str = "FRONT",
        timeout: int = 120000,
        reset_on_connect: bool = True,
    ):
        _install_mock_attrs(self, model="8508A", gpib=gpib, timeout=timeout)
        self.input_terminal = str(input_terminal).upper()

    def initialize_ac_shunt_mode(self) -> None:  # type: ignore[override]
        return None

    def set_input(self, terminal: str) -> None:  # type: ignore[override]
        self.input_terminal = str(terminal).upper()

    def read_instrument(self) -> float:  # type: ignore[override]
        # Offset the two logical inputs just enough for mock runs to prove that
        # Standard and TI routing did not accidentally read the same channel.
        base = _synthetic_reading(getattr(self, "gpib", None), inject_lf_ripple=True)
        return base if self.input_terminal == "FRONT" else base * 1.000001

    def read_pair(self, other, reverse_order: bool = False):  # type: ignore[override]
        return self.read_instrument(), other.read_instrument()

    def close(self) -> None:  # type: ignore[override]
        return None


# --- Amplifier & switch ------------------------------------------------------
class Mock8100(Instrument8100):
    """Mock Clarke-Hess 8100 transconductance amp."""

    def __init__(self, model: str = "8100", gpib: Optional[str] = None, timeout: int = 20000, reset_on_connect: bool = True):
        _install_mock_attrs(self, model=model, gpib=gpib, timeout=timeout)

    def close(self, reset: bool = True) -> None:  # type: ignore[override]
        return None

    def reset(self) -> None:  # type: ignore[override]
        return None

    def set_range(self, range_amps: float) -> None:  # type: ignore[override]
        _STATE["amp_range"] = float(range_amps) if range_amps is not None else 1.0

    def set_operate(self) -> None:  # type: ignore[override]
        return None

    def set_standby(self) -> None:  # type: ignore[override]
        return None


class Mock11713C(Instrument11713C):
    """Mock Agilent 11713C switch driver."""

    def __init__(self, gpib: Optional[str] = None, timeout: float = 10000):
        _install_mock_attrs(self, model="11713C", gpib=gpib, timeout=timeout)

    def select_dc_source(self) -> None:  # type: ignore[override]
        _STATE["active_source"] = "DC"

    def select_ac_source(self) -> None:  # type: ignore[override]
        _STATE["active_source"] = "AC"

    def set_route(self, route: str) -> None:  # type: ignore[override]
        _STATE["active_route"] = str(route).upper()

    def select_reader(self, role: str, standard_route: str = "OPEN") -> None:  # type: ignore[override]
        role = str(role).upper()
        _STATE["active_reader"] = role
        route = standard_route if role == "STD" else (
            "CLOSED" if str(standard_route).upper() == "OPEN" else "OPEN"
        )
        self.set_route(route)

    def deactivate_all(self) -> None:  # type: ignore[override]
        _STATE["active_source"] = None

    def get_active_source(self) -> Optional[str]:  # type: ignore[override]
        return _STATE.get("active_source")


# --- Public resolver ---------------------------------------------------------
MOCK_CLASS_MAP = {
    Instrument5730A: Mock5730A,
    Instrument3458A: Mock3458A,
    Instrument5790A: Mock5790A,
    Instrument5790B: Mock5790B,
    Instrument34420A: Mock34420A,
    Instrument8508A: Mock8508A,
    Instrument8100: Mock8100,
    Instrument11713C: Mock11713C,
}


def resolve_calibration_instrument(real_cls, address: Optional[str]):
    """Return the mock subclass when mocking is enabled for this address.

    Caller is responsible for checking ``settings.MOCK_INSTRUMENTS`` and
    ``is_mock_address(address)`` -- this function just performs the mapping.
    """
    return MOCK_CLASS_MAP.get(real_cls, real_cls)
