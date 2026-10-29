"""Back up and remove unsupported auto-generated library entries only."""
import json
import re
from pathlib import Path
from uuid import uuid4

from django.conf import settings
from django.core.serializers.json import DjangoJSONEncoder
from django.db import router, transaction
from django.utils.timezone import now

from .models import Instrument
from .serializers import instrument_to_dict
from .shunt_identity import matching_uncertainty_records


def backup_instruments(items, reason, prefix='ac-shunt-unsupported'):
    backup = Path(settings.CREDENTIALS_DIR) / 'backups' / f'{prefix}-{uuid4().hex}.json'
    payload = {'format': 'uncertalytics-ac-shunt-library-backup', 'version': 1,
        'exportedAt': now(), 'reason': reason,
        'previousLibraryEntries': [instrument_to_dict(item) for item in items]}
    serialized = json.dumps(payload, cls=DjangoJSONEncoder, ensure_ascii=False, indent=2, allow_nan=False)
    backup.parent.mkdir(parents=True, exist_ok=True)
    with backup.open('x', encoding='utf-8') as stream:
        stream.write(serialized + '\n')
    return backup


def has_calibration_evidence(item, catalog):
    identity = (item.column_metadata or {}).get('acShuntIdentity', {})
    if matching_uncertainty_records(identity, catalog + identity.get('calibrationEvidence', [])):
        return True
    # Older portable TMDE definitions already carry report provenance and the
    # actual ppm uncertainties. UUT tolerances are lab limits, never evidence.
    if item.instrument_type == 'tmde':
        for function in item.functions or []:
            for row in function.get('ranges', []):
                source = row.get('acShuntSource', {})
                reading = row.get('tolerances', {}).get('reading', {})
                if source.get('reportId') is None or reading.get('unit') != 'ppm':
                    continue
                report_record = {'model': source.get('model'), 'serial': source.get('serial'),
                    'rangeA': source.get('shuntRange'), 'report': {'points': [{
                        'currentA': row.get('value'), 'frequencyHz': row.get('qualifier', {}).get('value'),
                        'uncertaintyPpm': reading.get('high')}]}}
                if matching_uncertainty_records(identity, [report_record]):
                    return True
    return False


def remove_unsupported_generated_instruments(catalog, *, candidate_ids=None):
    """Keep reports/saved budgets intact; a failed backup prevents removal."""
    alias = router.db_for_write(Instrument)
    with transaction.atomic(using=alias):
        library = list(Instrument.objects.using(alias).select_for_update().all())
        unsupported = set()
        for item in library:
            identity = (item.column_metadata or {}).get('acShuntIdentity', {})
            if (item.scope != Instrument.SCOPE_VALIDATED
                    or not re.fullmatch(r'ac-shunt-(?:ref|ti)-[0-9a-f]{32}', item.id)
                    or identity.get('model') not in ('A40B', 'Y5020') or not identity.get('serial')
                    or identity.get('role') != item.instrument_type
                    or (candidate_ids is not None and item.id not in candidate_ids)):
                continue
            if not has_calibration_evidence(item, catalog):
                unsupported.add(item.id)
        removed = [item for item in library if item.id in unsupported or (
            item.scope == Instrument.SCOPE_LOCAL and item.source_id in unsupported)]
        if not removed:
            return 0, None
        backup = backup_instruments(removed, 'Generated entries without reported calibration uncertainty')
        Instrument.objects.using(alias).filter(id__in=[item.id for item in removed]).delete()
    return len(removed), backup
