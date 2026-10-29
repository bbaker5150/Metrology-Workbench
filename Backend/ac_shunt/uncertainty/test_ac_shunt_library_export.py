import json
import tempfile
from io import StringIO
from pathlib import Path

from django.core.management import call_command, CommandError
from django.test import TestCase

from api.models import CalibrationSession, Shunt, ShuntReport, ShuntCorrection
from .ac_shunt_instruments import seed_ac_shunt_references, standard_type
from .models import Instrument, Session, Uut, TestPoint
from .serializers import instrument_to_dict


class ShuntLibraryExportTests(TestCase):
    databases = {'default', 'uncertainty'}

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.output = Path(self.temp.name) / 'shunts.json'
        self.shunt = Shunt.objects.create(model_name='A40B', serial_number='12345', range=.01)
        self.report = ShuntReport.objects.create(shunt=self.shunt, report_number='LAB-1')
        ShuntCorrection.objects.create(report=self.report, current=.005, frequency=60, uncertainty=100)
        ShuntCorrection.objects.create(report=self.report, current=.01, frequency=1000, uncertainty=100)
        seed_ac_shunt_references()
        self.original = Instrument.objects.get()
        Instrument.objects.create(id='duplicate', **{field: getattr(self.original, field) for field in
            ('manufacturer', 'model', 'description', 'functions', 'column_metadata')})
        Instrument.objects.create(id='local', scope='local', source_id=self.original.id, owner='bench')
        Instrument.objects.create(id='authored', model='A40B', description='12345 10 mA', functions=[])
        Instrument.objects.create(id='reader', model='5790B')

    def export(self, **kwargs):
        call_command('export_ac_shunt_library', output=str(self.output), stdout=StringIO(), **kwargs)
        return json.loads(self.output.read_text(encoding='utf-8'))

    def test_export_is_read_only_and_deduplicates_portable_definitions(self):
        before = list(Instrument.objects.values())
        data = self.export()
        self.assertEqual(list(Instrument.objects.values()), before)
        self.assertEqual(len(data['catalog']), 1)
        self.assertEqual(len(data['instruments']), 1)
        item = data['instruments'][0]
        self.assertEqual((item['model'], item['description']), ('A40B', '12345 10 mA CHECK STD'))
        self.assertEqual(item['functions'][0]['ranges'][1]['qualifier']['value'], 1000)
        self.assertEqual(data['catalog'][0]['report']['points'][0]['uncertaintyPpm'], 100)
        self.assertEqual(set(data['cleanupCandidateIds']), {self.original.id, 'duplicate', 'local'})

    def test_cleanup_backs_up_duplicates_and_leaves_authored_instruments_then_reseeds_once(self):
        backup = instrument_to_dict(self.original)
        data = self.export(clean_old_imports=True)
        self.assertIn(backup, data['previousLibraryEntries'])
        self.assertEqual(set(Instrument.objects.values_list('id', flat=True)), {'authored', 'reader'})
        self.assertEqual(seed_ac_shunt_references(), 1)
        self.assertEqual(seed_ac_shunt_references(), 0)
        self.assertEqual(Instrument.objects.get(pk=self.original.id).description, '12345 10 mA CHECK STD')

    def test_existing_or_unwritable_backup_prevents_deletion(self):
        self.output.write_text('preserve', encoding='utf-8')
        for output in [self.output, Path(self.temp.name) / 'missing' / 'export.json']:
            with self.assertRaises(CommandError):
                call_command('export_ac_shunt_library', output=str(output), clean_old_imports=True, stdout=StringIO())
        self.assertEqual(Instrument.objects.count(), 5)
        self.assertEqual(self.output.read_text(encoding='utf-8'), 'preserve')

    def test_classification_uses_catalog_values_even_when_old_labels_conflict(self):
        self.shunt.remark = 'NIST'
        self.assertEqual(standard_type(self.shunt, self.report), 'CHECK STD')
        self.shunt.remark = 'CHECK STD'
        ShuntCorrection.objects.filter(report=self.report).update(uncertainty=35)
        self.assertEqual(standard_type(self.shunt, self.report), 'NIST')
        ShuntCorrection.objects.filter(report=self.report).update(uncertainty=0)
        self.assertEqual(standard_type(self.shunt, self.report), 'NIST')
        self.shunt.remark = ''
        ShuntCorrection.objects.filter(report=self.report).update(uncertainty=None)
        self.assertEqual(standard_type(self.shunt, self.report), '')

    def test_legacy_certificate_import_is_backed_up_but_an_unrelated_reader_is_not(self):
        Instrument.objects.create(id='legacy', model='12345', description='A40B',
            functions=[{'ranges': [{'acShuntSource': {'certificates': [{'serial': '12345'}]}}]}])
        data = self.export(clean_old_imports=True)
        self.assertIn('legacy', data['cleanupCandidateIds'])
        self.assertTrue(Instrument.objects.filter(pk='reader').exists())

    def test_legacy_ti_is_identified_from_import_origin_without_deleting_saved_budgets(self):
        origin = CalibrationSession.objects.create(session_name='Original', test_instrument_model='A40B', test_instrument_serial='12345')
        session = Session.objects.create(id=123, name='Imported')
        TestPoint.objects.create(session=session, cid='p', test_point_info={'acShuntSource': {'sessionId': origin.pk}})
        for key, linked in [('legacy-ti', False), ('authored-linked-ti', True)]:
            Instrument.objects.create(id=key, model='12345', description='A40B')
            Uut.objects.create(session=session, cid=key, instrument={'id': key, 'model': '12345', 'description': 'A40B',
                **({'sourceId': 'original-shared'} if linked else {})})
        data = self.export(clean_old_imports=True)
        self.assertIn('legacy-ti', data['cleanupCandidateIds'])
        self.assertNotIn('authored-linked-ti', data['cleanupCandidateIds'])
        self.assertEqual(session.uuts.count(), 2)
        self.assertEqual(session.test_points.count(), 1)

    def test_empty_source_does_not_clear_old_entries(self):
        Shunt.objects.all().delete()
        with self.assertRaises(CommandError):
            self.export(clean_old_imports=True)
        self.assertEqual(Instrument.objects.count(), 5)
        self.assertFalse(self.output.exists())
