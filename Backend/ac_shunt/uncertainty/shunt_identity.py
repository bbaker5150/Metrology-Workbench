"""Compare tagged shunt records using complete calibration data, never names alone."""
import json
import math
import re


def catalog_key(row):
    return row['model'], row['serial'].strip().casefold(), float(row['rangeA'])


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
            groups.setdefault((row['model'], base, float(row['rangeA']), signature), []).append(row)
    aliases = {}
    for rows in groups.values():
        canonical = min(rows, key=lambda row: (len(row['serial'].strip()), row['serial'].casefold()))
        for row in rows:
            if catalog_key(row) != catalog_key(canonical):
                aliases[catalog_key(row)] = canonical
    return aliases


def serial_aliases(canonical, aliases):
    key = catalog_key(canonical)
    return sorted(serial for (_, serial, _), target in aliases.items() if catalog_key(target) == key)


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
