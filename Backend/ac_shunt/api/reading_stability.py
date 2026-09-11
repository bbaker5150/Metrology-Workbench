"""Cycle-local manual stability edits, shared by live and saved results views."""
from django.db import transaction
from rest_framework.exceptions import ValidationError, NotFound
from .models import CalibrationReadings


def positive_integer(value, name):
    if isinstance(value, bool) or not str(value).isdigit() or int(value) < 1:
        raise ValidationError({'detail': f'{name} must be a positive integer.'})
    return int(value)


@transaction.atomic
def mark_stability(test_point, data):
    key = data.get('reading_key')
    allowed = {f.name for f in CalibrationReadings._meta.fields if f.name.endswith('_readings')}
    if key not in allowed:
        raise ValidationError({'detail': 'Invalid reading key.'})
    stable = data.get('is_stable')
    if not isinstance(stable, bool):
        raise ValidationError({'detail': 'is_stable must be a boolean.'})
    start = positive_integer(data.get('start_index'), 'start_index')
    end = positive_integer(data.get('end_index'), 'end_index')
    try:
        readings = CalibrationReadings.objects.select_for_update().get(test_point=test_point)
    except CalibrationReadings.DoesNotExist:
        raise NotFound('No readings object found for this test point.')
    raw = getattr(readings, key) or []
    cycles = {int(r.get('cycle', 1)) if isinstance(r, dict) else 1 for r in raw}
    cycle = data.get('cycle')
    if cycle is None:
        if cycles - {1}:
            raise ValidationError({'detail': 'Select a cycle before updating stability.'})
        cycle = 1  # Backwards compatibility for untagged, single-cycle recordings.
    cycle = positive_integer(cycle, 'cycle')
    indices = [i for i, r in enumerate(raw)
               if (int(r.get('cycle', 1)) if isinstance(r, dict) else 1) == cycle]
    if start > end or end > len(indices):
        raise ValidationError({'detail': 'Invalid sample range for the selected cycle.'})
    for i in indices[start - 1:end]:
        if not isinstance(raw[i], dict):
            raw[i] = {'value': raw[i], 'cycle': 1}
        raw[i]['is_stable'] = stable
    setattr(readings, key, raw)
    readings.save(update_fields=[key])
    readings.update_related_results()
    if '_char_' not in key:
        readings.recompute_cycle(cycle)
    return {'message': f'Updated {end - start + 1} readings in cycle {cycle} and recalculated statistics.'}
