"""Uncertalytics instruments from the saved shunt catalog and sessions.

This setup is separate from measurement import. Names are upgraded once;
stable identities preserve uncertainty definitions and subsequent user edits.
"""
import math
import re
from hashlib import sha256
from django.db import router, transaction

from api.models import CalibrationSession, Shunt, resolve_active_report
from .models import Instrument
from .shunt_identity import (catalog_key, correction_aliases, definition_signature,
                            matching_uncertainty_records, reported_uncertainty_points, serial_aliases)


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
        identity = (model, shunt.serial_number.strip().casefold(), shunt.range)
        if model not in ('A40B', 'Y5020') or not identity[1] or not positive(shunt.range) or identity in seen:
            continue
        seen.add(identity)
        report = resolve_active_report(shunt.reports.all())
        yield shunt, model, report, standard_type(shunt, report)


def catalog_record(shunt, model, report, label):
    def finite(value):
        return value if value is not None and math.isfinite(float(value)) else None
    return {'model': model, 'serial': shunt.serial_number.strip(), 'rangeA': shunt.range,
            'standardType': label, 'remark': shunt.remark,
            'report': None if not report else {
                'id': report.pk, 'number': report.report_number, 'date': str(report.calibration_date or ''), 'notes': report.notes,
                'points': [{'currentA': finite(row.current), 'frequencyHz': finite(row.frequency),
                            'correctionPpm': finite(row.correction), 'uncertaintyPpm': finite(row.uncertainty)}
                           for row in sorted(report.corrections.all(), key=lambda row: (row.current, row.frequency))]}}


def refresh_serial_aliases(existing, records, aliases):
    # A later report can invalidate an earlier equivalence. Revoke that alias
    # before it can match the now-different calibration to the old definition.
    for item in existing:
        source = (item.column_metadata or {}).get('acShuntIdentity', {})
        if not source.get('serialAliases'):
            continue
        record = next((row for row in records if row['model'] == source.get('model')
                       and row['serial'].casefold() == str(source.get('serial', '')).casefold()
                       and row['rangeA'] == source.get('shuntRange')), None)
        current_aliases = serial_aliases(record, aliases) if record else []
        if current_aliases != source['serialAliases']:
            item.column_metadata = {**item.column_metadata, 'acShuntIdentity': {**source, 'serialAliases': current_aliases}}
            item.save(update_fields=['column_metadata', 'updated_at'])


def retain_canonical_instrument(matches, preferred_id, aliases, target_identity=None):
    """Collapse only untouched equal library copies; preserve edited definitions.

    Calibration reports and saved session snapshots are never changed. Local
    overrides keep their data and are relinked to the retained shared definition.
    """
    primary = next((item for item in matches if item.id == preferred_id), matches[0])
    metadata = primary.column_metadata or {}
    previous_identity = metadata.get('acShuntIdentity', {})
    if not previous_identity:
        return primary
    identity = {**previous_identity, **(target_identity or {})}
    alias_names = sorted(set(aliases))
    db = router.db_for_write(Instrument)
    with transaction.atomic(using=db):
        if identity != previous_identity or alias_names != previous_identity.get('serialAliases', []):
            old_name = instrument_identity(previous_identity.get('model'), previous_identity.get('serial'),
                                           previous_identity.get('shuntRange'), previous_identity.get('standardType', ''))
            if all(getattr(primary, field) == value for field, value in old_name.items()):
                for field, value in instrument_identity(identity['model'], identity['serial'], identity['shuntRange'], identity['standardType']).items():
                    setattr(primary, field, value)
            primary.column_metadata = {**metadata, 'acShuntIdentity': {**identity, 'serialAliases': alias_names}}
            primary.save(update_fields=['manufacturer', 'model', 'description', 'column_metadata', 'updated_at'])
        for duplicate in matches:
            other = (duplicate.column_metadata or {}).get('acShuntIdentity', {})
            if duplicate.id == primary.id or other.get('serial', '').casefold() not in alias_names:
                continue
            original_name = instrument_identity(other.get('model'), other.get('serial'), other.get('shuntRange'), other.get('standardType', ''))
            if (any(getattr(duplicate, field) != value for field, value in original_name.items())
                    or duplicate.type_b_components != primary.type_b_components
                    or {k: v for k, v in (duplicate.column_metadata or {}).items() if k != 'acShuntIdentity'}
                       != {k: v for k, v in metadata.items() if k != 'acShuntIdentity'}
                    or definition_signature(duplicate.functions) != definition_signature(primary.functions)):
                continue
            Instrument.objects.filter(scope=Instrument.SCOPE_LOCAL, source_id=duplicate.id).update(source_id=primary.id)
            duplicate.delete()
    return primary


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


