from unittest.mock import patch
from django.test import TestCase
from rest_framework.exceptions import ValidationError
from .models import CalibrationSession, TestPointSet, TestPoint, CalibrationReadings, CalibrationResults
from .reading_stability import mark_stability


class ReadingStabilityTests(TestCase):
    def setUp(self):
        session = CalibrationSession.objects.create(session_name='cycle stability')
        points = TestPointSet.objects.create(session=session)
        self.point = TestPoint.objects.create(test_point_set=points, current=1, frequency=1000, direction='Forward')
        self.other = TestPoint.objects.create(test_point_set=points, current=1, frequency=1000, direction='Reverse')
        raw = [{'value': v, 'cycle': c, 'is_stable': True} for c in (1, 2) for v in (1., 1., 2.)]
        fields = {f'{p}_{phase}_readings': raw for p in ('std','ti') for phase in ('ac_open','dc_pos','dc_neg','ac_close')}
        self.readings = CalibrationReadings.objects.create(test_point=self.point, **fields)
        self.other_readings = CalibrationReadings.objects.create(test_point=self.other, **fields)
        self.results = CalibrationResults.objects.create(test_point=self.point, eta_std=1, eta_ti=1, delta_std=0, delta_ti=0, delta_std_known=0)
        self.readings.recompute_cycle(1)
        self.readings.recompute_cycle(2)

    def edit(self, **overrides):
        data = dict(reading_key='ti_ac_open_readings', cycle=2, start_index=3, end_index=3, is_stable=False)
        data.update(overrides)
        with patch.object(CalibrationResults, 'fetch_automatic_corrections'):
            return mark_stability(self.point, data)

    def test_edits_only_selected_cycle_direction_and_phase_and_recalculates(self):
        before = self.results.cycles.get(cycle_index=1).delta_uut_ppm
        self.edit()
        self.readings.refresh_from_db(); self.other_readings.refresh_from_db()
        self.assertEqual([r['is_stable'] for r in self.readings.ti_ac_open_readings], [True]*5+[False])
        self.assertTrue(all(r['is_stable'] for r in self.readings.std_ac_open_readings))
        self.assertTrue(all(r['is_stable'] for r in self.other_readings.ti_ac_open_readings))
        self.assertEqual(self.results.cycles.get(cycle_index=1).delta_uut_ppm, before)
        edited = self.results.cycles.get(cycle_index=2)
        self.assertEqual(edited.ti_ac_open_avg, 1)
        self.assertNotEqual(edited.delta_uut_ppm, before)
        self.edit(is_stable=True)
        self.assertEqual(self.results.cycles.get(cycle_index=2).delta_uut_ppm, before)

    def test_all_unstable_clears_cycle_and_aggregate_statistics(self):
        for cycle in (1, 2):
            self.edit(cycle=cycle, start_index=1)
        self.results.refresh_from_db()
        self.assertIsNone(self.results.cycles.get(cycle_index=2).delta_uut_ppm)
        self.assertIsNone(self.results.delta_uut_ppm_avg)
        self.assertIsNone(self.results.type_a_uncertainty_ppm)

    def test_rejects_ambiguous_cycle_invalid_ranges_and_boolean_strings(self):
        for data in [dict(cycle=None),dict(cycle=3),dict(start_index=4,end_index=4),dict(start_index='x'),dict(is_stable='false'),dict(cycle=True),dict(reading_key='id')]:
            with self.subTest(data=data), self.assertRaises(ValidationError): self.edit(**data)
        self.readings.refresh_from_db()
        self.assertTrue(all(r['is_stable'] for r in self.readings.ti_ac_open_readings))

    def test_legacy_readings_use_cycle_one(self):
        self.readings.ti_ac_open_readings = [{'value': 1}, {'value': 2}, 3]
        self.readings.save(update_fields=['ti_ac_open_readings'])
        self.edit(cycle=None)
        self.readings.refresh_from_db()
        self.assertFalse(self.readings.ti_ac_open_readings[2]['is_stable'])

    def test_auto_filter_is_default_and_explicit_off_persists(self):
        self.assertEqual(self.results.outlier_filter_mode, 'auto')
        self.results.outlier_filter_mode='none'; self.results.save()
        self.edit()
        self.results.refresh_from_db()
        self.assertEqual(self.results.outlier_filter_mode, 'none')

    def test_edit_refreshes_mirrored_pair_statistics(self):
        reverse = CalibrationResults.objects.create(test_point=self.other, eta_std=1, eta_ti=1, delta_std=0, delta_ti=0, delta_std_known=0)
        self.other_readings.recompute_cycle(1)
        self.other_readings.recompute_cycle(2)
        self.results.refresh_from_db()
        before = self.results.pair_delta_uut_ppm
        self.edit()
        self.results.refresh_from_db(); reverse.refresh_from_db()
        self.assertNotEqual(self.results.pair_delta_uut_ppm, before)
        self.assertEqual(self.results.pair_delta_uut_ppm, reverse.pair_delta_uut_ppm)

    def test_default_filter_rejects_outlier_and_off_uses_all_cycles(self):
        from .models import directional_cycle_analytics
        cycles = list(enumerate([1] * 7 + [100], 1))
        filtered = directional_cycle_analytics(cycles, 'forward', self.results.outlier_filter_mode)
        self.assertEqual(filtered['n_pairs_used'], 7)
        self.assertEqual(filtered['auto_excluded_pairs'], [8])
        self.assertEqual(directional_cycle_analytics(cycles, 'forward', 'none')['n_pairs_used'], 8)
