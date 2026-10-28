from django.test import TestCase
from rest_framework.test import APIClient
from api.models import (CalibrationSession, Calibration, CalibrationConfigurations,
    TestPointSet, TestPoint, CalibrationResults, CalibrationResultsCycle,
    CalibrationSettings, Shunt, ShuntReport, ShuntCorrection, TVC, TVCReport, TVCCorrection)
from .ac_shunt_import import session_snapshot
from .serializers import save_session, session_to_dict
from .ac_shunt_instruments import seed_ac_shunt_references, seed_ac_shunt_test_instruments
from .models import Instrument


class AcShuntImportTests(TestCase):
    databases = {'default', 'uncertainty'}

    def setUp(self):
        self.session = CalibrationSession.objects.create(session_name='Import fixture',
            test_instrument_model='A40B', test_instrument_serial='UUT',
            standard_instrument_model='A40B', standard_instrument_serial='REF',
            standard_reader_model='34420A', test_reader_model='34420A',
            standard_tvc_serial='123', test_tvc_serial='124')
        cal = Calibration.objects.create(session=self.session)
        CalibrationConfigurations.objects.create(calibration=cal,ac_shunt_range=10)
        self.point_set = TestPointSet.objects.create(session=self.session)
        shunt = Shunt.objects.create(serial_number='REF',range=10)
        self.report = ShuntReport.objects.create(shunt=shunt,report_number='SAVED',calibration_date='2024-01-01')
        ShuntCorrection.objects.create(report=self.report,current=10,frequency=1000,uncertainty=4)
        latest = ShuntReport.objects.create(shunt=shunt,report_number='NEW',calibration_date='2026-01-01')
        ShuntCorrection.objects.create(report=latest,current=10,frequency=1000,uncertainty=40)
        for serial in [123,124]:
            tvc = TVC.objects.create(serial_number=serial,test_voltage=1)
            report = TVCReport.objects.create(tvc=tvc,report_number=f'TVC-{serial}')
            TVCCorrection.objects.create(report=report,frequency=1000,ac_dc_difference=2,expanded_uncertainty=6)
        for direction, deltas in [('Forward',[1,3,5]),('Reverse',[3,3,3])]:
            tp = TestPoint.objects.create(test_point_set=self.point_set,current=10,frequency=1000,
                                          direction=direction,correction_report=self.report)
            CalibrationSettings.objects.create(test_point=tp,n_cycles=3,f5790_range_mode='0.22',f5790_filter_mode='SLOW')
            result = CalibrationResults.objects.create(test_point=tp,outlier_filter_mode='none')
            for index,delta in enumerate(deltas,1):
                CalibrationResultsCycle.objects.create(results=result,cycle_index=index,delta_uut_ppm=delta)

    def test_snapshot_pairs_once_sends_only_measurements_and_does_not_write(self):
        before = list(CalibrationResults.objects.values())
        snapshot = session_snapshot(self.session.pk)
        self.assertEqual(len(snapshot['points']),1)
        point = snapshot['points'][0]
        self.assertEqual(point['analytics']['n_pairs_used'],3)
        self.assertAlmostEqual(point['analytics']['pair_type_a_uncertainty_ppm'],1/(3**.5))
        self.assertEqual(point['analytics']['pair_delta_uut_ppm'],3)
        self.assertEqual(set(point), {'sourcePointIds','current','frequency','analytics','stabilityFailed'})
        self.assertEqual(set(point['analytics']), {'pair_delta_uut_ppm','pair_type_a_uncertainty_ppm','n_pairs_used'})
        self.assertEqual(before,list(CalibrationResults.objects.values()))

    def test_manual_exclusions_do_not_depend_on_certificates(self):
        CalibrationResults.objects.update(manual_excluded_pairs=[2])
        ShuntCorrection.objects.all().delete()
        point = session_snapshot(self.session.pk)['points'][0]
        self.assertEqual(point['analytics']['n_pairs_used'],2)
        self.assertAlmostEqual(point['analytics']['pair_type_a_uncertainty_ppm'],1)
        self.assertNotIn('shuntSources',point)

    def test_read_endpoints_search_missing_and_empty_session(self):
        client = APIClient()
        listing = client.get('/api/uncertainty/ac-shunt/sessions/',{'q':'Import UUT'})
        self.assertEqual(listing.status_code,200)
        self.assertEqual(listing.data['total'],1)
        self.assertEqual(client.get('/api/uncertainty/ac-shunt/sessions/999999/').status_code,404)
        empty = CalibrationSession.objects.create(session_name='Empty')
        self.assertEqual(session_snapshot(empty.pk)['points'],[])

    def test_incomplete_type_a_is_explicit(self):
        TestPoint.objects.filter(direction='Reverse').delete()
        TestPoint.objects.update(correction_report=None)
        point = session_snapshot(self.session.pk)['points'][0]
        self.assertIsNone(point['analytics']['pair_type_a_uncertainty_ppm'])
        self.assertNotIn('tvcs',point)

    def test_legacy_persisted_aggregates_are_preserved(self):
        CalibrationResultsCycle.objects.all().delete()
        CalibrationResults.objects.update(pair_delta_uut_ppm=-7, pair_type_a_uncertainty_ppm=2, n_pairs_used=4)
        point = session_snapshot(self.session.pk)['points'][0]
        self.assertEqual(point['analytics'], {'pair_delta_uut_ppm': -7,
            'pair_type_a_uncertainty_ppm': 2, 'n_pairs_used': 4, 'persistedOnly': True})

    def test_screenshot_mean_and_standard_type_a_remain_distinct(self):
        CalibrationResultsCycle.objects.all().delete()
        CalibrationSettings.objects.update(n_cycles=5)
        expected_u = 0.6150070189859945
        for result in CalibrationResults.objects.all():
            # ABBA pairs Forward i with Reverse N+1-i.
            sign = -1 if result.test_point.direction == 'Reverse' else 1
            for index, offset in enumerate([-2, -1, 0, 1, 2], 1):
                CalibrationResultsCycle.objects.create(results=result, cycle_index=index,
                    delta_uut_ppm=-0.070 + sign * offset * expected_u * 2**.5)
        analytics = session_snapshot(self.session.pk)['points'][0]['analytics']
        self.assertAlmostEqual(analytics['pair_delta_uut_ppm'], -0.070)
        self.assertAlmostEqual(analytics['pair_type_a_uncertainty_ppm'], expected_u)
        self.assertEqual(analytics['n_pairs_used'], 5)

    def test_snapshot_does_not_read_certificate_tables(self):
        from django.db import connections
        from django.test.utils import CaptureQueriesContext
        with CaptureQueriesContext(connections['default']) as queries:
            session_snapshot(self.session.pk)
        sql = ' '.join(query['sql'].lower() for query in queries.captured_queries)
        for table in ('api_shuntreport', 'api_shuntcorrection', 'api_tvcreport', 'api_tvccorrection'):
            self.assertNotIn(table, sql)

    def test_provenance_and_pending_components_survive_budget_save(self):
        data = {'id':12345,'name':'Imported','testPoints':[{'id':'point','testPointInfo':{
            'acShuntSource':{'sessionId':self.session.pk,'pointIds':[1,2]}},'components':[
                {'id':'a','type':'A','name':'Repeatability','value':1,'dof':2,
                 'acShuntSource':{'n':3}}, {'id':'b','type':'B','name':'Missing','pendingReason':'No RoC'}]}]}
        restored = session_to_dict(save_session(data))
        self.assertEqual(restored['testPoints'][0]['testPointInfo'],data['testPoints'][0]['testPointInfo'])
        self.assertEqual(restored['testPoints'][0]['components'][1]['pendingReason'],'No RoC')

    def test_native_derived_inputs_sources_and_model_survive_repeated_save(self):
        point = {
            'id': 'derived-point', 'measurementType': 'derived',
            'equationString': 'Iref + I0 * ((Vac / Vdc - 1) / 2)',
            'variableMappings': {'Iref': 'Reference shunt calibration', 'I0': 'Nominal test current',
                                 'Vac': 'Reference reader AC', 'Vdc': 'Reference reader DC'},
            'variableNominals': {'Iref': {'value': 10, 'unit': 'A'}, 'I0': {'value': 10, 'unit': 'A'},
                                 'Vac': {'value': .2, 'unit': 'V', 'qualifier': {'value': 1000, 'unit': 'Hz'}},
                                 'Vdc': {'value': .2, 'unit': 'V', 'qualifier': {'value': 1000, 'unit': 'Hz'}}},
            'inputCorrelations': {'Reference reader AC|Reference reader DC': -1},
            'testPointInfo': {'parameter': {'value': 10, 'unit': 'A'}, 'acShuntSource': {
                'sessionId': self.session.pk, 'pointIds': [1, 2], 'deltaPpm': 3,
                'derivedModel': {'version': 1, 'convention': 'Nominal-centered equivalent-current AC/DC comparison',
                                 'readerCorrelation': 'Conservative full-magnitude correlation',
                                 'directionCombination': 'Type A imported once at output'}}},
            'components': [
                {'id': 'reader', 'type': 'B', 'name': 'Reader uncertainty', 'variableSymbol': 'Vac',
                 'variableType': 'Reference reader AC', 'value_native': .00001, 'unit_native': 'V',
                 'tmdeBudgetSourceId': 'reader-master', 'tmdeBudgetRangeId': 'ac-range',
                 'tmdeBudgetFunctionId': 'ac-function', 'tmdeBudgetComponentKind': 'TMDE Error',
                 'acShuntSource': {'phase': 'ac_open', 'direction': 'Forward', 'role': 'std'}},
                {'id': 'type-a', 'type': 'A', 'name': 'AC/DC repeatability',
                 'value_native': .00002, 'unit_native': 'A', 'dof': 3},
            ],
        }
        data = {'id': 12346, 'name': 'Native derived import', 'testPoints': [point]}
        for _ in range(2):
            data = session_to_dict(save_session(data))
            restored = data['testPoints'][0]
            for key in ('measurementType', 'equationString', 'variableMappings', 'variableNominals',
                        'inputCorrelations', 'testPointInfo'):
                self.assertEqual(restored[key], point[key], key)
            for expected, actual in zip(point['components'], restored['components']):
                for key, value in expected.items():
                    self.assertEqual(actual[key], value, key)
            self.assertFalse(restored['components'][1].get('variableSymbol'))


