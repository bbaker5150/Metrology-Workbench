import math

from django.test import TestCase
from rest_framework.test import APIClient

from api.models import (CalibrationSession, Calibration, CalibrationConfigurations,
                        TestPointSet, TestPoint, CalibrationSettings, CalibrationResults, CalibrationResultsCycle)
from .ac_shunt_import import session_snapshot
from .fluke5790_instrument import GENERIC_5790_ID, seed_generic_5790
from .models import Instrument
from .serializers import instrument_to_dict, save_session, session_to_dict
from .y5020_resolution import phase_sensitivity


class Generic5790Tests(TestCase):
    databases = {'default', 'uncertainty'}

    def session(self, model='Y5020', current=10):
        session = CalibrationSession.objects.create(session_name='Reader import', test_instrument_model=model,
            test_instrument_serial='TI', standard_instrument_model=model, standard_instrument_serial='REF',
            standard_reader_model='5790B', test_reader_model='5790B', standard_reader_serial='4449302',
            test_reader_serial='4449302')
        cal = Calibration.objects.create(session=session)
        CalibrationConfigurations.objects.create(calibration=cal, ac_shunt_range=20)
        points = TestPointSet.objects.create(session=session)
        for direction in ('Forward', 'Reverse'):
            point = TestPoint.objects.create(test_point_set=points, current=current, frequency=1000, direction=direction)
            CalibrationSettings.objects.create(test_point=point, n_cycles=2, f5790_range_mode='2.2',
                                               f5790_filter_mode='MEDIUM', f5790_hires_enabled=True)
            result = CalibrationResults.objects.create(test_point=point, outlier_filter_mode='none', eta_std=1, eta_ti=1)
            for index in (1, 2):
                CalibrationResultsCycle.objects.create(results=result, cycle_index=index, delta_uut_ppm=index,
                    **{f'{role}_{phase}_avg': current*.01*(-1 if phase == 'dc_neg' else 1)
                       for role in ('std', 'ti') for phase in ('ac_open', 'ac_close', 'dc_pos', 'dc_neg')})
        return session

    def test_single_serial_independent_definition_with_manual_resolutions_and_no_accuracy(self):
        unrelated = Instrument.objects.create(id='existing-reader', model='5790B 4449302', functions=[{'name':'Mine'}])
        instrument, created = seed_generic_5790()
        self.assertTrue(created)
        self.assertEqual(instrument.model, '5790B')
        self.assertEqual(instrument.description, '')
        self.assertEqual(instrument.scope, 'validated')
        normal, fast = instrument.functions
        self.assertEqual(len(normal['ranges']), 13)
        self.assertEqual(len(fast['ranges']), 13)
        for fn in instrument.functions:
            for row in fn['ranges']:
                self.assertEqual(row['resolution'], row['measuringResolution'])
                self.assertEqual(row['resolutionUnit'], 'V')
                self.assertEqual(row['resolutionDistribution'], '3.464')
                self.assertTrue(row['includeResolutionInBudget'])
                self.assertEqual(row['tolerances'], {})
        self.assertEqual(normal['ranges'][6]['resolution'], 1e-7)  # 2.2 V, Medium/Slow
        self.assertEqual(fast['ranges'][6]['resolution'], 1e-6)
        self.assertEqual(normal['ranges'][-1]['resolution'], 1e-4)
        normal['ranges'][6]['resolution'] = 2e-7
        instrument.save()
        self.assertFalse(seed_generic_5790()[1])
        self.assertEqual(Instrument.objects.get(pk=GENERIC_5790_ID).functions[0]['ranges'][6]['resolution'], 2e-7)
        unrelated.refresh_from_db()
        self.assertEqual(unrelated.functions, [{'name':'Mine'}])
        self.assertEqual(Instrument.objects.count(), 2)

    def test_y5020_endpoint_initializes_once_and_returns_the_same_generic_instrument(self):
        session = self.session()
        client = APIClient()
        before = list(CalibrationResults.objects.values())
        first = client.get(f'/api/uncertainty/ac-shunt/sessions/{session.pk}/')
        self.assertEqual(first.status_code, 200)
        self.assertEqual(first.data['generic5790Instrument']['id'], GENERIC_5790_ID)
        second = client.get(f'/api/uncertainty/ac-shunt/sessions/{session.pk}/')
        self.assertEqual(first.data['generic5790Instrument'], second.data['generic5790Instrument'])
        self.assertEqual(Instrument.objects.count(), 1)
        self.assertEqual(before, list(CalibrationResults.objects.values()))
        listed = client.get('/api/uncertainty/instruments/').data
        self.assertTrue(any(row['id'] == GENERIC_5790_ID for row in listed))

    def test_a40b_does_not_initialize_or_attach_the_meter(self):
        session = self.session(model='A40B')
        data = APIClient().get(f'/api/uncertainty/ac-shunt/sessions/{session.pk}/').data
        self.assertNotIn('generic5790Instrument', data)
        self.assertNotIn('readerResolution', data['points'][0])
        self.assertFalse(Instrument.objects.exists())

    def test_all_eight_phase_sensitivities_and_read_only_snapshot(self):
        session = self.session()
        data = session_snapshot(session.pk)['points'][0]['readerResolution']
        self.assertFalse(data['nominalVoltageFallback'])
        self.assertEqual(len(data['cases']), 1)
        self.assertAlmostEqual(data['cases'][0]['ppmPerVolt'], math.sqrt(2)*1e7)
        self.assertFalse(Instrument.objects.exists())  # pure snapshot does not write
        result = CalibrationResults.objects.first()
        row = result.cycles.first()
        result.eta_std = 2
        row.std_ac_open_avg = row.std_ac_close_avg = .2
        # STD: 2*(2.5e6^2 + 5e6^2); TI: 4*5e6^2.
        self.assertAlmostEqual(phase_sensitivity(row, result), math.sqrt(162.5e12))

    def test_cycle_exclusions_caps_and_largest_accepted_sensitivity(self):
        session = self.session()
        # ABBA pairs F1/R2 and F2/R1. Remove the low-voltage F1/R2 pair.
        CalibrationResults.objects.update(manual_excluded_pairs=[1])
        for result in CalibrationResults.objects.all():
            excluded_index = 1 if result.test_point.direction == 'Forward' else 2
            result.cycles.filter(cycle_index=excluded_index).update(std_dc_pos_avg=.001, std_dc_neg_avg=-.001)
            CalibrationResultsCycle.objects.create(results=result, cycle_index=3, delta_uut_ppm=0,
                std_dc_pos_avg=.0001, std_dc_neg_avg=-.0001)  # outside N=2, must not enter budget
        data = session_snapshot(session.pk)['points'][0]['readerResolution']
        self.assertFalse(data['nominalVoltageFallback'])
        self.assertAlmostEqual(data['cases'][0]['ppmPerVolt'], math.sqrt(2)*1e7)

    def test_legacy_ppm_only_sessions_have_explicit_nominal_voltage_fallback(self):
        session = self.session(current=20)
        CalibrationResultsCycle.objects.all().delete()
        CalibrationResults.objects.update(pair_delta_uut_ppm=2, pair_type_a_uncertainty_ppm=1, n_pairs_used=3)
        data = session_snapshot(session.pk)['points'][0]
        self.assertTrue(data['readerResolution']['nominalVoltageFallback'])
        self.assertAlmostEqual(data['readerResolution']['cases'][0]['ppmPerVolt'], math.sqrt(2)*5e6)
        self.assertEqual(data['analytics']['pair_type_a_uncertainty_ppm'], 1)
        CalibrationResults.objects.update(eta_std=2, eta_ti=1)
        data = session_snapshot(session.pk)['points'][0]['readerResolution']
        self.assertAlmostEqual(data['cases'][0]['ppmPerVolt'], math.sqrt(1.25)*5e6)

    def test_filter_and_hires_choose_the_correct_live_library_ranges(self):
        session = self.session()
        CalibrationSettings.objects.update(f5790_filter_mode='FAST', f5790_hires_enabled=False, f5790_range_mode='AUTO')
        data = session_snapshot(session.pk)['points'][0]['readerResolution']
        self.assertTrue(data['autoRangeUpperBound'])
        self.assertEqual(data['cases'][0]['rangeId'], f'{GENERIC_5790_ID}-fast-2.2')
        CalibrationSettings.objects.update(f5790_hires_enabled=True)
        data = session_snapshot(session.pk)['points'][0]['readerResolution']
        self.assertEqual(data['cases'][0]['rangeId'], f'{GENERIC_5790_ID}-medium-slow-2.2')

    def test_link_and_compact_sensitivities_survive_budget_save(self):
        session = self.session()
        reader, _ = seed_generic_5790()
        resolution = session_snapshot(session.pk)['points'][0]['readerResolution']
        data = {'id':173001,'name':'Y5020','tmdes':[{'id':'meter','name':'',
            'measurementAreaNames':['Current'],'instrument':instrument_to_dict(reader)}],
            'testPoints':[{'id':'point','components':[{'id':'res','type':'B','isResolution':True,
                'tmdeBudgetSourceId':'meter','tmdeBudgetComponentKind':'Resolution','y5020Resolution':resolution}]}]}
        for _ in range(2):
            data = session_to_dict(save_session(data))
            self.assertEqual(data['tmdes'][0]['instrument']['id'], GENERIC_5790_ID)
            self.assertEqual(data['testPoints'][0]['components'][0]['y5020Resolution'], resolution)
