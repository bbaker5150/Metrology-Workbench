from django.test import SimpleTestCase
from api.models import directional_cycle_analytics, summarize_cycle_rows, build_pair_rows

class DirectionalAnalyticsTests(SimpleTestCase):
    def test_directional_iqr_filters_single_direction_and_keeps_real_cycle_ids(self):
        cycles = [(i + 2, value) for i, value in enumerate([1, 1, 1, 1, 1, 1, 1, 100])]
        raw = directional_cycle_analytics(cycles, 'forward', 'none')
        filtered = directional_cycle_analytics(cycles, 'forward', 'auto')
        self.assertEqual(raw['n_pairs_used'], 8)
        self.assertEqual(filtered['n_pairs_used'], 7)
        self.assertEqual(filtered['pair_delta_uut_ppm'], 1)
        self.assertEqual(filtered['auto_excluded_pairs'], [9])
        self.assertIsNone(filtered['pair_rows'][0]['rev_delta'])

    def test_chauvenet_filters_reverse_and_reports_standard_error(self):
        result = directional_cycle_analytics(list(enumerate([2] * 14 + [100], 1)), 'reverse', 'auto')
        self.assertEqual(result['n_pairs_used'], 14)
        self.assertEqual(result['pair_delta_uut_ppm'], 2)
        self.assertEqual(result['pair_type_a_uncertainty_ppm'], 0)

    def test_final_pair_mean_uses_filtered_survivors_and_none_when_all_excluded(self):
        rows = build_pair_rows([1] * 7 + [100], [1] * 8, use_abba=False)
        result = summarize_cycle_rows(rows, 'auto')
        self.assertEqual(result['pair_delta_uut_ppm'], 1)
        self.assertEqual(result['n_pairs_used'], 7)
        self.assertIsNone(summarize_cycle_rows(rows, 'auto', range(1, 9))['pair_delta_uut_ppm'])

    def test_single_cycle_has_mean_but_no_standard_error(self):
        result = directional_cycle_analytics([(4, 3)], 'reverse', 'auto')
        self.assertEqual(result['pair_delta_uut_ppm'], 3)
        self.assertIsNone(result['pair_type_a_uncertainty_ppm'])


from django.test import TestCase
from api import tests as existing_tests


class StoredDirectionalAnalyticsTests(TestCase):
    _build_pair = existing_tests.PairAggregateCycleCapTests._build_pair

    def test_filtered_pair_is_mirrored_and_directions_are_independent(self):
        forward, reverse = self._build_pair(None, 8, 8)
        forward.cycles.filter(cycle_index=8).update(delta_uut_ppm=100)
        forward.outlier_filter_mode = 'auto'
        forward.use_abba_pairing = False
        forward.recompute_pair_aggregate()
        reverse.refresh_from_db()
        self.assertEqual(reverse.pair_delta_uut_ppm, 1)
        self.assertEqual(reverse.n_pairs_used, 7)
        payload = forward.build_pair_analytics()
        self.assertEqual(payload['directional']['forward']['n_pairs_used'], 7)
        self.assertEqual(payload['directional']['reverse']['n_pairs_used'], 8)
        self.assertEqual(payload['pair_delta_uut_ppm'], reverse.pair_delta_uut_ppm)
        forward.outlier_filter_mode = 'none'
        forward.recompute_pair_aggregate()
        self.assertEqual(forward.n_pairs_used, 8)
        self.assertEqual(forward.pair_delta_uut_ppm, 7.1875)

    def test_serialized_direction_works_before_opposite_results_exist(self):
        forward, reverse = self._build_pair(None, 8, 0)
        reverse.delete()
        forward.cycles.filter(cycle_index=8).update(delta_uut_ppm=100)
        forward.outlier_filter_mode = 'auto'
        payload = forward.build_pair_analytics()
        self.assertIsNone(payload['pair_delta_uut_ppm'])
        self.assertEqual(payload['directional']['forward']['pair_delta_uut_ppm'], 1)
        self.assertEqual(payload['directional']['forward']['n_pairs_used'], 7)
        self.assertEqual(payload['directional']['reverse']['n_pairs_used'], 0)
