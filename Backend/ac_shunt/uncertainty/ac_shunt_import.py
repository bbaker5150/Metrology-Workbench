"""Read-only AC-shunt snapshots for the full Workbench budget importer.

Never recompute/save calibration results here. Pair analytics are the same
read-only calculation used by the AC-shunt results view.
"""
import math
from collections import OrderedDict

from api.models import CalibrationSession, Shunt, TVC, resolve_active_report


def finite(value):
    return value is not None and math.isfinite(float(value))


def report_info(report, selection):
    return {"id": report.pk, "number": report.report_number,
            "date": str(report.calibration_date or ""), "selection": selection}


def shunt_source(session, point, configured_range):
    report = point.correction_report
    candidates = [(report, "saved test-point report")] if report else []
    if not report and session.standard_instrument_serial and configured_range:
        devices = Shunt.objects.filter(serial_number=session.standard_instrument_serial,
                                       range=configured_range).order_by('-is_manual', 'id')
        candidates = [(resolve_active_report(device.reports.all()), "current report (legacy point)")
                      for device in devices.prefetch_related('reports__corrections')]
    for report, selection in candidates:
        if not report:
            continue
        correction = next((c for c in report.corrections.all()
                           if math.isclose(c.current, float(point.current), abs_tol=1e-9)
                           and c.frequency == point.frequency), None)
        if correction and finite(correction.uncertainty) and correction.uncertainty >= 0:
            return {"expandedPpm": correction.uncertainty, "correctionPpm": correction.correction,
                    "report": report_info(report, selection), "serial": report.shunt.serial_number,
                    "model": report.shunt.model_name, "range": report.shunt.range}
    return None


def tvc_source(serial, frequency):
    try:
        device = TVC.objects.prefetch_related('reports__corrections').filter(serial_number=int(serial)).first()
    except (ValueError, TypeError):
        return None
    report = resolve_active_report(device.reports.all()) if device else None
    if not report:
        return None
    # Uncertainty is not interpolated: a missing certificate point is explicit.
    correction = next((c for c in report.corrections.all() if c.frequency == frequency), None)
    if not correction or not finite(correction.expanded_uncertainty) or correction.expanded_uncertainty < 0:
        return None
    return {"expandedPpm": correction.expanded_uncertainty,
            "correctionPpm": correction.ac_dc_difference,
            "report": report_info(report, "current TVC report; historical report not stored"),
            "serial": str(serial), "model": "TVC", "testVoltage": device.test_voltage}


def session_snapshot(session_id):
    session = CalibrationSession.objects.filter(pk=session_id).first()
    if not session:
        return None
    config = getattr(getattr(session, 'calibration', None), 'configurations', None)
    point_set = getattr(session, 'test_point_set', None)
    points = list(point_set.points.select_related('results', 'settings', 'correction_report__shunt')
                  .prefetch_related('results__cycles', 'correction_report__corrections')) if point_set else []
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
        sources = [shunt_source(session, p, getattr(config, 'ac_shunt_range', None)) for p in pair]
        reader_points = []
        for point in pair:
            row = getattr(point, 'results', None)
            settings = getattr(point, 'settings', None)
            reader_points.append({"direction": point.direction,
                "rangeMode": getattr(settings, 'f5790_range_mode', None),
                "nplc": getattr(settings, 'nplc', None),
                "analogFilterRequested": bool(getattr(settings, 'enable_low_frequency_settings', False)
                                               and getattr(settings, 'enable_11hz_filter', False)),
                "eta_std": getattr(row, 'eta_std', None), "eta_ti": getattr(row, 'eta_ti', None),
                "phases": {f'{side}_{phase}': getattr(row, f'{side}_{phase}_avg', None)
                           for side in ('std', 'ti') for phase in ('ac_open', 'ac_close', 'dc_pos', 'dc_neg')}})
        result_points.append({"sourcePointIds": [p.pk for p in pair], "current": float(current),
            "frequency": frequency, "analytics": analytics,
            "stabilityFailed": any(p.is_stability_failed for p in pair),
            "shuntSources": sources, "readerPoints": reader_points,
            "tvcs": {side: tvc_source(getattr(session, f'{role}_tvc_serial'), frequency)
                     for side, role in [('std', 'standard'), ('ti', 'test')]}})
    fields = ('standard_instrument_model', 'standard_instrument_serial', 'test_instrument_model',
              'test_instrument_serial', 'standard_reader_model', 'standard_reader_serial',
              'test_reader_model', 'test_reader_serial', 'standard_tvc_serial', 'test_tvc_serial',
              'standard_reader_address', 'test_reader_address', 'temperature', 'humidity')
    return {"id": session.pk, "name": session.session_name, "createdAt": session.created_at.isoformat(),
            "instruments": {field: getattr(session, field) for field in fields},
            "shuntRange": getattr(config, 'ac_shunt_range', None), "points": result_points}
