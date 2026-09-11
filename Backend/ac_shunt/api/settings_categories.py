"""Validated, atomic category saves for calibration points."""
from django.db import transaction
from django.shortcuts import get_object_or_404
from rest_framework.exceptions import ValidationError
from .models import TestPointSet, TestPoint, CalibrationSettings
from .serializers import CalibrationSettingsSerializer

CATEGORY_FIELDS = {
    'general': ['n_cycles'],
    'stability': ['initial_warm_up_time', 'settling_time', 'nplc', 'num_samples',
                  'stability_check_method', 'stability_window', 'stability_threshold_ppm',
                  'stability_max_attempts', 'iqr_filter_ppm_threshold', 'ignore_instability_after_lock'],
    'characterization': ['characterization_source', 'characterize_std_first', 'characterize_test_first'],
    '8508': ['input_switch_settling_time', 'f8508_dc_filter_enabled', 'f8508_dc_resolution',
             'f8508_dc_fast_enabled', 'f8508_ac_filter_hz', 'f8508_ac_resolution',
             'f8508_ac_transfer_enabled', 'f8508_ac_dc_coupled'],
    '5790': ['f5790_filter_mode', 'f5790_filter_restart', 'f5790_hires_enabled',
             'f5790_range_mode', 'f5790_input_switch_settling_time'],
    'low_frequency': ['enable_low_frequency_settings', 'enable_11hz_filter',
                      'min_low_freq_settling_time', 'lf_harmonic_projection', 'lf_harmonics'],
}


def initial_defaults(frequency, first_point, preset):
    """Match the form's effective defaults when the first settings row is created."""
    hz = abs(float(frequency))
    ac_filter = 10 if hz < 40 else 40 if hz < 100 else 100
    return {
        'num_samples': 6, 'settling_time': 45, 'nplc': 100,
        'stability_window': 6, 'stability_threshold_ppm': 25, 'stability_max_attempts': 100,
        'input_switch_settling_time': 12.5 if ac_filter == 10 else 5,
        'f8508_ac_filter_hz': ac_filter, 'f8508_ac_dc_coupled': hz < 40,
        'enable_11hz_filter': False, 'n_cycles': 15, **preset,
        'initial_warm_up_time': preset.get('initial_warm_up_time', 1800) if first_point else 0,
    }


def save_category(session_id, data):
    category, scope = data.get('category'), data.get('scope')
    if category not in CATEGORY_FIELDS or scope not in ('point', 'all'):
        raise ValidationError('Choose a valid settings category and point/all scope.')
    settings = data.get('settings')
    expected = set(CATEGORY_FIELDS[category])
    if category == 'stability' and scope == 'all':
        settings = {key: value for key, value in settings.items() if key != 'initial_warm_up_time'} if isinstance(settings, dict) else settings
        expected.remove('initial_warm_up_time')
    if not isinstance(settings, dict) or set(settings) != expected:
        raise ValidationError('Supply all and only the fields for the selected category.')
    direction = data.get('direction')
    if direction not in ('Forward', 'Reverse'):
        raise ValidationError('Choose Forward or Reverse.')
    # Reuse field types, choices and range checks from the ordinary save API.
    validator = CalibrationSettingsSerializer(data=settings, partial=True)
    validator.is_valid(raise_exception=True)
    values = validator.validated_data
    bounds = {'initial_warm_up_time': 0, 'settling_time': 0, 'num_samples': 2,
              'stability_window': 2, 'stability_max_attempts': 1, 'min_low_freq_settling_time': 0}
    for key, minimum in bounds.items():
        if key in values and (values[key] is None or values[key] < minimum):
            raise ValidationError({key: f'Must be at least {minimum}.'})
    for key in ('nplc', 'stability_threshold_ppm', 'iqr_filter_ppm_threshold'):
        if key in values and (values[key] is None or values[key] <= 0):
            raise ValidationError({key: 'Must be greater than zero.'})
    if category == 'stability' and values['stability_window'] > values['num_samples']:
        raise ValidationError({'stability_window': 'Cannot exceed the sample count.'})
    if 'lf_harmonics' in values and values['lf_harmonics'] not in (1, 2, 3):
        raise ValidationError({'lf_harmonics': 'Choose 1, 2 or 3.'})
    coordinates = {name: data.get(name) for name in ('current', 'frequency')}
    from .serializers import TestPointSerializer
    point_validator = TestPointSerializer(data={**coordinates, 'direction': direction})
    point_validator.is_valid(raise_exception=True)
    coordinates = {name: point_validator.validated_data[name] for name in coordinates}

    preset_data = data.get('default_settings', {})
    allowed_defaults = set().union(*CATEGORY_FIELDS.values())
    if not isinstance(preset_data, dict) or not set(preset_data) <= allowed_defaults:
        raise ValidationError('Invalid default setup fields.')
    preset_validator = CalibrationSettingsSerializer(data=preset_data, partial=True)
    preset_validator.is_valid(raise_exception=True)
    preset = preset_validator.validated_data

    with transaction.atomic():
        point_set = get_object_or_404(TestPointSet.objects.select_for_update(), session_id=session_id)
        source = point_set.points.filter(**coordinates).first()
        if source is None:
            raise ValidationError('The selected point is no longer in this session. Refresh and try again.')
        first = point_set.points.order_by('order', 'id').first()
        first_key = (first.current, first.frequency)
        pairs = list(point_set.points.values('current', 'frequency', 'order')) if scope == 'all' else [{**coordinates, 'order': source.order}]
        unique = {(pair['current'], pair['frequency']): pair for pair in pairs}
        updated = 0
        for pair in unique.values():
            directions = (direction,)
            for target_direction in directions:
                point, _ = TestPoint.objects.get_or_create(test_point_set=point_set,
                    current=pair['current'], frequency=pair['frequency'], direction=target_direction,
                    defaults={'order': pair['order']})
                existing = CalibrationSettings.objects.filter(test_point=point).first()
                changes = dict(values)
                if existing is None:
                    changes = {**initial_defaults(pair['frequency'], (pair['current'], pair['frequency']) == first_key, preset), **changes}
                if scope == 'point' and category == 'stability' and (pair['current'], pair['frequency']) != first_key:
                    changes['initial_warm_up_time'] = 0
                    values['initial_warm_up_time'] = 0
                if existing is None and 'n_cycles' not in values:
                    # Creating a reader/stability profile must not reset the pair's cycle count.
                    sibling = CalibrationSettings.objects.filter(test_point__test_point_set=point_set,
                        test_point__current=pair['current'], test_point__frequency=pair['frequency']).first()
                    if sibling is not None:
                        changes['n_cycles'] = sibling.n_cycles
                # These explicit category actions are direction-specific, including cycles.
                # Bypass the legacy post_save sibling mirror for this endpoint only.
                if existing is not None:
                    CalibrationSettings.objects.filter(pk=existing.pk).update(**changes)
                else:
                    CalibrationSettings.objects.bulk_create([CalibrationSettings(test_point=point, **changes)])
                updated += 1
    return {'updated_points': updated, 'settings': dict(values), 'category': category, 'scope': scope}
