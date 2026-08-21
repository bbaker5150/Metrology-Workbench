import asyncio
import json
from unittest.mock import AsyncMock, Mock, patch

from django.test import SimpleTestCase, TestCase
from rest_framework.test import APIRequestFactory

from npsl_tools.instruments import Instrument11713C, Instrument5790A

from .consumers import (
    CalibrationConsumer,
    INSTRUMENT_CLASS_MAP,
    _clear_live_state,
    _get_live_state,
    _5790_profile_settings,
)
from .models import (
    CalibrationSession,
    CalibrationSettings,
    TestPoint,
    TestPointSet,
)
from .serializers import CalibrationSessionSerializer
from .views import TestPointViewSet


class Instrument5790ACompatibilityTests(SimpleTestCase):
    def test_model_is_registered_for_acquisition(self):
        self.assertIs(INSTRUMENT_CLASS_MAP["5790A"], Instrument5790A)

    def test_alpha_uses_non_blocking_value_query(self):
        instrument = Instrument5790A.__new__(Instrument5790A)
        instrument.resource = Mock()
        instrument.resource.query.return_value = "0.1000000,60.0,0"

        voltage, frequency, status = instrument.send_Value()
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
        instrument.resource.query.assert_called_once_with("VAL?")
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
            "filter_mode": "MEDIUM",
            "filter_restart": "MEDIUM",
            "hires_enabled": True,
            "range_mode": "AUTO",
            "input_switch_delay": 30.0,
        })
        self.assertEqual(
            _5790_profile_settings({"f5790_input_switch_settling_time": 0})[
                "input_switch_delay"
            ],
            0.0,
        )


class ReaderSettingsApiTests(TestCase):
    def test_apply_5790_settings_to_all_points(self):
        session = CalibrationSession.objects.create(session_name="reader-settings")
        point_set = TestPointSet.objects.create(session=session)
        points = [
            TestPoint.objects.create(
                test_point_set=point_set,
                current="0.10000",
                frequency=60,
                direction=direction,
            )
            for direction in ("Forward", "Reverse")
        ]
        request = APIRequestFactory().post(
            "/reader-settings",
            {
                "reader_type": "5790",
                "settings": {
                    "f5790_filter_mode": "FAST",
                    "f5790_input_switch_settling_time": 4.5,
                },
            },
            format="json",
        )
        response = TestPointViewSet.as_view({
            "post": "apply_reader_settings_to_all",
        })(request, session_pk=session.pk)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["updated_points"], 2)
        for point in points:
            settings = CalibrationSettings.objects.get(test_point=point)
            self.assertEqual(settings.f5790_filter_mode, "FAST")
            self.assertEqual(settings.f5790_input_switch_settling_time, 4.5)


