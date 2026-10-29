import copy
import json
import tempfile
from io import StringIO
from pathlib import Path
from unittest.mock import patch

from django.core.management import call_command
from django.test import TestCase

from api.models import CalibrationSession, Shunt, ShuntReport, ShuntCorrection, TestPointSet, TestPoint
from .ac_shunt_instruments import catalog_record, seed_ac_shunt_references, seed_ac_shunt_test_instruments, shunt_catalog
from .ac_shunt_library_cleanup import remove_unsupported_generated_instruments
from .management.commands.import_ac_shunt_library import prepare_definitions
from .models import Instrument, Session, Uut
from .serializers import instrument_to_dict
from .shunt_identity import reported_uncertainty_points


class ShuntEligibilityTests(TestCase):
    databases = {'default', 'uncertainty'}

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)
        self.settings_override = self.settings(CREDENTIALS_DIR=self.directory)
        self.settings_override.enable()
        self.addCleanup(self.settings_override.disable)

    def make_report(self, serial='12345', uncertainty=100):
        shunt = Shunt.objects.create(model_name='A40B', serial_number=serial, range=1)
        report = ShuntReport.objects.create(shunt=shunt, report_number='LAB-1')
        ShuntCorrection.objects.create(report=report, current=1, frequency=60, correction=1, uncertainty=uncertainty)
        return report

    def make_session(self, serial='12345'):
        session = CalibrationSession.objects.create(session_name=serial, test_instrument_model='A40B', test_instrument_serial=serial)
        points = TestPointSet.objects.create(session=session)
        TestPoint.objects.create(test_point_set=points, current=1, frequency=60, direction='Forward')
        return session

    def legacy_ti(self):
        return Instrument.objects.create(id='ac-shunt-ti-' + 'f' * 32, manufacturer='Fluke', model='A40B',
            description='MISSING 1 A', instrument_type='uut',
            column_metadata={'acShuntIdentity': {'model': 'A40B', 'serial': 'MISSING', 'shuntRange': 1,
                                               'standardType': '', 'role': 'uut', 'namingVersion': 2}},
            functions=[{'name': 'Current', 'unit': 'A', 'ranges': [{'value': 1, 'unit': 'A',
                'qualifier': {'value': 60, 'unit': 'Hz'}, 'source': 'Lab TI requirement',
                'tolerances': {'reading': {'high': 100, 'low': -100, 'unit': 'ppm'}}}]}])

    def catalog(self):
        return [catalog_record(*row) for row in shunt_catalog()]

    def test_missing_reports_labels_and_invalid_uncertainties_do_not_create_instruments(self):
        self.make_session('NO-CATALOG')
        for serial in ('NO-REPORT', 'EMPTY', 'UNKNOWN', 'NEGATIVE'):
            self.make_session(serial)
        Shunt.objects.create(model_name='A40B', serial_number='NO-REPORT', range=1, remark='CHECK STD')
        empty = Shunt.objects.create(model_name='A40B', serial_number='EMPTY', range=1, remark='NIST')
        ShuntReport.objects.create(shunt=empty, report_number='EMPTY-REPORT')
        self.make_report('UNKNOWN', uncertainty=None)
        self.make_report('NEGATIVE', uncertainty=-1)
        self.assertEqual(seed_ac_shunt_references(), 0)
        self.assertEqual(seed_ac_shunt_test_instruments(), 0)
        output = self.directory / 'export.json'
        call_command('export_ac_shunt_library', output=str(output), stdout=StringIO())
        data = json.loads(output.read_text(encoding='utf-8'))
        self.assertEqual(data['instruments'], [])
        self.assertEqual(len(data['catalog']), 4)
        self.assertEqual(Instrument.objects.count(), 0)

    def test_valid_zero_uncertainty_counts_but_missing_invalid_values_do_not(self):
        for value in (None, -1, float('inf'), float('nan'), True, 'missing'):
            self.assertEqual(reported_uncertainty_points({'report': {'points': [
                {'currentA': 1, 'frequencyHz': 60, 'uncertaintyPpm': value}]}}), [])
        self.make_report(uncertainty=0)
        self.make_session()
        self.make_session('12345-2')  # Unverified tag does not establish report evidence.
        self.assertEqual(seed_ac_shunt_references(), 1)
        self.assertEqual(seed_ac_shunt_test_instruments(), 1)
        uut = Instrument.objects.get(instrument_type='uut')
        self.assertEqual(uut.description, '12345 1 A NIST')
        self.assertEqual(uut.functions[0]['ranges'][0]['tolerances']['reading']['high'], 100)
        evidence = uut.column_metadata['acShuntIdentity']['calibrationEvidence'][0]
        self.assertEqual(evidence['report']['points'][0]['uncertaintyPpm'], 0)

    def test_portable_import_excludes_unsupported_tis_even_with_a_label_and_100_ppm(self):
        self.make_report()
        good = instrument_to_dict(seed_ac_shunt_references(export_only=True)[0])
        bad = instrument_to_dict(self.legacy_ti())
        bad['acShuntIdentity']['standardType'] = 'CHECK STD'
        bad['acShuntIdentity']['calibrationEvidence'] = self.catalog()  # Another serial is not proof.
        payload = {'format': 'uncertalytics-ac-shunt-library', 'version': 1,
                   'catalog': self.catalog(), 'instruments': [good, bad]}
        original = copy.deepcopy(payload)
        excluded = []
        prepared = prepare_definitions(payload, excluded=excluded)
        self.assertEqual([item['id'] for item in prepared], [good['id']])
        self.assertEqual([item['id'] for item in excluded], [bad['id']])
        self.assertEqual(payload, original)
        payload['catalog'] = []
        self.assertEqual(prepare_definitions(payload), [])
        self.assertEqual(len(prepare_definitions(payload, live_catalog=self.catalog())), 1)

    def test_seed_cleanup_backs_up_unsupported_entries_and_preserves_authored_data_and_budgets(self):
        self.make_report()
        self.make_session()
        self.make_session('MISSING')
        legacy = self.legacy_ti()
        snapshot = instrument_to_dict(legacy)
        Instrument.objects.create(id='local', scope='local', source_id=legacy.id, functions=[{'edited': True}])
        Instrument.objects.create(id='authored', model='A40B', description='MISSING 1 A')
        saved = Session.objects.create(id=1, name='Keep saved budget')
        Uut.objects.create(session=saved, cid='uut', instrument=snapshot)
        for _ in range(2):
            call_command('seed_ac_shunt_references', stdout=StringIO())
        self.assertEqual(Instrument.objects.count(), 3)  # Supported reference/TI + authored item.
        self.assertFalse(Instrument.objects.filter(pk__in=[legacy.id, 'local']).exists())
        backups = list((self.directory / 'backups').glob('*.json'))
        self.assertEqual(len(backups), 1)
        backup = json.loads(backups[0].read_text(encoding='utf-8'))
        self.assertEqual({row['id'] for row in backup['previousLibraryEntries']}, {legacy.id, 'local'})
        self.assertIn(snapshot, backup['previousLibraryEntries'])
        self.assertEqual(Uut.objects.get().instrument, snapshot)
        self.assertEqual(CalibrationSession.objects.count(), 2)
        self.assertEqual(ShuntReport.objects.count(), 1)

    def test_backup_failure_leaves_unsupported_library_entries_intact(self):
        legacy = self.legacy_ti()
        with patch('uncertainty.ac_shunt_library_cleanup.Path.open', side_effect=OSError('Backup blocked')):
            with self.assertRaises(OSError):
                remove_unsupported_generated_instruments([])
        self.assertTrue(Instrument.objects.filter(pk=legacy.id).exists())

    def test_import_dry_run_preserves_excluded_entry_then_import_backs_up_and_removes_it(self):
        legacy = self.legacy_ti()
        payload = {'format': 'uncertalytics-ac-shunt-library', 'version': 1,
                   'catalog': [], 'instruments': [instrument_to_dict(legacy)]}
        path = self.directory / 'reviewed.json'
        path.write_text(json.dumps(payload), encoding='utf-8')
        output = StringIO()
        call_command('import_ac_shunt_library', input=str(path), dry_run=True, stdout=output)
        self.assertIn('no reported calibration uncertainty', output.getvalue())
        self.assertTrue(Instrument.objects.filter(pk=legacy.id).exists())
        call_command('import_ac_shunt_library', input=str(path), stdout=StringIO())
        self.assertFalse(Instrument.objects.filter(pk=legacy.id).exists())
        self.assertEqual(len(list((self.directory / 'backups').glob('*.json'))), 1)

    def test_portable_report_evidence_survives_without_local_catalog(self):
        self.make_report()
        self.make_session()
        seed_ac_shunt_references()
        seed_ac_shunt_test_instruments()
        # Stored report evidence permits a portable installation on a computer
        # without AC-shunt source tables; lab tolerance alone never does.
        self.assertEqual(remove_unsupported_generated_instruments([]), (0, None))
        self.assertEqual(Instrument.objects.count(), 2)

    def test_legacy_tmde_report_uncertainties_remain_valid_evidence(self):
        self.make_report()
        seed_ac_shunt_references()
        item = Instrument.objects.get()
        item.column_metadata['acShuntIdentity'].pop('calibrationEvidence')
        item.save()
        self.assertEqual(remove_unsupported_generated_instruments([]), (0, None))
        item.functions[0]['ranges'][0]['tolerances'] = {}
        item.save()
        self.assertEqual(remove_unsupported_generated_instruments([])[0], 1)
