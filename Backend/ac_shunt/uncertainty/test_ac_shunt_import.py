from django.test import TestCase
from rest_framework.test import APIClient
from api.models import (CalibrationSession, Calibration, CalibrationConfigurations,
    TestPointSet, TestPoint, CalibrationResults, CalibrationResultsCycle,
    CalibrationSettings, Shunt, ShuntReport, ShuntCorrection, TVC, TVCReport, TVCCorrection)
from .ac_shunt_import import session_snapshot
from .serializers import save_session, session_to_dict


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

    def test_snapshot_pairs_once_preserves_report_and_does_not_write(self):
        before = list(CalibrationResults.objects.values())
        snapshot = session_snapshot(self.session.pk)
        self.assertEqual(len(snapshot['points']),1)
        self.assertEqual(snapshot['points'][0]['readerPoints'][0]['filterMode'],'SLOW')
        point = snapshot['points'][0]
        self.assertEqual(point['analytics']['n_pairs_used'],3)
        self.assertAlmostEqual(point['analytics']['pair_type_a_uncertainty_ppm'],1/(3**.5))
        self.assertEqual(point['shuntSources'][0]['report']['number'],'SAVED')
        self.assertEqual(point['shuntSources'][0]['expandedPpm'],4)
        self.assertEqual(point['tvcs']['std']['expandedPpm'],6)
        self.assertEqual(before,list(CalibrationResults.objects.values()))

    def test_manual_exclusions_and_missing_certificate_are_not_zero(self):
        CalibrationResults.objects.update(manual_excluded_pairs=[2])
        ShuntCorrection.objects.all().delete()
        point = session_snapshot(self.session.pk)['points'][0]
        self.assertEqual(point['analytics']['n_pairs_used'],2)
        self.assertAlmostEqual(point['analytics']['pair_type_a_uncertainty_ppm'],1)
        self.assertEqual(point['shuntSources'],[None,None])

    def test_read_endpoints_search_missing_and_empty_session(self):
        client = APIClient()
        listing = client.get('/api/uncertainty/ac-shunt/sessions/',{'q':'Import UUT'})
        self.assertEqual(listing.status_code,200)
        self.assertEqual(listing.data['total'],1)
        self.assertEqual(client.get('/api/uncertainty/ac-shunt/sessions/999999/').status_code,404)
        empty = CalibrationSession.objects.create(session_name='Empty')
        self.assertEqual(session_snapshot(empty.pk)['points'],[])

    def test_incomplete_type_a_and_legacy_report_are_explicit(self):
        TestPoint.objects.filter(direction='Reverse').delete()
        TestPoint.objects.update(correction_report=None)
        point = session_snapshot(self.session.pk)['points'][0]
        self.assertIsNone(point['analytics']['pair_type_a_uncertainty_ppm'])
        self.assertEqual(point['shuntSources'][0]['expandedPpm'],40)
        self.assertIn('legacy',point['shuntSources'][0]['report']['selection'])

    def test_provenance_and_pending_components_survive_budget_save(self):
        data = {'id':12345,'name':'Imported','testPoints':[{'id':'point','testPointInfo':{
            'acShuntSource':{'sessionId':self.session.pk,'pointIds':[1,2]}},'components':[
                {'id':'a','type':'A','name':'Repeatability','value':1,'dof':2,
                 'acShuntSource':{'n':3}}, {'id':'b','type':'B','name':'Missing','pendingReason':'No RoC'}]}]}
        restored = session_to_dict(save_session(data))
        self.assertEqual(restored['testPoints'][0]['testPointInfo'],data['testPoints'][0]['testPointInfo'])
        self.assertEqual(restored['testPoints'][0]['components'][1]['pendingReason'],'No RoC')