def remember_calibration_evidence(item, records):
    metadata = item.column_metadata or {}
    identity = metadata.get('acShuntIdentity', {})
    evidence = matching_uncertainty_records(identity, records)
    if evidence and identity.get('calibrationEvidence') != evidence:
        item.column_metadata = {**metadata, 'acShuntIdentity': {**identity, 'calibrationEvidence': evidence}}
        item.save(update_fields=['column_metadata', 'updated_at'])


def matches_instrument(item, model, serial, shunt_range=None):
    sources = [(item.column_metadata or {}).get('acShuntIdentity', {})]
    sources += [r.get('acShuntSource', {}) for fn in item.functions or [] for r in fn.get('ranges', [])]
    matching_sources = [source for source in sources if serial.casefold() in
                        [str(value).casefold() for value in [source.get('serial', ''), *source.get('serialAliases', [])]]
                        and shunt_model(source.get('model')) == model]
    if matching_sources:
        return any(shunt_range is None or source.get('shuntRange') is None
                   or (positive(source['shuntRange']) and math.isclose(float(source['shuntRange']), shunt_range))
                   for source in matching_sources)
    return (item.model.casefold() in (serial.casefold(), f'{model} · {serial}'.casefold())
            and model.casefold() in f'{item.model} {item.description}'.casefold())


def rename_instrument_once(item, model, serial, shunt_range, label, role):
    metadata = item.column_metadata or {}
    previous = metadata.get('acShuntIdentity', {})
    if previous.get('namingVersion', 0) >= 2:
        # Repair the missing rating produced by conflicting historical session
        # configurations, but preserve names the user has since customized.
        old_name = instrument_identity(model, serial, previous.get('shuntRange'), previous.get('standardType', ''))
        if not (role == 'uut' and not positive(previous.get('shuntRange')) and positive(shunt_range)
                and all(getattr(item, field) == value for field, value in old_name.items())):
            return
    for field, value in instrument_identity(model, serial, shunt_range, label).items():
        setattr(item, field, value)
    item.column_metadata = {**metadata, 'acShuntIdentity': source_identity(model, serial, shunt_range, label, role)}
    item.save(update_fields=['manufacturer', 'model', 'description', 'column_metadata', 'updated_at'])


def seed_ac_shunt_references(*, export_only=False):
    existing = list(Instrument.objects.filter(scope=Instrument.SCOPE_VALIDATED).exclude(instrument_type='uut'))
    created = 0
    exported = []
    catalog = list(shunt_catalog())
    records = [catalog_record(*row) for row in catalog]
    aliases = correction_aliases(records)
    if not export_only:
        refresh_serial_aliases(existing, records, aliases)
    for shunt, model, report, label in catalog:
        record = catalog_record(shunt, model, report, label)
        if not reported_uncertainty_points(record) or catalog_key(record) in aliases:
            continue
        alias_names = serial_aliases(record, aliases)
        identity = (shunt.serial_number.strip(), shunt.range)
        families = {row['model'] for row in records if row['serial'].casefold() == identity[0].casefold() and row['rangeA'] == shunt.range}
        stable_identity = (model, *identity) if len(families) > 1 else identity
        key = 'ac-shunt-ref-' + sha256(repr(stable_identity).encode()).hexdigest()[:32]
        matches = [item for item in existing if item.id == key or any(matches_instrument(item, model, serial, shunt.range)
                   for serial in [identity[0], *alias_names])]
        if matches and not export_only:
            canonical_matches = [item for item in matches if matches_instrument(item, model, identity[0], shunt.range)]
            if canonical_matches:
                for item in canonical_matches:
                    rename_instrument_once(item, model, identity[0], shunt.range, label, 'tmde')
                    remember_calibration_evidence(item, records)
                retain_canonical_instrument(matches, canonical_matches[0].id, alias_names)
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
            'column_metadata': {'acShuntIdentity': {**source_identity(model, identity[0], shunt.range, label, 'tmde'),
                                                  'calibrationEvidence': [record],
                                                  **({'serialAliases': alias_names} if alias_names else {})}},
            'measurement_area': 'Current', 'measurement_area_color': '#5aa6d9',
            'instrument_type': 'tmde', 'scope': Instrument.SCOPE_VALIDATED,
            'functions': [{'id': f'{key}-current', 'name': 'Current', 'unit': 'A', 'ranges': ranges}],
        }
        if export_only:
            exported.append(Instrument(id=key, **defaults))
            continue
        item, was_created = Instrument.objects.get_or_create(id=key, defaults=defaults)
        created += int(was_created)
        if matches:
            retain_canonical_instrument([item, *matches], item.id, alias_names)
    return exported if export_only else created


