"""Fluke 5790A AC Measurement Standard.

The 5790A and 5790B share the remote measurement commands used by the
AC-shunt workflow (INPUT, RANGE, HIRES, DFILT, VAL?, and ISR?).  Keep a
distinct class so discovery and identity validation remain model-accurate,
while inheriting the audited command implementation from the 5790B driver.
"""

from .instrument_5790B import Instrument5790B


class Instrument5790A(Instrument5790B):
    """5790A model-specific identity with the shared 5790 measurement API."""

    def __init__(self, model: str = "5790A", gpib: str = None, timeout: float = 60000):
        super().__init__(model=model, gpib=gpib, timeout=timeout)

    def check_identity(self):
        """Require the Alpha identity rather than accepting any 5790 model."""
        try:
            self.resource.timeout = 2000
            self.resource.read_termination = "\n"
            identity = self.resource.query("*IDN?").strip()
            fields = [field.strip().upper() for field in identity.split(',')]
            model_field = fields[1] if len(fields) > 1 else identity.upper()
            return model_field.startswith("5790A"), identity
        finally:
            self.resource.timeout = self.timeout
