import copy
import json
import tempfile
from io import StringIO
from pathlib import Path
from unittest.mock import patch

from django.core.management import call_command
from django.test import TestCase
from api.models import Shunt, ShuntReport, ShuntCorrection
from .ac_shunt_instruments import catalog_record, seed_ac_shunt_references, shunt_catalog, standard_type
from .ac_shunt_roles import consolidate_library_roles, default_ti_functions
from .management.commands.import_ac_shunt_library import prepare_definitions
from .models import Instrument, Session, Uut
from .serializers import instrument_to_dict, save_instrument


class ShuntManualRoleTests(TestCase):
    databases = {'default', 'uncertainty'}

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        override = self.settings(CREDENTIALS_DIR=Path(self.temp.name))
        override.enable()
        self.addCleanup(override.disable)

    def report(self, manual=False, serial='450274742', uncertainty=22, notes='Baseline'):
        shunt = Shunt.objects.create(model_name='A40B', serial_number=serial, range=5, is_manual=manual)
        report = ShuntReport.objects.create(shunt=shunt, notes=notes)
        ShuntCorrection.objects.create(report=report, current=3, frequency=1000, correction=1, uncertainty=uncertainty)
        return shunt, report

    def test_manual_overrides_label_even_at_100_ppm_and_baseline_remains_separate(self):
        base, base_report = self.report()
        manual, report = self.report(True, uncertainty=100, notes='Temp corrections from session #93')
        self.assertEqual(standard_type(manual, report), 'MANUAL')
        self.assertEqual(standard_type(base, base_report), 'NIST')
        self.assertEqual(seed_ac_shunt_references(), 2)
        self.assertEqual(seed_ac_shunt_references(), 0)
        self.assertEqual(set(Instrument.objects.values_list('description', flat=True)),
                         {'450274742 5 A MANUAL', '450274742 5 A NIST'})
        self.assertEqual({item.functions[0]['ranges'][0]['tolerances']['reading']['high'] for item in Instrument.objects.all()}, {22, 100})

    def test_copied_or_temporary_corrections_are_manual_without_guessing_from_uncertainty(self):
        shunt, report = self.report(notes='20A copied from 18A')
        self.assertEqual(standard_type(shunt, report), 'MANUAL')
        for notes in ('Temp corrections from session #79', 'Used 10A corrections for 14A'):
            report.notes = notes
            self.assertEqual(standard_type(shunt, report), 'MANUAL')
        report.notes = 'Imported baseline (pre-history). Date unknown.'
        self.assertEqual(standard_type(shunt, report), 'NIST')
        report.corrections.update(uncertainty=100)
        self.assertEqual(standard_type(shunt, report), 'CHECK STD')

    def test_old_manual_reference_id_does_not_block_baseline_creation_and_auto_name_is_repaired(self):
        self.report()
        manual, report = self.report(True, notes='Temporary corrections')
        seed_ac_shunt_references()
        baseline = Instrument.objects.get(description='450274742 5 A NIST')
        manual_item = Instrument.objects.get(description='450274742 5 A MANUAL')
        data = instrument_to_dict(manual_item)
        old_id = baseline.id
        Instrument.objects.all().delete()
        data['id'] = old_id
        data['description'] = '450274742 5 A NIST'
        data['acShuntIdentity'].update(namingVersion=2, standardType='NIST')
        data['acShuntIdentity'].pop('isManual')
        save_instrument(data)
        seed_ac_shunt_references()
        seed_ac_shunt_references()
        self.assertEqual(Instrument.objects.count(), 2)
        self.assertEqual(Instrument.objects.get(pk=old_id).description, '450274742 5 A MANUAL')
        self.assertTrue(Instrument.objects.filter(description='450274742 5 A NIST').exists())

    def test_same_serial_duplicate_reference_and_ti_consolidate_once_with_backup(self):
        self.report()
        seed_ac_shunt_references()
        ref = Instrument.objects.get()
        duplicate = instrument_to_dict(ref)
        duplicate['id'] = 'ac-shunt-ref-' + 'e' * 32
        save_instrument(duplicate)
        ti = instrument_to_dict(ref)
        ti.update(id='ac-shunt-ti-' + 'd' * 32, type='uut', functions=default_ti_functions(ti))
        ti['acShuntIdentity']['role'] = 'uut'
        save_instrument(ti)
        session = Session.objects.create(id=1)
        Uut.objects.create(session=session, cid='saved', instrument=ti)
        call_command('seed_ac_shunt_references', stdout=StringIO())
        call_command('seed_ac_shunt_references', stdout=StringIO())
        self.assertEqual(Instrument.objects.count(), 1)
        ref.refresh_from_db()
        self.assertEqual(ref.functions[0]['ranges'][0]['tolerances']['reading']['high'], 22)
        self.assertEqual(ref.column_metadata['acShuntIdentity']['uutFunctions'][0]['ranges'][0]['tolerances']['reading']['high'], 100)
        self.assertEqual(Uut.objects.get().instrument, ti)
        backups = list((Path(self.temp.name) / 'backups').glob('ac-shunt-roles-*.json'))
        self.assertEqual(len(backups), 1)
        self.assertIn(ti['id'], {item['id'] for item in json.loads(backups[0].read_text())['previousLibraryEntries']})
        # Syncing an unchanged old saved budget cannot recreate the retired TI.
        ti['functions'][0]['ranges'][0]['tolerances']['reading']['high'] = 95
        synced = save_instrument(ti)
        self.assertEqual(synced.id, ref.id)
        self.assertEqual(Instrument.objects.count(), 1)
        self.assertEqual(synced.functions[0]['ranges'][0]['tolerances']['reading']['high'], 22)
        self.assertEqual(synced.column_metadata['acShuntIdentity']['uutFunctions'][0]['ranges'][0]['tolerances']['reading']['high'], 95)

    def test_role_cleanup_does_not_delete_when_backup_fails(self):
        self.report()
        seed_ac_shunt_references()
        ti = instrument_to_dict(Instrument.objects.get())
        ti.update(id='ac-shunt-ti-' + 'd' * 32, type='uut', functions=default_ti_functions(ti))
        ti['acShuntIdentity']['role'] = 'uut'
        save_instrument(ti)
        with patch('uncertainty.ac_shunt_library_cleanup.Path.open', side_effect=OSError('blocked')):
            with self.assertRaises(OSError):
                consolidate_library_roles()
        self.assertEqual(Instrument.objects.count(), 2)

    def test_old_export_recovers_manual_flag_and_consolidates_roles(self):
        self.report(True, notes='Fluke Report')
        seed_ac_shunt_references()
        ref = instrument_to_dict(Instrument.objects.get())
        ref['acShuntIdentity'].pop('isManual')
        ref['acShuntIdentity']['standardType'] = 'NIST'
        ti = copy.deepcopy(ref)
        ti.update(id='ac-shunt-ti-' + 'd' * 32, type='uut', functions=default_ti_functions(ti))
        ti['acShuntIdentity']['role'] = 'uut'
        catalog = [catalog_record(*row) for row in shunt_catalog()]
        old_catalog = copy.deepcopy(catalog)
        old_catalog[0].pop('isManual')
        payload = {'format':'uncertalytics-ac-shunt-library','version':1,'catalog':old_catalog,'instruments':[ref, ti]}
        result = prepare_definitions(payload, live_catalog=catalog)
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]['description'], '450274742 5 A MANUAL')
        self.assertEqual(result[0]['acShuntIdentity']['roles'], ['tmde', 'uut'])

    def test_saving_ti_profile_cannot_replace_reference_uncertainties(self):
        self.report()
        seed_ac_shunt_references()
        consolidate_library_roles()
        item = Instrument.objects.get()
        data = instrument_to_dict(item)
        data['type'] = 'uut'
        data['acShuntIdentity']['usageRole'] = 'uut'
        data['functions'] = copy.deepcopy(data['acShuntIdentity']['uutFunctions'])
        data['functions'][0]['ranges'][0]['tolerances']['reading']['high'] = 90
        save_instrument(data)
        item.refresh_from_db()
        self.assertEqual(item.instrument_type, 'tmde')
        self.assertEqual(item.functions[0]['ranges'][0]['tolerances']['reading']['high'], 22)
        self.assertEqual(item.column_metadata['acShuntIdentity']['uutFunctions'][0]['ranges'][0]['tolerances']['reading']['high'], 90)
