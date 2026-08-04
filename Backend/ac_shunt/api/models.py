# Backend/ac_shunt/api/models.py
from django.db import models
from django.core.validators import MinValueValidator
from datetime import date
import math
import uuid
import numpy as np


def resolve_active_report(reports):
    """Pick the active Report of Calibration from an iterable of reports.

    A pinned report always wins. Otherwise the report with the newest
    ``calibration_date`` is active (undated reports sort oldest), with ties
    broken by ``created_at`` then ``id`` so the result is deterministic.
    Returns the chosen report, or ``None`` when ``reports`` is empty.
    """
    reports = list(reports)
    if not reports:
        return None

    def sort_key(report):
        return (
            report.calibration_date or date.min,
            report.created_at.timestamp() if report.created_at else 0.0,
            report.id or 0,
        )

    pinned = [r for r in reports if r.is_pinned]
    pool = pinned or reports
    return max(pool, key=sort_key)


def refresh_active_report(device):
    """Recompute and persist which of ``device``'s reports is active.

    Exactly one report ends up with ``is_active=True``. Shared by
    :class:`Shunt` and :class:`TVC`; only the report rows whose flag
    actually changes are written.
    """
    reports = list(device.reports.all())
    if not reports:
        return None
    active = resolve_active_report(reports)
    changed = []
    for report in reports:
        desired = report.pk == active.pk
        if report.is_active != desired:
            report.is_active = desired
            changed.append(report)
    if changed:
        device.reports.model.objects.bulk_update(changed, ['is_active'])
    return active

def get_default_cal_session_name():
    return f"CalSession-{uuid.uuid4().hex[:8]}"

class Message(models.Model):
    text = models.CharField(max_length=255)
    created_at = models.DateTimeField(auto_now_add=True)
    def __str__(self): return self.text

class CalibrationSession(models.Model):
    session_name = models.CharField(
        max_length=255,
        unique=True,
        default=get_default_cal_session_name
    )
    # Standard Instrument (The actual device being used as a reference, e.g., A40B Shunt)
    standard_instrument_model = models.CharField(max_length=100, blank=True, null=True)
    standard_instrument_serial = models.CharField(max_length=100, blank=True, null=True)
    
    # TVC Serials
    standard_tvc_serial = models.CharField(max_length=100, blank=True, null=True)
    test_tvc_serial = models.CharField(max_length=100, blank=True, null=True)
    
    # Standard Reader (The instrument reading the standard, e.g., 3458A)
    standard_reader_model = models.CharField(max_length=100, blank=True, null=True)
    standard_reader_serial = models.CharField(max_length=100, blank=True, null=True)
    standard_reader_address = models.CharField(max_length=100, blank=True, null=True)
    standard_reader_input = models.CharField(max_length=6, blank=True, null=True)

    # Test Instrument (The Unit Under Test, e.g., another A40B Shunt)
    test_instrument_model = models.CharField(max_length=100, blank=True, null=True)
    test_instrument_serial = models.CharField(max_length=100, blank=True, null=True)

    # Test Instrument Reader (The instrument reading the UUT, e.g., 5790B)
    test_reader_model = models.CharField(max_length=100, blank=True, null=True)
    test_reader_serial = models.CharField(max_length=100, blank=True, null=True)
    test_reader_address = models.CharField(max_length=100, blank=True, null=True)
    test_reader_input = models.CharField(max_length=6, blank=True, null=True)
    
    # AC/DC Source Addresses
    ac_source_serial = models.CharField(max_length=100, blank=True, null=True)
    dc_source_serial = models.CharField(max_length=100, blank=True, null=True)
    ac_source_address = models.CharField(max_length=100, blank=True, null=True)
    dc_source_address = models.CharField(max_length=100, blank=True, null=True)

    # Switch Driver Addresses
    switch_driver_address = models.CharField(max_length=100, blank=True, null=True)
    switch_driver_model = models.CharField(max_length=100, blank=True, null=True)
    switch_driver_serial = models.CharField(max_length=100, blank=True, null=True)

    # Optional, independent reader-routing switch.  The legacy switch_driver
    # fields above remain the source-routing assignment so existing sessions
    # and the established two-source workflow are unchanged.  Keeping the two
    # routes independent permits a future bench to use two identical 11713Cs.
    reader_switch_driver_address = models.CharField(max_length=100, blank=True, null=True)
    reader_switch_driver_model = models.CharField(max_length=100, blank=True, null=True)
    reader_switch_driver_serial = models.CharField(max_length=100, blank=True, null=True)
    reader_switch_standard_route = models.CharField(
        max_length=6,
        choices=(("OPEN", "Open / NC"), ("CLOSED", "Closed / NO")),
        default="OPEN",
    )
    reader_switch_settling_time = models.FloatField(default=1.0)

    # Amplifier Address
    amplifier_address = models.CharField(max_length=255, null=True, blank=True)
    amplifier_serial = models.CharField(max_length=255, null=True, blank=True)

    # Physical bench the run happens on. Nullable so every pre-existing
    # session (and single-user Electron installs that never touch the
    # concept) keeps working unchanged; unset sessions implicitly resolve
    # to Workstation.get_default() at request time.
    workstation = models.ForeignKey(
        'Workstation',
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='sessions',
    )

    temperature = models.FloatField(null=True, blank=True, help_text="Temperature in °C")
    humidity = models.FloatField(null=True, blank=True, help_text="Relative Humidity in %RH")
    created_at = models.DateTimeField(auto_now_add=True)
    notes = models.TextField(blank=True, null=True)

    def __str__(self):
        return f"{self.session_name} (Recorded: {self.created_at.strftime('%Y-%m-%d %H:%M')})"

    class Meta:
        ordering = ['-created_at']


class Calibration(models.Model):
    session = models.OneToOneField(
        CalibrationSession,
        related_name='calibration',
        on_delete=models.CASCADE
    )
    
class TestPointSet(models.Model):
    session = models.OneToOneField(
        CalibrationSession,
        on_delete=models.CASCADE,
        related_name='test_point_set'
    )

    def __str__(self):
        return f"TestPointSet for Session: {self.session.session_name}"

class TestPoint(models.Model):
    DIRECTION_CHOICES = [
        ('Forward', 'Forward'),
        ('Reverse', 'Reverse'),
    ]
    test_point_set = models.ForeignKey(
        TestPointSet,
        on_delete=models.CASCADE,
        related_name='points'
    )
    current = models.DecimalField(max_digits=10, decimal_places=5)
    frequency = models.IntegerField()
    direction = models.CharField(max_length=10, choices=DIRECTION_CHOICES, default='Forward')
    order = models.IntegerField(default=0, help_text="Custom sort order for the test point pair")
    is_stability_failed = models.BooleanField(default=False)

    def __str__(self):
        return f"ID: {self.id} | {self.direction} | Current: {self.current}, Frequency: {self.frequency}"
    
    class Meta:
        # Ensure a test point is unique for a given current, frequency, and direction within a set
        unique_together = ('test_point_set', 'current', 'frequency', 'direction')
        ordering = ['order', 'frequency', 'current', 'direction']

class CalibrationTVCCorrections(models.Model):
    calibration = models.OneToOneField(
        Calibration,
        related_name='tvccorrections',
        on_delete=models.CASCADE,
        null=True,
        blank=True
    )
    corrections_data = models.JSONField(default=dict, blank=True)

    def __str__(self):
        return f"TVC Corrections for {self.calibration.session.name if self.calibration and self.calibration.session else 'N/A'}"
    

class CalibrationConfigurations(models.Model):
    calibration = models.OneToOneField(
        Calibration, 
        related_name='configurations',
        on_delete=models.CASCADE,
        null=True,
        blank=True
    )
    ac_shunt_range = models.FloatField(null=True, blank=True)
    amplifier_range = models.FloatField(null=True, blank=True)
    # When true, reverse-pair Fwd_i with Rev_{N+1-i} (cancels linear drift).
    # When false, pair Fwd_i with Rev_i. Operator-toggleable for testing.
    use_abba_pairing = models.BooleanField(
        default=True,
        help_text=(
            "When true, reverse-pair Fwd_i with Rev_{N+1-i} so linear drift "
            "across the run cancels. When false, index-pair Fwd_i with Rev_i. "
            "Toggle for testing/comparison."
        ),
    )
    
