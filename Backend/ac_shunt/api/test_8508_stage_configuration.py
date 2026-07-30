from unittest.mock import Mock

from django.test import SimpleTestCase
from npsl_tools.instruments import Instrument8508A

from .consumers import (
    CalibrationConsumer,
    _8508_ac_filter_for_frequency,
    _8508_ac_scan_delay,
    _8508_dc_delay,
    _8508_expected_y5020_voltage,
    _8508_profile_settings,
    _8508_recommended_switch_delay,
    _shared_8508_reader_pair,
    _configure_8508_for_y5020,
)


class Instrument8508AStageConfigurationTests(SimpleTestCase):
    def test_shared_8508_pair_requires_two_roles_on_the_same_resource(self):
        std_reader = Mock(spec=Instrument8508A)
        ti_reader = Mock(spec=Instrument8508A)
        std_reader.gpib = 'GPIB0::16::INSTR'
        ti_reader.gpib = 'GPIB0::16::INSTR'

        self.assertTrue(_shared_8508_reader_pair(std_reader, ti_reader))

        ti_reader.gpib = 'GPIB0::17::INSTR'
        self.assertFalse(_shared_8508_reader_pair(std_reader, ti_reader))
        self.assertFalse(_shared_8508_reader_pair(std_reader, Mock()))

    def test_assignment_selects_one_8508a_with_opposite_terminals(self):
        data = {
            'measurement_params': {
                'direct_source_test_mode': True,
                'direct_source_voltage': 2.0,
                'characterize_std_first': True,
                'characterize_test_first': True,
            }
        }
        details = {
            'std_reader_address': 'GPIB0::16::INSTR',
            'ti_reader_address': 'GPIB0::16::INSTR',
            'std_reader_model': '8508A',
            'ti_reader_model': 'Fluke 8508A',
            'std_reader_input': 'FRONT',
            'ti_reader_input': 'REAR',
        }

        CalibrationConsumer._validate_reader_assignments(data, details)

        params = data['measurement_params']
        self.assertNotIn('direct_source_test_mode', params)
        self.assertNotIn('direct_source_voltage', params)
        self.assertFalse(params['characterize_std_first'])
        self.assertFalse(params['characterize_test_first'])

    def test_8508a_roles_must_share_one_meter_and_use_opposite_inputs(self):
        base = {
            'std_reader_model': '8508A',
            'ti_reader_model': '8508A',
            'std_reader_address': 'GPIB0::16::INSTR',
            'ti_reader_address': 'GPIB0::16::INSTR',
            'std_reader_input': 'FRONT',
            'ti_reader_input': 'REAR',
        }
        with self.assertRaisesRegex(RuntimeError, 'same physical 8508A'):
            CalibrationConsumer._validate_reader_assignments(
                {}, {**base, 'ti_reader_address': 'GPIB0::17::INSTR'}
            )
        with self.assertRaisesRegex(RuntimeError, 'opposite FRONT/REAR'):
            CalibrationConsumer._validate_reader_assignments(
                {}, {**base, 'ti_reader_input': 'FRONT'}
            )

    def test_mixed_34420a_and_8508a_roles_are_rejected(self):
        with self.assertRaisesRegex(RuntimeError, '8508A for both'):
            CalibrationConsumer._validate_reader_assignments(
                {},
                {
                    'std_reader_model': '8508A',
                    'ti_reader_model': '34420A',
                },
            )

    def test_34420a_tvc_flags_remain_untouched(self):
        data = {
            'measurement_params': {
                'characterize_std_first': True,
                'characterize_test_first': True,
            }
        }
        CalibrationConsumer._validate_reader_assignments(
            data,
            {'std_reader_model': '34420A', 'ti_reader_model': '34420A'},
        )
        self.assertTrue(data['measurement_params']['characterize_std_first'])
        self.assertTrue(data['measurement_params']['characterize_test_first'])

    def test_y5020_expected_voltage_comes_from_current_and_shunt_value(self):
        self.assertAlmostEqual(_8508_expected_y5020_voltage({'current': 20}), 0.2)
        self.assertAlmostEqual(_8508_expected_y5020_voltage({'current': 10}), 0.1)
        self.assertAlmostEqual(_8508_expected_y5020_voltage({'current': 6.9}), 0.069)
        with self.assertRaisesRegex(ValueError, 'greater than 0'):
            _8508_expected_y5020_voltage({'current': 0})

    def test_smart_ac_defaults_follow_measurement_frequency(self):
        self.assertEqual(_8508_ac_filter_for_frequency(10), 10)
        self.assertEqual(_8508_ac_filter_for_frequency(39.9), 10)
        self.assertEqual(_8508_ac_filter_for_frequency(40), 40)
        self.assertEqual(_8508_ac_filter_for_frequency(99.9), 40)
        self.assertEqual(_8508_ac_filter_for_frequency(100), 100)

        low = _8508_profile_settings({}, 20)
        high = _8508_profile_settings({}, 1000)
        self.assertTrue(low['ac_dc_coupled'])
        self.assertFalse(high['ac_dc_coupled'])

    def test_recommended_switch_delay_covers_both_stage_profiles(self):
        self.assertEqual(_8508_ac_scan_delay(10, 6), 12.5)
        self.assertEqual(_8508_dc_delay(True, 7), 5.0)
        self.assertEqual(_8508_recommended_switch_delay({}, 10), 12.5)
        self.assertEqual(_8508_recommended_switch_delay({}, 100), 5.0)

    def test_default_ac_profile_uses_internal_trigger_and_actual_shunt_signal(self):
        instrument = Mock()

        _configure_8508_for_y5020(
            instrument,
            is_ac_reading=True,
            frequency=20,
            expected_voltage=0.2,
            measurement_params={},
        )

        instrument.set_trigger_source.assert_called_once_with('INT')
        instrument.configure_ac_voltage.assert_called_once_with(
            range_setting=0.2,
            filter_hz=10,
            resolution=6,
            transfer=True,
            two_wire=True,
            dc_coupled=True,
            spot_correction=False,
        )
        instrument.set_input_switch_delay.assert_called_once_with(12.5)
        instrument.configure_dc_voltage.assert_not_called()

    def test_default_dc_profile_uses_resl7_filter_and_fast_off(self):
        instrument = Mock()

        _configure_8508_for_y5020(
            instrument,
            is_ac_reading=False,
            frequency=1000,
            expected_voltage=0.069,
            measurement_params={},
        )

        instrument.set_trigger_source.assert_called_once_with('INT')
        instrument.configure_dc_voltage.assert_called_once_with(
            range_setting=0.069,
            resolution=7,
            filter_enabled=True,
            fast=False,
            two_wire=True,
        )
        instrument.set_input_switch_delay.assert_called_once_with(5.0)
        instrument.configure_ac_voltage.assert_not_called()

    def test_operator_profile_overrides_are_applied(self):
        instrument = Mock()
        params = {
            'f8508_ac_filter_hz': 40,
            'f8508_ac_resolution': 5,
            'f8508_ac_transfer_enabled': False,
            'f8508_ac_dc_coupled': False,
            'input_switch_settling_time': 0.25,
        }

        _configure_8508_for_y5020(
            instrument,
            is_ac_reading=True,
            frequency=20,
            expected_voltage=0.1,
            measurement_params=params,
        )

        instrument.configure_ac_voltage.assert_called_once_with(
            range_setting=0.1,
            filter_hz=40,
            resolution=5,
            transfer=False,
            two_wire=True,
            dc_coupled=False,
            spot_correction=False,
        )
        # Recommendation is advisory: an intentional lower value is retained.
        instrument.set_input_switch_delay.assert_called_once_with(0.25)

    def test_invalid_persisted_profile_values_fall_back_safely(self):
        profile = _8508_profile_settings(
            {
                'f8508_ac_filter_hz': 1,
                'f8508_ac_resolution': 8,
                'f8508_dc_resolution': 4,
            },
            50,
        )
        self.assertEqual(profile['ac_filter_hz'], 40)
        self.assertEqual(profile['ac_resolution'], 6)
        self.assertEqual(profile['dc_resolution'], 7)
