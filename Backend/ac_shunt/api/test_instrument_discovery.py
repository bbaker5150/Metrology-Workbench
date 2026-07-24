from unittest.mock import Mock

from django.test import SimpleTestCase

from .views import (
    IDENTITY_OPEN_TIMEOUT_MS,
    IDENTITY_QUERY_TIMEOUT_MS,
    _ordered_unique_resources,
    get_instrument_identity,
)


class InstrumentDiscoveryTests(SimpleTestCase):
    def test_mixed_local_and_remote_resources_are_all_retained(self):
        resources = (
            "visa://10.0.0.42/GPIB0::22::INSTR",
            "GPIB0::4::INSTR",
            "GPIB0::22::INSTR",
            "gpib0::4::instr",
        )

        self.assertEqual(
            _ordered_unique_resources(resources),
            [
                "GPIB0::22::INSTR",
                "GPIB0::4::INSTR",
                "visa://10.0.0.42/GPIB0::22::INSTR",
            ],
        )

    def test_identity_probe_uses_lab_safe_timeouts_and_lf_termination(self):
        instrument = Mock()
        instrument.query.return_value = "FLUKE,8508A,12345,1.0\n"
        rm = Mock()
        rm.open_resource.return_value = instrument

        identity = get_instrument_identity(rm, "GPIB0::4::INSTR")

        self.assertEqual(identity, "FLUKE,8508A,12345,1.0")
        rm.open_resource.assert_called_once_with(
            "GPIB0::4::INSTR",
            open_timeout=IDENTITY_OPEN_TIMEOUT_MS,
        )
        self.assertEqual(instrument.timeout, IDENTITY_QUERY_TIMEOUT_MS)
        self.assertEqual(instrument.read_termination, "\n")
        self.assertEqual(instrument.write_termination, "\n")
        instrument.query.assert_called_once_with("*IDN?")
        instrument.close.assert_called_once()
