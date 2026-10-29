"""Read-only AC-shunt snapshots for the full Workbench budget importer.

Never recompute/save calibration results here. Pair analytics are the same
read-only calculation used by the AC-shunt results view.
"""
from collections import OrderedDict
import math
import re

from api.models import CalibrationSession

def reader_resolution_sensitivities(pair, analytics):
    """A compact ppm/volt coefficient for the existing reader resolution.

    Keep phase arrays/settings in AC-shunt. Use the largest accepted cycle's
    absolute sensitivity sum, without assuming cancellation or averaging credit.
    """
    excluded = set(analytics.get('auto_excluded_pairs', [])) | set(analytics.get('manual_excluded_pairs', []))
    accepted = [row for row in analytics.get('pair_rows', [])
                if row['paired_avg'] is not None and row['pair_num'] not in excluded]
    sensitivities = {'std': [], 'ti': []}
    invalid = set()
    range_volts = set()
    for point in pair:
        result, settings = getattr(point, 'results', None), getattr(point, 'settings', None)
        if not result:
            continue
        key = 'fwd_cycle_num' if point.direction == 'Forward' else 'rev_cycle_num'
        indexes = {row[key] for row in accepted}
        cycles = list(result.cycles.filter(cycle_index__in=indexes))
        if not analytics.get('pair_rows') and analytics.get('persistedOnly'):
            cycles = [result]
        try:
            selected_range = float(settings.f5790_range_mode)
            if selected_range not in (.022, .07, .22, .7, 2.2):
                raise ValueError()
            high_resolution = settings.f5790_hires_enabled or settings.f5790_filter_mode in ('MEDIUM', 'SLOW')
            multiplier = 1 if high_resolution or selected_range <= .22 else 10
            range_volts.add(selected_range)
        except (AttributeError, TypeError, ValueError):
            invalid.update(sensitivities)
            continue
        for cycle in cycles:
            for side in sensitivities:
                try:
                    ao, ac, dp, dn = [abs(float(getattr(cycle, f'{side}_{phase}_avg')))
                                      for phase in ('ac_open', 'ac_close', 'dc_pos', 'dc_neg')]
                    dc, av = (dp + dn) / 2, (ao + ac) / 2
                    eta = getattr(result, f'eta_{side}')
                    eta = 1 if eta is None else eta
                    value = multiplier * 1e6 * (1 / dc + av / dc**2) / eta
                    if not math.isfinite(value) or value <= 0:
                        raise ValueError()
                    sensitivities[side].append(value)
                except (TypeError, ValueError, ZeroDivisionError):
                    invalid.add(side)
    return {side: {'ppmPerVolt': max(values) if values and side not in invalid else None,
                   'rangeVolts': max(range_volts) if range_volts else None}
            for side, values in sensitivities.items()}


def session_snapshot(session_id):
    session = CalibrationSession.objects.select_related('calibration__configurations').filter(pk=session_id).first()
    if not session:
        return None
    point_set = getattr(session, 'test_point_set', None)
    points = list(point_set.points.select_related('results', 'settings')) if point_set else []
    sibling_map = {(p.test_point_set_id, p.current, p.frequency, p.direction): p for p in points}
    grouped = OrderedDict()
    for point in points:
        grouped.setdefault((point.current, point.frequency), []).append(point)
    result_points = []
    has_5790 = any(re.search(r'5790\s*[AB]', getattr(session, field) or '', re.I)
                   for field in ('standard_reader_model', 'test_reader_model'))
    for (current, frequency), pair in grouped.items():
        results = [p.results for p in pair if getattr(p, 'results', None)]
        analytics = results[0].build_pair_analytics(sibling_map) if results else None
        # Preserve legacy persisted paired results only if no cycle observations exist.
        if analytics and not analytics['pair_rows'] and results[0].n_pairs_used:
            analytics = {**analytics, 'pair_delta_uut_ppm': results[0].pair_delta_uut_ppm,
                         'pair_type_a_uncertainty_ppm': results[0].pair_type_a_uncertainty_ppm,
                         'n_pairs_used': results[0].n_pairs_used, 'persistedOnly': True}
        reader_resolution = reader_resolution_sensitivities(pair, analytics or {}) if has_5790 else None
        analytics = {key: analytics[key] for key in (
            'pair_delta_uut_ppm', 'pair_type_a_uncertainty_ppm', 'n_pairs_used', 'persistedOnly'
        ) if key in analytics} if analytics else None
        result_points.append({"sourcePointIds": [p.pk for p in pair], "current": float(current),
            "frequency": frequency, "analytics": analytics,
            "stabilityFailed": any(p.is_stability_failed for p in pair),
            **({'readerResolution': reader_resolution} if has_5790 else {})})
    fields = ('standard_instrument_model', 'standard_instrument_serial',
              'test_instrument_model', 'test_instrument_serial',
              'standard_reader_model', 'standard_reader_serial', 'standard_reader_address',
              'test_reader_model', 'test_reader_serial', 'test_reader_address')
    config = getattr(getattr(session, 'calibration', None), 'configurations', None)
    return {"id": session.pk, "name": session.session_name, "createdAt": session.created_at.isoformat(),
            "instruments": {**{field: getattr(session, field) for field in fields},
                            "referenceReportIds": sorted({point.correction_report_id for point in points if point.correction_report_id}),
                            "shuntRange": getattr(config, 'ac_shunt_range', None)},
            "points": result_points}
