import json
import tempfile
from pathlib import Path
from unittest.mock import patch

from django.test import TestCase, override_settings
from .models import Instrument
from .fluke5790_resolution import seed_5790_resolution, resolution_profile
from .serializers import instrument_to_dict, save_instrument, save_session, session_to_dict


class ReaderResolutionSetupTests(TestCase):
    databases = {'default', 'uncertainty'}

    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.directory = Path(directory.name)
        override = override_settings(CREDENTIALS_DIR=self.directory)
        override.enable()
        self.addCleanup(override.disable)

    def test_existing_ranges_updated_once_with_backup_and_specs_preserved(self):
        item = Instrument.objects.create(id='5790', manufacturer='Fluke', model='5790B',
            scope='validated', functions=[{'id': 'ac', 'name': 'AC Voltage', 'unit': 'V', 'ranges': [
                {'id': 'range', 'max': 2.2, 'unit': 'V', 'tolerances': {
                    'reading': {'high': 35, 'unit': 'ppm', 'distribution': '1.960'},
                    'resolution': 99, 'resolutionUnit': 'ppm', 'includeResolutionInBudget': False}}]}])
        before = instrument_to_dict(item)
        self.assertEqual(seed_5790_resolution(), 1)
        item.refresh_from_db()
        row = item.functions[0]['ranges'][0]
        self.assertEqual(row['id'], 'range')
        self.assertEqual(row['tolerances'], {'reading': {'high': 35, 'unit': 'ppm', 'distribution': '1.960'}})
        self.assertEqual(row['measuringResolution'], 1e-7)
        self.assertEqual(row['measuringResolutionUnit'], 'V')
        self.assertEqual(row['measuringResolutionDistribution'], '3.464')
        self.assertTrue(row['includeResolutionInBudget'])
        self.assertEqual(item.functions[1]['name'], 'DC Voltage')
        backup = json.loads(next((self.directory / 'backups').glob('*.json')).read_text(encoding='utf-8'))
        self.assertEqual(backup['previousLibraryEntries'][0], before)
        row['measuringResolution'] = 2e-7
        save_instrument(instrument_to_dict(item))
        self.assertEqual(seed_5790_resolution(), 0)
        item.refresh_from_db()
        self.assertEqual(item.functions[0]['ranges'][0]['measuringResolution'], 2e-7)

    def test_old_ppm_entry_gains_voltage_ranges_without_losing_variability(self):
        functions = [{'id': 'ppm', 'name': 'Current', 'unit': 'ppm', 'ranges': [{'id': 'old', 'max': 200,
            'unit': 'ppm', 'tolerances': {'floor': {'high': 5, 'unit': 'ppm'}}}]}]
        for model in ('5790A', '5790B'):
            Instrument.objects.create(id=model, model=model, scope='validated', functions=functions)
        self.assertEqual(seed_5790_resolution(), 2)
        for item in Instrument.objects.all():
            self.assertEqual(item.functions[0], functions[0])
            self.assertEqual([fn['name'] for fn in item.functions[1:]], ['AC Voltage', 'DC Voltage'])
            self.assertEqual(min(row['max'] for row in item.functions[2]['ranges']), .22)
            for fn in item.functions[1:]:
                for row in fn['ranges']:
                    self.assertFalse(row['tolerances'])
                    self.assertIn('source', row['fluke5790Resolution'])
        self.assertEqual(Instrument.objects.count(), 2)

    def test_only_supported_readers_and_ranges_are_changed(self):
        Instrument.objects.create(id='other', model='34420A', functions=[])
        self.assertEqual(seed_5790_resolution(), 0)
        self.assertIsNone(resolution_profile('5790A', .0022))
        self.assertIsNone(resolution_profile('5790B', 2000))
        self.assertEqual(resolution_profile('5790B', .22)['normalResolutionVolts'], 1e-7)
        self.assertEqual(resolution_profile('5790B', 2.2)['normalResolutionVolts'], 1e-6)
        self.assertEqual(resolution_profile('5790A', 22)['highResolutionVolts'], 1e-6)

    def test_failed_backup_prevents_update(self):
        item = Instrument.objects.create(id='reader', model='5790B', functions=[])
        with patch('uncertainty.fluke5790_resolution.backup_instruments', side_effect=OSError('backup failed')):
            with self.assertRaises(OSError):
                seed_5790_resolution()
        item.refresh_from_db()
        self.assertEqual(item.functions, [])

    def test_linked_resolution_sources_and_provenance_survive_save(self):
        component = {'id': 'resolution', 'type': 'B', 'isResolution': True, 'tmdeTransferOutputUnit': 'ppm',
            'tmdeTransferSources': [{'sourceId': 'reader', 'rangeId': 'range', 'functionId': 'AC',
                'nominal': {'value': 1, 'unit': 'V'}, 'sensitivity': 5, 'resolutionMultiplier': 10,
                'role': 'std', 'direction': 'Forward:1', 'settings': {'hiresEnabled': False, 'filterMode': 'FAST'}}],
            'acShuntSource': {'sessionId': 1, 'resolutionMethod': 'conservative phase sum'}}
        data = {'id': 12349, 'name': 'Resolution', 'testPoints': [{'id': 'point', 'components': [component]}]}
        for _ in range(2):
            data = session_to_dict(save_session(data))
            for key, value in component.items():
                self.assertEqual(data['testPoints'][0]['components'][0][key], value)
