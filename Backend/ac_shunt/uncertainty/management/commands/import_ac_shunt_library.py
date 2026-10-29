"""Install reviewed portable shunt definitions without replacing library edits."""
import copy
import json
import math
import re
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError
from django.db import router, transaction

from uncertainty.ac_shunt_instruments import (
    catalog_record, instrument_identity, matches_instrument, rename_instrument_once,
    remember_calibration_evidence, retain_canonical_instrument, shunt_catalog,
)
from uncertainty.ac_shunt_library_cleanup import remove_unsupported_generated_instruments
from uncertainty.shunt_identity import (catalog_key, correction_aliases, definition_signature,
    matching_uncertainty_records, reported_uncertainty_points, serial_aliases)
from uncertainty.models import Instrument
from uncertainty.serializers import save_instrument


def prepare_definitions(payload, *, live_catalog=None, excluded=None):
    """Validate the whole file before writing, and recover missing catalog ratings."""
    if not isinstance(payload, dict) or payload.get('format') != 'uncertalytics-ac-shunt-library' or payload.get('version') != 1:
        raise ValueError('Expected a version 1 AC-shunt library export.')
    definitions = copy.deepcopy(payload.get('instruments'))
    if not isinstance(definitions, list):
        raise ValueError('The export must contain a list of instrument definitions.')
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
            ratings = {row['rangeA'] for row in payload.get('catalog', []) + (live_catalog or [])
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
    catalog = copy.deepcopy(payload.get('catalog', []))
    # Old exports omitted correction values. On the originating lab computer,
    # recover them only from the same report and unchanged point/uncertainty set.
    for row in catalog:
        report = row.get('report') or {}
        if report.get('points') and all('correctionPpm' in point for point in report['points']):
            continue
        for live in live_catalog or []:
            live_report = live.get('report') or {}
            if catalog_key(row) != catalog_key(live) or report.get('id') != live_report.get('id'):
                continue
            without_corrections = [{key: value for key, value in point.items() if key != 'correctionPpm'}
                                   for point in live_report.get('points', [])]
            if report.get('points') == without_corrections:
                row['report'] = live_report
                break
    aliases = correction_aliases(catalog)
    retained = []
    # Canonical entries come first, regardless of export order.
    definitions.sort(key=lambda item: (len(item['acShuntIdentity']['serial']), item['acShuntIdentity']['serial'].casefold()))
    for item in definitions:
        identity = item['acShuntIdentity']
        evidence = matching_uncertainty_records(identity, catalog) or matching_uncertainty_records(identity, live_catalog or [])
        if not evidence:
            if excluded is not None:
                excluded.append(item)
            continue
        # Never trust a generated TI's 100 ppm limit or an old display label as
        # calibration evidence. Retain the source report for portable installs.
        identity['calibrationEvidence'] = evidence
        uncertainties = [float(point['uncertaintyPpm']) for row in evidence for point in reported_uncertainty_points(row)]
        identity['standardType'] = 'CHECK STD' if all(math.isclose(value, 100, rel_tol=0, abs_tol=1e-9)
                                                     for value in uncertainties) else 'NIST'
        item.update(instrument_identity(identity['model'], identity['serial'], identity['shuntRange'], identity['standardType']))
        for function in item['functions']:
            for row in function['ranges']:
                row['acShuntSource']['standardType'] = identity['standardType']
        key = (identity['model'], identity['serial'].casefold(), identity['shuntRange'])
        canonical = aliases.get(key)
        target = next((old for old in retained if canonical and old['type'] == item['type']
                       and old['acShuntIdentity']['model'] == canonical['model']
                       and old['acShuntIdentity']['serial'].casefold() == canonical['serial'].casefold()
                       and old['acShuntIdentity']['shuntRange'] == canonical['rangeA']), None)
        if target and definition_signature(target['functions']) == definition_signature(item['functions']) and target.get('typeBComponents') == item.get('typeBComponents'):
            continue
        record = next((row for row in catalog if catalog_key(row) == key), None)
        names = serial_aliases(record, aliases) if record else []
        identity.pop('serialAliases', None)
        if names:
            identity['serialAliases'] = names
        retained.append(item)
    return retained


class Command(BaseCommand):
    help = 'Install reviewed AC-shunt export definitions once, preserving existing library definitions and sessions.'

    def add_arguments(self, parser):
        parser.add_argument('--input', required=True, help='Reviewed AC-shunt library JSON export.')
        parser.add_argument('--dry-run', action='store_true', help='Validate and report names without changing the library.')

    def handle(self, *args, **options):
        try:
            payload = json.loads(Path(options['input']).expanduser().read_text(encoding='utf-8-sig'))
            live_catalog = [catalog_record(*row) for row in shunt_catalog()]
            excluded = []
            definitions = prepare_definitions(payload, live_catalog=live_catalog, excluded=excluded)
        except (OSError, ValueError, KeyError, TypeError, AttributeError) as error:
            raise CommandError(f'Invalid export; library unchanged: {error}') from error
        for item in excluded:
            self.stdout.write(f"Excluded {item['model']} {item['acShuntIdentity']['serial']}: no reported calibration uncertainty.")
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
                names = [source['serial'], *source.get('serialAliases', [])]
                matches = [old for old in existing if old.scope == Instrument.SCOPE_VALIDATED
                           and old.instrument_type == item['type'] and any(matches_instrument(old, source['model'], serial,
                               source['shuntRange'] if item['type'] == 'tmde' else None) for serial in names)]
                collision = next((old for old in existing if old.id == item['id']), None)
                if collision and collision not in matches:
                    raise CommandError(f"Conflicting existing ID {item['id']}; no definitions imported.")
                if matches:
                    canonical_matches = [old for old in matches if matches_instrument(old, source['model'], source['serial'], source['shuntRange'])]
                    if canonical_matches:
                        for old in canonical_matches:
                            rename_instrument_once(old, source['model'], source['serial'], source['shuntRange'], source['standardType'], item['type'])
                            remember_calibration_evidence(old, source['calibrationEvidence'])
                        retained += 1
                    else:
                        primary = save_instrument(item)
                        existing.append(primary)
                        matches.append(primary)
                        created += 1
                    preferred_id = canonical_matches[0].id if canonical_matches else item['id']
                    retain_canonical_instrument(matches, preferred_id, source.get('serialAliases', []), source)
                    existing = [old for old in existing if old.pk is not None]
                else:
                    existing.append(save_instrument(item))
                    created += 1
            removed, backup = remove_unsupported_generated_instruments(
                payload.get('catalog', []) + live_catalog, candidate_ids={item['id'] for item in excluded})
        self.stdout.write(self.style.SUCCESS(f'Created {created} instruments; retained {retained} existing definitions. Saved budgets unchanged.'))
        if removed:
            self.stdout.write(f'Removed {removed} unsupported generated entries/local copies. Backup: {backup}.')
