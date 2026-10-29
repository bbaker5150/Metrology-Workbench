"""Read-only AC-shunt snapshots for the full Workbench budget importer.

Never recompute/save calibration results here. Pair analytics are the same
read-only calculation used by the AC-shunt results view.
"""
from collections import OrderedDict

from api.models import CalibrationSession


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
    for (current, frequency), pair in grouped.items():
        results = [p.results for p in pair if getattr(p, 'results', None)]
        analytics = results[0].build_pair_analytics(sibling_map) if results else None
        # Preserve legacy persisted paired results only if no cycle observations exist.
        if analytics and not analytics['pair_rows'] and results[0].n_pairs_used:
            analytics = {**analytics, 'pair_delta_uut_ppm': results[0].pair_delta_uut_ppm,
                         'pair_type_a_uncertainty_ppm': results[0].pair_type_a_uncertainty_ppm,
                         'n_pairs_used': results[0].n_pairs_used, 'persistedOnly': True}
        # Send only the aggregates used by the budget, not phase readings or certificates.
        analytics = {key: analytics[key] for key in (
            'pair_delta_uut_ppm', 'pair_type_a_uncertainty_ppm', 'n_pairs_used', 'persistedOnly'
        ) if key in analytics} if analytics else None
        result_points.append({"sourcePointIds": [p.pk for p in pair], "current": float(current),
            "frequency": frequency, "analytics": analytics,
            "stabilityFailed": any(p.is_stability_failed for p in pair)})
    fields = ('standard_instrument_model', 'standard_instrument_serial',
              'test_instrument_model', 'test_instrument_serial')
    config = getattr(getattr(session, 'calibration', None), 'configurations', None)
    return {"id": session.pk, "name": session.session_name, "createdAt": session.created_at.isoformat(),
            "instruments": {**{field: getattr(session, field) for field in fields},
                            "referenceReportIds": sorted({point.correction_report_id for point in points if point.correction_report_id}),
                            "shuntRange": getattr(config, 'ac_shunt_range', None)},
            "points": result_points}
