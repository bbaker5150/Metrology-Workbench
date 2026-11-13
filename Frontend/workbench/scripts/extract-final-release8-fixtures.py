#!/usr/bin/env python3
"""Extract saved V8.00 risk evidence without opening Excel or executing VBA.

Usage (Python standard library only):
  python scripts/extract-final-release8-fixtures.py \
    --workbook /path/to/the/supplied-release.xlsm \
    --output src/modules/uncertainty/utils/risk8/finalRelease8Vectors.json

This intentionally reads existing OOXML cell values, not the app's results and
not a translated solver. The SHA-256 pins the exact supplied final-release file.
Only numeric math inputs/results and cell references are exported. Instrument
identifiers, analyst details, free text, and the workbook/VBA bytes stay private.

MAIN rows 5-9 and 11 are the populated cases. Hidden RISK_DATA duplicates the
saved MAIN outputs; matching by internal ID is used only as an extraction check,
and those IDs never enter the fixture. Scratch row 7 retains only the last
calculated case (MAIN row 11). Its status strings are evidence for that case
alone; statuses for other cases must not be invented as if Excel captured them.
"""

import argparse
import hashlib
import json
import posixpath
from pathlib import Path
from xml.etree import ElementTree as ET
from zipfile import ZipFile

EXPECTED_SHA256 = '8410cc4812276aff5973c1ac50abd6ef3a6d13ecd114240f418e3b80121d223d'
N = {'s': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
MAIN_ROWS = (5, 6, 7, 8, 9, 11)
INPUT_COLUMNS = {
    'nominal': 'I', 'lowerLimit': 'M', 'upperLimit': 'N',
    'initialGB': 'AB', 'uCal': 'U', 'mu': 'AC', 'xcal': 'AD',
    'tur': 'W', 'reop': 'AF', 'turNeeded': 'AG', 'originalInterval': 'AK',
    'pfaTarget': 'AI', 'reopTarget': 'AJ', 'decayModel': 'AL', 'weibullBeta': 'AM',
}
OUTPUT_COLUMNS = {
    'tolType': 'O', 'asymmetry': 'P',
    'obs': 'AO', 'pfa': 'AP', 'pfr': 'AQ', 'maxReop': 'AR', 'trueReop': 'AS',
    'gbMult': 'AT', 'physGbLower': 'AU', 'physGbUpper': 'AV',
    'mitPfa': 'AW', 'mitPfr': 'AX', 'gbInterval': 'AY', 'mitReop': 'AZ',
    'mitObs': 'BA', 'intPfa': 'BB', 'intPfr': 'BC', 'intInterval': 'BD',
    'intReop': 'BE', 'intObs': 'BF',
}
RISK_COLUMNS = {
    'obs': 'C', 'pfa': 'D', 'pfr': 'E', 'maxReop': 'F', 'trueReop': 'G',
    'gbMult': 'H', 'physGbLower': 'I', 'physGbUpper': 'J',
    'mitPfa': 'K', 'mitPfr': 'L', 'gbInterval': 'M', 'mitReop': 'N',
    'mitObs': 'O', 'intPfa': 'P', 'intPfr': 'Q', 'intInterval': 'R',
    'intReop': 'S', 'intObs': 'T',
}
SCRATCH_INPUT_COLUMNS = {
    'nominal': 'F', 'lowerLimit': 'G', 'upperLimit': 'H', 'initialGB': 'I',
    'uCal': 'J', 'mu': 'K', 'xcal': 'L', 'tur': 'S', 'reop': 'T',
    'turNeeded': 'U', 'originalInterval': 'Z', 'pfaTarget': 'AA',
    'reopTarget': 'AB', 'decayModel': 'AC', 'weibullBeta': 'AD', 'resolution': 'AE',
}
SCRATCH_OUTPUT_COLUMNS = {
    'tolType': 'N', 'asymmetry': 'M', 'obs': 'AG', 'pfa': 'AH', 'pfr': 'AI',
    'maxReop': 'AJ', 'trueReop': 'AK', 'gbMult': 'AL', 'physGbLower': 'AM',
    'physGbUpper': 'AN', 'mitPfa': 'AO', 'mitPfr': 'AP', 'gbInterval': 'AQ',
    'mitReop': 'AR', 'intPfa': 'AS', 'intPfr': 'AT', 'intInterval': 'AU',
    'intReop': 'AV', 'mitObs': 'BA', 'intObs': 'BB',
}
STATUS_COLUMNS = {'statusCore': 'AX', 'statusMit': 'AY', 'statusInt': 'AZ'}


def read_cells(archive, path, shared_strings):
    result = {}
    for cell in ET.fromstring(archive.read(path)).findall('.//s:sheetData/s:row/s:c', N):
        if cell.find('s:f', N) is not None:
            # Evidence must remain saved literal risk outputs, not an evaluated
            # formula guessed by the extractor. Unrelated formulas are skipped.
            continue
        raw = cell.find('s:v', N)
        if cell.get('t') == 'inlineStr':
            value = ''.join(cell.itertext())
        elif raw is None or raw.text is None:
            value = ''
        elif cell.get('t') == 's':
            value = shared_strings[int(raw.text)]
        elif cell.get('t') in ('str', 'e'):
            value = raw.text
        else:
            value = float(raw.text)
        result[cell.attrib['r']] = value
    return result


def extract(workbook):
    digest = hashlib.sha256(workbook.read_bytes()).hexdigest()
    if digest != EXPECTED_SHA256:
        raise ValueError('Workbook SHA-256 differs from the reviewed V8.00 release; do not silently replace the oracle.')
    with ZipFile(workbook) as archive:
        strings = []
        if 'xl/sharedStrings.xml' in archive.namelist():
            strings = [''.join(node.itertext()) for node in
                       ET.fromstring(archive.read('xl/sharedStrings.xml')).findall('s:si', N)]
        rels = {r.attrib['Id']: r.attrib['Target'] for r in
                ET.fromstring(archive.read('xl/_rels/workbook.xml.rels'))}
        sheets = {}
        for sheet in ET.fromstring(archive.read('xl/workbook.xml')).findall('s:sheets/s:sheet', N):
            name = sheet.attrib['name']
            if name not in ('MAIN', 'UUT_TOL_DATA', 'RISK_DATA', 'RISK_CALC_SCRATCH'):
                continue
            target = rels[sheet.attrib[f'{{{REL_NS}}}id']]
            path = target.lstrip('/') if target.startswith('/') else posixpath.normpath('xl/' + target)
            sheets[name] = read_cells(archive, path, strings)

    main, tolerance, risk, scratch = (sheets[n] for n in
                                     ('MAIN', 'UUT_TOL_DATA', 'RISK_DATA', 'RISK_CALC_SCRATCH'))
    cases = []
    for row in MAIN_ROWS:
        internal_id = main[f'D{row}']
        tolerance_row = next(int(cell[1:]) for cell, value in tolerance.items()
                             if cell.startswith('A') and value == internal_id)
        risk_row = next(int(cell[1:]) for cell, value in risk.items()
                        if cell.startswith('B') and value == internal_id)
        inputs = {key: main.get(f'{col}{row}', '') for key, col in INPUT_COLUMNS.items()}
        inputs['resolution'] = tolerance[f'F{tolerance_row}']
        expected = {key: main[f'{col}{row}'] for key, col in OUTPUT_COLUMNS.items()}
        if not all(isinstance(value, (int, float)) for value in expected.values()):
            raise ValueError(f'Expected numeric saved output missing in MAIN row {row}')
        for key, col in RISK_COLUMNS.items():
            if risk[f'{col}{risk_row}'] != expected[key]:
                raise ValueError(f'MAIN/RISK_DATA disagreement for row {row}, {key}')
        case = {
            'id': f'final-release/main-row-{row}',
            'source': {'mainRow': row, 'uutToleranceRow': tolerance_row, 'riskDataRow': risk_row},
            'input': inputs,
            'expected': expected,
        }
        if row == 11:
            for key, col in SCRATCH_INPUT_COLUMNS.items():
                if scratch.get(f'{col}7', '') != inputs[key]:
                    raise ValueError(f'Scratch no longer matches last calculated row: {key}')
            for key, col in SCRATCH_OUTPUT_COLUMNS.items():
                if scratch[f'{col}7'] != expected[key]:
                    raise ValueError(f'Scratch output differs from MAIN row 11: {key}')
            case['source']['scratchRow'] = 7
            case['expectedSavedStatuses'] = {key: scratch[f'{col}7'] for key, col in STATUS_COLUMNS.items()}
        cases.append(case)
    return {
        'source': 'User-supplied final V8.00 release workbook, MAIN!A1 version label',
        'sha256': digest,
        'captureMethod': 'Read-only extraction of saved literal OOXML cells; no VBA execution and no app-generated expected values.',
        'scope': 'Six saved Type 1 cases (five distinct inputs, including one duplicate), default E1 decay. This fixture alone does not establish final-release parity for Types 2-6 or other decay models.',
        'privacy': 'Only math values and source cell locations; no instrument IDs, analyst details, workbook bytes, or VBA source.',
        'sourceMap': {
            'inputMainColumns': INPUT_COLUMNS,
            'resolution': 'UUT_TOL_DATA column F, matched internally by TestPointID; matching IDs are not exported.',
            'outputMainColumns': OUTPUT_COLUMNS,
            'outputMainFieldNames': {key: main[f'{col}4'] for key, col in OUTPUT_COLUMNS.items()},
            'outputRiskDataColumns': RISK_COLUMNS,
            'outputScratchColumns': SCRATCH_OUTPUT_COLUMNS,
            'savedStatusScratchColumns': STATUS_COLUMNS,
            'statusScope': 'Only MAIN row 11 has verified matching saved scratch inputs/outputs and saved status strings.',
        },
        'vbaRoutines': [
            'modRiskBackend.ComputeRiskForMainRow', 'modRiskBackend.ComputeOneRow',
            'modRiskBackend.ApplyResolutionToMitigation_DS',
            'modRiskBackend.BuildRecommendationCandidate_DS_FromLimits',
            'modRiskBackend.GetRPairForInterval', 'modRiskBackend.ComputeLogInterval',
            'modRiskBackend.RB_CopyScratchOutputsToMain', 'modRiskBackend.RB_CopyScratchOutputsToRiskTable',
        ],
        'cases': cases,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--workbook', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    result = extract(args.workbook)
    args.output.write_text(json.dumps(result, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    print(f'Extracted {len(result["cases"])} saved V8.00 cases to {args.output}')


if __name__ == '__main__':
    main()
