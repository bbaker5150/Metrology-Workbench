"""Compare tagged shunt records using complete calibration data, never names alone."""
import json
import math
import re


def catalog_key(row):
    return row['model'], row['serial'].strip().casefold(), float(row['rangeA'])


def catalog_variant_key(row):
    return (*catalog_key(row), bool(row.get('isManual', False)))


def catalog_standard_type(row):
    if manual_corrections(row):
        return 'MANUAL'
    values = [float(point['uncertaintyPpm']) for point in reported_uncertainty_points(row)]
    if values:
        return 'CHECK STD' if all(math.isclose(value, 100, rel_tol=0, abs_tol=1e-9) for value in values) else 'NIST'
    return row.get('standardType', '')


def manual_corrections(row):
    text = ' '.join(str(value or '') for value in (row.get('remark'), (row.get('report') or {}).get('notes')))
    return row.get('isManual') is True or bool(re.search(
        r'\bmanual(?:ly)?\b|\btemp(?:orary)?\s+corrections?\b|\bcopied\s+from\b|\bused\b.*\bcorrections?\b', text, re.I))


def reported_uncertainty_points(row):
    """Only report values count as evidence; a TI acceptance limit does not."""
    result = []
    for point in (row.get('report') or {}).get('points') or []:
        values = [point.get(key) for key in ('currentA', 'frequencyHz', 'uncertaintyPpm')]
        try:
            if any(value is None or isinstance(value, bool) or not math.isfinite(float(value)) for value in values):
                continue
            current, frequency, uncertainty = map(float, values)
        except (ValueError, TypeError):
            continue
        if current > 0 and frequency > 0 and uncertainty >= 0:
            result.append(point)
    return result


def matching_uncertainty_records(identity, catalog):
    """Require exact model/serial and, when known, the physical rating."""
    return [row for row in catalog
            if row.get('model') == identity.get('model')
            and str(row.get('serial', '')).strip().casefold() == str(identity.get('serial', '')).strip().casefold()
            and (identity.get('shuntRange') is None or row.get('rangeA') == identity['shuntRange'])
            and ('isManual' not in identity or bool(row.get('isManual', False)) == identity['isManual'])
            and reported_uncertainty_points(row)]


def correction_signature(row):
    points = (row.get('report') or {}).get('points') or []
    result = []
    for point in points:
        values = [point.get(key) for key in ('currentA', 'frequencyHz', 'correctionPpm', 'uncertaintyPpm')]
        if any(value is None or not math.isfinite(float(value)) for value in values):
            return None
        values = tuple(float(value) for value in values)
        if values[0] <= 0 or values[1] <= 0 or values[3] < 0:
            return None
        result.append(values)
    return tuple(sorted(result)) if result else None


def correction_aliases(catalog):
    """Map each proven equivalent tagged record to its canonical catalog row.

    Numeric Fluke serials may carry a separated tag, such as -2 or (temporary).
    Non-numeric serials are supported when the untagged serial also exists.
    Partial reports or missing correction values never establish equivalence.
    """
    groups = {}
    names = {row['serial'].strip().casefold() for row in catalog}
    for row in catalog:
        serial = row['serial'].strip().casefold()
        numeric = re.match(r'^(\d{5,})(?:[\s._(\-].+)?$', serial)
        bases = [name for name in names if serial.startswith(name) and len(serial) > len(name)
                 and serial[len(name)] in ' ._(-']
        base = numeric.group(1) if numeric else min(bases, key=len) if bases else serial
        signature = correction_signature(row)
        if signature is not None:
            groups.setdefault((row['model'], base, float(row['rangeA']), bool(row.get('isManual', False)), signature), []).append(row)
    aliases = {}
    for rows in groups.values():
        canonical = min(rows, key=lambda row: (len(row['serial'].strip()), row['serial'].casefold()))
        for row in rows:
            if catalog_variant_key(row) != catalog_variant_key(canonical):
                aliases[catalog_variant_key(row)] = canonical
    return aliases


def serial_aliases(canonical, aliases):
    key = catalog_variant_key(canonical)
    return sorted(serial for (_, serial, _, _), target in aliases.items() if catalog_variant_key(target) == key)


def definition_signature(functions):
    # These fields identify rows or report provenance, not their budget behavior.
    ignored = {'id', 'qualifierGroupId', 'acShuntSource', 'source', 'notes'}
    def clean(value):
        if isinstance(value, dict):
            return {key: clean(item) for key, item in value.items() if key not in ignored}
        if isinstance(value, list):
            return [clean(item) for item in value]
        return value
    return json.dumps(clean(functions), sort_keys=True, allow_nan=False)
