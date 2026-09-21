import io
import os
from pathlib import Path
import secrets
import tempfile
from unittest.mock import patch

from django.contrib.auth.hashers import check_password, make_password
from django.core.cache import cache
from django.core.management import call_command, CommandError
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from .corrections_auth import PASSWORD_ENV, token_key
from .models import Shunt, ShuntReport, TVC, TVCReport


class CorrectionsAuthorizationTests(TestCase):
    def setUp(self):
        cache.clear()
        self.password = secrets.token_urlsafe(24)
        self.env = patch.dict(os.environ, {PASSWORD_ENV: make_password(self.password)})
        self.env.start()
        self.addCleanup(self.env.stop)
        self.addCleanup(cache.clear)
        self.client = APIClient()
        self.shunt = Shunt.objects.create(serial_number='imported', range=20)
        self.report = ShuntReport.objects.create(shunt=self.shunt)
        self.tvc = TVC.objects.create(serial_number=888, test_voltage=1)
        self.tvc_report = TVCReport.objects.create(tvc=self.tvc)

    def authorize(self, kind='shunt', device=None, password=None):
        return self.client.post('/api/corrections/authorize/', {
            'device_type':kind, 'device_id':(device or self.shunt).pk,
            'password':self.password if password is None else password,
        }, format='json')

    def test_correct_password_returns_opaque_scoped_grant_and_permits_writes(self):
        for kind, device, report in [('shunt', self.shunt, self.report), ('tvc', self.tvc, self.tvc_report)]:
            with self.subTest(kind=kind):
                response = self.authorize(kind, device)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response['Cache-Control'], 'no-store')
                self.assertEqual(response.data['expires_in'], 600)
                self.assertNotIn(self.password, str(response.data))
                self.client.credentials(HTTP_AUTHORIZATION='Corrections '+response.data['token'])
                url = f'/api/{kind}s/{device.pk}/reports/{report.pk}/'
                self.assertEqual(self.client.patch(url, {'notes':'edited'}, format='json').status_code, 200)
                self.assertEqual(self.client.post(url+'pin/', {'pinned':True}, format='json').status_code, 200)
                self.assertEqual(self.client.post(f'/api/{kind}s/{device.pk}/reports/', {'notes':'new'}, format='json').status_code, 201)

    def test_missing_and_forged_grants_block_all_imported_mutations(self):
        for kind, device, report in [('shunt', self.shunt, self.report), ('tvc', self.tvc, self.tvc_report)]:
            for credential in ['', 'Corrections '+secrets.token_urlsafe(32)]:
                self.client.credentials(HTTP_AUTHORIZATION=credential)
                base = f'/api/{kind}s/{device.pk}/'
                actions = [('patch', base, {'is_manual':True}), ('delete',base,{}),
                    ('post',base+'reports/',{'notes':'new'}),
                    ('patch',base+f'reports/{report.pk}/',{'notes':'changed'}),
                    ('delete',base+f'reports/{report.pk}/',{}),
                    ('post',base+f'reports/{report.pk}/pin/',{'pinned':True})]
                for method, url, data in actions:
                    with self.subTest(kind=kind, method=method, url=url):
                        self.assertEqual(getattr(self.client,method)(url,data,format='json').status_code,403)
                device.refresh_from_db(); report.refresh_from_db()
                self.assertFalse(device.is_manual)
                self.assertEqual(report.notes, '')
                self.assertFalse(report.is_pinned)

    def test_token_expiry_scope_and_password_rotation(self):
        token = self.authorize().data['token']
        self.client.credentials(HTTP_AUTHORIZATION='Corrections '+token)
        self.assertEqual(self.client.patch(f'/api/tvcs/{self.tvc.pk}/', {'test_voltage':2},format='json').status_code,403)
        cache.delete(token_key(token))
        self.assertEqual(self.client.patch(f'/api/shunts/{self.shunt.pk}/',{'remark':'expired'},format='json').status_code,403)
        token = self.authorize().data['token']
        self.client.credentials(HTTP_AUTHORIZATION='Corrections '+token)
        with patch.dict(os.environ,{PASSWORD_ENV:make_password(secrets.token_urlsafe(24))}):
            self.assertEqual(self.client.patch(f'/api/shunts/{self.shunt.pk}/',{'remark':'rotated'},format='json').status_code,403)

    def test_manual_report_cannot_overwrite_an_imported_report_by_id(self):
        for kind, model, report_model, parent, original in [
            ('shunt', Shunt, ShuntReport, self.shunt, self.report),
            ('tvc', TVC, TVCReport, self.tvc, self.tvc_report),
        ]:
            device = model.objects.create(is_manual=True, **(
                {'serial_number':'manual-other','range':1} if kind == 'shunt'
                else {'serial_number':999,'test_voltage':1}))
            report = report_model.objects.create(**{kind:device})
            base = f'/api/{kind}s/{device.pk}/reports/'
            response = self.client.patch(base+f'{report.pk}/', {'id':original.pk,'notes':'manual edit'},format='json')
            self.assertEqual(response.status_code,200)
            self.assertEqual(response.data['id'],report.pk)
            created = self.client.post(base,{'id':original.pk,'notes':'manual new'},format='json')
            self.assertEqual(created.status_code,201)
            self.assertNotEqual(created.data['id'],original.pk)
            original.refresh_from_db()
            self.assertEqual(original.notes,'')
            self.assertEqual(getattr(original,kind+'_id'),parent.pk)
            self.assertEqual(self.client.patch(f'/api/{kind}s/{device.pk}/',{'is_manual':False},format='json').status_code,400)

    def test_authorized_device_edits_and_deletes_remain_available(self):
        for kind, device, report in [('shunt', self.shunt, self.report), ('tvc', self.tvc, self.tvc_report)]:
            token = self.authorize(kind,device).data['token']
            self.client.credentials(HTTP_AUTHORIZATION='Corrections '+token)
            base = f'/api/{kind}s/{device.pk}/'
            self.assertEqual(self.client.patch(base,{'is_manual':True},format='json').status_code,400)
            data = {'remark':'edited'} if kind == 'shunt' else {'test_voltage':2}
            self.assertEqual(self.client.patch(base,data,format='json').status_code,200)
            self.assertEqual(self.client.delete(base+f'reports/{report.pk}/').status_code,204)
            self.assertEqual(self.client.delete(base).status_code,204)

    def test_malformed_server_hash_fails_closed(self):
        for encoded in ['not-a-hash','pbkdf2_sha256$invalid']:
            with patch.dict(os.environ,{PASSWORD_ENV:encoded}):
                self.assertEqual(self.authorize().status_code,503)

    def test_invalid_request_payloads_do_not_trigger_server_errors(self):
        for payload in [[], {}, {'device_type':[]},
                {'device_type':'shunt','device_id':2**80,'password':self.password},
                {'device_type':'shunt','device_id':self.shunt.pk,'password':[]}]:
            response = self.client.post('/api/corrections/authorize/',payload,format='json')
            self.assertEqual(response.status_code,400)
            self.assertEqual(response['Cache-Control'],'no-store')

    def test_setup_refuses_echoing_terminal_fallback(self):
        import getpass
        with patch.dict(os.environ,{PASSWORD_ENV:''}), patch('getpass.getpass',side_effect=getpass.GetPassWarning):
            with self.assertRaisesMessage(CommandError,'hidden password input'):
                call_command('configure_corrections_password')

    def test_wrong_password_throttled_without_grant(self):
        for _ in range(5):
            response = self.authorize(password=secrets.token_urlsafe(24))
            self.assertEqual(response.status_code,403)
            self.assertNotIn('token',response.data)
        self.assertEqual(self.authorize().status_code,429)

    def test_unconfigured_server_fails_closed_but_manual_crud_and_reads_work(self):
        with tempfile.TemporaryDirectory() as folder, override_settings(CREDENTIALS_DIR=folder), patch.dict(os.environ,{PASSWORD_ENV:''}):
            self.assertEqual(self.authorize().status_code,503)
            self.assertEqual(self.client.patch(f'/api/shunts/{self.shunt.pk}/',{'remark':'denied'},format='json').status_code,503)
            self.assertEqual(self.client.get('/api/shunts/').status_code,200)
            response = self.client.post('/api/shunts/',{'serial_number':'manual','range':1,'is_manual':True},format='json')
            self.assertEqual(response.status_code,201)
            self.assertEqual(self.client.patch(f"/api/shunts/{response.data['id']}/",{'remark':'allowed'},format='json').status_code,200)
            self.assertEqual(self.client.post('/api/shunts/',{'serial_number':'fake-import','range':1,'is_manual':False},format='json').status_code,403)

    def test_setup_command_hashes_existing_choice_without_echoing_it(self):
        with tempfile.TemporaryDirectory() as folder, override_settings(CREDENTIALS_DIR=folder), patch.dict(os.environ,{PASSWORD_ENV:''}):
            output = io.StringIO()
            with patch('getpass.getpass', side_effect=[self.password,self.password]):
                call_command('configure_corrections_password',stdout=output)
            encoded = (Path(folder)/'corrections-admin-password.hash').read_text().strip()
            self.assertTrue(check_password(self.password,encoded))
            self.assertNotIn(self.password,encoded)
            self.assertNotIn(self.password,output.getvalue())
            self.assertEqual(self.authorize().status_code,200)
            with patch('getpass.getpass', side_effect=[self.password,'']), self.assertRaises(CommandError):
                call_command('configure_corrections_password',stdout=output)
            self.assertEqual((Path(folder)/'corrections-admin-password.hash').read_text().strip(),encoded)
