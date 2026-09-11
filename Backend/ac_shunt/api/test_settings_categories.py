from unittest.mock import patch
from django.test import TestCase
from rest_framework.exceptions import ValidationError
from .models import CalibrationSession, TestPointSet, TestPoint, CalibrationSettings
from .settings_categories import save_category, CATEGORY_FIELDS

VALUES = {
    'general': {'n_cycles': 8},
    'stability': {'initial_warm_up_time': 0, 'settling_time': 0.5, 'nplc': 100,
        'num_samples': 6, 'stability_check_method': 'sliding_window', 'stability_window': 6,
        'stability_threshold_ppm': 25, 'stability_max_attempts': 100,
        'iqr_filter_ppm_threshold': 15, 'ignore_instability_after_lock': False},
    'characterization': {'characterization_source': 'AC', 'characterize_std_first': True, 'characterize_test_first': True},
    '8508': {'input_switch_settling_time': 0, 'f8508_dc_filter_enabled': False,
        'f8508_dc_resolution': 8, 'f8508_dc_fast_enabled': True, 'f8508_ac_filter_hz': 40,
        'f8508_ac_resolution': 5, 'f8508_ac_transfer_enabled': False, 'f8508_ac_dc_coupled': True},
    '5790': {'f5790_filter_mode': 'OFF', 'f5790_filter_restart': 'FINE',
        'f5790_hires_enabled': False, 'f5790_range_mode': '0.22', 'f5790_input_switch_settling_time': 0},
    'low_frequency': {'enable_low_frequency_settings': False, 'enable_11hz_filter': True,
        'min_low_freq_settling_time': 5, 'lf_harmonic_projection': True, 'lf_harmonics': 3},
}

