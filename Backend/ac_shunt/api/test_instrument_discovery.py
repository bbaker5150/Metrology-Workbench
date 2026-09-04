import threading
from unittest.mock import Mock, patch

from django.test import SimpleTestCase

from .views import (
    IDENTITY_OPEN_TIMEOUT_MS,
    IDENTITY_QUERY_BUDGET_MS,
    _identify_resources,
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
        self.assertGreater(instrument.timeout, 0)
        self.assertLessEqual(
            instrument.timeout,
            IDENTITY_QUERY_BUDGET_MS // 2,
        )
        self.assertEqual(instrument.read_termination, "\n")
        self.assertEqual(instrument.write_termination, "\n")
        instrument.query.assert_called_once_with("*IDN?")
        instrument.close.assert_called_once()

    def test_resources_are_identified_concurrently_but_returned_in_order(self):
        addresses = [
            "GPIB0::4::INSTR",
            "GPIB0::5::INSTR",
            "GPIB0::6::INSTR",
        ]
        all_workers_started = threading.Barrier(len(addresses))

        def identify(_rm, address):
            all_workers_started.wait(timeout=1)
            return f"IDENTITY:{address}"

        with patch("api.views.get_instrument_identity", side_effect=identify):
            results = _identify_resources(Mock(), addresses)

        self.assertEqual(
            results,
            [
                {"address": address, "identity": f"IDENTITY:{address}"}
                for address in addresses
            ],
        )

    def test_unidentified_local_and_remote_resources_are_not_returned(self):
        addresses = [
            "GPIB0::4::INSTR",
            "GPIB0::8::INSTR",
            "visa://10.206.104.160:3637/ASRL3::INSTR",
        ]
        identities = {
            addresses[0]: "FLUKE,5730A,1234,1.0",
            addresses[1]: "N/A - VISA I/O Error (Check connection or if in use).",
            addresses[2]: "N/A - Instrument connected but did not identify.",
        }

        with patch(
            "api.views.get_instrument_identity",
            side_effect=lambda _rm, address: identities[address],
        ):
            results = _identify_resources(Mock(), addresses)

        self.assertEqual(
            results,
            [
                {
                    "address": "GPIB0::4::INSTR",
                    "identity": "FLUKE,5730A,1234,1.0",
                }
            ],
        )
