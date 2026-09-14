/** Historical regression inputs, freshly captured against Beta.7 in Excel.
 * Full synthetic matrix and capture provenance: beta7Vectors.json.
 * No app-generated expected values are used for workbook parity.
 */
import vectors from './beta7Vectors.json';
export const GOLDEN_VECTORS = vectors.cases
  .filter((vector) => vector.id.startsWith('legacy-row-'))
  .map((vector) => ({
    name: vector.name || vector.id,
    source: 'workbook v8.00-Beta.7, Excel VBA Value2 capture',
    input: vector.input,
    resolution: vector.input.resolution,
    expected: vector.expected,
    tol: 9,
  }));