class AcShuntReferenceSetupTests(TestCase):
    databases = {'default', 'uncertainty'}

    def setUp(self):
        self.shunt = Shunt.objects.create(model_name='Y5020', serial_number='NIST-10', range=10)
        self.report = ShuntReport.objects.create(shunt=self.shunt, report_number='NIST-2026', calibration_date='2026-01-01')
        for frequency, uncertainty in [(60,38),(1000,35),(6000,None)]:
            ShuntCorrection.objects.create(report=self.report, current=10, frequency=frequency, uncertainty=uncertainty)

    def test_creates_grouped_frequency_ranges_and_preserves_edits_on_repeat(self):
        self.assertEqual(seed_ac_shunt_references(), 1)
        instrument = Instrument.objects.get()
        ranges = instrument.functions[0]['ranges']
        self.assertEqual(instrument.scope, 'validated')
        self.assertEqual(instrument.functions[0]['name'], 'Current')
        self.assertEqual(len({r['qualifierGroupId'] for r in ranges}), 1)
        self.assertEqual([r['qualifier']['value'] for r in ranges], [60,1000,6000])
        self.assertEqual(ranges[0]['tolerances']['reading'], {
            'high': 38, 'low': -38, 'unit': 'ppm', 'symmetric': True, 'distribution': '1.960'})
        self.assertEqual(ranges[1]['tolerances']['reading']['high'], 35)
        self.assertEqual(ranges[2]['tolerances'], {})
        self.assertEqual(ranges[0]['acShuntSource']['reportNumber'], 'NIST-2026')
        instrument.functions[0]['ranges'][0]['tolerances']['reading']['high'] = 99
        instrument.save()
        ShuntCorrection.objects.filter(report=self.report,frequency=60).update(uncertainty=100)
        self.assertEqual(seed_ac_shunt_references(), 0)
        instrument.refresh_from_db()
        self.assertEqual(instrument.functions[0]['ranges'][0]['tolerances']['reading']['high'], 99)

    def test_distinct_standards_keep_their_individual_uncertainties(self):
        other = Shunt.objects.create(model_name='Y5020', serial_number='NIST-20', range=20)
        report = ShuntReport.objects.create(shunt=other, report_number='OTHER')
        ShuntCorrection.objects.create(report=report,current=20,frequency=1000,uncertainty=46)
        self.assertEqual(seed_ac_shunt_references(), 2)
        definitions = {item.model: item for item in Instrument.objects.all()}
        self.assertEqual(definitions['Y5020 · NIST-20'].functions[0]['ranges'][0]['tolerances']['reading']['high'],46)
        self.assertEqual(definitions['Y5020 · NIST-10'].functions[0]['ranges'][1]['tolerances']['reading']['high'],35)

    def test_reuses_existing_authored_identity_and_prefers_manual_registry_entry(self):
        Instrument.objects.create(id='authored', model='NIST-10', description='Y5020', functions=[])
        self.assertEqual(seed_ac_shunt_references(),0)
        self.assertEqual(Instrument.objects.count(),1)
        Instrument.objects.all().delete()
        manual = Shunt.objects.create(model_name='Y5020',serial_number='NIST-10',range=10,is_manual=True)
        report = ShuntReport.objects.create(shunt=manual,report_number='MANUAL')
        ShuntCorrection.objects.create(report=report,current=10,frequency=1000,uncertainty=42)
        self.assertEqual(seed_ac_shunt_references(),1)
        self.assertEqual(Instrument.objects.get().functions[0]['ranges'][0]['tolerances']['reading']['high'],42)


