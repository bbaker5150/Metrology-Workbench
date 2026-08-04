import asyncio
import json
from unittest.mock import AsyncMock, Mock, patch

from django.test import SimpleTestCase

from npsl_tools.instruments import Instrument11713C, Instrument5790A

from .consumers import (
    CalibrationConsumer,
    INSTRUMENT_CLASS_MAP,
    _clear_live_state,
    _get_live_state,
    _5790_profile_settings,
)
from .models import CalibrationSession
from .serializers import CalibrationSessionSerializer


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

    def test_configurable_profile_programs_shared_alpha_bravo_commands(self):
        instrument = Instrument5790A.__new__(Instrument5790A)
        instrument.resource = Mock()
        instrument.resource.timeout = 1000
        instrument.configure_acquisition(
            filter_mode="MEDIUM",
            filter_restart="FINE",
            hires=True,
            range_mode="POINT",
            point_value=0.1,
            input_switch_delay=2.5,
        )
        instrument.resource.write.assert_any_call("DFILT MEDIUM,FINE")
        instrument.resource.write.assert_any_call("HIRES 1")
        instrument.resource.write.assert_any_call("RANGE 0.1")
        self.assertEqual(instrument.input_switch_delay, 2.5)
        self.assertEqual(instrument.resource.timeout, 90000)

    def test_profile_keyword_matches_consumer_configuration(self):
        instrument = Instrument5790A.__new__(Instrument5790A)
        instrument.resource = Mock()
        instrument.resource.timeout = 1000

        instrument.configure_acquisition(hires_enabled=True)

        instrument.resource.write.assert_any_call("HIRES 1")

    def test_profile_defaults_match_factory_input_workflow(self):
        self.assertEqual(_5790_profile_settings({}), {
            "filter_mode": "FAST",
            "filter_restart": "COARSE",
            "hires_enabled": False,
            "range_mode": "POINT",
            "input_switch_delay": 1.0,
        })
        self.assertEqual(
            _5790_profile_settings({"f5790_input_switch_settling_time": 0})[
                "input_switch_delay"
            ],
            0.0,
        )


class SequentialReaderStabilityTests(SimpleTestCase):
    def test_initial_paired_window_is_retained_without_chart_reset(self):
        class Source:
            def set_output(self, voltage, frequency):
                self.last_output = (voltage, frequency)

        async def run_measurement():
            consumer = CalibrationConsumer()
            consumer.stop_event.clear()
            consumer.broadcast = AsyncMock()
            consumer.save_readings_to_db = AsyncMock()
            consumer._buffer_append_sample = Mock()
            consumer._take_reader_pair = AsyncMock(side_effect=[
                (1.000000, 2.000000),
                (1.000001, 2.000002),
                (0.999999, 1.999998),
                (1.000000, 2.000000),
                (1.000001, 2.000002),
                (0.999999, 1.999998),
            ])

            source = Source()
            shared_reader = object()
            with patch(
                "api.consumers.asyncio.sleep",
                new=AsyncMock(),
            ):
                success = await consumer._perform_single_measurement(
                    "ac_open",
                    6,
                    {
                        "current": 0.1,
                        "frequency": 60,
                        "target_tvc": "BOTH",
                    },
                    False,
                    1.0,
                    source,
                    shared_reader,
                    shared_reader,
                    settling_time=0,
                    measurement_params={
                        "stability_check_method": "sliding_window",
                        "window": 3,
                        "threshold_ppm": 10,
                        "max_attempts": 10,
                    },
                )

            return consumer, success

        consumer, success = asyncio.run(run_measurement())
        self.assertTrue(success)
        self.assertEqual(consumer._take_reader_pair.await_count, 6)
        self.assertTrue(all(
            call.args[2] == "BOTH"
            for call in consumer._take_reader_pair.await_args_list
        ))

        saved = {
            call.args[0]: call.args[1]
            for call in consumer.save_readings_to_db.await_args_list
        }
        self.assertEqual(len(saved["std_ac_open"]), 6)
        self.assertEqual(len(saved["ti_ac_open"]), 6)

        messages = [
            json.loads(call.kwargs["text_data"])
            for call in consumer.broadcast.await_args_list
        ]
        self.assertNotIn("paired_collection_reset", {
            message.get("type") for message in messages
        })
        stability_updates = [
            message for message in messages
            if message.get("type") == "sliding_window_update"
        ]
        self.assertTrue(any(
            update.get("std_stdev_ppm") is not None
            and update.get("ti_stdev_ppm") is not None
            for update in stability_updates
        ))


