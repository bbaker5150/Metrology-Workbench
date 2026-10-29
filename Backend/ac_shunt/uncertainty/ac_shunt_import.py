"""Read-only AC-shunt snapshots for the full Workbench budget importer.

Never recompute/save calibration results here. Pair analytics are the same
read-only calculation used by the AC-shunt results view.
"""
from collections import OrderedDict
import re

from api.models import CalibrationSession

PHASES = tuple(f'{side}_{phase}_avg' for side in ('std', 'ti')
               for phase in ('ac_open', 'ac_close', 'dc_pos', 'dc_neg'))


def reader_resolution_points(pair, analytics):
    """Only accepted cycle means/settings needed to propagate reader resolution.

    Never transmit raw sample arrays or use excluded cycles. Legacy aggregates
    can supply their saved phase means when no cycle rows are available.
    """
    excluded = set(analytics.get('auto_excluded_pairs', [])) | set(analytics.get('manual_excluded_pairs', []))
    accepted = [row for row in analytics.get('pair_rows', [])
                if row['paired_avg'] is not None and row['pair_num'] not in excluded]
    payload = []
    for point in pair:
        result, settings = getattr(point, 'results', None), getattr(point, 'settings', None)
        if not result:
            continue
        key = 'fwd_cycle_num' if point.direction == 'Forward' else 'rev_cycle_num'
        indexes = {row[key] for row in accepted}
        cycles = list(result.cycles.filter(cycle_index__in=indexes))
        if not analytics.get('pair_rows') and analytics.get('persistedOnly'):
            cycles = [result]
        for cycle in cycles:
            payload.append({'direction': point.direction, 'cycleIndex': getattr(cycle, 'cycle_index', None),
                'phases': {key[:-4]: getattr(cycle, key) for key in PHASES},
                'eta_std': result.eta_std, 'eta_ti': result.eta_ti,
                'rangeMode': getattr(settings, 'f5790_range_mode', None),
                'filterMode': getattr(settings, 'f5790_filter_mode', None),
                'hiresEnabled': getattr(settings, 'f5790_hires_enabled', None)})
    return payload


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
    has_5790 = any(re.search(r'5790[AB]', getattr(session, field) or '', re.I)
                   for field in ('standard_reader_model', 'test_reader_model'))
    for (current, frequency), pair in grouped.items():
        results = [p.results for p in pair if getattr(p, 'results', None)]
        analytics = results[0].build_pair_analytics(sibling_map) if results else None
        # Preserve legacy persisted paired results only if no cycle observations exist.
        if analytics and not analytics['pair_rows'] and results[0].n_pairs_used:
            analytics = {**analytics, 'pair_delta_uut_ppm': results[0].pair_delta_uut_ppm,
                         'pair_type_a_uncertainty_ppm': results[0].pair_type_a_uncertainty_ppm,
                         'n_pairs_used': results[0].n_pairs_used, 'persistedOnly': True}
        reader_points = reader_resolution_points(pair, analytics or {}) if has_5790 else None
        # Only 5790 sessions need phase means for resolution propagation.
        analytics = {key: analytics[key] for key in (
            'pair_delta_uut_ppm', 'pair_type_a_uncertainty_ppm', 'n_pairs_used', 'persistedOnly'
        ) if key in analytics} if analytics else None
        result_points.append({"sourcePointIds": [p.pk for p in pair], "current": float(current),
            "frequency": frequency, "analytics": analytics,
            "stabilityFailed": any(p.is_stability_failed for p in pair),
            **({'readerPoints': reader_points} if has_5790 else {})})
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
