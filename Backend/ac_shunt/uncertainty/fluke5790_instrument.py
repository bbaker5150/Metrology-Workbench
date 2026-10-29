"""One serial-independent 5790B definition; never modify users' other meters."""
from copy import deepcopy
from django.db import router, transaction
from .models import Instrument
from .fluke5790_specs import INTERVALS, specification_rows

GENERIC_5790_ID = 'fluke-5790b-generic'

# 5790B Service Manual, page 1-6, "Resolution and Range Limits".
# Full least-significant increments in volts, not half-widths or uncertainties.
RESOLUTION_RANGES = (
    (0.0022, 1e-7, 1e-7), (0.007, 1e-7, 1e-7),
    (0.022, 1e-7, 1e-7), (0.07, 1e-7, 1e-7), (0.22, 1e-7, 1e-7),
    (0.7, 1e-7, 1e-6), (2.2, 1e-7, 1e-6),
    (7, 1e-6, 1e-5), (22, 1e-6, 1e-5),
    (70, 1e-5, 1e-4), (220, 1e-5, 1e-4),
    (700, 1e-4, 1e-3), (1000, 1e-4, 1e-3),
)


VOLTAGE_FUNCTION_ID = f'{GENERIC_5790_ID}-voltage'
MODES = (('medium-slow', 'Medium/Slow or HIRES On', 1), ('fast', 'Fast/Off, HIRES Off', 2))


def generic_5790_defaults():
    ranges = []
    for limits in RESOLUTION_RANGES:
        full_scale = limits[0]
        for mode, label, index in MODES:
            legacy_id = f'{GENERIC_5790_ID}-{mode}-{full_scale:g}'
            for spec in sorted(specification_rows(full_scale), key=lambda item: (('AC', 'DC', 'AC/DC Transfer').index(item['mode']), item.get('low', 0), item['interval'])):
                row_id = legacy_id if spec['key'] == 'ac-2-1' else f"{legacy_id}-{spec['key']}"
                frequency = {'name': 'Frequency', 'text': 'DC'}
                if 'low' in spec:
                    frequency = {'name': 'Frequency', 'min': spec['low'], 'max': spec['high'], 'unit': 'Hz'}
                frequency['qualifier'] = {'name': 'Calibration Interval', 'text': INTERVALS[spec['interval']]}
                measurement_mode = 'DC (polarity reversal)' if spec['mode'] == 'DC' else spec['mode']
                condition = {'name': 'Measurement Mode', 'text': measurement_mode + (' (typical)' if spec.get('typical') else ''),
                             'qualifier': frequency}
                term = lambda value, unit: {'high': value, 'low': -value, 'unit': unit, 'symmetric': True, 'distribution': '2.580'}
                tolerances = {'reading': term(spec['ppm'], 'ppm')}
                if spec['floor']:
                    tolerances['floor'] = term(spec['floor'] * 1e-6, 'V')
                ranges.append({
                    'id': row_id, 'range': f'{full_scale:g} V', 'min': 0,
                    'max': 1050 if full_scale == 1000 else full_scale, 'unit': 'V',
                    'qualifierGroupId': f'{GENERIC_5790_ID}-range-{full_scale:g}',
                    'qualifier': {'name': 'Resolution Mode', 'text': label, 'qualifier': condition},
                    'resolution': limits[index], 'resolutionUnit': 'V', 'resolutionDistribution': '3.464',
                    'measuringResolution': limits[index], 'measuringResolutionUnit': 'V',
                    'measuringResolutionDistribution': '3.464', 'includeResolutionInBudget': True,
                    'tolerances': tolerances,
                    'source': f"Fluke 5790B Service Manual, pp. 1-6 (resolution), {spec['page']} (absolute uncertainty)",
                    'notes': spec['notes'] + ' Resolution is the full increment, divided by sqrt(12) for standard uncertainty.',
                    'generic5790Range': {'fullScale': full_scale, 'resolutionMode': mode, 'specification': spec['key']},
                })
    return {
        'manufacturer': 'Fluke', 'model': '5790B', 'description': '',
        'instrument_type': 'tmde', 'scope': Instrument.SCOPE_VALIDATED,
        'measurement_area': 'Voltage', 'measurement_area_color': '#5aa6d9',
        'functions': [{'id': VOLTAGE_FUNCTION_ID, 'name': 'Voltage', 'unit': 'V', 'ranges': ranges}],
        'column_metadata': {'generic5790': {'version': 2, 'serialIndependent': True},
                            'qualifierColumnNames': ['Resolution Mode', 'Measurement Mode', 'Frequency', 'Calibration Interval']},
    }


def seed_generic_5790():
    """Back up and upgrade our v1 definition, preserving resolution/accuracy edits."""
    alias = router.db_for_write(Instrument)
    with transaction.atomic(using=alias):
        instrument, created = Instrument.objects.get_or_create(id=GENERIC_5790_ID, defaults=generic_5790_defaults())
        if created:
            return instrument, True
        instrument = Instrument.objects.select_for_update().get(pk=GENERIC_5790_ID)
        metadata = instrument.column_metadata or {}
        if metadata.get('generic5790', {}).get('version') != 1:
            return instrument, False
        from .ac_shunt_library_cleanup import backup_instruments
        backup_instruments([instrument], '5790B mode/interval qualifier and absolute specification upgrade', '5790b-v1')
        defaults = generic_5790_defaults()
        old_ids = {f'{GENERIC_5790_ID}-{mode}' for mode, _, _ in MODES}
        old_rows = {row['id']: row for fn in instrument.functions if fn.get('id') in old_ids
                    for row in fn.get('ranges', []) if row.get('id')}
        for row in defaults['functions'][0]['ranges']:
            info = row['generic5790Range']
            old = old_rows.get(f"{GENERIC_5790_ID}-{info['resolutionMode']}-{info['fullScale']:g}", {})
            for key in ('resolution', 'resolutionUnit', 'resolutionDistribution', 'measuringResolution',
                        'measuringResolutionUnit', 'measuringResolutionDistribution', 'includeResolutionInBudget'):
                if key in old:
                    row[key] = old[key]
            # v1 shipped no accuracy; retain any accuracy the user authored.
            if old.get('tolerances'):
                row['tolerances'] = deepcopy(old['tolerances'])
        instrument.functions = defaults['functions'] + [fn for fn in instrument.functions if fn.get('id') not in old_ids]
        instrument.column_metadata = {**metadata, **defaults['column_metadata']}
        instrument.save(update_fields=['functions', 'column_metadata', 'updated_at'])
        return instrument, False
