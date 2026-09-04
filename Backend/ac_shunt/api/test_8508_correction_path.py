from django.test import TestCase

from .models import (
    CalibrationResults,
    CalibrationSession,
    TestPoint,
    TestPointSet,
    compute_delta_uut_ppm,
)


class Instrument8508ACorrectionPathTests(TestCase):
    def setUp(self):
        session = CalibrationSession.objects.create(
            session_name="8508 Y5020 correction test",
            standard_reader_model="8508A",
            test_reader_model="8508A",
        )
        point_set = TestPointSet.objects.create(session=session)
        self.point = TestPoint.objects.create(
            test_point_set=point_set,
            current=10,
            frequency=1000,
            direction="Forward",
        )

    def test_8508_neutralizes_only_tvc_terms_and_keeps_shunt_correction(self):
        results = CalibrationResults.objects.create(
            test_point=self.point,
            delta_std_known=7.25,
            delta_std=99.0,
            delta_ti=-50.0,
            eta_std=0.8,
            eta_ti=1.2,
        )

        results.fetch_automatic_corrections()
        results.refresh_from_db()

        self.assertEqual(results.delta_std_known, 7.25)
        self.assertEqual(results.delta_std, 0.0)
        self.assertEqual(results.delta_ti, 0.0)
        self.assertEqual(results.eta_std, 1.0)
        self.assertEqual(results.eta_ti, 1.0)

    def test_existing_ac_dc_difference_formula_is_retained_for_8508(self):
        phase_avgs = {
            "std_ac_open_avg": 0.100001,
            "std_ac_close_avg": 0.100003,
            "std_dc_pos_avg": 0.100000,
            "std_dc_neg_avg": -0.100000,
            "ti_ac_open_avg": 0.099999,
            "ti_ac_close_avg": 0.100001,
            "ti_dc_pos_avg": 0.100000,
            "ti_dc_neg_avg": -0.100000,
        }
        results = CalibrationResults.objects.create(
            test_point=self.point,
            delta_std_known=3.5,
            **phase_avgs,
        )
        expected = compute_delta_uut_ppm(
            phase_avgs,
            eta_std=1.0,
            eta_ti=1.0,
            delta_std=0.0,
            delta_ti=0.0,
            delta_std_known=3.5,
        )

        actual = results.calculate_ac_dc_difference()

        self.assertAlmostEqual(actual, expected, places=12)
        results.refresh_from_db()
        self.assertAlmostEqual(results.delta_uut_ppm, expected, places=12)