class SequentialReaderStabilityTests(SimpleTestCase):
    def test_measurement_uses_one_full_batch_per_shared_5790_role(self):
        class Source:
            def set_output(self, voltage, frequency):
                self.last_output = (voltage, frequency)

        async def run_measurement():
            consumer = CalibrationConsumer()
            consumer.stop_event.clear()
            consumer.broadcast = AsyncMock()
            consumer.save_readings_to_db = AsyncMock()
            consumer._buffer_append_sample = Mock()
            consumer._buffer_replace_search_window = Mock()
            consumer._take_reader_pair = AsyncMock()

            instrument = Instrument5790A.__new__(Instrument5790A)
            instrument.gpib = "GPIB0::16::INSTR"
            instrument.standard_role_input = "INPUT1"
            instrument.test_role_input = "INPUT2"
            instrument.configure_acquisition = Mock()
            batch = [
                {"value": value, "timestamp": float(index), "is_stable": True}
                for index, value in enumerate(
                    [1.0, 1.000001, 0.999999],
                    start=1,
                )
            ]
            ti_batch = [
                {**point, "value": point["value"] * 2}
                for point in batch
            ]
            async def take_shared_batches(
                std_reader,
                ti_reader,
                sample_count,
                *,
                inter_sample_delay,
                on_sample,
            ):
                for sample_index, point in enumerate(batch, start=1):
                    await on_sample("std", point, sample_index)
                for sample_index, point in enumerate(ti_batch, start=1):
                    await on_sample("ti", point, sample_index)
                return batch, ti_batch

            consumer._take_shared_5790_batches = AsyncMock(
                side_effect=take_shared_batches,
            )

            with patch("api.consumers.asyncio.sleep", new=AsyncMock()):
                success = await consumer._perform_single_measurement(
                    "ac_open",
                    3,
                    {"current": 0.1, "frequency": 60, "target_tvc": "BOTH"},
                    False,
                    1.0,
                    Source(),
                    instrument,
                    instrument,
                    settling_time=0,
                    measurement_params={
                        "stability_check_method": "sliding_window",
                        "window": 3,
                        "threshold_ppm": 10,
                        "max_attempts": 10,
                        "f5790_inter_sample_delay": 0,
                    },
                )
            return consumer, success, instrument

        consumer, success, instrument = asyncio.run(run_measurement())

        self.assertTrue(success)
        consumer._take_shared_5790_batches.assert_awaited_once()
        batch_call = consumer._take_shared_5790_batches.await_args
        self.assertEqual(batch_call.args, (instrument, instrument, 3))
        self.assertEqual(batch_call.kwargs["inter_sample_delay"], 0.0)
        self.assertTrue(callable(batch_call.kwargs["on_sample"]))
        consumer._take_reader_pair.assert_not_awaited()

        broadcasts = [
            json.loads(call.kwargs["text_data"])
            for call in consumer.broadcast.await_args_list
        ]
        live_samples = [
            payload for payload in broadcasts
            if payload.get("live_physical_sample")
        ]
        self.assertEqual(
            [payload["reader_role"] for payload in live_samples],
            ["std", "std", "std", "ti", "ti", "ti"],
        )
        self.assertEqual(
            [payload["count"] for payload in live_samples],
            [1, 2, 3, 1, 2, 3],
        )
        self.assertTrue(all(
            payload["std_reading"] is not None
            and payload["ti_reading"] is None
            for payload in live_samples[:3]
        ))
        self.assertTrue(all(
            payload["std_reading"] is None
            and payload["ti_reading"] is not None
            for payload in live_samples[3:]
        ))

        processed_updates = [
            payload for payload in broadcasts
            if payload.get("type") == "dual_reading_update"
            and not payload.get("live_physical_sample")
        ]
        self.assertEqual(len(processed_updates), 1)
        self.assertIsNone(processed_updates[0]["std_reading"])
        self.assertIsNone(processed_updates[0]["ti_reading"])
        self.assertEqual(
            len(processed_updates[0]["window_snapshot"]["std"]),
            3,
        )
        self.assertEqual(
            len(processed_updates[0]["window_snapshot"]["ti"]),
            3,
        )
        saved = {
            call.args[0]: call.args[1]
            for call in consumer.save_readings_to_db.await_args_list
        }
        self.assertEqual(len(saved["std_ac_open"]), 3)
        self.assertEqual(len(saved["ti_ac_open"]), 3)

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
            consumer._buffer_replace_search_window = Mock()
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


    def test_unstable_windows_advance_retry_count_and_replace_search_window(self):
        class Source:
            def set_output(self, voltage, frequency):
                self.last_output = (voltage, frequency)

        async def run_measurement():
            consumer = CalibrationConsumer()
            consumer.stop_event.clear()
            consumer.broadcast = AsyncMock()
            consumer.save_readings_to_db = AsyncMock()
            consumer._buffer_append_sample = Mock()
            consumer._buffer_replace_search_window = Mock()
            consumer._take_reader_pair = AsyncMock(side_effect=[
                (1.000000, 2.000000),
                (1.001000, 2.002000),
                (1.000000, 2.000000),  # retry 1
                (1.000000, 2.000000),  # retry 2
                (1.000000, 2.000000),  # stable lock
                (1.000000, 2.000000),  # retained sample 4
            ])

            with patch(
                "api.consumers.asyncio.sleep",
                new=AsyncMock(),
            ):
                success = await consumer._perform_single_measurement(
                    "ac_open",
                    4,
                    {"current": 0.1, "frequency": 60, "target_tvc": "BOTH"},
                    False,
                    1.0,
                    Source(),
                    object(),
                    object(),
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

        messages = [
            json.loads(call.kwargs["text_data"])
            for call in consumer.broadcast.await_args_list
        ]
        searching = [
            message for message in messages
            if message.get("type") == "sliding_window_update"
            and message.get("phase") == "searching"
        ]
        self.assertEqual(
            [message.get("instability_events") for message in searching],
            [1, 2],
        )
        self.assertTrue(all(message.get("window_count") == 3 for message in searching))
        self.assertTrue(any(
            message.get("type") == "dual_reading_update"
            and message.get("window_snapshot")
            for message in messages
        ))

        saved = {
            call.args[0]: call.args[1]
            for call in consumer.save_readings_to_db.await_args_list
        }
        self.assertEqual(len(saved["std_ac_open"]), 4)
        self.assertEqual(len(saved["ti_ac_open"]), 4)


class SafeShutdownTests(SimpleTestCase):
    def test_every_output_receives_explicit_standby_even_after_peer_failure(self):
        class Output:
            def __init__(self, fail=False):
                self.fail = fail
                self.standby_calls = 0

            def set_standby(self):
                self.standby_calls += 1
                if self.fail:
                    raise RuntimeError("simulated VISA failure")

        async def run_shutdown():
            consumer = CalibrationConsumer()
            first_source = Output(fail=True)
            second_source = Output()
            amplifier = Output()
            await consumer._standby_active_outputs(
                (first_source, first_source, second_source),
                amplifier,
            )
            return first_source, second_source, amplifier

        first_source, second_source, amplifier = asyncio.run(run_shutdown())
        self.assertEqual(first_source.standby_calls, 1)
        self.assertEqual(second_source.standby_calls, 1)
        self.assertEqual(amplifier.standby_calls, 1)

    def test_reset_is_only_a_fallback_when_standby_is_unavailable(self):
        class LegacyOutput:
            def __init__(self):
                self.reset_calls = 0

            def reset(self):
                self.reset_calls += 1

        async def run_shutdown():
            consumer = CalibrationConsumer()
            source = LegacyOutput()
            await consumer._standby_active_outputs((source,), None)
            return source

        source = asyncio.run(run_shutdown())
        self.assertEqual(source.reset_calls, 1)


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
    def test_shared_5790_batches_standard_then_ti_with_one_switch_per_role(self):
        events = []
        instrument = Instrument5790A.__new__(Instrument5790A)
        instrument.gpib = "GPIB0::16::INSTR"
        instrument.active_input = None
        instrument.input_switch_delay = 0
        instrument.standard_role_input = "INPUT1"
        instrument.test_role_input = "INPUT2"

        def set_input(input_name):
            instrument.active_input = input_name
            events.append(f"select:{input_name}")

        def read_instrument():
            events.append(f"read:{instrument.active_input}")
            return 1.0 if instrument.active_input == "INPUT1" else 2.0

        instrument.set_input = set_input
        instrument.read_instrument = read_instrument

        async def exercise():
            consumer = CalibrationConsumer()
            consumer.broadcast = AsyncMock()
            consumer._wait_for_stop_or_timeout = AsyncMock(return_value=True)
            on_sample = AsyncMock()
            return await consumer._take_shared_5790_batches(
                instrument,
                instrument,
                3,
                inter_sample_delay=1.0,
                on_sample=on_sample,
            ), consumer, on_sample

        (standard, test), consumer, on_sample = asyncio.run(exercise())

        self.assertEqual([point["value"] for point in standard], [1.0, 1.0, 1.0])
        self.assertEqual([point["value"] for point in test], [2.0, 2.0, 2.0])
        self.assertEqual(events, [
            "select:INPUT1",
            "read:INPUT1",
            "read:INPUT1",
            "read:INPUT1",
            "select:INPUT2",
            "read:INPUT2",
            "read:INPUT2",
            "read:INPUT2",
        ])
        self.assertEqual(
            [call.args[0] for call in on_sample.await_args_list],
            ["std", "std", "std", "ti", "ti", "ti"],
        )
        self.assertEqual(
            [call.args[2] for call in on_sample.await_args_list],
            [1, 2, 3, 1, 2, 3],
        )
        sample_dwells = [
            call for call in consumer._wait_for_stop_or_timeout.await_args_list
            if call.args == (1.0,)
        ]
        self.assertEqual(len(sample_dwells), 4)

    def test_shared_5790_reads_ti_then_standard_on_opposite_inputs(self):
        events = []

        instrument = Instrument5790A.__new__(Instrument5790A)
        instrument.gpib = "GPIB0::16::INSTR"
        instrument.active_input = None
        instrument.input_switch_delay = 0

        def set_input(input_name):
            instrument.active_input = input_name
            events.append(f"select:{input_name}")

        instrument.set_input = set_input
        instrument.read_instrument = lambda: events.append(
            f"read:{instrument.active_input}"
        ) or (2.0 if instrument.active_input == "INPUT2" else 1.0)

        async def exercise():
            consumer = CalibrationConsumer()
            consumer._reader_switch = None
            consumer._standard_reader_input = "INPUT1"
            consumer._test_reader_input = "INPUT2"
            consumer.broadcast = AsyncMock()
            return await consumer._take_reader_pair(instrument, instrument)

        self.assertEqual(asyncio.run(exercise()), (1.0, 2.0))
        self.assertEqual(events, [
            "select:INPUT2",
            "read:INPUT2",
            "select:INPUT1",
            "read:INPUT1",
        ])

    def test_instrument_switch_collects_ti_then_standard_on_shared_input(self):
        events = []

        instrument = Instrument5790A.__new__(Instrument5790A)
        instrument.gpib = "GPIB0::16::INSTR"
        instrument.active_input = "INPUT2"
        instrument.input_switch_delay = 0
        instrument.set_input = lambda input_name: setattr(
            instrument, "active_input", input_name
        )

        def read_instrument():
            events.append(f"read:{instrument.active_input}")
            return 1.0 if len(events) == 4 else 2.0

        instrument.read_instrument = read_instrument

        class FakeSwitch:
            def select_instrument(self, role, standard_route="OPEN"):
                events.append(f"route:{role}:{standard_route}")

        async def exercise():
            consumer = CalibrationConsumer()
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

    def test_internal_5790_switch_delay_is_announced_for_each_changed_input(self):
        events = []
        instrument = Instrument5790A.__new__(Instrument5790A)
        instrument.gpib = "GPIB0::16::INSTR"
        instrument.active_input = "INPUT1"
        instrument.input_switch_delay = 2.5

        def set_input(input_name):
            events.append(f"select:{input_name}")
            instrument.active_input = input_name

        instrument.set_input = set_input
        instrument.read_instrument = lambda: events.append(
            f"read:{instrument.active_input}"
        ) or (2.0 if instrument.active_input == "INPUT2" else 1.0)

        async def exercise():
            consumer = CalibrationConsumer()
            consumer._reader_switch = None
            consumer._standard_reader_input = "INPUT1"
            consumer._test_reader_input = "INPUT2"

            async def broadcast(*, text_data):
                events.append(json.loads(text_data))

            consumer.broadcast = broadcast
            consumer._wait_for_stop_or_timeout = AsyncMock(return_value=True)
            return await consumer._take_reader_pair(instrument, instrument)

        self.assertEqual(asyncio.run(exercise()), (1.0, 2.0))
        delays = [
            event for event in events
            if isinstance(event, dict)
            and event.get("type") == "reader_switch_delay_update"
        ]
        self.assertEqual([event["duration"] for event in delays], [2.5, 2.5])
        self.assertEqual(
            [event["role"] for event in delays],
            ["Test instrument", "Standard"],
        )

    def test_stop_interrupts_5790_switch_delay_before_reading(self):
        instrument = Instrument5790A.__new__(Instrument5790A)
        instrument.gpib = "GPIB0::16::INSTR"
        instrument.active_input = "INPUT1"
        instrument.input_switch_delay = 60
        instrument.set_input = Mock(
            side_effect=lambda value: setattr(instrument, "active_input", value)
        )
        instrument.read_instrument = Mock(return_value=2.0)
        source = Mock()

        async def exercise():
            consumer = CalibrationConsumer()
            consumer._reader_switch = None
            consumer._standard_reader_input = "INPUT1"
            consumer._test_reader_input = "INPUT2"
            delay_started = asyncio.Event()

            async def broadcast(*, text_data):
                message = json.loads(text_data)
                if message.get("type") == "reader_switch_delay_update":
                    delay_started.set()

            consumer.broadcast = broadcast
            consumer.stop_event.clear()

            async def run_with_cleanup():
                try:
                    await consumer._take_reader_pair(instrument, instrument)
                finally:
                    await consumer._standby_active_outputs((source,), None)

            with patch("api.session_state.release_run_lock", return_value=None):
                self.assertTrue(await consumer.supervisor.start_task(
                    "interruptible-delay-test",
                    run_with_cleanup(),
                ))
                await asyncio.wait_for(delay_started.wait(), timeout=0.5)
                await asyncio.wait_for(
                    consumer.supervisor.stop_task(),
                    timeout=0.5,
                )
            return consumer

        consumer = asyncio.run(exercise())
        self.assertTrue(consumer.stop_event.is_set())
        instrument.set_input.assert_called_once_with("INPUT2")
        instrument.read_instrument.assert_not_called()
        source.set_standby.assert_called_once_with()


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

    def test_mid_cycle_snapshot_carries_cycle_samples_and_stability(self):
        consumer = CalibrationConsumer.__new__(CalibrationConsumer)
        consumer.session_id = "shared-5790-live-buffer"
        consumer._buffer_set_stage(
            "ac_open",
            tp_id=42,
            total=6,
            cycle_index=2,
        )
        raw = {"value": 0.1, "timestamp": 10.0, "is_stable": True}
        consumer._buffer_append_sample(
            "ac_open",
            raw,
            raw,
            1,
            6,
            cycle_index=2,
        )
        consumer._buffer_record_broadcast({
            "type": "sliding_window_update",
            "stdev_ppm": 4.5,
            "std_stdev_ppm": 3.5,
            "ti_stdev_ppm": 4.5,
            "is_stable": True,
            "instability_events": 1,
            "max_retries": 10,
            "phase": "monitoring",
            "window_count": 1,
            "window_size": 3,
        })

        state = _get_live_state(consumer.session_id)
        self.assertEqual(state["activeCollectionDetails"], {
            "stage": "ac_open",
            "tpId": 42,
            "readingKey": "ac_open",
            "cycle_index": 2,
        })
        self.assertEqual(state["liveReadings"]["ac_open"][0]["cycle"], 2)
        self.assertEqual(state["tiLiveReadings"]["ac_open"][0]["cycle"], 2)
        self.assertEqual(state["slidingWindowStatus"], {
            "ppm": 4.5,
            "std_ppm": 3.5,
            "ti_ppm": 4.5,
            "is_stable": True,
            "instability_events": 1,
            "max_retries": 10,
            "phase": "monitoring",
            "window_count": 1,
            "window_size": 3,
        })
