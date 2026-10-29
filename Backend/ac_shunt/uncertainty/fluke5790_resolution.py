"""One-time library setup for 5790 main-input voltage resolution.

Fluke 5790A/B Operators Manuals, Table 4-5 and HIRES command. These are
reporting increments, not calibration uncertainties. The active import profile
selects normal versus high resolution; no accuracy specifications are replaced.
"""
from copy import deepcopy
import math
import re
from django.db import router, transaction
from .models import Instrument
from .ac_shunt_library_cleanup import backup_instruments

SOURCES = {
    '5790A': 'https://assets.fluke.com/manuals/5790a___omeng0400.pdf',
    '5790B': 'https://media.fluke.com/f969b653-c483-4d78-a50e-b10800c204a4_original%20file.pdf',
}
# Main inputs, not the optional wideband input. The AC-shunt acquisition UI
# supports fixed ranges from 22 mV through 2.2 V.
RANGES = (.022, .07, .22, .7, 2.2, 7, 22, 70, 220, 700, 1000)
VOLT_UNITS = {'V': 1, 'mV': 1e-3, 'uV': 1e-6, 'µV': 1e-6, 'μV': 1e-6}


def reader_model(item):
    match = re.search(r'\b5790[AB]\b', f'{item.model} {item.description}', re.I)
    return match.group().upper() if match else None


def resolution_profile(model, maximum):
    if not math.isfinite(maximum) or maximum < .022:
        return None
    bound = next((value for value in RANGES if maximum <= value * (1 + 1e-9)), None)
    if bound is None:
        return None
    high = 1e-7 if bound <= 2.2 else 1e-6 if bound <= 22 else 1e-5 if bound <= 220 else 1e-4
    return {'version': 1, 'rangeVolts': bound, 'highResolutionVolts': high,
            'normalResolutionVolts': high if bound <= .22 else high * 10,
            'source': SOURCES[model], 'conditions': 'Main input; HIRES ON or MEDIUM/SLOW filter. Full increment; rectangular ±half increment.'}


def apply_profile(row, profile):
    # Preserve the saved uncertainty/correction data and IDs. Subsequent manual
    # resolution edits survive restarts because the setup is versioned.
    row.update(measuringResolution=profile['highResolutionVolts'], measuringResolutionUnit='V',
               measuringResolutionDistribution='3.464', includeResolutionInBudget=True,
               fluke5790Resolution=profile)
    for nested in ('tolerance', 'tolerances'):
        if isinstance(row.get(nested), dict):
            for key in ('resolution', 'resolutionUnit', 'resolutionDistribution', 'measuringResolution',
                        'measuringResolutionUnit', 'measuringResolutionDistribution', 'includeResolutionInBudget'):
                row[nested].pop(key, None)
    for key in ('resolution', 'resolutionUnit', 'resolutionDistribution'):
        row.pop(key, None)


def seed_5790_resolution():
    """Upgrade existing shared readers once; never alter saved budget snapshots."""
    updates = []
    for item in Instrument.objects.filter(scope='validated'):
        model = reader_model(item)
        if not model or (item.column_metadata or {}).get('fluke5790ResolutionVersion') == 1:
            continue
        functions = deepcopy(item.functions or [])
        covered_modes = set()
        for function in functions:
            if 'wideband' in function.get('name', '').lower():
                continue
            for row in function.get('ranges', []):
                scale = VOLT_UNITS.get(row.get('unit') or function.get('unit'))
                try:
                    maximum = abs(float(row.get('max', row.get('value')))) * scale if scale else None
                except (ValueError, TypeError):
                    maximum = None
                profile = resolution_profile(model, maximum) if maximum else None
                if profile:
                    apply_profile(row, profile)
                    mode = re.search(r'\b(AC|DC)\b', function.get('name', ''), re.I)
                    covered_modes.update([mode.group().upper()] if mode else ['AC', 'DC'])
        # Older entries may only have ppm variability or AC voltage. Add the
        # missing voltage functions without changing their authored sources.
        for mode in ('AC', 'DC'):
            if mode in covered_modes:
                continue
            ranges = []
            for bound in RANGES:
                if mode == 'DC' and bound < .22:
                    continue
                row = {'id': f'5790-resolution-{mode}-{bound:g}', 'min': 0, 'max': bound,
                       'unit': 'V', 'tolerances': {}}
                apply_profile(row, resolution_profile(model, bound))
                ranges.append(row)
            functions.append({'id': f'5790-resolution-{mode}', 'name': f'{mode} Voltage', 'unit': 'V', 'ranges': ranges})
        updates.append((item, functions))
    if not updates:
        return 0
    backup_instruments([item for item, _ in updates], '5790 voltage resolution setup', '5790-resolution')
    with transaction.atomic(using=router.db_for_write(Instrument)):
        for item, functions in updates:
            item.functions = functions
            item.column_metadata = {**(item.column_metadata or {}), 'fluke5790ResolutionVersion': 1}
            item.save(update_fields=['functions', 'column_metadata', 'updated_at'])
    return len(updates)
