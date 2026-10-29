import json
import tempfile
from pathlib import Path
from unittest.mock import patch

from django.test import TestCase, override_settings
from .models import Instrument
from .fluke5790_resolution import seed_5790_resolution, resolution_profile, apply_profile, RANGES
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
        self.assertEqual(len(item.functions), 1)
        backup = json.loads(next((self.directory / 'backups').glob('*.json')).read_text(encoding='utf-8'))
        self.assertEqual(backup['previousLibraryEntries'][0], before)
        row['measuringResolution'] = 2e-7
        save_instrument(instrument_to_dict(item))
        self.assertEqual(seed_5790_resolution(), 0)
        item.refresh_from_db()
        self.assertEqual(item.functions[0]['ranges'][0]['measuringResolution'], 2e-7)

    def test_existing_local_and_shared_ppm_ranges_gain_resolution_without_extra_functions(self):
        functions = [{'id': 'ppm', 'name': 'Current', 'unit': 'ppm', 'ranges': [{'id': 'old', 'max': 200,
            'unit': 'ppm', 'tolerances': {'floor': {'high': 5, 'unit': 'ppm'}}}]}]
        for model, scope in [('5790A', 'validated'), ('5790B', 'local')]:
            Instrument.objects.create(id=model, model=model, scope=scope, owner='bench-1', functions=functions)
        self.assertEqual(seed_5790_resolution(), 2)
        for item in Instrument.objects.all():
            self.assertEqual(len(item.functions), 1)
            self.assertEqual(item.functions[0]['id'], 'ppm')
            row = item.functions[0]['ranges'][0]
            self.assertEqual(row['id'], 'old')
            self.assertEqual(row['max'], 200)
            self.assertEqual(row['unit'], 'ppm')
            self.assertEqual(row['tolerances'], functions[0]['ranges'][0]['tolerances'])
            self.assertEqual(row['measuringResolution'], 1e-7)
            self.assertEqual(row['measuringResolutionUnit'], 'V')
            self.assertEqual(item.column_metadata['fluke5790ResolutionVersion'], 2)
        self.assertEqual(Instrument.objects.count(), 2)

    def test_repairs_v1_setup_and_removes_only_untouched_generated_functions(self):
        existing = {'id': 'ppm', 'name': 'AC/DC Difference', 'unit': 'ppm',
            'ranges': [{'id': 'original', 'max': 200, 'unit': 'ppm', 'tolerances': {}}]}
        generated = []
        for mode in ('AC', 'DC'):
            ranges = []
            for bound in RANGES:
                if mode == 'DC' and bound < .22:
                    continue
                row = {'id': f'5790-resolution-{mode}-{bound:g}', 'min': 0, 'max': bound, 'unit': 'V', 'tolerances': {}}
                apply_profile(row, resolution_profile('5790B', bound))
                ranges.append(row)
            generated.append({'id': f'5790-resolution-{mode}', 'name': f'{mode} Voltage', 'unit': 'V', 'ranges': ranges})
        generated[1]['ranges'][0]['measuringResolution'] = 8e-7  # User edit survives repair.
        item = Instrument.objects.create(id='v1', model='5790B', functions=[existing, *generated],
            column_metadata={'fluke5790ResolutionVersion': 1})
        self.assertEqual(seed_5790_resolution(), 1)
        item.refresh_from_db()
        self.assertEqual([fn['id'] for fn in item.functions], ['ppm', '5790-resolution-DC'])
        self.assertEqual(item.functions[0]['ranges'][0]['measuringResolution'], 1e-7)
        self.assertEqual(item.functions[1]['ranges'][0]['measuringResolution'], 8e-7)
        self.assertEqual(seed_5790_resolution(), 0)

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
        component = {'id': 'resolution', 'type': 'B', 'isResolution': True,
            'tmdeBudgetSourceId': 'reader', 'tmdeBudgetRangeId': 'existing-200-ppm',
            'tmdeBudgetComponentKind': 'Resolution', 'acShuntResolution': {'ppmPerVolt': 4e6}}
        data = {'id': 12349, 'name': 'Resolution', 'testPoints': [{'id': 'point', 'components': [component]}]}
        for _ in range(2):
            data = session_to_dict(save_session(data))
            for key, value in component.items():
                self.assertEqual(data['testPoints'][0]['components'][0][key], value)
