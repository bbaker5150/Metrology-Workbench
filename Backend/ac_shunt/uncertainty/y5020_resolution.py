"""Compact voltage-to-ppm sensitivity for the Y5020 AC/DC comparison.

Each of the eight phase means retains one full digit of rounding uncertainty.
Phase rounding errors combine independently in quadrature. No reduction for
samples, cycles or forward/reverse averaging is claimed: use the largest
accepted cycle contribution. Type A is unaffected.
"""
import math
import re

from .fluke5790_instrument import GENERIC_5790_ID, RESOLUTION_RANGES


def is_y5020(model):
    return bool(re.search(r'\bY5020\b', str(model or ''), re.IGNORECASE))


def phase_sensitivity(row, result):
    squares = 0.0
    for role in ('std', 'ti'):
        values = [getattr(row, f'{role}_{phase}_avg', None)
                  for phase in ('ac_open', 'ac_close', 'dc_pos', 'dc_neg')]
        if any(value is None or not math.isfinite(value) for value in values):
            return None
        ac = (abs(values[0]) + abs(values[1])) / 2
        dc = (abs(values[2]) + abs(values[3])) / 2
        eta = getattr(result, f'eta_{role}', None)
        eta = 1.0 if eta is None else abs(eta)
        if dc <= 0 or not math.isfinite(eta) or eta <= 0:
            return None
        squares += 2 * ((1e6 / (2 * eta * dc)) ** 2
                        + (1e6 * ac / (2 * eta * dc ** 2)) ** 2)
    return math.sqrt(squares)


def resolution_snapshot(points, analytics, current):
    excluded = set((analytics or {}).get('manual_excluded_pairs', [])) | set(
        (analytics or {}).get('auto_excluded_pairs', []))
    accepted = {'Forward': set(), 'Reverse': set()}
    for row in (analytics or {}).get('pair_rows', []):
        if row['paired_avg'] is not None and row['pair_num'] not in excluded:
            accepted['Forward'].add(row['fwd_cycle_num'])
            accepted['Reverse'].add(row['rev_cycle_num'])
    cases = {}
    used_nominal = False
    used_auto_bound = False
    for point in points:
        settings = getattr(point, 'settings', None)
        # These are the same defaults used by the AC-shunt acquisition profile.
        mode = str(getattr(settings, 'f5790_filter_mode', 'MEDIUM') or 'MEDIUM').upper()
        high_res = getattr(settings, 'f5790_hires_enabled', True)
        function = 'medium-slow' if high_res or mode in ('MEDIUM', 'SLOW') else 'fast'
        raw_range = str(getattr(settings, 'f5790_range_mode', '2.2') or '2.2').upper()
        # AUTO does not save the actual selected range. The acquisition profile
        # supports ranges through 2.2 V: use that upper-bound digit, not an
        # inferred small range that could understate resolution in Fast mode.
        if raw_range == 'AUTO':
            full_scale = 2.2
            used_auto_bound = True
        else:
            try:
                full_scale = float(raw_range)
            except (ValueError, TypeError):
                full_scale = 2.2
        if full_scale not in {row[0] for row in RESOLUTION_RANGES}:
            full_scale = 2.2
        result = getattr(point, 'results', None)
        cycles = list(result.cycles.filter(cycle_index__in=accepted.get(point.direction, set()))) if result else []
        values = [phase_sensitivity(cycle, result) for cycle in cycles]
        if not values and result and not (analytics or {}).get('pair_rows'):
            values = [phase_sensitivity(result, result)]
        if not values or any(value is None for value in values):
            # Older sessions may contain only ppm results. Y5020 is a 10 mOhm
            # shunt; use its nominal voltage explicitly instead of dropping the
            # contribution or requiring the user to supply phase readings.
            nominal_voltage = float(current) * 0.01
            etas = [getattr(result, f'eta_{role}', None) for role in ('std', 'ti')]
            etas = [1.0 if eta is None else abs(eta) for eta in etas]
            nominal = (math.sqrt(sum(1 / eta ** 2 for eta in etas)) * 1e6 / nominal_voltage
                       if nominal_voltage > 0 and all(math.isfinite(eta) and eta > 0 for eta in etas) else None)
            values = [value if value is not None else nominal for value in values] or [nominal]
            used_nominal = True
        finite_values = [value for value in values if value is not None and math.isfinite(value)]
        if not finite_values:
            continue
        key = (function, full_scale)
        cases[key] = max(cases.get(key, 0), *finite_values)
    return {
        'method': 'independent-phase-rounding-max-cycle',
        'nominalVoltageFallback': used_nominal, 'autoRangeUpperBound': used_auto_bound,
        'cases': [{'functionId': f'{GENERIC_5790_ID}-{function}',
                   'rangeId': f'{GENERIC_5790_ID}-{function}-{full_scale:g}',
                   'ppmPerVolt': value} for (function, full_scale), value in cases.items()],
    }