class ReaderSwitchMappingTests(SimpleTestCase):
    def test_shared_5790_requires_opposite_main_inputs(self):
        details = {
            "std_reader_address": "GPIB0::16::INSTR",
            "ti_reader_address": "GPIB0::16::INSTR",
            "std_reader_model": "5790A",
            "ti_reader_model": "5790A",
            "std_reader_input": "INPUT2",
            "ti_reader_input": "INPUT2",
        }
        with self.assertRaisesRegex(RuntimeError, "opposite INPUT1/INPUT2"):
            CalibrationConsumer._validate_reader_assignments({}, details)
        details["std_reader_input"] = "INPUT1"
        CalibrationConsumer._validate_reader_assignments({}, details)

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

    def test_instrument_switch_accepts_one_shared_5790_on_one_input(self):
        details = {
            "reader_switch_driver_address": "GPIB0::8::INSTR",
            "std_reader_address": "GPIB0::16::INSTR",
            "ti_reader_address": "GPIB0::16::INSTR",
            "std_reader_model": "5790A",
            "ti_reader_model": "5790A",
            "std_reader_input": "INPUT2",
            "ti_reader_input": "INPUT2",
        }
        CalibrationConsumer._validate_reader_assignments({}, details)

        details["ti_reader_input"] = "INPUT1"
        with self.assertRaisesRegex(RuntimeError, "same physical input"):
            CalibrationConsumer._validate_reader_assignments({}, details)

    def test_instrument_switch_rejects_two_independent_readers(self):
        details = {
            "reader_switch_driver_address": "GPIB0::8::INSTR",
            "std_reader_address": "GPIB0::16::INSTR",
            "ti_reader_address": "GPIB0::17::INSTR",
            "std_reader_model": "5790A",
            "ti_reader_model": "5790B",
        }
        with self.assertRaisesRegex(RuntimeError, "one shared 5790A/B"):
            CalibrationConsumer._validate_reader_assignments({}, details)

    def test_supported_source_and_reader_topologies(self):
        base = {
            "std_reader_address": "GPIB0::16::INSTR",
            "ti_reader_address": "GPIB0::16::INSTR",
            "std_reader_model": "5790A",
            "ti_reader_model": "5790A",
        }
        # One or two sources, shared 5790 switched internally.
        for source_switch in (None, "GPIB0::7::INSTR"):
            details = {
                **base,
                "std_reader_input": "INPUT1",
                "ti_reader_input": "INPUT2",
                "switch_driver_address": source_switch,
            }
            CalibrationConsumer._validate_reader_assignments({}, details)

        # One or two sources, external switch feeding one common 5790 input.
        for source_switch in (None, "GPIB0::7::INSTR"):
            details = {
                **base,
                "std_reader_input": "INPUT2",
                "ti_reader_input": "INPUT2",
                "reader_switch_driver_address": "GPIB0::8::INSTR",
                "switch_driver_address": source_switch,
            }
            CalibrationConsumer._validate_reader_assignments({}, details)

    def test_source_and_reader_switches_must_be_distinct(self):
        details = {
            "switch_driver_address": "GPIB0::8::INSTR",
            "reader_switch_driver_address": "GPIB0::8::INSTR",
            "std_reader_address": "GPIB0::16::INSTR",
            "ti_reader_address": "GPIB0::16::INSTR",
            "std_reader_model": "5790A",
            "ti_reader_model": "5790A",
            "std_reader_input": "INPUT2",
            "ti_reader_input": "INPUT2",
        }
        with self.assertRaisesRegex(RuntimeError, "separate physical switch"):
            CalibrationConsumer._validate_reader_assignments({}, details)


