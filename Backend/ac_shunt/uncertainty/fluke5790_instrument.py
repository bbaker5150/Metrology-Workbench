"""One serial-independent 5790B definition; never modify users' other meters."""
from .models import Instrument

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


def generic_5790_defaults():
    functions = []
    for mode, label, index in [('medium-slow', 'Medium/Slow', 1), ('fast', 'Fast', 2)]:
        ranges = []
        for row in RESOLUTION_RANGES:
            full_scale, increment = row[0], row[index]
            ranges.append({
                'id': f'{GENERIC_5790_ID}-{mode}-{full_scale:g}',
                'range': f'{full_scale:g} V', 'min': 0, 'max': full_scale, 'unit': 'V',
                'resolution': increment, 'resolutionUnit': 'V',
                'resolutionDistribution': '3.464',
                'measuringResolution': increment, 'measuringResolutionUnit': 'V',
                'measuringResolutionDistribution': '3.464', 'includeResolutionInBudget': True,
                'tolerances': {},
                'source': 'Fluke 5790B Service Manual, page 1-6: Resolution and Range Limits',
                'notes': 'Full voltage increment; rectangular rounding uncertainty = increment / sqrt(12).',
            })
        functions.append({'id': f'{GENERIC_5790_ID}-{mode}',
                          'name': f'Voltage ({label})', 'unit': 'V', 'ranges': ranges})
    return {
        'manufacturer': 'Fluke', 'model': '5790B', 'description': '',
        'instrument_type': 'tmde', 'scope': Instrument.SCOPE_VALIDATED,
        'measurement_area': 'Voltage', 'measurement_area_color': '#5aa6d9',
        'functions': functions,
        'column_metadata': {'generic5790': {'version': 1, 'serialIndependent': True}},
    }


def seed_generic_5790():
    """Idempotent setup: stable ID prevents duplicates and preserves later edits."""
    return Instrument.objects.get_or_create(id=GENERIC_5790_ID, defaults=generic_5790_defaults())
