"""Uncertalytics instruments from the saved shunt catalog and sessions.

This setup is separate from measurement import. Names are upgraded once;
stable identities preserve uncertainty definitions and subsequent user edits.
"""
import math
import re
from hashlib import sha256

from api.models import CalibrationSession, Shunt, resolve_active_report
from .models import Instrument


def shunt_model(value):
    value = str(value or '')
    match = re.search(r'(A40B|Y5020)', value or '', re.I)
    if match:
        return match.group(1).upper()
    # The AC-shunt corrections UI uses A40B for legacy generic catalog rows.
    return 'A40B' if not value or value.strip().lower() == 'shunt' else value.strip()


def positive(value):
    try:
        return value is not None and math.isfinite(float(value)) and float(value) > 0
    except (ValueError, TypeError):
        return False


def standard_type(shunt, report):
    # Lab convention: the catalog's 100 ppm uncertainties identify a Check
    # STD. Do not infer this from the TI's separate 100 ppm acceptance limit.
    uncertainties = [float(row.uncertainty) for row in report.corrections.all()
                     if row.uncertainty is not None and math.isfinite(row.uncertainty) and row.uncertainty >= 0] if report else []
    if uncertainties:
        return 'CHECK STD' if all(math.isclose(value, 100, rel_tol=0, abs_tol=1e-9) for value in uncertainties) else 'NIST'
    # A Check STD can itself be traceable to NIST. Prefer its device label.
    for text in (shunt.remark, shunt.model_name, getattr(report, 'notes', ''), getattr(report, 'report_number', '')):
        if re.search(r'\bcheck[\s_-]*(?:std|standard)\b', text or '', re.I):
            return 'CHECK STD'
        if re.search(r'\bNIST\b', text or '', re.I):
            return 'NIST'
    return ''


def shunt_catalog():
    seen = set()
    for shunt in Shunt.objects.prefetch_related('reports__corrections').order_by('-is_manual', 'id'):
        model = shunt_model(shunt.model_name)
        identity = (shunt.serial_number.strip().casefold(), shunt.range)
        if model not in ('A40B', 'Y5020') or not identity[0] or not positive(shunt.range) or identity in seen:
            continue
        seen.add(identity)
        report = resolve_active_report(shunt.reports.all())
        yield shunt, model, report, standard_type(shunt, report)


def instrument_identity(model, serial, shunt_range, label):
    if positive(shunt_range):
        range_text = f'{shunt_range:g} A' if shunt_range >= 1 else f'{shunt_range * 1000:g} mA'
    else:
        range_text = ''
    return {'manufacturer': 'Fluke' if model in ('A40B', 'Y5020') else '', 'model': model,
            'description': ' '.join(part for part in (serial, range_text, label) if part)}


def source_identity(model, serial, shunt_range, label, role):
    return {'model': model, 'serial': serial, 'shuntRange': shunt_range,
            'standardType': label, 'role': role, 'namingVersion': 2}


def matches_instrument(item, model, serial, shunt_range=None):
    sources = [(item.column_metadata or {}).get('acShuntIdentity', {})]
    sources += [r.get('acShuntSource', {}) for fn in item.functions or [] for r in fn.get('ranges', [])]
    matching_sources = [source for source in sources if str(source.get('serial', '')).casefold() == serial.casefold()
                        and shunt_model(source.get('model')) == model]
    if matching_sources:
        return any(shunt_range is None or source.get('shuntRange') is None
                   or (positive(source['shuntRange']) and math.isclose(float(source['shuntRange']), shunt_range))
                   for source in matching_sources)
    return (item.model.casefold() in (serial.casefold(), f'{model} · {serial}'.casefold())
            and model.casefold() in f'{item.model} {item.description}'.casefold())


def rename_instrument_once(item, model, serial, shunt_range, label, role):
    metadata = item.column_metadata or {}
    if metadata.get('acShuntIdentity', {}).get('namingVersion', 0) >= 2:
        return
    for field, value in instrument_identity(model, serial, shunt_range, label).items():
        setattr(item, field, value)
    item.column_metadata = {**metadata, 'acShuntIdentity': source_identity(model, serial, shunt_range, label, role)}
    item.save(update_fields=['manufacturer', 'model', 'description', 'column_metadata', 'updated_at'])


