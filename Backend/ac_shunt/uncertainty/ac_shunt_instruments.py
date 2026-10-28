"""Initial Uncertalytics reference definitions from the saved shunt catalog.

This setup is separate from measurement import. Stable identities and
get_or_create preserve subsequent user edits, including certificate updates.
"""
import math
from hashlib import sha256

from api.models import CalibrationSession, Shunt, resolve_active_report
from .models import Instrument


def seed_ac_shunt_references():
    existing = list(Instrument.objects.filter(scope=Instrument.SCOPE_VALIDATED))
    created = 0
    seen = set()
    for shunt in Shunt.objects.prefetch_related('reports__corrections').order_by('-is_manual', 'id'):
        if not any(model in shunt.model_name.upper() for model in ('A40B', 'Y5020')):
            continue
        identity = (shunt.serial_number.strip(), shunt.range)
        if identity in seen:
            continue
        seen.add(identity)
        report = resolve_active_report(shunt.reports.all())
        if not report:
            continue
        key = 'ac-shunt-ref-' + sha256(repr(identity).encode()).hexdigest()[:32]
        # Earlier imports used serial in model and the model in description.
        # Also recognize previously seeded definitions by their stable ID.
        if any(item.id == key or (item.model == identity[0] and shunt.model_name.lower() in item.description.lower())
               for item in existing):
            continue
        ranges = []
        for correction in sorted(report.corrections.all(), key=lambda c: (c.current, c.frequency)):
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
                'acShuntSource': {'serial': identity[0], 'model': shunt.model_name,
                    'shuntRange': shunt.range, 'reportId': report.pk, 'reportNumber': report.report_number,
                    'reportDate': str(report.calibration_date or '')},
            })
        if not ranges:
            continue
        _, was_created = Instrument.objects.get_or_create(id=key, defaults={
            'manufacturer': 'Fluke', 'model': f'{shunt.model_name} · {identity[0]}',
            'description': f'NIST reference AC shunt · {shunt.range:g} A',
            'measurement_area': 'Current', 'measurement_area_color': '#5aa6d9',
            'instrument_type': 'tmde', 'scope': Instrument.SCOPE_VALIDATED,
            'functions': [{'id': f'{key}-current', 'name': 'Current', 'unit': 'A', 'ranges': ranges}],
        })
        created += int(was_created)
    return created


def seed_ac_shunt_test_instruments():
    """Create one library TI per saved model/serial, collecting its point ranges.

    Reference and TI definitions remain separate even when a physical shunt
    has been used in both roles: only the TI has the lab acceptance limits.
    """
    existing = list(Instrument.objects.filter(scope=Instrument.SCOPE_VALIDATED).exclude(instrument_type='tmde'))
    grouped = {}
    sessions = CalibrationSession.objects.select_related('test_point_set').prefetch_related('test_point_set__points')
    for session in sessions:
        model = (session.test_instrument_model or '').strip()
        serial = (session.test_instrument_serial or '').strip()
        if not model or not serial:
            continue
        identity = (model.casefold(), serial.casefold())
        record = grouped.setdefault(identity, {'model': model, 'serial': serial, 'points': set()})
        point_set = getattr(session, 'test_point_set', None)
        for point in point_set.points.all() if point_set else []:
            if math.isfinite(float(point.current)) and point.current > 0 and point.frequency > 0:
                record['points'].add((float(point.current), point.frequency))
    created = 0
    for identity, record in grouped.items():
        key = 'ac-shunt-ti-' + sha256(repr(identity).encode()).hexdigest()[:32]
        model, serial = record['model'], record['serial']
        def matches(item):
            sources = [r.get('acShuntSource', {}) for fn in item.functions for r in fn.get('ranges', [])]
            return item.id == key or any(
                str(source.get('serial', '')).casefold() == identity[1]
                and str(source.get('model', '')).casefold() == identity[0] for source in sources
            ) or (item.model.casefold() in (serial.casefold(), f'{model} · {serial}'.casefold())
                  and model.casefold() in f'{item.model} {item.description}'.casefold())
        if not record['points'] or any(matches(item) for item in existing):
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
                'acShuntSource': {'model': model, 'serial': serial, 'role': 'uut'}})
        _, was_created = Instrument.objects.get_or_create(id=key, defaults={
            'manufacturer': 'Fluke' if any(name in model.upper() for name in ('Y5020', 'A40B')) else '',
            'model': f'{model} · {serial}', 'description': 'AC shunt TI · Lab ±100 ppm',
            'measurement_area': 'Current', 'measurement_area_color': '#5aa6d9',
            'instrument_type': 'uut', 'scope': Instrument.SCOPE_VALIDATED,
            'functions': [{'id': f'{key}-current', 'name': 'Current', 'unit': 'A', 'ranges': ranges}]})
        created += int(was_created)
    return created
