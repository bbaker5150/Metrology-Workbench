import asyncio
from unittest.mock import Mock

from django.test import SimpleTestCase

from npsl_tools.instruments import Instrument11713C, Instrument5790A

from .consumers import CalibrationConsumer, INSTRUMENT_CLASS_MAP


class Instrument5790ACompatibilityTests(SimpleTestCase):
    def test_model_is_registered_for_acquisition(self):
        self.assertIs(INSTRUMENT_CLASS_MAP["5790A"], Instrument5790A)

    def test_alpha_uses_shared_remote_measurement_commands(self):
        instrument = Instrument5790A.__new__(Instrument5790A)
        instrument.resource = Mock()
        instrument.resource.query.return_value = "0.1000000,60.0,0"

        voltage, frequency, status = instrument.send_MEAS()
        instrument.set_range(0.2)
        instrument.set_filters(
            # Import-free enum access through the inherited method annotations
            # is intentionally avoided; the commands below are the workflow's
            # actual A/B-shared surface.
            mode=type("Mode", (), {"name": "FAST"})(),
            restart=type("Restart", (), {"name": "FINE"})(),
        )
        instrument.set_hires(False)

        self.assertEqual(voltage, 0.1)
        self.assertEqual(frequency, 60.0)
        self.assertEqual(int(status), 0)
        instrument.resource.query.assert_called_once_with("MEAS?")
        instrument.resource.write.assert_any_call("RANGE 0.2")
        instrument.resource.write.assert_any_call("DFILT FAST,FINE")
        instrument.resource.write.assert_any_call("HIRES 0")

    def test_alpha_identity_does_not_accept_bravo(self):
        instrument = Instrument5790A.__new__(Instrument5790A)
        instrument.timeout = 60000
        instrument.resource = Mock()
        instrument.resource.query.return_value = "FLUKE,5790A,1234,1.0"
        self.assertTrue(instrument.check_identity()[0])

        instrument.resource.query.return_value = "FLUKE,5790B,5678,1.0"
        self.assertFalse(instrument.check_identity()[0])


class ReaderSwitchMappingTests(SimpleTestCase):
    def test_reader_role_maps_to_configured_physical_route(self):
        switch = Instrument11713C.__new__(Instrument11713C)
        switch.resource = Mock()

        switch.select_reader("STD", standard_route="OPEN")
        switch.select_reader("TI", standard_route="OPEN")
        switch.select_reader("STD", standard_route="CLOSED")

        self.assertEqual(
            [call.args[0] for call in switch.resource.write.call_args_list],
            [
                "ROUT:OPEN (@109)",
                "ROUT:CLOS (@109)",
                "ROUT:CLOS (@109)",
            ],
        )

    def test_reader_switch_requires_two_distinct_readers(self):
        details = {
            "reader_switch_driver_address": "GPIB0::8::INSTR",
            "std_reader_address": "GPIB0::16::INSTR",
            "ti_reader_address": "GPIB0::16::INSTR",
            "std_reader_model": "5790A",
            "ti_reader_model": "5790A",
        }
        with self.assertRaisesRegex(RuntimeError, "two physical readers"):
            CalibrationConsumer._validate_reader_assignments({}, details)

    def test_source_and_reader_switches_must_be_distinct(self):
        details = {
            "switch_driver_address": "GPIB0::8::INSTR",
            "reader_switch_driver_address": "GPIB0::8::INSTR",
            "std_reader_address": "GPIB0::16::INSTR",
            "ti_reader_address": "GPIB0::17::INSTR",
            "std_reader_model": "5790A",
            "ti_reader_model": "5790A",
        }
        with self.assertRaisesRegex(RuntimeError, "separate physical switch"):
            CalibrationConsumer._validate_reader_assignments({}, details)


class SequentialReaderAcquisitionTests(SimpleTestCase):
    def test_reader_switch_collects_ti_then_standard_but_returns_std_first(self):
        events = []

        class FakeReader:
            def __init__(self, role, value):
                self.role = role
                self.value = value

            def read_instrument(self):
                events.append(f"read:{self.role}")
                return self.value

        class FakeSwitch:
            def select_reader(self, role, standard_route="OPEN"):
                events.append(f"route:{role}:{standard_route}")

        async def exercise():
            consumer = CalibrationConsumer.__new__(CalibrationConsumer)
            consumer._reader_switch = FakeSwitch()
            consumer._reader_switch_standard_route = "CLOSED"
            consumer._reader_switch_settling_time = 0

            async def broadcast(*, text_data):
                return None

            consumer.broadcast = broadcast
            return await consumer._take_reader_pair(
                FakeReader("STD", 1.0),
                FakeReader("TI", 2.0),
            )

        result = asyncio.run(exercise())

        self.assertEqual(result, (1.0, 2.0))
        self.assertEqual(
            events,
            [
                "route:TI:CLOSED",
                "read:TI",
                "route:STD:CLOSED",
                "read:STD",
            ],
        )