def seed_ac_shunt_references(*, export_only=False):
    existing = list(Instrument.objects.filter(scope=Instrument.SCOPE_VALIDATED).exclude(instrument_type='uut'))
    created = 0
    exported = []
    for shunt, model, report, label in shunt_catalog():
        identity = (shunt.serial_number.strip(), shunt.range)
        key = 'ac-shunt-ref-' + sha256(repr(identity).encode()).hexdigest()[:32]
        matches = [item for item in existing if item.id == key or matches_instrument(item, model, identity[0], shunt.range)]
        if matches and not export_only:
            for item in matches:
                rename_instrument_once(item, model, identity[0], shunt.range, label, 'tmde')
            continue
        if not report and not label:
            continue
        ranges = []
        for correction in sorted(report.corrections.all() if report else [], key=lambda c: (c.current, c.frequency)):
            if not math.isfinite(correction.current) or correction.current <= 0 or correction.frequency <= 0:
                continue
            uncertainty = correction.uncertainty
            valid = uncertainty is not None and math.isfinite(uncertainty) and uncertainty >= 0
            ranges.append({
                'id': f'{key}-{correction.pk}', 'range': f'{correction.current:g} A',
                'value': correction.current, 'min': correction.current, 'max': correction.current,
                'isSingleValue': True, 'unit': 'A', 'includeResolutionInBudget': False,
                'qualifierGroupId': f'{key}-{correction.current:g}',
                'qualifier': {'name': 'Frequency', 'value': correction.frequency,
                              'min': correction.frequency, 'max': correction.frequency,
                              'isSingleValue': True, 'unit': 'Hz'},
                'tolerances': {'reading': {'high': uncertainty, 'low': -uncertainty,
                    'unit': 'ppm', 'symmetric': True, 'distribution': '1.960'}} if valid else {},
                'source': f'Reference report {report.report_number}',
                'notes': 'Initial reference uncertainty: Normal (95%). Review against the certificate.',
                'acShuntSource': {'serial': identity[0], 'model': model, 'standardType': label,
                    'shuntRange': shunt.range, 'reportId': report.pk, 'reportNumber': report.report_number,
                    'reportDate': str(report.calibration_date or '')},
            })
        if not ranges and not label:
            continue
        defaults = {
            **instrument_identity(model, identity[0], shunt.range, label),
            'column_metadata': {'acShuntIdentity': source_identity(model, identity[0], shunt.range, label, 'tmde')},
            'measurement_area': 'Current', 'measurement_area_color': '#5aa6d9',
            'instrument_type': 'tmde', 'scope': Instrument.SCOPE_VALIDATED,
            'functions': [{'id': f'{key}-current', 'name': 'Current', 'unit': 'A', 'ranges': ranges}],
        }
        if export_only:
            exported.append(Instrument(id=key, **defaults))
            continue
        _, was_created = Instrument.objects.get_or_create(id=key, defaults=defaults)
        created += int(was_created)
    return exported if export_only else created


def seed_ac_shunt_test_instruments(*, export_only=False):
    """Create one library TI per saved model/serial, collecting its point ranges.

    Reference and TI definitions remain separate even when a physical shunt
    has been used in both roles: only the TI has the lab acceptance limits.
    """
    existing = list(Instrument.objects.filter(scope=Instrument.SCOPE_VALIDATED).exclude(instrument_type='tmde'))
    grouped = {}
    catalog = list(shunt_catalog())
    sessions = CalibrationSession.objects.select_related('test_point_set', 'calibration__configurations').prefetch_related('test_point_set__points')
    for session in sessions:
        model = shunt_model(session.test_instrument_model)
        serial = (session.test_instrument_serial or '').strip()
        if not session.test_instrument_model or not serial:
            continue
        identity = (model.casefold(), serial.casefold())
        record = grouped.setdefault(identity, {'model': model, 'serial': serial, 'points': set(), 'physicalRanges': set(), 'labels': set()})
        config = getattr(getattr(session, 'calibration', None), 'configurations', None)
        configured_range = getattr(config, 'ac_shunt_range', None)
        matching_shunts = [(shunt, label) for shunt, family, _, label in catalog
                           if shunt.serial_number.strip().casefold() == serial.casefold() and family == model
                           and (not positive(configured_range) or math.isclose(shunt.range, configured_range))]
        if positive(configured_range):
            record['physicalRanges'].add(float(configured_range))
        elif len(matching_shunts) == 1:
            record['physicalRanges'].add(matching_shunts[0][0].range)
        record['labels'].update(label for _, label in matching_shunts if label)
        point_set = getattr(session, 'test_point_set', None)
        for point in point_set.points.all() if point_set else []:
            if math.isfinite(float(point.current)) and point.current > 0 and point.frequency > 0:
                record['points'].add((float(point.current), point.frequency))
    created = 0
    exported = []
    for identity, record in grouped.items():
        key = 'ac-shunt-ti-' + sha256(repr(identity).encode()).hexdigest()[:32]
        model, serial = record['model'], record['serial']
        shunt_range = next(iter(record['physicalRanges'])) if len(record['physicalRanges']) == 1 else None
        label = next(iter(record['labels'])) if len(record['labels']) == 1 else ''
        matches = [item for item in existing if item.id == key or matches_instrument(item, model, serial)]
        if matches and not export_only:
            for item in matches:
                rename_instrument_once(item, model, serial, shunt_range, label, 'uut')
            continue
        if not record['points']:
            continue
        ranges = []
        for current, frequency in sorted(record['points']):
            ranges.append({'id': f'{key}-{current:g}-{frequency}', 'range': f'{current:g} A',
                'value': current, 'min': current, 'max': current, 'isSingleValue': True, 'unit': 'A',
                'qualifierGroupId': f'{key}-{current:g}', 'includeResolutionInBudget': False,
                'qualifier': {'name': 'Frequency', 'value': frequency, 'min': frequency, 'max': frequency,
                              'isSingleValue': True, 'unit': 'Hz'},
                'tolerances': {'reading': {'high': 100, 'low': -100, 'unit': 'ppm',
                                          'symmetric': True, 'distribution': 'not_set'}},
                'source': 'Lab TI requirement',
                'acShuntSource': {'model': model, 'serial': serial, 'role': 'uut',
                                  'shuntRange': shunt_range, 'standardType': label}})
        defaults = {
            **instrument_identity(model, serial, shunt_range, label),
            'column_metadata': {'acShuntIdentity': source_identity(model, serial, shunt_range, label, 'uut')},
            'measurement_area': 'Current', 'measurement_area_color': '#5aa6d9',
            'instrument_type': 'uut', 'scope': Instrument.SCOPE_VALIDATED,
            'functions': [{'id': f'{key}-current', 'name': 'Current', 'unit': 'A', 'ranges': ranges}]}
        if export_only:
            exported.append(Instrument(id=key, **defaults))
            continue
        _, was_created = Instrument.objects.get_or_create(id=key, defaults=defaults)
        created += int(was_created)
    return exported if export_only else created
