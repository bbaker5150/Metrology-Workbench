from unittest.mock import Mock

from django.test import SimpleTestCase

from .consumers import (
    CalibrationConsumer,
    _8508_ac_filter_for_frequency,
    _8508_ac_scan_delay,
    _8508_safe_input_switch_delay,
    _configure_8508_for_direct_source,
    _configure_8508_for_tvc_output,
    _direct_source_voltage_for_test_point,
)


class Instrument8508AStageConfigurationTests(SimpleTestCase):
    def test_direct_mode_requires_two_distinct_sources(self):
        data = {'measurement_params': {'direct_source_test_mode': False}}

        with self.assertRaisesRegex(RuntimeError, "two distinct 5730A"):
            CalibrationConsumer._validate_direct_source_test_setup(
                data,
                {
                    'ac_source_address': 'GPIB0::4::INSTR',
                    'dc_source_address': 'GPIB0::4::INSTR',
                    'std_reader_address': 'GPIB0::16::INSTR',
                    'ti_reader_address': 'GPIB0::16::INSTR',
                    'std_reader_model': '8508A',
                    'ti_reader_model': 'Fluke 8508A',
                    'std_reader_input': 'FRONT',
                    'ti_reader_input': 'REAR',
                    'amplifier_address': None,
                    'switch_driver_address': None,
                },
            )

    def test_direct_mode_is_inferred_from_instrument_assignments(self):
        data = {'measurement_params': {'direct_source_test_mode': False}}
        details = {
            'ac_source_address': 'GPIB0::11::INSTR',
            'dc_source_address': 'GPIB0::4::INSTR',
            'std_reader_address': 'GPIB0::16::INSTR',
            'ti_reader_address': 'GPIB0::16::INSTR',
            'std_reader_model': '8508A',
            'ti_reader_model': '8508A',
            'std_reader_input': 'FRONT',
            'ti_reader_input': 'REAR',
            'amplifier_address': None,
            'switch_driver_address': None,
        }

        CalibrationConsumer._validate_direct_source_test_setup(data, details)

        self.assertTrue(data['measurement_params']['direct_source_test_mode'])

    def test_lab_tvc_assignments_override_a_stale_direct_mode_value(self):
        data = {'measurement_params': {'direct_source_test_mode': True}}
        details = {
            'ac_source_address': 'GPIB0::11::INSTR',
            'dc_source_address': 'GPIB0::4::INSTR',
            'std_reader_address': 'GPIB0::16::INSTR',
            'ti_reader_address': 'GPIB0::16::INSTR',
            'std_reader_model': '8508A',
            'ti_reader_model': '8508A',
            'std_reader_input': 'FRONT',
            'ti_reader_input': 'REAR',
            'amplifier_address': 'GPIB0::7::INSTR',
            'switch_driver_address': 'GPIB0::8::INSTR',
        }

        CalibrationConsumer._validate_direct_source_test_setup(data, details)

        self.assertFalse(data['measurement_params']['direct_source_test_mode'])

    def test_direct_voltage_comes_from_the_selected_measurement_point(self):
        self.assertEqual(
            _direct_source_voltage_for_test_point(
                {'current': 0.002}, amplifier_range=0.002
            ),
            2.0,
        )
        self.assertEqual(
            _direct_source_voltage_for_test_point(
                {'current': 0.001}, amplifier_range=0.002
            ),
            1.0,
        )
        self.assertEqual(
            _direct_source_voltage_for_test_point({'current': 0.02}),
            2.0,
        )
        with self.assertRaisesRegex(ValueError, "current must be greater than 0"):
            _direct_source_voltage_for_test_point({'current': 0})

    def test_direct_mode_filter_tracks_the_8508a_frequency_bands(self):
        self.assertEqual(_8508_ac_filter_for_frequency(1), 1)
        self.assertEqual(_8508_ac_filter_for_frequency(10), 10)
        self.assertEqual(_8508_ac_filter_for_frequency(40), 40)
        self.assertEqual(_8508_ac_filter_for_frequency(100), 100)

    def test_direct_mode_uses_manual_scan_delays_as_a_floor(self):
        self.assertEqual(_8508_ac_scan_delay(100), 1.25)
        self.assertEqual(_8508_ac_scan_delay(40), 3.25)
        self.assertEqual(_8508_ac_scan_delay(10), 12.5)
        self.assertEqual(_8508_ac_scan_delay(1), 125.0)
        self.assertEqual(_8508_safe_input_switch_delay(1.0, 12.5), 12.5)
        self.assertEqual(_8508_safe_input_switch_delay(20.0, 12.5), 20.0)

    def test_direct_ac_mode_uses_actual_signal_and_exact_two_volts(self):
        instrument = Mock()

        _configure_8508_for_direct_source(
            instrument,
            is_ac_reading=True,
            frequency=10,
            expected_voltage=2.0,
            input_switch_settling_time=2.5,
        )

        instrument.configure_ac_voltage.assert_called_once_with(
            range_setting=2.0,
            filter_hz=10,
            resolution=6,
            transfer=True,
            two_wire=True,
            dc_coupled=True,
            spot_correction=False,
        )
        instrument.set_trigger_source.assert_called_once_with("EXT")
        instrument.set_settling_delay.assert_called_once_with(None)
        instrument.set_input_switch_delay.assert_called_once_with(12.5)
        instrument.configure_dc_voltage.assert_not_called()

    def test_direct_dc_mode_uses_actual_signal_range(self):
        instrument = Mock()

        _configure_8508_for_direct_source(
            instrument,
            is_ac_reading=False,
            frequency=0,
            expected_voltage=2.1,
        )

        instrument.configure_dc_voltage.assert_called_once_with(
            range_setting=2.1,
            resolution=6,
            filter_enabled=True,
            fast=False,
            two_wire=True,
        )
        instrument.configure_ac_voltage.assert_not_called()

    def test_standard_current_and_amplifier_ranges_never_exceed_two_volts(self):
        currents = (
            0.001, 0.002, 0.0033, 0.005, 0.01, 0.02, 0.033, 0.05,
            0.1, 0.2, 0.33, 0.5, 1.0, 1.09, 2.0, 3.0, 5.0, 6.9,
            10.0, 18.0, 20.0, 50.0, 100.0,
        )
        amplifier_ranges = (0.002, 0.02, 0.2, 2.0, 20.0, 100.0)

        for current in currents:
            amplifier_range = next(value for value in amplifier_ranges if current <= value)
            source_drive = (current / amplifier_range) * 2.0
            with self.subTest(current=current, amplifier_range=amplifier_range):
                self.assertGreater(source_drive, 0.0)
                self.assertLessEqual(source_drive, 2.0)

    def test_default_profile_reads_low_level_tvc_output_in_dcv(self):
        instrument = Mock()

        _configure_8508_for_tvc_output(instrument)

        instrument.configure_dc_voltage.assert_called_once_with(
            range_setting=0.01,
            resolution=6,
            filter_enabled=True,
            fast=False,
            two_wire=True,
        )
        instrument.set_trigger_source.assert_called_once_with("EXT")
        instrument.set_settling_delay.assert_called_once_with(None)
        instrument.set_input_switch_delay.assert_called_once_with(1.0)
        instrument.configure_ac_voltage.assert_not_called()

    def test_operator_can_override_front_rear_settling_time(self):
        instrument = Mock()

        _configure_8508_for_tvc_output(instrument, 0.01, 2.5)

        instrument.set_input_switch_delay.assert_called_once_with(2.5)

    def test_tvc_profile_does_not_allow_less_than_manual_dcv_delay(self):
        instrument = Mock()

        _configure_8508_for_tvc_output(instrument, 0.01, 0.1)

        instrument.set_input_switch_delay.assert_called_once_with(1.0)

    def test_expected_tvc_output_selects_the_fixed_dcv_range(self):
        instrument = Mock()

        _configure_8508_for_tvc_output(instrument, 0.025)

        instrument.configure_dc_voltage.assert_called_once_with(
            range_setting=0.025,
            resolution=6,
            filter_enabled=True,
            fast=False,
            two_wire=True,
        )
        instrument.configure_ac_voltage.assert_not_called()

    def test_none_expected_output_is_the_only_autorange_request(self):
        instrument = Mock()

        _configure_8508_for_tvc_output(instrument, None)

        instrument.configure_dc_voltage.assert_called_once_with(
            range_setting="AUTO",
            resolution=6,
            filter_enabled=True,
            fast=False,
            two_wire=True,
        )
