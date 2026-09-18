import { expect, it } from 'vitest';
import { rawDecimal, exposeDecimalOnHover } from './rawDecimal';
it.each([[1.23456789e-12, '0.00000000000123456789'], [-2e21, '-2000000000000000000000'], ['± 3.1e-7 V', '± 0.00000031 V'], [0, '0']])('expands %s without rounding', (input, expected) => expect(rawDecimal(input)).toBe(expected));
it('prefers the unrounded title in every table and leaves descriptive titles alone', () => {
  document.body.innerHTML = '<table><tbody><tr><td title="1.23456789e-12"><span>1.23e-12</span></td><td title="Edit tolerance">1e-3</td></tr></tbody></table>';
  const cells = document.querySelectorAll('td');
  exposeDecimalOnHover({ target: cells[0].firstChild });
  exposeDecimalOnHover({ target: cells[1] });
  expect(cells[0].title).toBe('0.00000000000123456789');
  expect(cells[1].title).toBe('Edit tolerance\n0.001');
  exposeDecimalOnHover({ target: cells[1] });
  expect(cells[1].title).toBe('Edit tolerance\n0.001');
});
