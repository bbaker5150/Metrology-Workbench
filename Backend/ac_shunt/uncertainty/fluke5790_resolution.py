"""Set resolution on existing 5790 ranges; never generate reader functions.

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
    match = re.search(r'5790\s*([AB])\b', f'{item.model} {item.description}', re.I)
    return f'5790{match.group(1).upper()}' if match else None


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


def unchanged_generated_function(function, model):
    """Remove only the untouched functions mistakenly appended by version 1."""
    mode = next((mode for mode in ('AC', 'DC') if function.get('id') == f'5790-resolution-{mode}'), None)
    if not mode:
        return False
    ranges = []
    for bound in RANGES:
        if mode == 'DC' and bound < .22:
            continue
        row = {'id': f'5790-resolution-{mode}-{bound:g}', 'min': 0, 'max': bound,
               'unit': 'V', 'tolerances': {}}
        apply_profile(row, resolution_profile(model, bound))
        ranges.append(row)
    return function == {'id': f'5790-resolution-{mode}', 'name': f'{mode} Voltage', 'unit': 'V', 'ranges': ranges}


def seed_5790_resolution():
    """Repair existing local/shared readers once, preserving subsequent edits."""
    updates = []
    for item in Instrument.objects.all():
        model = reader_model(item)
        version = (item.column_metadata or {}).get('fluke5790ResolutionVersion', 0)
        if not model or version >= 2:
            continue
        functions = [deepcopy(fn) for fn in (item.functions or [])
                     if not (version == 1 and unchanged_generated_function(fn, model))]
        for function in functions:
            if 'wideband' in function.get('name', '').lower():
                continue
            for row in function.get('ranges', []):
                # A range already updated by v1 may have been edited since.
                if version == 1 and row.get('fluke5790Resolution'):
                    continue
                unit = row.get('unit') or function.get('unit')
                scale = VOLT_UNITS.get(unit)
                try:
                    maximum = abs(float(row.get('max', row.get('value')))) * scale if scale else None
                except (ValueError, TypeError):
                    maximum = None
                # Existing AC/DC-difference definitions use ppm ranges. Their
                # reader's reporting increment is still a voltage, not ppm.
                profile = resolution_profile(model, maximum or 2.2) if scale or unit == 'ppm' else None
                if profile:
                    apply_profile(row, profile)
        updates.append((item, functions))
    if not updates:
        return 0
    backup_instruments([item for item, _ in updates], '5790 voltage resolution setup', '5790-resolution')
    with transaction.atomic(using=router.db_for_write(Instrument)):
        for item, functions in updates:
            item.functions = functions
            item.column_metadata = {**(item.column_metadata or {}), 'fluke5790ResolutionVersion': 2}
            item.save(update_fields=['functions', 'column_metadata', 'updated_at'])
    return len(updates)
