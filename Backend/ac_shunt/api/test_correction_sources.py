from decimal import Decimal

from django.test import TestCase
from rest_framework.test import APIClient

from api.models import (
    Calibration,
    CalibrationConfigurations,
    CalibrationResults,
    CalibrationSession,
    Shunt,
    ShuntCorrection,
    ShuntReport,
    TestPoint,
    TestPointSet,
)


class CorrectionSourceTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.session = CalibrationSession.objects.create(
            session_name='Correction source test',
            standard_instrument_serial='3995010',
        )
        calibration = Calibration.objects.create(session=self.session)
        CalibrationConfigurations.objects.create(
            calibration=calibration,
            ac_shunt_range=10,
        )
        self.point_set = TestPointSet.objects.create(session=self.session)
        self.imported = Shunt.objects.create(
            model_name='Y5020-10A',
            serial_number='3995010',
            range=10,
            is_manual=False,
        )
        self.report = ShuntReport.objects.create(shunt=self.imported, is_active=True)
        ShuntCorrection.objects.create(
            report=self.report,
            current=10,
            frequency=1000,
            correction=7.25,
            uncertainty=0.4,
        )

    def test_generated_point_uses_its_exact_imported_report(self):
        self.session.standard_instrument_serial = 'different-session-serial'
        self.session.save(update_fields=['standard_instrument_serial'])
        point = TestPoint.objects.create(
            test_point_set=self.point_set,
            current=Decimal('10'),
            frequency=1000,
            direction='Forward',
            correction_report=self.report,
        )
        results = CalibrationResults.objects.create(test_point=point)

        results.fetch_automatic_corrections()

        self.assertEqual(results.delta_std_known, 7.25)

    def test_partial_manual_device_does_not_mask_imported_point(self):
        manual = Shunt.objects.create(
            model_name='Y5020-10A',
            serial_number='3995010',
            range=10,
            is_manual=True,
        )
        manual_report = ShuntReport.objects.create(shunt=manual, is_active=True)
        ShuntCorrection.objects.create(
            report=manual_report,
            current=6.9,
            frequency=1000,
            correction=99,
            uncertainty=1,
        )
        point = TestPoint.objects.create(
            test_point_set=self.point_set,
            current=Decimal('10'),
            frequency=1000,
            direction='Forward',
        )
        results = CalibrationResults.objects.create(test_point=point)

        results.fetch_automatic_corrections()

        self.assertEqual(results.delta_std_known, 7.25)

    def test_append_and_resolve_preserve_source_report(self):
        response = self.client.post(
            f'/api/calibration_sessions/{self.session.id}/test_points/append/',
            {
                'correction_report_id': self.report.id,
                'points': [
                    {'current': 10, 'frequency': 1000, 'direction': 'Forward'},
                    {'current': 10, 'frequency': 1000, 'direction': 'Reverse'},
                ],
            },
            format='json',
        )
        self.assertEqual(response.status_code, 201)
        points = TestPoint.objects.filter(test_point_set=self.point_set)
        self.assertEqual(points.count(), 2)
        self.assertTrue(all(point.correction_report_id == self.report.id for point in points))

        point = points.get(direction='Forward')
        resolved = self.client.get(
            f'/api/calibration_sessions/{self.session.id}/test_points/{point.id}/resolved-corrections/'
        )
        self.assertEqual(resolved.status_code, 200)
        self.assertEqual(resolved.data['delta_std_known'], 7.25)
        self.assertEqual(resolved.data['correction_report_id'], self.report.id)

    def test_report_edit_refreshes_automatic_but_not_manual_results(self):
        automatic_point = TestPoint.objects.create(
            test_point_set=self.point_set,
            current=Decimal('10'),
            frequency=1000,
            direction='Forward',
            correction_report=self.report,
        )
        automatic = CalibrationResults.objects.create(
            test_point=automatic_point,
            delta_std_known=7.25,
        )
        manual_point = TestPoint.objects.create(
            test_point_set=self.point_set,
            current=Decimal('10'),
            frequency=1000,
            direction='Reverse',
            correction_report=self.report,
        )
        manual = CalibrationResults.objects.create(
            test_point=manual_point,
            delta_std_known=3.0,
            corrections_manually_overridden=True,
        )

        response = self.client.put(
            f'/api/shunts/{self.imported.id}/reports/{self.report.id}/',
            {
                'corrections': [
                    {
                        'current': 10,
                        'frequency': 1000,
                        'correction': 8.5,
                        'uncertainty': 0.4,
                    }
                ]
            },
            format='json',
        )
        self.assertEqual(response.status_code, 200)
        automatic.refresh_from_db()
        manual.refresh_from_db()
        self.assertEqual(automatic.delta_std_known, 8.5)
        self.assertEqual(manual.delta_std_known, 3.0)

    def test_report_edit_can_update_device_identity(self):
        device_response = self.client.patch(
            f'/api/shunts/{self.imported.id}/',
            {'model_name': 'Y5020', 'serial_number': '3995010-UPDATED'},
            format='json',
        )
        self.assertEqual(device_response.status_code, 200)
        self.imported.refresh_from_db()
        self.assertEqual(self.imported.model_name, 'Y5020')
        self.assertEqual(self.imported.serial_number, '3995010-UPDATED')
