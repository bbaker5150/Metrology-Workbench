"""One physical library entry, with distinct reference and TI specifications."""
import copy

from django.db import router, transaction

from .models import Instrument
from .serializers import instrument_to_dict
from .ac_shunt_library_cleanup import backup_instruments


def point_key(row):
    return (row.get('value', row.get('min')), row.get('unit'),
            row.get('qualifier', {}).get('value', row.get('qualifier', {}).get('min')))


def default_ti_functions(item):
    functions = copy.deepcopy(item.get('functions', []))
    for function in functions:
        for row in function.get('ranges', []):
            row['tolerances'] = {'reading': {'high': 100, 'low': -100, 'unit': 'ppm',
                                           'symmetric': True, 'distribution': 'not_set'}}
            row['includeResolutionInBudget'] = False
            row['source'] = 'Lab TI requirement'
    return functions


def combine_functions(preferred, fallback):
    result = copy.deepcopy(preferred)
    for function in fallback:
        target = next((old for old in result if (old.get('name'), old.get('unit')) ==
                       (function.get('name'), function.get('unit'))), None)
        if target is None:
            result.append(copy.deepcopy(function))
            continue
        points = {point_key(row) for row in target.get('ranges', [])}
        target.setdefault('ranges', []).extend(copy.deepcopy(row) for row in function.get('ranges', []) if point_key(row) not in points)
    return result


def consolidate_role_definitions(definitions):
    """Return fresh definitions and old TI -> canonical reference IDs."""
    items = copy.deepcopy(definitions)
    refs = [item for item in items if item.get('type') == 'tmde' and item.get('acShuntIdentity')]
    retired = {}
    for ref in refs:
        identity = ref['acShuntIdentity']
        identity['roles'] = ['tmde', 'uut']
        identity.setdefault('uutFunctions', default_ti_functions(ref))
        identity.setdefault('uutTypeBComponents', [])
    for ti in [item for item in items if item.get('type') == 'uut' and item.get('acShuntIdentity')]:
        identity = ti['acShuntIdentity']
        candidates = [ref for ref in refs if ref['acShuntIdentity']['model'] == identity['model']
            and identity['serial'].casefold() in [ref['acShuntIdentity']['serial'].casefold(),
                *ref['acShuntIdentity'].get('serialAliases', [])]
            and (identity.get('shuntRange') is None or identity['shuntRange'] == ref['acShuntIdentity'].get('shuntRange'))]
        if 'isManual' in identity:
            candidates = [ref for ref in candidates if ref['acShuntIdentity'].get('isManual', False) == identity['isManual']]
        elif len(candidates) > 1:
            report_ids = {(row.get('report') or {}).get('id') for row in identity.get('calibrationEvidence', [])} - {None}
            exact = [ref for ref in candidates if report_ids.intersection(
                (row.get('report') or {}).get('id') for row in ref['acShuntIdentity'].get('calibrationEvidence', []))]
            candidates = exact or [ref for ref in candidates if ref['acShuntIdentity'].get('isManual')]
        if len(candidates) != 1:
            continue
        ref = candidates[0]
        target = ref['acShuntIdentity']
        # Existing TI edits take precedence; missing report points still get
        # the lab limit. The reference's report uncertainties are untouched.
        target['uutFunctions'] = combine_functions(ti['functions'], target['uutFunctions'])
        target['uutTypeBComponents'] = copy.deepcopy(ti.get('typeBComponents', []))
        target['formerLibraryIds'] = sorted(set(target.get('formerLibraryIds', []) + [ti['id']]))
        retired[ti['id']] = ref['id']
    return [item for item in items if item['id'] not in retired], retired


def consolidate_library_roles(profiles=()):
    alias = router.db_for_write(Instrument)
    with transaction.atomic(using=alias):
        shared = list(Instrument.objects.using(alias).select_for_update().filter(scope=Instrument.SCOPE_VALIDATED))
        # Authored instruments remain separate. Only generated shunt TIs are
        # folded into the physical entry; snapshots in saved budgets stay put.
        generated = [item for item in shared if (item.instrument_type == 'tmde' or item.id.startswith('ac-shunt-ti-'))
                     and (item.column_metadata or {}).get('acShuntIdentity')]
        values, _ = consolidate_role_definitions([instrument_to_dict(item) for item in generated] +
                                                [instrument_to_dict(item) for item in profiles])
        existing_profiles = {item.id: item.column_metadata['acShuntIdentity'].get('uutFunctions') for item in generated if item.instrument_type == 'tmde'}
        for value in values:
            if existing_profiles.get(value['id']):
                identity = value['acShuntIdentity']
                identity['uutFunctions'] = combine_functions(existing_profiles[value['id']], identity['uutFunctions'])
        # Apply actual saved TI definitions last, preserving their user edits.
        values, retired = consolidate_role_definitions(values + [instrument_to_dict(item) for item in generated if item.instrument_type == 'uut'])
        by_id = {item.id: item for item in shared}
        removed = [by_id[key] for key in retired if key in by_id and key != retired[key]]
        backup = backup_instruments(removed, 'Consolidated TI/reference library copies', 'ac-shunt-roles') if removed else None
        for value in values:
            item = by_id.get(value['id'])
            if item and item.instrument_type == 'tmde':
                metadata = {**item.column_metadata, 'acShuntIdentity': value['acShuntIdentity']}
                if metadata != item.column_metadata:
                    item.column_metadata = metadata
                    item.save(update_fields=['column_metadata', 'updated_at'])
        for item in removed:
            Instrument.objects.using(alias).filter(scope=Instrument.SCOPE_LOCAL, source_id=item.id).update(source_id=retired[item.id])
            item.delete()
    return len(removed), backup