class CalibrationSettings(models.Model):
    test_point = models.OneToOneField(
        TestPoint, 
        related_name='settings',
        on_delete=models.CASCADE,
        null=True,
        blank=True
    )
    STABILITY_CHOICES = [
        ('sliding_window', 'Sliding Window'),
        ('iqr_filter', 'IQR Filter'),
    ]
    stability_check_method = models.CharField(
        max_length=20,
        choices=STABILITY_CHOICES,
        default='sliding_window'
    )
    
    initial_warm_up_time = models.IntegerField(null=True, blank=True)
    num_samples = models.IntegerField(default=35, null=True, blank=True)
    settling_time = models.IntegerField(default=120, null=True, blank=True)
    nplc = models.FloatField(default=20, null=True, blank=True, help_text="Integration time in Power Line Cycles for 34420A")
    input_switch_settling_time = models.FloatField(
        null=True,
        blank=True,
        help_text="Operator-selected 8508A FRONT/REAR switch delay in seconds.",
    )
    f8508_dc_filter_enabled = models.BooleanField(default=True)
    f8508_dc_resolution = models.PositiveSmallIntegerField(default=7)
    f8508_dc_fast_enabled = models.BooleanField(default=False)
    f8508_ac_filter_hz = models.PositiveSmallIntegerField(default=100)
    f8508_ac_resolution = models.PositiveSmallIntegerField(default=6)
    f8508_ac_transfer_enabled = models.BooleanField(default=True)
    f8508_ac_dc_coupled = models.BooleanField(default=False)
    f5790_filter_mode = models.CharField(max_length=10, default="MEDIUM")
    f5790_filter_restart = models.CharField(max_length=10, default="MEDIUM")
    f5790_hires_enabled = models.BooleanField(default=True)
    f5790_range_mode = models.CharField(max_length=8, default="AUTO")
    f5790_input_switch_settling_time = models.FloatField(
        default=30.0,
        help_text="Delay after switching INPUT1/INPUT2 on a shared 5790A/B.",
    )
    stability_window = models.IntegerField(default=30, null=True, blank=True)
    stability_threshold_ppm = models.FloatField(default=10, null=True, blank=True)
    stability_max_attempts = models.IntegerField(default=10, null=True, blank=True)
    iqr_filter_enabled = models.BooleanField(default=False)
    iqr_filter_ppm_threshold = models.FloatField(default=15.0, null=True, blank=True)
    ignore_instability_after_lock = models.BooleanField(default=True)
    characterize_test_first = models.BooleanField(default=False)
    characterize_std_first = models.BooleanField(default=False)
    characterization_source = models.CharField(max_length=10, default="DC")
    enable_low_frequency_settings = models.BooleanField(default=False)
    lf_harmonic_projection = models.BooleanField(default=False)
    enable_11hz_filter = models.BooleanField(default=True)
    min_low_freq_settling_time = models.IntegerField(default=0, null=True, blank=True)
    lf_harmonics = models.IntegerField(default=2, null=True, blank=True)

    # Number of full AC-DC measurement cycles to repeat at this test point.
    # Required for Type A statistical uncertainty: u_A = s(delta_i) / sqrt(N),
    # which is meaningful only with N >= 2. Default = 3 to give 2 degrees of
    # freedom while keeping run time reasonable.
    n_cycles = models.PositiveIntegerField(
        default=3,
        validators=[MinValueValidator(2)],
        help_text="Number of full AC-DC cycles to average per test point (>= 2).",
    )


# ---------------------------------------------------------------------------
# Pure math helpers — extracted so the per-cycle finalizer in
# CalibrationConsumer can compute δ for a single cycle's phase averages
# without duplicating the formula, and so a CalibrationResults row can
# reuse the same code in `calculate_ac_dc_difference`. The frontend has a
# parallel copy in `sessionExcelExport.js:calcFullyCorrectedStandard` —
# any change here must be mirrored there.
# ---------------------------------------------------------------------------
def welford_mean_stddev(values):
    """Return (mean, sample_stddev) for an iterable of floats using Welford's
    one-pass algorithm. Returns (None, None) if fewer than 2 values.
    """
    vals = [v for v in values if v is not None]
    if len(vals) < 2:
        return (None, None)
    mean_val = 0.0
    M2 = 0.0
    for index, val in enumerate(vals):
        delta = val - mean_val
        mean_val += delta / (index + 1)
        M2 += delta * (val - mean_val)
    variance = M2 / (len(vals) - 1)
    return (mean_val, math.sqrt(variance))


def compute_delta_uut_ppm(phase_avgs, eta_std, eta_ti, delta_std, delta_ti, delta_std_known):
    """Compute the per-cycle (or aggregate) UUT AC-DC difference in ppm.

    `phase_avgs` is a dict with the 8 keys: std_ac_open_avg, std_dc_pos_avg,
    std_dc_neg_avg, std_ac_close_avg, ti_ac_open_avg, ti_dc_pos_avg,
    ti_dc_neg_avg, ti_ac_close_avg. Any None → returns None.

    Returns float ppm or None.
    """
    required = (
        'std_dc_pos_avg', 'std_dc_neg_avg', 'std_ac_open_avg', 'std_ac_close_avg',
        'ti_dc_pos_avg', 'ti_dc_neg_avg', 'ti_ac_open_avg', 'ti_ac_close_avg',
    )
    if any(phase_avgs.get(k) is None for k in required):
        return None
    eta_std = eta_std if eta_std is not None else 1.0
    eta_ti = eta_ti if eta_ti is not None else 1.0
    delta_std = delta_std if delta_std is not None else 0.0
    delta_ti = delta_ti if delta_ti is not None else 0.0
    delta_std_known = delta_std_known if delta_std_known is not None else 0.0

    try:
        V_DCSTD = (abs(phase_avgs['std_dc_pos_avg']) + abs(phase_avgs['std_dc_neg_avg'])) / 2
        V_ACSTD = (abs(phase_avgs['std_ac_open_avg']) + abs(phase_avgs['std_ac_close_avg'])) / 2
        V_DCUUT = (abs(phase_avgs['ti_dc_pos_avg']) + abs(phase_avgs['ti_dc_neg_avg'])) / 2
        V_ACUUT = (abs(phase_avgs['ti_ac_open_avg']) + abs(phase_avgs['ti_ac_close_avg'])) / 2

        term_STD = ((V_ACSTD - V_DCSTD) * 1_000_000) / (eta_std * V_DCSTD)
        term_UUT = ((V_ACUUT - V_DCUUT) * 1_000_000) / (eta_ti * V_DCUUT)

        return delta_std_known + term_STD - term_UUT + delta_std - delta_ti
    except ZeroDivisionError:
        return None


def aggregate_cycle_deltas(cycle_deltas):
    """Given a list of per-cycle δ values, return (mean, type_a_uncertainty)
    where type_a = s / √N. Returns (None, None) if fewer than 2 numeric
    entries.
    """
    nums = [d for d in cycle_deltas if d is not None]
    if len(nums) < 2:
        return (None, None)
    mean_val, std_dev = welford_mean_stddev(nums)
    if mean_val is None:
        return (None, None)
    return (mean_val, std_dev / math.sqrt(len(nums)))


def _results_n_cycles(results):
    """Return the configured ``n_cycles`` (the operator's source-of-truth
    cycle count) for a CalibrationResults' test point, or None when no
    setting is persisted. Used to cap aggregation so analytics honor the
    chosen N even if a direction physically collected more cycles."""
    if results is None:
        return None
    tp = getattr(results, 'test_point', None)
    settings = getattr(tp, 'settings', None) if tp is not None else None
    n = getattr(settings, 'n_cycles', None)
    try:
        n = int(n)
    except (TypeError, ValueError):
        return None
    return n if n >= 1 else None


def resolve_pair_n_cycles(fwd_results, rev_results):
    """Resolve the single cycle count both directions of a pair should be
    aggregated against. Prefers an explicit ``n_cycles`` setting on either
    side (they are kept in sync by the save path); returns None when neither
    side has one, in which case callers fall back to using every collected
    cycle."""
    for res in (fwd_results, rev_results):
        n = _results_n_cycles(res)
        if n is not None:
            return n
    return None


def _cap_cycle_pairs(pairs, n):
    """Keep only the first ``n`` (cycle_index, delta) tuples — they arrive
    ordered by cycle_index — so cycles beyond the configured N are ignored.
    ``n`` of None means no cap."""
    if n is None:
        return pairs
    return pairs[:n]


