"""Portable catalog/definition export and scoped cleanup of old shunt imports."""
import json
import math
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError
from django.core.serializers.json import DjangoJSONEncoder
from django.db import router, transaction
from django.utils.timezone import now
from api.models import CalibrationSession

from uncertainty.ac_shunt_instruments import (
    seed_ac_shunt_references, seed_ac_shunt_test_instruments, shunt_catalog, shunt_model,
)
from uncertainty.models import Instrument, TestPoint, Uut, SessionTmde
from uncertainty.serializers import instrument_to_dict


def imported_shunt(item):
    """Require import provenance; a manually built Fluke is not a duplicate."""
    sources = [(item.column_metadata or {}).get('acShuntIdentity', {})]
    sources += [row.get('acShuntSource', {}) for fn in item.functions for row in fn.get('ranges', [])]
    family = shunt_model(f'{item.model} {item.description}')
    if any(source.get('serial') and shunt_model(source.get('model') or family) in ('A40B', 'Y5020') for source in sources):
        return True
    # Earlier imports stored certificate provenance instead of a flat identity,
    # and used the serial as Model with the family in Description.
    if any(source.get('certificates') for source in sources):
        return family in ('A40B', 'Y5020')
    return (item.id.startswith(('ac-shunt-ref-', 'ac-shunt-ti-'))
            and shunt_model(item.model) in ('A40B', 'Y5020'))


def finite(value):
    return value if value is not None and math.isfinite(float(value)) else None


def legacy_imported_ids(alias):
    """Find pre-provenance TI definitions using their saved import session.

    These used the serial in Model and the family in Description. A definition
    linked from the shared library is deliberately excluded.
    """
    origins = {}
    for session_id, info in TestPoint.objects.using(alias).values_list('session_id', 'test_point_info'):
        source_id = (info or {}).get('acShuntSource', {}).get('sessionId')
        if str(source_id).isdigit():
            origins.setdefault(session_id, set()).add(int(source_id))
    source_ids = set().union(*origins.values()) if origins else set()
    identities = {}
    for session in CalibrationSession.objects.filter(pk__in=source_ids):
        identities[session.pk] = {
            (shunt_model(model), (serial or '').strip().casefold())
            for model, serial in [(session.test_instrument_model, session.test_instrument_serial),
                                  (session.standard_instrument_model, session.standard_instrument_serial)]
            if model and serial and shunt_model(model) in ('A40B', 'Y5020')
        }
    found = set()
    for model in (Uut, SessionTmde):
        for session_id, definition in model.objects.using(alias).filter(session_id__in=origins).values_list('session_id', 'instrument'):
            definition = definition or {}
            if definition.get('sourceId') or definition.get('libraryInstrumentId') or definition.get('scope') == 'validated':
                continue
            identity = (shunt_model(definition.get('description')), str(definition.get('model', '')).strip().casefold())
            if identity in set().union(*(identities.get(source, set()) for source in origins[session_id])) and definition.get('id'):
                found.add(str(definition['id']))
    return found


class Command(BaseCommand):
    help = 'Export A40B/Y5020 source data and Uncertalytics definitions; optionally back up and clear old imported library entries.'

    def add_arguments(self, parser):
        parser.add_argument('--output', required=True, help='New JSON file to create; an existing file is never overwritten.')
        parser.add_argument('--clean-old-imports', action='store_true',
                            help='After writing the backup, remove only library entries with AC-shunt import provenance and their local copies.')

    def handle(self, *args, **options):
        catalog = []
        for shunt, model, report, label in shunt_catalog():
            catalog.append({
                'model': model, 'serial': shunt.serial_number.strip(), 'rangeA': shunt.range,
                'standardType': label, 'remark': shunt.remark,
                'report': None if not report else {
                    'id': report.pk, 'number': report.report_number, 'date': report.calibration_date,
                    'notes': report.notes,
                    'points': [{'currentA': finite(row.current), 'frequencyHz': finite(row.frequency),
                                'uncertaintyPpm': finite(row.uncertainty)}
                               for row in sorted(report.corrections.all(), key=lambda row: (row.current, row.frequency))],
                },
            })
        definitions = [instrument_to_dict(item) for item in (
            seed_ac_shunt_references(export_only=True) + seed_ac_shunt_test_instruments(export_only=True))
            if shunt_model(item.model) in ('A40B', 'Y5020')]
        if not catalog and not definitions:
            raise CommandError('No A40B/Y5020 source data found. No library entries were changed.')
        alias = router.db_for_write(Instrument)
        legacy_ids = legacy_imported_ids(alias)
        output = Path(options['output']).expanduser().resolve()
        with transaction.atomic(using=alias):
            library = list(Instrument.objects.using(alias).select_for_update().all())
            imported_ids = {item.id for item in library if imported_shunt(item) or item.id in legacy_ids}
            old = [item for item in library if item.id in imported_ids or (
                item.scope == Instrument.SCOPE_LOCAL and item.source_id in imported_ids)]
            payload = {
                'format': 'uncertalytics-ac-shunt-library', 'version': 1, 'exportedAt': now(),
                'classificationRule': 'Active catalog uncertainties all 100 ppm: CHECK STD; other known nonnegative uncertainties: NIST; missing values retain explicit labels or remain unset. TI acceptance limits are not used for classification.',
                'catalog': catalog, 'instruments': definitions,
                'previousLibraryEntries': [instrument_to_dict(item) for item in old],
                'cleanupRequested': bool(options['clean_old_imports']),
                'cleanupCandidateIds': [item.id for item in old],
            }
            try:
                # Serialize before opening, and close the complete backup before
                # deleting anything. A failed export cannot clear the library.
                serialized = json.dumps(payload, cls=DjangoJSONEncoder, ensure_ascii=False, indent=2, allow_nan=False)
                with output.open('x', encoding='utf-8') as stream:
                    stream.write(serialized + '\n')
            except (OSError, ValueError) as error:
                raise CommandError(f'Export failed; no library entries changed: {error}') from error
            if options['clean_old_imports']:
                Instrument.objects.using(alias).filter(id__in=[item.id for item in old]).delete()
        self.stdout.write(self.style.SUCCESS(f'Exported {len(catalog)} shunts and {len(definitions)} instrument definitions to {output}.'))
        if options['clean_old_imports']:
            self.stdout.write(f'Backed up and cleared {len(old)} imported library entries. Existing sessions are unchanged. Run seed_ac_shunt_references (or restart the backend) to recreate one entry per shunt/role.')
        else:
            self.stdout.write(f'Library unchanged. {len(old)} imported entries included in the backup.')