class SettingsCategoryTests(TestCase):
    def setUp(self):
        self.session = CalibrationSession.objects.create(session_name='category settings')
        self.point_set = TestPointSet.objects.create(session=self.session)
        for current in ('0.1', '0.2'):
            for direction in ('Forward', 'Reverse'):
                point = TestPoint.objects.create(test_point_set=self.point_set, current=current, frequency=60, direction=direction)
                CalibrationSettings.objects.create(test_point=point, n_cycles=7, settling_time=45, num_samples=6, stability_window=6)

    def save(self, category, scope='point', values=None):
        return save_category(self.session.pk, {'category':category, 'scope':scope,
            'current':'0.1', 'frequency':60, 'direction':'Forward',
            'settings': VALUES[category] if values is None else values})

    def test_each_category_single_point_round_trip_and_isolation(self):
        fields = [field.name for field in CalibrationSettings._meta.fields]
        for category in CATEGORY_FIELDS:
            with self.subTest(category=category):
                before = {row['id']: row for row in CalibrationSettings.objects.values(*fields)}
                self.save(category)
                for record in CalibrationSettings.objects.select_related('test_point'):
                    targeted = float(record.test_point.current) == 0.1 and record.test_point.direction == 'Forward'
                    for key in fields:
                        expected = VALUES[category][key] if targeted and key in VALUES[category] else before[record.pk][key]
                        self.assertEqual(getattr(record, key + '_id') if key == 'test_point' else getattr(record, key), expected, (category, key))

    def test_apply_all_is_direction_specific_for_every_category(self):
        for direction in ('Forward', 'Reverse'):
            for category in CATEGORY_FIELDS:
                with self.subTest(direction=direction, category=category):
                    before = {row['id']: row for row in CalibrationSettings.objects.values()}
                    result = save_category(self.session.pk, {'category':category, 'scope':'all',
                        'current':'0.1', 'frequency':60, 'direction':direction, 'settings':VALUES[category]})
                    self.assertEqual(result['updated_points'], 2)
                    for record in CalibrationSettings.objects.select_related('test_point'):
                        for key, old in before[record.pk].items():
                            targeted = record.test_point.direction == direction and key in VALUES[category] and key != 'initial_warm_up_time'
                            self.assertEqual(getattr(record, key), VALUES[category][key] if targeted else old)

    def test_apply_all_creates_only_missing_active_direction(self):
        self.point_set.points.filter(current='0.2', direction='Forward').delete()
        self.save('5790', scope='all')
        self.assertEqual(self.point_set.points.count(), 4)
        self.assertEqual(self.point_set.points.get(current='0.2', direction='Forward').settings.f5790_filter_mode, 'OFF')
        self.assertEqual(self.point_set.points.get(current='0.2', direction='Reverse').settings.f5790_filter_mode, 'MEDIUM')

    def test_apply_all_excludes_warmup_and_point_save_limits_it_to_first(self):
        CalibrationSettings.objects.update(initial_warm_up_time=123)
        self.save('stability', scope='all', values={**VALUES['stability'], 'initial_warm_up_time':999})
        self.assertEqual(set(CalibrationSettings.objects.values_list('initial_warm_up_time', flat=True)), {123})
        result = save_category(self.session.pk, {'category':'stability', 'scope':'point',
            'current':'0.2', 'frequency':60, 'direction':'Forward', 'settings':{**VALUES['stability'], 'initial_warm_up_time':999}})
        self.assertEqual(result['settings']['initial_warm_up_time'], 0)
        self.assertEqual(self.point_set.points.get(current='0.2', direction='Forward').settings.initial_warm_up_time, 0)
        self.assertEqual(self.point_set.points.get(current='0.2', direction='Reverse').settings.initial_warm_up_time, 123)

    def test_new_reader_profile_preserves_pair_cycle_count(self):
        self.point_set.points.get(current='0.1', direction='Forward').settings.delete()
        self.save('5790', scope='all')
        self.assertEqual(set(CalibrationSettings.objects.values_list('n_cycles', flat=True)), {7})

    def test_zero_settling_time_is_saved(self):
        self.save('stability', values={**VALUES['stability'], 'settling_time':0})
        self.assertEqual(self.point_set.points.get(current='0.1', direction='Forward').settings.settling_time, 0)

    def test_invalid_or_cross_category_payload_writes_nothing(self):
        for values in [{'n_cycles':1}, {'n_cycles':8, 'settling_time':0}, {}]:
            with self.assertRaises(ValidationError):
                self.save('general', scope='all', values=values)
        self.assertEqual(set(CalibrationSettings.objects.values_list('n_cycles', flat=True)), {7})

    def test_bulk_failure_rolls_back_prior_points(self):
        from django.db.models.query import QuerySet
        original = QuerySet.update
        calls = []
        def fail_second(instance, *args, **kwargs):
            calls.append(instance)
            if len(calls) == 2:
                raise RuntimeError('simulated database failure')
            return original(instance, *args, **kwargs)
        with patch.object(QuerySet, 'update', fail_second), self.assertRaises(RuntimeError):
            self.save('stability', scope='all')
        self.assertEqual(set(CalibrationSettings.objects.values_list('settling_time', flat=True)), {45})

    def test_new_profile_uses_effective_defaults_not_legacy_model_defaults(self):
        CalibrationSettings.objects.all().delete()
        self.save('5790')
        settings = self.point_set.points.get(current='0.1', direction='Forward').settings
        self.assertEqual(settings.num_samples, 6)
        self.assertEqual(settings.stability_window, 6)
        self.assertEqual(settings.n_cycles, 15)
        self.assertEqual(settings.nplc, 100)

    def test_saved_default_is_used_only_for_new_settings_rows(self):
        CalibrationSettings.objects.all().delete()
        payload = {'category':'5790', 'scope':'point', 'current':'0.1', 'frequency':60,
            'direction':'Forward', 'settings':VALUES['5790'], 'default_settings':{'num_samples':10}}
        save_category(self.session.pk, payload)
        settings = self.point_set.points.get(current='0.1', direction='Forward').settings
        self.assertEqual(settings.num_samples, 10)
        payload['default_settings']['num_samples'] = 20
        save_category(self.session.pk, payload)
        settings.refresh_from_db()
        self.assertEqual(settings.num_samples, 10)
