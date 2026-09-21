from django.test import TestCase
from rest_framework.test import APIClient
from .models import TVCCorrection, ShuntCorrection


class DecimalCorrectionTests(TestCase):
    def test_decimal_corrections_round_trip_through_nested_device_and_report_apis(self):
        client = APIClient()
        for kind, identity, point, model in (
            ('tvcs', {'serial_number':123456, 'test_voltage':0.5},
             {'frequency':1000, 'ac_dc_difference':-1.375, 'expanded_uncertainty':0.0625}, TVCCorrection),
            ('shunts', {'serial_number':'SHUNT-1', 'model_name':'Y5020', 'range':20},
             {'frequency':1000, 'current':18.5, 'correction':-1.375, 'uncertainty':0.0625}, ShuntCorrection),
        ):
            with self.subTest(kind=kind):
                response = client.post(f'/api/{kind}/', {**identity, 'is_manual':True,
                    'reports':[{'calibration_date':'2026-09-01', 'corrections':[point]}]}, format='json')
                self.assertEqual(response.status_code, 201, response.data)
                device = response.data
                report = device['reports'][0]
                saved = model.objects.get(report_id=report['id'])
                for field, value in point.items():
                    self.assertEqual(getattr(saved, field), value)
                    self.assertEqual(report['corrections'][0][field], value)
                correction_key = 'ac_dc_difference' if kind == 'tvcs' else 'correction'
                updated = {**point, 'id':saved.id, correction_key:2.125}
                response = client.put(f"/api/{kind}/{device['id']}/reports/{report['id']}/",
                    {'corrections':[updated]}, format='json')
                self.assertEqual(response.status_code, 200, response.data)
                saved.refresh_from_db()
                self.assertEqual(getattr(saved, correction_key), 2.125)
                response = client.get(f"/api/{kind}/{device['id']}/")
                self.assertEqual(response.data['reports'][0]['corrections'][0][correction_key], 2.125)