def build_pair_rows(fwd_deltas, rev_deltas, use_abba=True):
    """Build the pair table that the analytics UI renders.

    Returns a list of dicts shaped like the JS frontend's row structure:
      { 'pair_num': int (1-based), 'fwd_cycle_num': int, 'rev_cycle_num': int,
        'fwd_delta': float|None, 'rev_delta': float|None, 'paired_avg': float|None }

    ``fwd_deltas``/``rev_deltas`` are *parallel arrays* of either floats or
    (cycle_index, delta) tuples. Cycle ordinals when given let the table
    show "Cy 3" instead of synthetic "Cy 1" when the user has masked some.
    """
    def _split(items):
        idxs, vals = [], []
        for k, item in enumerate(items or []):
            if isinstance(item, (tuple, list)):
                idxs.append(item[0])
                vals.append(item[1])
            else:
                idxs.append(k + 1)
                vals.append(item)
        return idxs, vals

    fwd_idxs, fwd_vals = _split(fwd_deltas)
    rev_idxs, rev_vals = _split(rev_deltas)
    n = max(len(fwd_vals), len(rev_vals))
    rows = []
    for i in range(n):
        fwd_i = i
        rev_i = (len(rev_vals) - 1 - i) if (use_abba and i < len(rev_vals)) else i
        fwd_d = fwd_vals[fwd_i] if fwd_i < len(fwd_vals) else None
        rev_d = rev_vals[rev_i] if 0 <= rev_i < len(rev_vals) else None
        avg = (fwd_d + rev_d) / 2 if (fwd_d is not None and rev_d is not None) else None
        rows.append({
            'pair_num': i + 1,
            'fwd_cycle_num': fwd_idxs[fwd_i] if fwd_i < len(fwd_idxs) else (i + 1),
            'rev_cycle_num': rev_idxs[rev_i] if 0 <= rev_i < len(rev_idxs) else (i + 1),
            'fwd_delta': fwd_d,
            'rev_delta': rev_d,
            'paired_avg': avg,
        })
    return rows


def apply_outlier_filter(pair_rows, mode):
    """Port of the JS Chauvenet (N>=12) / IQR (4<=N<12) sentinel.

    Returns (auto_excluded_set, flagged_set) keyed by pair_num. Only the
    'auto' mode performs rejection; 'none' returns two empty sets.

    Chauvenet uses Z = 1.1 + 0.38*ln(N) as a closed-form approximation of
    the inverse normal CDF threshold for N in [12, 100]. IQR uses the
    standard 1.5x box-and-whisker rule on the unsorted-original pair_num
    mapping so we can mark rows visually without rejecting them.
    """
    auto, flagged = set(), set()
    if mode != 'auto':
        return auto, flagged
    valid = [(r['pair_num'], r['paired_avg']) for r in pair_rows if r.get('paired_avg') is not None]
    n = len(valid)
    if n >= 12:
        mean = sum(v for _, v in valid) / n
        variance = sum((v - mean) ** 2 for _, v in valid) / (n - 1)
        std = math.sqrt(variance)
        Z = 1.1 + 0.38 * math.log(n)
        threshold = Z * std
        for pn, v in valid:
            if abs(v - mean) > threshold:
                auto.add(pn)
    elif n >= 4:
        sorted_vals = sorted(v for _, v in valid)
        q1 = sorted_vals[int(n * 0.25)]
        q3 = sorted_vals[int(n * 0.75)]
        iqr = q3 - q1
        lower, upper = q1 - 1.5 * iqr, q3 + 1.5 * iqr
        for pn, v in valid:
            if v < lower or v > upper:
                flagged.add(pn)
    return auto, flagged


def aggregate_paired_cycles(fwd_deltas, rev_deltas, use_abba=True):
    """Pair Fwd and Rev cycle δ values and roll up to the AC-DC pair
    aggregate (mean, u_A).

    Two pairing modes:

    - ``use_abba=True`` (default, NIST/NPL standard): reverse pairing —
      Fwd_i is paired with Rev_{N+1-i}. All paired midpoint times collapse
      to the same instant, which fully cancels any linear-in-time drift
      contribution to ``s`` (and therefore to u_A). Strongly preferred.
    - ``use_abba=False``: index pairing — Fwd_i with Rev_i. Simpler, but
      linear drift across the run inflates ``s``. Exposed via a session-
      level checkbox for side-by-side comparison.

    Returns ``(mean_pair_delta_ppm, type_a_ppm, n_used)`` or
    ``(None, None, 0)`` when the two lists do not have matched non-null
    lengths ≥ 2 (we need at least 2 paired deltas to define ``s``).
    """
    fwd = [d for d in (fwd_deltas or []) if d is not None]
    rev = [d for d in (rev_deltas or []) if d is not None]
    n = min(len(fwd), len(rev))
    if n < 2:
        return (None, None, n)
    if use_abba:
        paired = [(fwd[i] + rev[n - 1 - i]) / 2 for i in range(n)]
    else:
        paired = [(fwd[i] + rev[i]) / 2 for i in range(n)]
    mean_val, std_dev = welford_mean_stddev(paired)
    if mean_val is None:
        return (None, None, n)
    return (mean_val, std_dev / math.sqrt(n), n)


