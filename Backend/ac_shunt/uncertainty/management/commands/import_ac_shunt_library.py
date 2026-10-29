"""Install reviewed portable shunt definitions without replacing library edits."""
import copy
import json
import math
import re
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError
from django.db import router, transaction

from uncertainty.ac_shunt_instruments import instrument_identity, matches_instrument, rename_instrument_once
from uncertainty.models import Instrument
from uncertainty.serializers import save_instrument


def prepare_definitions(payload):
    """Validate the whole file before writing, and recover missing catalog ratings."""
    if not isinstance(payload, dict) or payload.get('format') != 'uncertalytics-ac-shunt-library' or payload.get('version') != 1:
        raise ValueError('Expected a version 1 AC-shunt library export.')
    definitions = copy.deepcopy(payload.get('instruments'))
    if not isinstance(definitions, list) or not definitions:
        raise ValueError('The export contains no instrument definitions.')
    seen_ids, seen_identities = set(), set()
    for item in definitions:
        identity = item['acShuntIdentity']
        model, serial, role = identity['model'], identity['serial'], identity['role']
        if model not in ('A40B', 'Y5020') or not isinstance(serial, str) or not serial.strip() or role not in ('tmde', 'uut'):
            raise ValueError('Every definition must identify an A40B/Y5020, serial and instrument role.')
        if item.get('type') != role or item.get('scope') != 'validated':
            raise ValueError('Instrument type/scope does not match its shared library identity.')
        prefix = 'ref' if role == 'tmde' else 'ti'
        if not re.fullmatch(rf'ac-shunt-{prefix}-[0-9a-f]{{32}}', item['id']) or item['id'] in seen_ids:
            raise ValueError('Invalid or duplicate instrument ID.')
        seen_ids.add(item['id'])
        if role == 'uut' and identity.get('shuntRange') is None:
            ratings = {row['rangeA'] for row in payload.get('catalog', [])
                       if row['model'] == model and row['serial'].strip().casefold() == serial.strip().casefold()}
            if len(ratings) == 1:
                identity['shuntRange'] = ratings.pop()
        rating = identity.get('shuntRange')
        if rating is not None and (isinstance(rating, bool) or not math.isfinite(float(rating)) or float(rating) <= 0):
            raise ValueError('Invalid physical shunt range.')
        identity['shuntRange'] = float(rating) if rating is not None else None
        label = identity.get('standardType', '')
        if label not in ('', 'CHECK STD', 'NIST'):
            raise ValueError('Invalid standard classification.')
        key = (model, serial.strip().casefold(), role, identity['shuntRange'] if role == 'tmde' else None)
        if key in seen_identities:
            raise ValueError('Duplicate physical instrument/role in the export.')
        seen_identities.add(key)
        item.update(instrument_identity(model, serial, identity['shuntRange'], label))
        item.update(owner='', sourceId='', localOverride=False, validatedSnapshot=None)
        identity['namingVersion'] = 2
        if not isinstance(item.get('functions'), list) or not item['functions']:
            raise ValueError('Missing instrument function definitions.')
        for function in item['functions']:
            if function.get('unit') != 'A' or not isinstance(function.get('ranges'), list):
                raise ValueError('Expected current ranges in amperes.')
            for row in function['ranges']:
                qualifier = row['qualifier']
                if row.get('unit') != 'A' or qualifier.get('unit') != 'Hz':
                    raise ValueError('Every measurement point needs current and frequency units.')
                for value in (row['value'], qualifier['value']):
                    if isinstance(value, bool) or not math.isfinite(float(value)) or float(value) <= 0:
                        raise ValueError('Invalid current/frequency measurement point.')
                reading = row.get('tolerances', {}).get('reading')
                if reading is not None and (reading.get('unit') != 'ppm'
                        or not math.isfinite(float(reading['high'])) or float(reading['high']) < 0
                        or not math.isfinite(float(reading['low'])) or float(reading['low']) > 0):
                    raise ValueError('Invalid ppm uncertainty.')
                row['acShuntSource'] = {**row.get('acShuntSource', {}),
                    'model': model, 'serial': serial, 'shuntRange': identity['shuntRange'], 'standardType': label}
    return definitions


class Command(BaseCommand):
    help = 'Install reviewed AC-shunt export definitions once, preserving existing library definitions and sessions.'

    def add_arguments(self, parser):
        parser.add_argument('--input', required=True, help='Reviewed AC-shunt library JSON export.')
        parser.add_argument('--dry-run', action='store_true', help='Validate and report names without changing the library.')

    def handle(self, *args, **options):
        try:
            payload = json.loads(Path(options['input']).expanduser().read_text(encoding='utf-8-sig'))
            definitions = prepare_definitions(payload)
        except (OSError, ValueError, KeyError, TypeError, AttributeError) as error:
            raise CommandError(f'Invalid export; library unchanged: {error}') from error
        if options['dry_run']:
            for item in definitions:
                self.stdout.write(f"{item['type'].upper()}: {item['manufacturer']} {item['model']} {item['description']}")
            self.stdout.write(f'Validated {len(definitions)} definitions. Library unchanged.')
            return
        created, retained = 0, 0
        alias = router.db_for_write(Instrument)
        with transaction.atomic(using=alias):
            existing = list(Instrument.objects.using(alias).select_for_update().all())
            for item in definitions:
                source = item['acShuntIdentity']
                matches = [old for old in existing if old.scope == Instrument.SCOPE_VALIDATED
                           and old.instrument_type == item['type'] and matches_instrument(old, source['model'], source['serial'],
                               source['shuntRange'] if item['type'] == 'tmde' else None)]
                collision = next((old for old in existing if old.id == item['id']), None)
                if collision and collision not in matches:
                    raise CommandError(f"Conflicting existing ID {item['id']}; no definitions imported.")
                if matches:
                    for old in matches:
                        rename_instrument_once(old, source['model'], source['serial'], source['shuntRange'], source['standardType'], item['type'])
                    retained += 1
                else:
                    existing.append(save_instrument(item))
                    created += 1
        self.stdout.write(self.style.SUCCESS(f'Created {created} instruments; retained {retained} existing definitions. Saved budgets unchanged.'))
