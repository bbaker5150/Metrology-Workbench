from unittest.mock import Mock

from django.test import SimpleTestCase

from .consumers import (
    _8508_ac_filter_for_frequency,
    _configure_8508_for_stage,
)


class Instrument8508AStageConfigurationTests(SimpleTestCase):
    def test_filter_tracks_low_frequency_test_point(self):
        self.assertEqual(_8508_ac_filter_for_frequency(0.5), 1)
        self.assertEqual(_8508_ac_filter_for_frequency(10), 10)
        self.assertEqual(_8508_ac_filter_for_frequency(40), 40)
        self.assertEqual(_8508_ac_filter_for_frequency(60), 40)
        self.assertEqual(_8508_ac_filter_for_frequency(1000), 100)

    def test_ac_stage_uses_transfer_mode_and_dc_coupling_below_40_hz(self):
        instrument = Mock()

        _configure_8508_for_stage(instrument, True, 10, 2.0)

        instrument.configure_ac_voltage.assert_called_once_with(
            # Per the manual, Nrf=2 selects the 20 V range because 2.000 V
            # exceeds the 2 V range's 1.99990000 V maximum.
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
        instrument.configure_dc_voltage.assert_not_called()

    def test_dc_stage_changes_meter_to_dcv(self):
        instrument = Mock()

        _configure_8508_for_stage(instrument, False, 0)

        instrument.configure_dc_voltage.assert_called_once_with(
            range_setting="AUTO",
            resolution=6,
            filter_enabled=True,
            fast=False,
            two_wire=True,
        )
        instrument.configure_ac_voltage.assert_not_called()

    def test_dc_stage_uses_fixed_expected_signal_range_when_available(self):
        instrument = Mock()

        _configure_8508_for_stage(instrument, False, 0, 2.0)

        instrument.configure_dc_voltage.assert_called_once_with(
            range_setting=2.0,
            resolution=6,
            filter_enabled=True,
            fast=False,
            two_wire=True,
        )