class CalibrationReadings(models.Model):

    test_point = models.OneToOneField(
        TestPoint,
        related_name='readings',
        on_delete=models.CASCADE,
        null=True,
        blank=True
    )
    
    # --- Standard Instrument Readings ---
    std_ac_open_readings = models.JSONField(default=list, blank=True, null=True)
    std_dc_pos_readings = models.JSONField(default=list, blank=True, null=True)
    std_dc_neg_readings = models.JSONField(default=list, blank=True, null=True)
    std_ac_close_readings = models.JSONField(default=list, blank=True, null=True)

    # --- Test Instrument Readings ---
    ti_ac_open_readings = models.JSONField(default=list, blank=True, null=True)
    ti_dc_pos_readings = models.JSONField(default=list, blank=True, null=True)
    ti_dc_neg_readings = models.JSONField(default=list, blank=True, null=True)
    ti_ac_close_readings = models.JSONField(default=list, blank=True, null=True)

    # --- TVC Sensitivity Characterization Readings ---
    std_char_plus1_readings = models.JSONField(default=list, blank=True, null=True)
    std_char_minus_readings = models.JSONField(default=list, blank=True, null=True)
    std_char_plus2_readings = models.JSONField(default=list, blank=True, null=True)

    ti_char_plus1_readings = models.JSONField(default=list, blank=True, null=True)
    ti_char_minus_readings = models.JSONField(default=list, blank=True, null=True)
    ti_char_plus2_readings = models.JSONField(default=list, blank=True, null=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"Calibration Readings for TestPoint ID: {self.test_point.id} | Session: {self.test_point.test_point_set.session.session_name}"

    def update_related_results(self):
        # print(f"\n[MODELS] --- Starting Result Calculation for TP ID {self.test_point.id} ---", flush=True)
        results, _ = CalibrationResults.objects.get_or_create(test_point=self.test_point)
        
        def calculate_stats(readings, label="Reading"):
            import math
            if not readings:
                return None, None
            
            stable_values = [
                r['value'] for r in readings
                if isinstance(r, dict) and r.get('is_stable', True)
            ]

            # Fallback if no stable readings exist
            if len(stable_values) < 2:
                # print(f"[MODELS - {label}] Warning: < 2 stable readings. Using all {len(readings)} readings as fallback.", flush=True)
                all_values = [r['value'] for r in readings if isinstance(r, dict) and 'value' in r]
                
                if len(all_values) < 2:
                    # print(f"[MODELS - {label}] Insufficient readings to calculate stats. Aborting.", flush=True)
                    return None, None
                stable_values = all_values

            # Welford's Algorithm for strict parity with Frontend/Excel
            mean_val = 0.0
            M2 = 0.0
            for index, val in enumerate(stable_values):
                delta = val - mean_val
                mean_val += delta / (index + 1)
                M2 += delta * (val - mean_val)

            variance = M2 / (len(stable_values) - 1)
            std_dev = math.sqrt(variance)
            
            # print(f"[MODELS - {label}] Calculated from {len(stable_values)} points: Mean = {mean_val:.6f}, StdDev = {std_dev:.6e}", flush=True)
            return mean_val, std_dev

        # --- 1. Standard Averages Update ---
        # print("[MODELS] Calculating Standard Instrument AC/DC Averages...", flush=True)
        results.std_ac_open_avg, results.std_ac_open_stddev = calculate_stats(self.std_ac_open_readings, "STD AC Open")
        results.std_dc_pos_avg, results.std_dc_pos_stddev = calculate_stats(self.std_dc_pos_readings, "STD DC Pos")
        results.std_dc_neg_avg, results.std_dc_neg_stddev = calculate_stats(self.std_dc_neg_readings, "STD DC Neg")
        results.std_ac_close_avg, results.std_ac_close_stddev = calculate_stats(self.std_ac_close_readings, "STD AC Close")

        print("[MODELS] Calculating Test Instrument AC/DC Averages...", flush=True)
        results.ti_ac_open_avg, results.ti_ac_open_stddev = calculate_stats(self.ti_ac_open_readings, "TI AC Open")
        results.ti_dc_pos_avg, results.ti_dc_pos_stddev = calculate_stats(self.ti_dc_pos_readings, "TI DC Pos")
        results.ti_dc_neg_avg, results.ti_dc_neg_stddev = calculate_stats(self.ti_dc_neg_readings, "TI DC Neg")
        results.ti_ac_close_avg, results.ti_ac_close_stddev = calculate_stats(self.ti_ac_close_readings, "TI AC Close")

        # --- 2 & 3. TVC Characterization Averages & Eta (η) Calculation ---
        # ONLY run this if characterization readings actually exist
        has_std_char = bool(self.std_char_plus1_readings and self.std_char_minus_readings and self.std_char_plus2_readings)
        has_ti_char = bool(self.ti_char_plus1_readings and self.ti_char_minus_readings and self.ti_char_plus2_readings)

        if has_std_char or has_ti_char:
            print("[MODELS] Characterization data detected. Calculating Averages and Eta...", flush=True)

            def calculate_eta(v_out_1, v_out_2, v_out_3, label="Unknown"):
                if None in [v_out_1, v_out_2, v_out_3] or v_out_2 == 0: 
                    return None
                denominator = 0.00100050025 
                numerator = ((v_out_1 + v_out_3) / (2 * v_out_2)) - 1
                return numerator / denominator

            # NOTE: The characterized gain (η) is intentionally stored ONLY on the
            # per-point CalibrationResults row (and propagated to in-session
            # siblings by consumers._propagate_characterization_eta). Historically
            # we also wrote to the global TVCSensitivity table here, but that
            # table was session-agnostic and would silently leak a newer
            # session's characterization into older sessions if anything ever
            # read from it. Session isolation is now enforced by keeping η
            # strictly per-session on CalibrationResults.

            # Process Standard TVC Characterization
            if has_std_char:
                std_char_plus1_avg, _ = calculate_stats(self.std_char_plus1_readings, "STD Char +500ppm (1)")
                std_char_minus_avg, _ = calculate_stats(self.std_char_minus_readings, "STD Char -500ppm")
                std_char_plus2_avg, _ = calculate_stats(self.std_char_plus2_readings, "STD Char +500ppm (2)")

                new_eta_std = calculate_eta(std_char_plus1_avg, std_char_minus_avg, std_char_plus2_avg, "STD TVC")
                if new_eta_std is not None and (results.eta_std is None or abs(results.eta_std - new_eta_std) > 1e-9):
                    results.eta_std = new_eta_std

            # Process Test Instrument TVC Characterization
            if has_ti_char:
                ti_char_plus1_avg, _ = calculate_stats(self.ti_char_plus1_readings, "TI Char +500ppm (1)")
                ti_char_minus_avg, _ = calculate_stats(self.ti_char_minus_readings, "TI Char -500ppm")
                ti_char_plus2_avg, _ = calculate_stats(self.ti_char_plus2_readings, "TI Char +500ppm (2)")

                new_eta_ti = calculate_eta(ti_char_plus1_avg, ti_char_minus_avg, ti_char_plus2_avg, "TI TVC")
                if new_eta_ti is not None and (results.eta_ti is None or abs(results.eta_ti - new_eta_ti) > 1e-9):
                    results.eta_ti = new_eta_ti

        # --- 4. Final Save and Math Trigger ---
        results.save()
        results.calculate_ac_dc_difference()
        print(f"[MODELS] --- Result Calculation Complete ---", flush=True)

class CalibrationResults(models.Model):
    test_point = models.OneToOneField(
        TestPoint,
        related_name='results',
        on_delete=models.CASCADE,
        null=True,
        blank=True
    )
    
    def fetch_automatic_corrections(self):
        """Automatically fetches DB correction factors if they haven't been manually set."""
        session = self.test_point.test_point_set.session
        target_freq = float(self.test_point.frequency)
        target_current = float(self.test_point.current)

        # 1. Shunt Correction
        if self.delta_std_known is None and session.standard_instrument_serial:
            cal_config = getattr(session.calibration, 'configurations', None)
            if cal_config and cal_config.ac_shunt_range:
                from .models import Shunt
                # Prefer a manual override when both manual and imported rows
                # exist for the same (serial, range, current).
                shunt = (
                    Shunt.objects
                    .filter(
                        serial_number=session.standard_instrument_serial,
                        range=cal_config.ac_shunt_range,
                    )
                    .order_by('-is_manual')
                    .first()
                )
                if shunt:
                    # Corrections live under the device's active Report of
                    # Calibration; older reports are retained for history but
                    # never feed live math.
                    active_report = shunt.reports.filter(is_active=True).first()
                    if active_report:
                        corr = active_report.corrections.filter(
                            current=target_current,
                            frequency=target_freq,
                        ).first()
                        if corr:
                            self.delta_std_known = corr.correction

        # 2. TVC Interpolation Logic
        def get_tvc_corr(serial):
            if not serial: return None
            from .models import TVC
            try:
                tvc = TVC.objects.get(serial_number=serial)
                active_report = tvc.reports.filter(is_active=True).first()
                corrs = (
                    list(active_report.corrections.all().order_by('frequency'))
                    if active_report else []
                )
                if not corrs: return None
                
                # Exact Match
                for c in corrs:
                    if float(c.frequency) == target_freq: return c.ac_dc_difference
                
                # Interpolation / Extrapolation
                sorted_corrs = sorted(corrs, key=lambda x: x.frequency)
                if target_freq < 1000:
                    next_corr = next((c for c in sorted_corrs if c.frequency > target_freq), None)
                    return next_corr.ac_dc_difference if next_corr else None
                
                for i in range(len(sorted_corrs) - 1):
                    lower, upper = sorted_corrs[i], sorted_corrs[i+1]
                    if lower.frequency < target_freq < upper.frequency:
                        # Linear Interpolation
                        return lower.ac_dc_difference + ((target_freq - lower.frequency) * (upper.ac_dc_difference - lower.ac_dc_difference)) / (upper.frequency - lower.frequency)
                
                # Extrapolation
                if len(sorted_corrs) >= 2:
                    if target_freq < sorted_corrs[0].frequency:
                        f1, d1 = sorted_corrs[0].frequency, sorted_corrs[0].ac_dc_difference
                        f2, d2 = sorted_corrs[1].frequency, sorted_corrs[1].ac_dc_difference
                        return d1 + ((target_freq - f1) * (d2 - d1)) / (f2 - f1)
                    elif target_freq > sorted_corrs[-1].frequency:
                        f1, d1 = sorted_corrs[-2].frequency, sorted_corrs[-2].ac_dc_difference
                        f2, d2 = sorted_corrs[-1].frequency, sorted_corrs[-1].ac_dc_difference
                        return d2 + ((target_freq - f2) * (d2 - d1)) / (f2 - f1)
            except TVC.DoesNotExist:
                return None
            return None

        # The 8508A reads both Y5020 shunt outputs directly. It retains the
        # known Standard shunt correction above, but has no intervening TVC
        # gain or AC-DC correction terms. The 34420A/A40B workflow continues
        # to use its existing TVC corrections and characterized eta values.
        uses_8508 = (
            '8508' in str(session.standard_reader_model or '').upper()
            and '8508' in str(session.test_reader_model or '').upper()
        )
        if uses_8508:
            self.delta_std = 0.0
            self.delta_ti = 0.0
            self.eta_std = 1.0
            self.eta_ti = 1.0
        else:
            if self.delta_std is None:
                self.delta_std = get_tvc_corr(session.standard_tvc_serial)
            if self.delta_ti is None:
                self.delta_ti = get_tvc_corr(session.test_tvc_serial)

        # Set defaults so math doesn't crash
        if self.eta_std is None: self.eta_std = 1.0
        if self.eta_ti is None: self.eta_ti = 1.0
        if self.delta_std is None: self.delta_std = 0.0
        if self.delta_ti is None: self.delta_ti = 0.0
        if self.delta_std_known is None: self.delta_std_known = 0.0

        self.save(update_fields=['delta_std', 'delta_ti', 'delta_std_known', 'eta_std', 'eta_ti'])

    def calculate_ac_dc_difference(self):
        """Performs the final math formulation."""
        # 1. Check if all required averages exist
        required_avgs = [
            self.std_dc_pos_avg, self.std_dc_neg_avg, self.std_ac_open_avg, self.std_ac_close_avg,
            self.ti_dc_pos_avg, self.ti_dc_neg_avg, self.ti_ac_open_avg, self.ti_ac_close_avg
        ]
        if any(v is None for v in required_avgs):
            return None  # Not ready to calculate yet

        # 2. Fetch corrections automatically if not already set
        self.fetch_automatic_corrections()

        # 3. Perform Math (delegated to the shared pure function so the
        #    per-cycle finalizer and this aggregate path compute δ via one
        #    source of truth).
        phase_avgs = {
            'std_ac_open_avg': self.std_ac_open_avg,
            'std_dc_pos_avg': self.std_dc_pos_avg,
            'std_dc_neg_avg': self.std_dc_neg_avg,
            'std_ac_close_avg': self.std_ac_close_avg,
            'ti_ac_open_avg': self.ti_ac_open_avg,
            'ti_dc_pos_avg': self.ti_dc_pos_avg,
            'ti_dc_neg_avg': self.ti_dc_neg_avg,
            'ti_ac_close_avg': self.ti_ac_close_avg,
        }
        delta = compute_delta_uut_ppm(
            phase_avgs,
            eta_std=self.eta_std,
            eta_ti=self.eta_ti,
            delta_std=self.delta_std,
            delta_ti=self.delta_ti,
            delta_std_known=self.delta_std_known,
        )
        if delta is None:
            return None

        self.delta_uut_ppm = delta
        self.save(update_fields=['delta_uut_ppm'])
        return self.delta_uut_ppm

    def recompute_cycle_deltas(self):
        """Re-derive `delta_uut_ppm` for every per-cycle row using the
        row's current correction factors (eta_std, eta_ti, delta_std,
        delta_ti, delta_std_known) and that cycle's stored phase averages.

        Used when the operator edits correction inputs after cycles have
        already been collected — without this, the row-level
        `delta_uut_ppm` would be recomputed but every
        `CalibrationResultsCycle.delta_uut_ppm` (and therefore the pair
        aggregate the headline reads from) would still reflect the OLD
        corrections.

        Cycles missing any of the 8 required phase averages keep their
        existing value as null (compute_delta_uut_ppm returns None).
        """
        eta_std = self.eta_std if self.eta_std is not None else 1.0
        eta_ti = self.eta_ti if self.eta_ti is not None else 1.0
        delta_std = self.delta_std if self.delta_std is not None else 0.0
        delta_ti = self.delta_ti if self.delta_ti is not None else 0.0
        delta_std_known = self.delta_std_known if self.delta_std_known is not None else 0.0
        for cyc in self.cycles.all():
            phase_avgs = {
                'std_ac_open_avg': cyc.std_ac_open_avg,
                'std_dc_pos_avg': cyc.std_dc_pos_avg,
                'std_dc_neg_avg': cyc.std_dc_neg_avg,
                'std_ac_close_avg': cyc.std_ac_close_avg,
                'ti_ac_open_avg': cyc.ti_ac_open_avg,
                'ti_dc_pos_avg': cyc.ti_dc_pos_avg,
                'ti_dc_neg_avg': cyc.ti_dc_neg_avg,
                'ti_ac_close_avg': cyc.ti_ac_close_avg,
            }
            new_delta = compute_delta_uut_ppm(
                phase_avgs,
                eta_std=eta_std,
                eta_ti=eta_ti,
                delta_std=delta_std,
                delta_ti=delta_ti,
                delta_std_known=delta_std_known,
            )
            if new_delta is None:
                # Don't clobber the previous value when phase data is
                # missing — see the "Leave as null (skip)" choice.
                continue
            cyc.delta_uut_ppm = new_delta
            cyc.save(update_fields=['delta_uut_ppm'])

    def recompute_cycle_aggregates(self):
        """After per-cycle δ values are persisted in CalibrationResultsCycle,
        roll them up onto this row: `delta_uut_ppm_avg` = mean(δᵢ),
        `type_a_uncertainty_ppm` = s(δᵢ) / √N. Leaves `delta_uut_ppm` (the
        legacy single-pass value) untouched so older sessions keep showing
        their original number.

        These are *per-direction* aggregates and are diagnostic-only — the
        headline AC-DC δ comes from ``recompute_pair_aggregate`` below.
        """
        # Cap to the configured source-of-truth N so the per-direction
        # diagnostic mean/u_A match the capped pair analytics.
        n_cap = _results_n_cycles(self)
        cycle_deltas = list(
            self.cycles.exclude(delta_uut_ppm__isnull=True)
            .order_by('cycle_index')
            .values_list('delta_uut_ppm', flat=True)
        )
        if n_cap is not None:
            cycle_deltas = cycle_deltas[:n_cap]
        mean_val, type_a = aggregate_cycle_deltas(cycle_deltas)
        update_fields = []
        if mean_val is not None:
            self.delta_uut_ppm_avg = mean_val
            update_fields.append('delta_uut_ppm_avg')
        if type_a is not None:
            self.type_a_uncertainty_ppm = type_a
            update_fields.append('type_a_uncertainty_ppm')
        if update_fields:
            self.save(update_fields=update_fields)
        return (mean_val, type_a)

    def recompute_pair_aggregate(self):
        """Recompute the AC-DC pair aggregate, honoring the persisted
        analytics state (use_abba_pairing override, outlier_filter_mode,
        manual_excluded_pairs).

        Reads the use_abba/filter/exclusion fields off whichever row
        currently has a non-default value (writer side); both rows are
        mirrored so reading either side is equivalent. Then:

          1. Pulls the per-cycle δ values from both directions (with cycle
             indices preserved).
          2. Builds the pair table via ``build_pair_rows``.
          3. Runs ``apply_outlier_filter`` to populate auto/flagged sets.
          4. Drops pairs in (auto ∪ manual), computes mean & u_A = s/√N
             over the survivors.
          5. Mirrors the result + bookkeeping onto BOTH Fwd and Rev rows.

        Returns the paired mean δ in ppm, or ``None`` when fewer than 2
        survivors remain.
        """
        tp = self.test_point
        if tp is None:
            return None
        opposite_direction = 'Reverse' if tp.direction == 'Forward' else 'Forward'
        try:
            sibling_tp = TestPoint.objects.get(
                test_point_set=tp.test_point_set,
                current=tp.current,
                frequency=tp.frequency,
                direction=opposite_direction,
            )
        except TestPoint.DoesNotExist:
            return None
        sibling_results = getattr(sibling_tp, 'results', None)
        if sibling_results is None:
            return None

        fwd_results, rev_results = (
            (self, sibling_results) if tp.direction == 'Forward' else (sibling_results, self)
        )

        # Resolve analytics state: per-TP override beats session config.
        session = tp.test_point_set.session
        cal_cfg = getattr(getattr(session, 'calibration', None), 'configurations', None)
        session_abba = bool(getattr(cal_cfg, 'use_abba_pairing', True))
        # Either Fwd or Rev may hold the override; non-null wins.
        override = self.use_abba_pairing
        if override is None:
            override = sibling_results.use_abba_pairing
        use_abba = bool(override) if override is not None else session_abba

        # Filter mode + manual exclusions: take whichever row has a
        # non-default value so either direction can write.
        filter_mode = self.outlier_filter_mode or sibling_results.outlier_filter_mode or 'none'
        manual = set(self.manual_excluded_pairs or []) | set(sibling_results.manual_excluded_pairs or [])

        # Cap each direction to the configured source-of-truth N so analytics
        # use only the chosen number of cycles even if a direction physically
        # collected more (e.g. N=12 ignores a 13th–15th stray cycle).
        n_cap = resolve_pair_n_cycles(fwd_results, rev_results)
        fwd_pairs = _cap_cycle_pairs(list(
            fwd_results.cycles.exclude(delta_uut_ppm__isnull=True)
            .order_by('cycle_index').values_list('cycle_index', 'delta_uut_ppm')
        ), n_cap)
        rev_pairs = _cap_cycle_pairs(list(
            rev_results.cycles.exclude(delta_uut_ppm__isnull=True)
            .order_by('cycle_index').values_list('cycle_index', 'delta_uut_ppm')
        ), n_cap)

        pair_rows = build_pair_rows(fwd_pairs, rev_pairs, use_abba=use_abba)
        auto, flagged = apply_outlier_filter(pair_rows, filter_mode)

        survivors = [
            r['paired_avg'] for r in pair_rows
            if r['paired_avg'] is not None
            and r['pair_num'] not in auto
            and r['pair_num'] not in manual
        ]
        if len(survivors) >= 2:
            mean_val, std_dev = welford_mean_stddev(survivors)
            u_a = std_dev / math.sqrt(len(survivors)) if std_dev is not None else None
        elif len(survivors) == 1:
            mean_val, u_a = survivors[0], None
        else:
            mean_val, u_a = None, None

        auto_list = sorted(auto)
        flagged_list = sorted(flagged)
        n_used = len(survivors)

        for row in (fwd_results, rev_results):
            row.pair_delta_uut_ppm = mean_val
            row.pair_type_a_uncertainty_ppm = u_a
            row.use_abba_pairing = use_abba
            row.outlier_filter_mode = filter_mode
            row.manual_excluded_pairs = sorted(manual)
            row.auto_excluded_pairs = auto_list
            row.flagged_pairs = flagged_list
            row.n_pairs_used = n_used
            row.save(update_fields=[
                'pair_delta_uut_ppm', 'pair_type_a_uncertainty_ppm',
                'use_abba_pairing', 'outlier_filter_mode',
                'manual_excluded_pairs', 'auto_excluded_pairs',
                'flagged_pairs', 'n_pairs_used',
            ])
        return mean_val

    def build_pair_analytics(self, sibling_map=None):
        """Return a dict describing the pair analytics state for both
        directions (the same data ``recompute_pair_aggregate`` writes,
        plus the full pair_rows table). Used by the serializer to expose
        a single canonical analytics blob to the frontend.

        ``sibling_map`` is an optional dict keyed by
        ``(test_point_set_id, current, frequency, direction)`` → TestPoint,
        prebuilt by callers that have already loaded all sibling points
        (e.g. TestPointViewSet.list). When supplied, the opposite-direction
        sibling is resolved in memory instead of via a DB query — turning
        an O(N) query pattern into O(1) for a list response.
        """
        tp = self.test_point
        if tp is None:
            return None
        opposite = 'Reverse' if tp.direction == 'Forward' else 'Forward'
        sibling_tp = None
        if sibling_map is not None:
            sibling_tp = sibling_map.get(
                (tp.test_point_set_id, tp.current, tp.frequency, opposite)
            )
        if sibling_tp is None:
            try:
                sibling_tp = TestPoint.objects.get(
                    test_point_set=tp.test_point_set,
                    current=tp.current,
                    frequency=tp.frequency,
                    direction=opposite,
                )
            except TestPoint.DoesNotExist:
                sibling_tp = None
        sibling_results = getattr(sibling_tp, 'results', None) if sibling_tp else None
        fwd_results, rev_results = (
            (self, sibling_results) if tp.direction == 'Forward' else (sibling_results, self)
        )
        session = tp.test_point_set.session
        cal_cfg = getattr(getattr(session, 'calibration', None), 'configurations', None)
        session_abba = bool(getattr(cal_cfg, 'use_abba_pairing', True))
        override = self.use_abba_pairing
        if override is None and sibling_results is not None:
            override = sibling_results.use_abba_pairing
        use_abba = bool(override) if override is not None else session_abba
        filter_mode = (
            self.outlier_filter_mode
            or (sibling_results.outlier_filter_mode if sibling_results else None)
            or 'none'
        )
        manual_self = set(self.manual_excluded_pairs or [])
        manual_sib = set(sibling_results.manual_excluded_pairs or []) if sibling_results else set()
        manual = sorted(manual_self | manual_sib)

        n_cap = resolve_pair_n_cycles(fwd_results, rev_results)
        fwd_pairs = _cap_cycle_pairs(list(
            fwd_results.cycles.exclude(delta_uut_ppm__isnull=True)
            .order_by('cycle_index').values_list('cycle_index', 'delta_uut_ppm')
        ) if fwd_results else [], n_cap)
        rev_pairs = _cap_cycle_pairs(list(
            rev_results.cycles.exclude(delta_uut_ppm__isnull=True)
            .order_by('cycle_index').values_list('cycle_index', 'delta_uut_ppm')
        ) if rev_results else [], n_cap)

        pair_rows = build_pair_rows(fwd_pairs, rev_pairs, use_abba=use_abba)
        auto, flagged = apply_outlier_filter(pair_rows, filter_mode)
        return {
            'use_abba_pairing': use_abba,
            'outlier_filter_mode': filter_mode,
            'manual_excluded_pairs': manual,
            'auto_excluded_pairs': sorted(auto),
            'flagged_pairs': sorted(flagged),
            'pair_rows': pair_rows,
            'pair_delta_uut_ppm': self.pair_delta_uut_ppm,
            'pair_type_a_uncertainty_ppm': self.pair_type_a_uncertainty_ppm,
            'n_pairs_used': self.n_pairs_used,
        }

    std_ac_open_avg = models.FloatField(null=True, blank=True)
    std_ac_open_stddev = models.FloatField(null=True, blank=True)
    std_dc_pos_avg = models.FloatField(null=True, blank=True)
    std_dc_pos_stddev = models.FloatField(null=True, blank=True)
    std_dc_neg_avg = models.FloatField(null=True, blank=True)
    std_dc_neg_stddev = models.FloatField(null=True, blank=True)
    std_ac_close_avg = models.FloatField(null=True, blank=True)
    std_ac_close_stddev = models.FloatField(null=True, blank=True)
    
    ti_ac_open_avg = models.FloatField(null=True, blank=True)
    ti_ac_open_stddev = models.FloatField(null=True, blank=True)
    ti_dc_pos_avg = models.FloatField(null=True, blank=True)
    ti_dc_pos_stddev = models.FloatField(null=True, blank=True)
    ti_dc_neg_avg = models.FloatField(null=True, blank=True)
    ti_dc_neg_stddev = models.FloatField(null=True, blank=True)
    ti_ac_close_avg = models.FloatField(null=True, blank=True)
    ti_ac_close_stddev = models.FloatField(null=True, blank=True)

    eta_std = models.FloatField(null=True, blank=True, help_text="Gain factor for Standard instrument system")
    eta_ti = models.FloatField(null=True, blank=True, help_text="Gain factor for Test Instrument system")
    delta_std = models.FloatField(null=True, blank=True, help_text="Known AC-DC difference of the Standard TVC in PPM")
    delta_ti = models.FloatField(null=True, blank=True, help_text="Known AC-DC difference of the TI TVC in PPM")
    delta_std_known = models.FloatField(null=True, blank=True, help_text="Known AC-DC difference of the Standard Shunt in PPM")

    delta_uut_ppm = models.FloatField(null=True, blank=True, help_text="Legacy single-pass UUT AC-DC difference in PPM (pre-N-cycle workflow)")
    delta_uut_ppm_avg = models.FloatField(null=True, blank=True, help_text="Per-direction mean δ across this TestPoint's cycles (ppm). Diagnostic only — the headline AC-DC δ is pair_delta_uut_ppm.")
    type_a_uncertainty_ppm = models.FloatField(
        null=True, blank=True,
        help_text="Per-direction Type A u_A = s(δᵢ)/√N across this TestPoint's cycles (ppm). Diagnostic only — the headline u_A is pair_type_a_uncertainty_ppm."
    )
    # Pair-level aggregate (Forward + Reverse paired). Mirrored on BOTH the
    # Fwd and Rev CalibrationResults rows of a (current, frequency) pair so
    # either side can serve as the source of truth.
    pair_delta_uut_ppm = models.FloatField(
        null=True, blank=True,
        help_text="Paired AC-DC δ_UUT = mean over pair_i = (δ_Fwd_i + δ_Rev_{N+1-i})/2 (ppm). Mirrored on both Fwd and Rev results rows."
    )
    pair_type_a_uncertainty_ppm = models.FloatField(
        null=True, blank=True,
        help_text="Pair-level Type A u_A = s(pair_δ_i)/√N (ppm). Mirrored on both Fwd and Rev results rows."
    )

    # User-controlled analytics state. Mirrored across the Fwd/Rev pair so a
    # single source of truth backs both directions.
    manual_excluded_pairs = models.JSONField(
        default=list, blank=True,
        help_text="1-based pair_num values the operator has excluded from the pair aggregate. Mirrored on both Fwd and Rev rows."
    )
    use_abba_pairing = models.BooleanField(
        null=True, blank=True,
        help_text="Per-TP override of CalibrationConfigurations.use_abba_pairing. None = inherit from session config."
    )
    outlier_filter_mode = models.CharField(
        max_length=16, default='none',
        choices=[('none', 'None'), ('auto', 'Auto (Chauvenet/IQR)')],
        help_text="Outlier auto-rejection mode applied during pair aggregation. Mirrored across the pair."
    )
    auto_excluded_pairs = models.JSONField(
        default=list, blank=True,
        help_text="Computed: pair_num values the backend auto-rejected via outlier_filter_mode. Mirrored across the pair."
    )
    flagged_pairs = models.JSONField(
        default=list, blank=True,
        help_text="Computed: pair_num values flagged (not rejected) by the IQR sentinel for small-N datasets."
    )
    n_pairs_used = models.PositiveIntegerField(
        null=True, blank=True,
        help_text="Computed: count of pairs that survived (auto ∪ manual) exclusion and contributed to pair_delta_uut_ppm."
    )

    combined_uncertainty = models.FloatField(null=True, blank=True, help_text="Calculated combined standard uncertainty (uc) in PPM")
    effective_dof = models.FloatField(null=True, blank=True, help_text="Calculated effective degrees of freedom (veff)")
    k_value = models.FloatField(null=True, blank=True, help_text="Calculated coverage factor (k)")
    expanded_uncertainty = models.FloatField(null=True, blank=True, help_text="Calculated expanded uncertainty (U) in PPM")
    is_detailed_uncertainty_calculated = models.BooleanField(default=False)
    
    manual_uncertainty_components = models.JSONField(default=list, blank=True, null=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"Calibration Results for {self.test_point.test_point_set.session.session_name} at Test Point {self.test_point.id}" if self.test_point else "Calibration Results (no test point)"


class CalibrationResultsCycle(models.Model):
    """One row per AC-DC measurement cycle at a test point.

    Each cycle owns the full `ac_open → dc_pos → dc_neg → ac_close` sequence
    that yielded a single estimate of δ_UUT. The per-cycle phase averages
    and stddevs are persisted here so the new statistics modal and chart
    cycle-filter can reconstruct what happened in each cycle without
    re-aggregating from raw readings.

    The parent `CalibrationResults.delta_uut_ppm_avg` is the mean across
    all `cycle.delta_uut_ppm` values; `type_a_uncertainty_ppm` is
    s(δᵢ)/√N over the same set.
    """

    results = models.ForeignKey(
        CalibrationResults,
        related_name='cycles',
        on_delete=models.CASCADE,
    )
    cycle_index = models.PositiveIntegerField(help_text="1-based cycle ordinal within a test point.")
    delta_uut_ppm = models.FloatField(null=True, blank=True, help_text="δ_UUT for this cycle alone, in PPM.")

    # Per-cycle phase averages (mirror the 8 *_avg fields on CalibrationResults)
    std_ac_open_avg = models.FloatField(null=True, blank=True)
    std_dc_pos_avg = models.FloatField(null=True, blank=True)
    std_dc_neg_avg = models.FloatField(null=True, blank=True)
    std_ac_close_avg = models.FloatField(null=True, blank=True)
    ti_ac_open_avg = models.FloatField(null=True, blank=True)
    ti_dc_pos_avg = models.FloatField(null=True, blank=True)
    ti_dc_neg_avg = models.FloatField(null=True, blank=True)
    ti_ac_close_avg = models.FloatField(null=True, blank=True)

    # Per-cycle within-phase stddevs (short-term sample noise; diagnostic only)
    std_ac_open_stddev = models.FloatField(null=True, blank=True)
    std_dc_pos_stddev = models.FloatField(null=True, blank=True)
    std_dc_neg_stddev = models.FloatField(null=True, blank=True)
    std_ac_close_stddev = models.FloatField(null=True, blank=True)
    ti_ac_open_stddev = models.FloatField(null=True, blank=True)
    ti_dc_pos_stddev = models.FloatField(null=True, blank=True)
    ti_dc_neg_stddev = models.FloatField(null=True, blank=True)
    ti_ac_close_stddev = models.FloatField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ('results', 'cycle_index')
        ordering = ['cycle_index']

    def __str__(self):
        return f"Cycle {self.cycle_index} for Results {self.results_id} (δ={self.delta_uut_ppm})"


class Shunt(models.Model):
    """
    Represents a single physical AC Shunt device (one serial / range).

    A device owns one or more dated :class:`ShuntReport` rows — one per
    Report of Calibration received over the unit's life. The per-input-
    current, per-frequency correction values hang off each report, so the
    same serial can keep a full calibration history without losing the old
    numbers when a new certificate arrives.
    """
    model_name = models.CharField(max_length=100, default='Shunt')
    serial_number = models.CharField(max_length=100)
    range = models.FloatField()
    remark = models.CharField(max_length=255, blank=True, null=True)
    is_manual = models.BooleanField(default=False)

    class Meta:
        # is_manual is part of the key so a user-authored entry can coexist
        # with an imported one for the same physical (serial, range);
        # downstream lookups prefer is_manual=True when both exist.
        unique_together = ('serial_number', 'range', 'is_manual')

    def __str__(self):
        return f"{self.model_name} SN: {self.serial_number} ({self.range}A)"

    def refresh_active_report(self):
        return refresh_active_report(self)


class ShuntReport(models.Model):
    """A dated Report of Calibration for a :class:`Shunt`.

    Each report captures the corrections/uncertainties from one physical
    calibration certificate. Adding a new report for a serial never
    overwrites the prior ones — history is preserved. The report with the
    newest ``calibration_date`` is active by default (feeds live math),
    unless an operator pins an older one.
    """
    shunt = models.ForeignKey(Shunt, on_delete=models.CASCADE, related_name='reports')
    calibration_date = models.DateField(
        null=True, blank=True,
        help_text="Date printed on the Report of Calibration. Drives which report is active.",
    )
    report_number = models.CharField(max_length=120, blank=True, default='')
    received_date = models.DateField(
        null=True, blank=True,
        help_text="Date the certificate was received in the lab (optional, informational).",
    )
    notes = models.TextField(blank=True, default='')
    is_active = models.BooleanField(
        default=False,
        help_text="Materialized flag: the single report whose values feed live calibration math.",
    )
    is_pinned = models.BooleanField(
        default=False,
        help_text="Operator override: force this report active even if a newer-dated one exists.",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-calibration_date', '-created_at']

    def __str__(self):
        label = self.calibration_date.isoformat() if self.calibration_date else 'undated'
        return f"RoC {label} for {self.shunt}"


class ShuntCorrection(models.Model):
    """
    Stores a single correction/uncertainty point (one input current at one
    frequency) belonging to a specific Report of Calibration.
    """
    report = models.ForeignKey(ShuntReport, on_delete=models.CASCADE, related_name='corrections')
    current = models.FloatField()
    frequency = models.IntegerField()
    correction = models.FloatField(null=True, blank=True)
    uncertainty = models.FloatField(null=True, blank=True)

    class Meta:
        unique_together = ('report', 'current', 'frequency')


class TVC(models.Model):
    """
    Represents a single Thermal Voltage Converter device.

    Like :class:`Shunt`, a TVC owns dated :class:`TVCReport` rows so each
    serial keeps its full calibration history.
    """
    serial_number = models.IntegerField(unique=True)
    test_voltage = models.FloatField()
    is_manual = models.BooleanField(default=False)

    def __str__(self):
        return f"TVC Device SN: {self.serial_number}"

    def refresh_active_report(self):
        return refresh_active_report(self)


class TVCReport(models.Model):
    """A dated Report of Calibration for a :class:`TVC` (see :class:`ShuntReport`)."""
    tvc = models.ForeignKey(TVC, on_delete=models.CASCADE, related_name='reports')
    calibration_date = models.DateField(
        null=True, blank=True,
        help_text="Date printed on the Report of Calibration. Drives which report is active.",
    )
    report_number = models.CharField(max_length=120, blank=True, default='')
    received_date = models.DateField(
        null=True, blank=True,
        help_text="Date the certificate was received in the lab (optional, informational).",
    )
    notes = models.TextField(blank=True, default='')
    is_active = models.BooleanField(
        default=False,
        help_text="Materialized flag: the single report whose values feed live calibration math.",
    )
    is_pinned = models.BooleanField(
        default=False,
        help_text="Operator override: force this report active even if a newer-dated one exists.",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-calibration_date', '-created_at']

    def __str__(self):
        label = self.calibration_date.isoformat() if self.calibration_date else 'undated'
        return f"RoC {label} for {self.tvc}"

class TVCSensitivity(models.Model):
    """
    Stores the characterized Gain (η) for a specific TVC at a specific test point.
    """
    tvc = models.ForeignKey(TVC, on_delete=models.CASCADE, related_name='sensitivities')
    current = models.FloatField()
    frequency = models.FloatField()
    gain_eta = models.FloatField()
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ('tvc', 'current', 'frequency')

    def __str__(self):
        return f"TVC {self.tvc.serial_number} Gain: {self.gain_eta} at {self.current}A, {self.frequency}Hz"


class TVCCorrection(models.Model):
    """
    Stores a single correction point belonging to a specific TVC Report of
    Calibration.
    """
    report = models.ForeignKey(TVCReport, on_delete=models.CASCADE, related_name='corrections')
    frequency = models.IntegerField()
    ac_dc_difference = models.IntegerField()
    expanded_uncertainty = models.IntegerField()

    class Meta:
        unique_together = ('report', 'frequency')

class BugReport(models.Model):
    SEVERITY_CHOICES = [
        ('Low', 'Low'),
        ('Medium', 'Medium'),
        ('High', 'High'),
        ('Critical', 'Critical')
    ]
    CATEGORY_CHOICES = [
        ('UI/UX', 'UI/UX'),
        ('Hardware Communication', 'Hardware Communication'),
        ('Calculation Accuracy', 'Calculation Accuracy'),
        ('Database/Sync', 'Database/Sync'),
        ('Other', 'Other')
    ]
    STATUS_CHOICES = [
        ('Not Started', 'Not Started'),
        ('In Work', 'In Work'),
        ('Solved', 'Solved'),
    ]

    title = models.CharField(max_length=255)
    severity = models.CharField(max_length=20, choices=SEVERITY_CHOICES, default='Medium')
    category = models.CharField(max_length=50, choices=CATEGORY_CHOICES, default='UI/UX')
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='Not Started')
    description = models.TextField()
    steps = models.TextField(blank=True, null=True)
    system_info = models.TextField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.severity} - {self.title}"

class Workstation(models.Model):
    """A calibration bench — the physical location where a run happens.

    Workstation identity replaces the client-IP-based claim system so the
    application can be hosted centrally on a VM and still correctly
    attribute which physical bench a host is driving. Every entry is
    rarely-edited reference data managed through the Django admin; the
    optional ``Documents/Portal/workstations.json`` seed file imports an
    initial inventory on a fresh install and is ignored once any
    non-default rows exist.

    The relationship to :class:`CalibrationSession` is intentionally
    nullable — pre-existing sessions (and single-user Electron installs
    that never touch the concept) keep working, falling back to the
    auto-created local bench via :meth:`get_default`.
    """

    name = models.CharField(max_length=100, unique=True)
    identifier = models.SlugField(
        max_length=100,
        unique=True,
        help_text="Stable slug used in URLs / WebSocket payloads. Lower-case, no spaces.",
    )
    location = models.CharField(max_length=200, blank=True, default='')
    is_active = models.BooleanField(default=True)
    is_default = models.BooleanField(
        default=False,
        help_text=(
            "Marks the auto-created local bench. Used as the fallback "
            "workstation when a CalibrationSession has no explicit link."
        ),
    )
    instrument_addresses = models.JSONField(
        default=list,
        blank=True,
        help_text=(
            "Advisory list of GPIB/VISA addresses that physically live at "
            "this bench. Not enforced at run-time — used by the UI to "
            "pre-filter instrument choices when configuring a session."
        ),
    )
    visa_host = models.CharField(
        max_length=200,
        blank=True,
        default='',
        help_text=(
            "NI-VISA remote server host for this bench (configured in NI MAX "
            "-> Remote Systems), e.g. '10.0.0.42'. When set, the central VM "
            "opens this bench's instruments remotely as visa://<host>/<address>. "
            "Blank means the instruments are local to the server process."
        ),
    )
    notes = models.TextField(blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['name']

    def __str__(self):
        return self.name

    def resolve_resource(self, address):
        """Return a VISA resource string for ``address`` qualified to this bench.

        When ``visa_host`` is set (the bench's NI-VISA remote server), a raw
        VISA address like ``GPIB0::22::INSTR`` is rewritten to
        ``visa://<host>/GPIB0::22::INSTR`` so the central VM opens the
        instrument on that bench. Addresses that are already fully qualified
        (``visa://...``) or a blank ``visa_host`` (the local bench) are
        returned unchanged, so single-machine/Electron installs keep working.
        """
        addr = (address or "").strip()
        host = (self.visa_host or "").strip()
        if not host or not addr:
            return addr
        if addr.lower().startswith("visa://"):
            return addr
        return f"visa://{host}/{addr}"

    @classmethod
    def get_default(cls):
        """Return the auto-created local bench, creating it if missing.

        Called from ``entry_point._bootstrap_local_workstation`` at boot and
        as a safety net during request handling so the "Local Workstation"
        invariant holds even if the bootstrap step is ever skipped. Never
        raises — a broken DB surfaces elsewhere.
        """
        ws, _ = cls.objects.get_or_create(
            is_default=True,
            defaults={
                'name': 'Local Workstation',
                'identifier': 'local',
                'location': 'Local',
                'is_active': True,
            },
        )
        return ws


class WorkstationClaim(models.Model):
    """Durable row-backed replacement for the in-memory claim registry.

    Keeping the claim in the DB rather than the process-global
    ``CLAIMED_WORKSTATIONS`` dict gives us two things the dict cannot:

    1. **Crash safety** — a daphne restart no longer strands a workstation
       under a lock nobody owns. Staleness is detected via
       ``last_heartbeat_at`` plus a TTL enforced at claim time.
    2. **Cross-process correctness** — when the deployment eventually runs
       multiple ASGI workers, the claim row remains the single source of
       truth without any inter-process coordination.

    ``owner_channel`` stores the ASGI ``channel_name`` of the WebSocket
    that currently holds the lock. Release/disconnect logic verifies
    ownership against this value before mutating the row so a misrouted
    command cannot steal someone else's bench.
    """

    workstation = models.OneToOneField(
        Workstation,
        on_delete=models.CASCADE,
        related_name='claim',
    )
    owner_channel = models.CharField(max_length=200, db_index=True)
    owner_client_id = models.CharField(max_length=100, blank=True, default='')
    owner_label = models.CharField(
        max_length=200,
        blank=True,
        default='',
        help_text="Human-readable owner description surfaced in the UI.",
    )
    active_session = models.ForeignKey(
        CalibrationSession,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='active_claims',
    )
    claimed_at = models.DateTimeField(auto_now_add=True)
    last_heartbeat_at = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [
            models.Index(fields=['owner_channel']),
            models.Index(fields=['last_heartbeat_at']),
        ]

    def __str__(self):
        return f"Claim on {self.workstation.name} by {self.owner_channel[:40]}"


class CalibrationRunLock(models.Model):
    """Per-bench single-flight lock for an in-progress calibration RUN.

    Distinct from :class:`WorkstationClaim` (a UI/host-level bench reservation
    owned by the *HostSync* socket): a ``CalibrationRunLock`` row exists only
    while a calibration is actively driving a bench's instruments, and is owned
    by the ``CalibrationConsumer`` that started the run. The ``OneToOne`` on
    :class:`Workstation` guarantees at most one active run per bench, and because
    it is a DB row that guarantee holds across multiple ASGI workers — two
    sessions bound to the same bench cannot both start a run.

    ``last_heartbeat_at`` is refreshed while the run is live (the host socket's
    heartbeat). A lock whose heartbeat is older than
    ``settings.CALIBRATION_RUNLOCK_STALE_SECONDS`` is treated as abandoned (a
    crashed worker) and may be taken over by a new run on the same bench.
    """

    workstation = models.OneToOneField(
        Workstation,
        on_delete=models.CASCADE,
        related_name='run_lock',
    )
    session = models.ForeignKey(
        CalibrationSession,
        on_delete=models.CASCADE,
        related_name='run_locks',
    )
    owner_channel = models.CharField(max_length=200, db_index=True)
    acquired_at = models.DateTimeField(auto_now_add=True)
    last_heartbeat_at = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [
            models.Index(fields=['session']),
            models.Index(fields=['last_heartbeat_at']),
        ]

    def __str__(self):
        return f"RunLock on {self.workstation.name} by session {self.session_id}"


class PendingReadingWrite(models.Model):
    """
    Durable local write-outbox for calibration stage saves.

    Every call to `CalibrationConsumer.save_readings_to_db` enqueues one row
    here BEFORE attempting the real write against the default database. If the
    real write succeeds the row is marked `done`; if it fails (typical MSSQL
    outage) the row stays `pending` and the background drainer in
    `api.outbox.run_drainer_forever` retries with exponential backoff until
    the server is reachable again.

    This table lives on the dedicated `outbox` SQLite alias (see
    `api.db_routers.OutboxRouter`) so it is completely independent of the
    MSSQL connection state. All fields are plain JSON-serializable types so
    the row carries everything needed to replay the write without re-reading
    anything from the (possibly unreachable) default DB.
    """

    STATUS_PENDING = 'pending'
    STATUS_IN_FLIGHT = 'in_flight'
    STATUS_DONE = 'done'
    STATUS_FAILED = 'failed'
    STATUS_CHOICES = [
        (STATUS_PENDING, 'Pending'),
        (STATUS_IN_FLIGHT, 'In flight'),
        (STATUS_DONE, 'Done'),
        (STATUS_FAILED, 'Failed'),
    ]

    # Identifying context — enough to resolve the target row on replay.
    session_id = models.IntegerField(db_index=True)
    test_point_id = models.IntegerField(null=True, blank=True, db_index=True)
    test_point_lookup = models.JSONField(
        default=dict, blank=True,
        help_text="Fallback {current, frequency, direction} used when test_point_id is missing."
    )

    # Payload.
    reading_type_full = models.CharField(max_length=64)
    readings_json = models.JSONField(default=list, blank=True)

    # Replay bookkeeping.
    status = models.CharField(
        max_length=16, choices=STATUS_CHOICES, default=STATUS_PENDING, db_index=True
    )
    attempts = models.IntegerField(default=0)
    last_error = models.TextField(blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    last_attempt_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['created_at', 'id']
        indexes = [
            models.Index(fields=['status', 'created_at']),
        ]

    def __str__(self):
        return (
            f"PendingReadingWrite[{self.status}] "
            f"session={self.session_id} tp={self.test_point_id} "
            f"stage={self.reading_type_full} attempts={self.attempts}"
        )