class AcShuntTestInstrumentSetupTests(TestCase):
    databases = {'default', 'uncertainty'}

    def make_session(self, serial='TI-10', points=((10, 60), (10, 1000))):
        session = CalibrationSession.objects.create(session_name=f'TI setup {CalibrationSession.objects.count()}',
            test_instrument_model='Y5020', test_instrument_serial=serial)
        point_set = TestPointSet.objects.create(session=session)
        for current, frequency in points:
            for direction in ('Forward', 'Reverse'):
                TestPoint.objects.create(test_point_set=point_set, current=current,
                    frequency=frequency, direction=direction)
        return session

    def test_creates_one_shared_ti_per_serial_with_combined_current_frequency_ranges(self):
        self.make_session()
        self.make_session(points=((20, 1000), (10, 1000)))
        self.make_session(serial='TI-20')
        self.assertEqual(seed_ac_shunt_test_instruments(), 2)
        item = Instrument.objects.get(model='Y5020 · TI-10')
        self.assertEqual((item.manufacturer, item.instrument_type, item.scope), ('Fluke', 'uut', 'validated'))
        ranges = item.functions[0]['ranges']
        self.assertEqual([(r['value'], r['qualifier']['value']) for r in ranges], [(10, 60), (10, 1000), (20, 1000)])
        self.assertEqual(ranges[0]['qualifierGroupId'], ranges[1]['qualifierGroupId'])
        self.assertNotEqual(ranges[1]['qualifierGroupId'], ranges[2]['qualifierGroupId'])
        for row in ranges:
            self.assertEqual(row['qualifier']['unit'], 'Hz')
            self.assertEqual(row['tolerances']['reading'], {'high':100, 'low':-100,
                'unit':'ppm', 'symmetric':True, 'distribution':'not_set'})
            self.assertEqual(row['acShuntSource']['serial'], 'TI-10')
        item.functions[0]['ranges'][0]['tolerances']['reading']['high'] = 90
        item.save()
        self.assertEqual(seed_ac_shunt_test_instruments(), 0)
        item.refresh_from_db()
        self.assertEqual(item.functions[0]['ranges'][0]['tolerances']['reading']['high'], 90)

    def test_reuses_authored_ti_and_keeps_reference_definitions_separate(self):
        self.make_session()
        Instrument.objects.create(id='reference', model='Y5020 · TI-10', instrument_type='tmde')
        self.assertEqual(seed_ac_shunt_test_instruments(), 1)
        self.assertEqual(Instrument.objects.count(), 2)
        Instrument.objects.filter(instrument_type='uut').delete()
        Instrument.objects.create(id='authored-ti', model='Y5020 · TI-10', instrument_type='uut', functions=[])
        self.assertEqual(seed_ac_shunt_test_instruments(), 0)
        self.assertEqual(Instrument.objects.get(pk='authored-ti').functions, [])

    def test_skips_sessions_without_identity_or_points(self):
        CalibrationSession.objects.create(session_name='Empty', test_instrument_model='Y5020', test_instrument_serial='EMPTY')
        self.make_session(serial='')
        self.assertEqual(seed_ac_shunt_test_instruments(), 0)
