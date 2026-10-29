import copy
import json
import tempfile
from io import StringIO
from pathlib import Path

from django.core.management import call_command
from django.test import TestCase
from api.models import CalibrationSession, Shunt, ShuntReport, ShuntCorrection, TestPointSet, TestPoint
from .ac_shunt_instruments import catalog_record, seed_ac_shunt_references, seed_ac_shunt_test_instruments, shunt_catalog
from .management.commands.import_ac_shunt_library import prepare_definitions
from .models import Instrument
from .serializers import instrument_to_dict
from .shunt_identity import correction_aliases


class ShuntDeduplicationTests(TestCase):
    databases = {'default', 'uncertainty'}

    def make_shunt(self, serial, correction=1, uncertainty=100):
        shunt = Shunt.objects.create(model_name='Y5020', serial_number=serial, range=20)
        report = ShuntReport.objects.create(shunt=shunt)
        ShuntCorrection.objects.create(report=report, current=10, frequency=60, correction=correction, uncertainty=uncertainty)
        return report

    def catalog(self):
        return [catalog_record(*row) for row in shunt_catalog()]

    def test_only_complete_equal_corrections_and_uncertainties_establish_aliases(self):
        self.make_shunt('5965004')
        self.make_shunt('5965004-2')
        self.make_shunt('5965004-3', uncertainty=10)
        self.make_shunt('5965004 changed', correction=2)
        self.make_shunt('5965004 missing', correction=None)
        self.make_shunt('59650040')
        partial = self.make_shunt('5965004 partial')
        ShuntCorrection.objects.create(report=partial, current=20, frequency=60, correction=1, uncertainty=100)
        aliases = correction_aliases(self.catalog())
        self.assertEqual(set(aliases), {('Y5020', '5965004-2', 20)})
        self.assertEqual(aliases[('Y5020', '5965004-2', 20)]['serial'], '5965004')
        self.assertEqual(seed_ac_shunt_references(), 6)
        self.assertEqual(seed_ac_shunt_references(), 0)
        primary = Instrument.objects.get(description='5965004 20 A CHECK STD')
        self.assertEqual(primary.column_metadata['acShuntIdentity']['serialAliases'], ['5965004-2'])

    def test_existing_equal_duplicates_merge_and_local_copies_relink_without_touching_reports(self):
        self.make_shunt('5965004')
        report = self.make_shunt('5965004-2', correction=2)
        seed_ac_shunt_references()
        tagged = Instrument.objects.get(description='5965004-2 20 A CHECK STD')
        local = Instrument.objects.create(id='local', scope='local', source_id=tagged.id, functions=[{'custom': 'preserve'}])
        report.corrections.update(correction=1)
        seed_ac_shunt_references()
        self.assertEqual(Instrument.objects.filter(scope='validated').count(), 1)
        primary = Instrument.objects.get(scope='validated')
        local.refresh_from_db()
        self.assertEqual(local.source_id, primary.id)
        self.assertEqual(local.functions, [{'custom': 'preserve'}])
        self.assertEqual(ShuntReport.objects.count(), 2)
        # A later changed correction must become a separate definition again.
        report.corrections.update(correction=3)
        self.assertEqual(seed_ac_shunt_references(), 1)
        primary.refresh_from_db()
        self.assertEqual(primary.column_metadata['acShuntIdentity']['serialAliases'], [])

    def test_edited_library_uncertainties_are_not_discarded_as_duplicates(self):
        self.make_shunt('5965004')
        report = self.make_shunt('5965004-2', correction=2)
        seed_ac_shunt_references()
        item = Instrument.objects.get(description='5965004-2 20 A CHECK STD')
        item.functions[0]['ranges'][0]['tolerances']['reading']['high'] = 90
        item.save()
        report.corrections.update(correction=1)
        seed_ac_shunt_references()
        item.refresh_from_db()
        self.assertEqual(Instrument.objects.count(), 2)
        self.assertEqual(item.functions[0]['ranges'][0]['tolerances']['reading']['high'], 90)

    def test_only_tagged_library_copy_does_not_occupy_the_canonical_identity_permanently(self):
        self.make_shunt('5965004')
        report = self.make_shunt('5965004-2', correction=2)
        seed_ac_shunt_references()
        Instrument.objects.get(description='5965004 20 A CHECK STD').delete()
        report.corrections.update(correction=1)
        seed_ac_shunt_references()
        self.assertEqual(Instrument.objects.count(), 1)
        primary = Instrument.objects.get()
        self.assertEqual(primary.description, '5965004 20 A CHECK STD')
        report.corrections.update(correction=3)
        seed_ac_shunt_references()
        self.assertEqual(Instrument.objects.count(), 2)
        self.assertNotEqual(Instrument.objects.get(description='5965004-2 20 A CHECK STD').id, primary.id)

    def test_portable_import_uses_actual_corrections_and_can_complete_a_legacy_export_locally(self):
        self.make_shunt('5965004')
        report = self.make_shunt('5965004-2', correction=2)
        definitions = [instrument_to_dict(item) for item in seed_ac_shunt_references(export_only=True)]
        report.corrections.update(correction=1)
        catalog = self.catalog()
        payload = {'format': 'uncertalytics-ac-shunt-library', 'version': 1, 'catalog': catalog, 'instruments': definitions}
        result = prepare_definitions(payload)
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]['acShuntIdentity']['serialAliases'], ['5965004-2'])
        legacy = copy.deepcopy(payload)
        for row in legacy['catalog']:
            for point in row['report']['points']:
                del point['correctionPpm']
        self.assertEqual(len(prepare_definitions(legacy)), 2)
        self.assertEqual(len(prepare_definitions(legacy, live_catalog=catalog)), 1)
        legacy['catalog'][1]['report']['id'] = -1
        self.assertEqual(len(prepare_definitions(legacy, live_catalog=catalog)), 2)

    def test_ti_sessions_using_proven_aliases_share_one_definition_and_all_measurement_points(self):
        self.make_shunt('5965004')
        self.make_shunt('5965004-2')
        for index, serial in enumerate(('5965004', '5965004-2'), 1):
            session = CalibrationSession.objects.create(session_name=serial, test_instrument_model='Y5020', test_instrument_serial=serial)
            points = TestPointSet.objects.create(session=session)
            TestPoint.objects.create(test_point_set=points, current=index * 10, frequency=60, direction='Forward')
        self.assertEqual(seed_ac_shunt_test_instruments(), 1)
        item = Instrument.objects.get()
        self.assertEqual(item.description, '5965004 20 A CHECK STD')
        self.assertEqual([row['value'] for row in item.functions[0]['ranges']], [10, 20])
        self.assertEqual(item.column_metadata['acShuntIdentity']['serialAliases'], ['5965004-2'])

    def test_same_serial_on_different_models_does_not_merge_or_collide(self):
        self.make_shunt('5965004')
        shunt = Shunt.objects.create(model_name='A40B', serial_number='5965004', range=20, is_manual=True)
        report = ShuntReport.objects.create(shunt=shunt)
        ShuntCorrection.objects.create(report=report, current=10, frequency=60, correction=1, uncertainty=100)
        self.assertEqual(seed_ac_shunt_references(), 2)
        self.assertEqual(seed_ac_shunt_references(), 0)
        self.assertEqual(set(Instrument.objects.values_list('model', flat=True)), {'A40B', 'Y5020'})

    def test_import_command_checks_live_corrections_then_removes_existing_equal_alias(self):
        self.make_shunt('5965004')
        report = self.make_shunt('5965004-2', correction=2)
        seed_ac_shunt_references()
        definitions = [instrument_to_dict(item) for item in Instrument.objects.all()]
        report.corrections.update(correction=1)
        catalog = self.catalog()
        for row in catalog:
            for point in row['report']['points']:
                del point['correctionPpm']
        payload = {'format':'uncertalytics-ac-shunt-library', 'version':1, 'catalog':catalog, 'instruments':definitions}
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'legacy.json'
            path.write_text(json.dumps(payload), encoding='utf-8')
            for _ in range(2):
                call_command('import_ac_shunt_library', input=str(path), stdout=StringIO())
                self.assertEqual(Instrument.objects.count(), 1)
        self.assertEqual(Instrument.objects.get().description, '5965004 20 A CHECK STD')
