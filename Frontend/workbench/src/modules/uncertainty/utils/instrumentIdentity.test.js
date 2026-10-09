import { expect, it } from 'vitest';
import { instrumentDeleteTarget } from './instrumentIdentity';
it('identifies a single instrument with its displayed identity and a batch by count', () => {
  const instruments=[{id:7,description:'Flowmeter',instrument:{manufacturer:'Cox',model:'CPT',nickname:'T1'}}];
  expect(instrumentDeleteTarget(['7'],instruments)).toBe('“(T1) Cox CPT Flowmeter”');
  expect(instrumentDeleteTarget([7,8,9],instruments)).toBe('3 selected instruments');
  expect(instrumentDeleteTarget([42],[])).toBe('“Instrument”');
});