def seed_ac_shunt_test_instruments(*, export_only=False):
    """Create TIs only for catalog instruments with reported uncertainties.

    Reference and TI definitions remain separate even when a physical shunt
    has been used in both roles: only the TI has the lab acceptance limits.
    """
    existing = list(Instrument.objects.filter(scope=Instrument.SCOPE_VALIDATED).exclude(instrument_type='tmde'))
    grouped = {}
    catalog = list(shunt_catalog())
    records = [catalog_record(*row) for row in catalog]
    aliases = correction_aliases(records)
    if not export_only:
        refresh_serial_aliases(existing, records, aliases)
    sessions = CalibrationSession.objects.select_related('test_point_set', 'calibration__configurations').prefetch_related('test_point_set__points')
    for session in sessions:
        model = shunt_model(session.test_instrument_model)
        serial = (session.test_instrument_serial or '').strip()
        if not session.test_instrument_model or not serial:
            continue
        targets = [row for (family, alias, _), row in aliases.items() if family == model and alias == serial.casefold()]
        if len({row['serial'] for row in targets}) == 1:
            serial = targets[0]['serial']
        config = getattr(getattr(session, 'calibration', None), 'configurations', None)
        configured_range = getattr(config, 'ac_shunt_range', None)
        matching_shunts = [(shunt, label) for shunt, family, _, label in catalog
                           if shunt.serial_number.strip().casefold() == serial.casefold() and family == model
                           and matching_uncertainty_records({'model': model, 'serial': serial, 'shuntRange': shunt.range}, records)]
        # A unique catalog identity describes the physical instrument. Session
        # settings can describe a different measurement range; retain its points
        # without allowing that setting to erase the instrument's rating.
        if len(matching_shunts) > 1 and positive(configured_range):
            matching_shunts = [(shunt, label) for shunt, label in matching_shunts
                               if math.isclose(shunt.range, configured_range)]
        if not matching_shunts:
            continue
        identity = (model.casefold(), serial.casefold())
        record = grouped.setdefault(identity, {'model': model, 'serial': serial, 'points': set(), 'physicalRanges': set(), 'labels': set(), 'serialAliases': set()})
        record['serialAliases'].update(alias for (family, alias, _), row in aliases.items()
                                       if family == model and row['serial'].casefold() == serial.casefold())
        if len(matching_shunts) == 1:
            record['physicalRanges'].add(matching_shunts[0][0].range)
        elif positive(configured_range):
            record['physicalRanges'].add(float(configured_range))
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
        alias_names = sorted(record['serialAliases'])
        matches = [item for item in existing if item.id == key or any(matches_instrument(item, model, name) for name in [serial, *alias_names])]
        if matches and not export_only:
            canonical_matches = [item for item in matches if matches_instrument(item, model, serial)]
            if canonical_matches:
                for item in canonical_matches:
                    rename_instrument_once(item, model, serial, shunt_range, label, 'uut')
                    remember_calibration_evidence(item, records)
                retain_canonical_instrument(matches, canonical_matches[0].id, alias_names, source_identity(model, serial, shunt_range, label, 'uut'))
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
            'column_metadata': {'acShuntIdentity': {**source_identity(model, serial, shunt_range, label, 'uut'),
                                                  'calibrationEvidence': matching_uncertainty_records(
                                                      {'model': model, 'serial': serial, 'shuntRange': shunt_range}, records),
                                                  **({'serialAliases': alias_names} if alias_names else {})}},
            'measurement_area': 'Current', 'measurement_area_color': '#5aa6d9',
            'instrument_type': 'uut', 'scope': Instrument.SCOPE_VALIDATED,
            'functions': [{'id': f'{key}-current', 'name': 'Current', 'unit': 'A', 'ranges': ranges}]}
        if export_only:
            exported.append(Instrument(id=key, **defaults))
            continue
        item, was_created = Instrument.objects.get_or_create(id=key, defaults=defaults)
        created += int(was_created)
        if matches:
            retain_canonical_instrument([item, *matches], item.id, alias_names)
    return exported if export_only else created