class ReaderTopologySerializerTests(SimpleTestCase):
    def _session(self, **overrides):
        values = {
            "standard_reader_address": "GPIB0::16::INSTR",
            "test_reader_address": "GPIB0::16::INSTR",
            "standard_reader_model": "5790A",
            "test_reader_model": "5790A",
            "standard_reader_input": "INPUT1",
            "test_reader_input": "INPUT2",
        }
        values.update(overrides)
        return CalibrationSession(**values)

    def test_partial_patch_enables_external_instrument_routing_on_common_input(self):
        serializer = CalibrationSessionSerializer(
            instance=self._session(),
            data={
                "reader_switch_driver_address": "GPIB0::8::INSTR",
                "standard_reader_input": "INPUT2",
                "test_reader_input": "INPUT2",
            },
            partial=True,
        )
        self.assertTrue(serializer.is_valid(), serializer.errors)

    def test_partial_patch_rejects_external_switch_with_opposite_inputs(self):
        serializer = CalibrationSessionSerializer(
            instance=self._session(),
            data={"reader_switch_driver_address": "GPIB0::8::INSTR"},
            partial=True,
        )
        self.assertFalse(serializer.is_valid())
        self.assertIn("test_reader_input", serializer.errors)


class SequentialReaderAcquisitionTests(SimpleTestCase):
    def test_shared_5790_reads_ti_then_standard_on_opposite_inputs(self):
        events = []

        instrument = Instrument5790A.__new__(Instrument5790A)
        instrument.gpib = "GPIB0::16::INSTR"
        instrument.read_input = lambda input_name: events.append(input_name) or (
            2.0 if input_name == "INPUT2" else 1.0
        )

        async def exercise():
            consumer = CalibrationConsumer.__new__(CalibrationConsumer)
            consumer._reader_switch = None
            consumer._standard_reader_input = "INPUT1"
            consumer._test_reader_input = "INPUT2"
            return await consumer._take_reader_pair(instrument, instrument)

        self.assertEqual(asyncio.run(exercise()), (1.0, 2.0))
        self.assertEqual(events, ["INPUT2", "INPUT1"])

    def test_instrument_switch_collects_ti_then_standard_on_shared_input(self):
        events = []

        instrument = Instrument5790A.__new__(Instrument5790A)
        instrument.gpib = "GPIB0::16::INSTR"
        instrument.read_input = lambda input_name: events.append(
            f"read:{input_name}"
        ) or (1.0 if len(events) == 4 else 2.0)

        class FakeSwitch:
            def select_instrument(self, role, standard_route="OPEN"):
                events.append(f"route:{role}:{standard_route}")

        async def exercise():
            consumer = CalibrationConsumer.__new__(CalibrationConsumer)
            consumer._reader_switch = FakeSwitch()
            consumer._reader_switch_standard_route = "CLOSED"
            consumer._reader_switch_settling_time = 0
            consumer._standard_reader_input = "INPUT2"
            consumer._test_reader_input = "INPUT2"

            async def broadcast(*, text_data):
                return None

            consumer.broadcast = broadcast
            return await consumer._take_reader_pair(instrument, instrument)

        result = asyncio.run(exercise())

        self.assertEqual(result, (1.0, 2.0))
        self.assertEqual(
            events,
            [
                "route:TI:CLOSED",
                "read:INPUT2",
                "route:STD:CLOSED",
                "read:INPUT2",
            ],
        )


class SequentialLiveBufferTests(SimpleTestCase):
    def tearDown(self):
        _clear_live_state("shared-5790-live-buffer")

    def test_live_series_never_exceeds_requested_sample_count(self):
        consumer = CalibrationConsumer.__new__(CalibrationConsumer)
        consumer.session_id = "shared-5790-live-buffer"
        for count in range(1, 9):
            raw = {"value": count / 10, "timestamp": float(count)}
            consumer._buffer_append_sample("ac_open", raw, raw, count, 6)

        state = _get_live_state(consumer.session_id)
        self.assertEqual(len(state["liveReadings"]["ac_open"]), 6)
        self.assertEqual(len(state["tiLiveReadings"]["ac_open"]), 6)
        self.assertEqual(
            [point["x"] for point in state["liveReadings"]["ac_open"]],
            [3, 4, 5, 6, 7, 8],
        )
