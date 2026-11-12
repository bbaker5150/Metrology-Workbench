import { expect, it } from 'vitest';
import { formatInstrumentIdentity, formatErrorSourceDescription, formatTmdeBudgetLabel, instrumentDeleteTarget } from './instrumentIdentity';

it('puts secondary uncertainty names first without rewriting authored names or primary labels', () => {
  const source = { name: 'Reference DMM', instrument: { manufacturer: 'Keysight', model: '3458A', nickname: 'STD' } };
  const identity = '(STD) Keysight 3458A Reference DMM';
  for (const name of ['Thermal drift', 'Accuracy', 'Temperature - correction']) {
    const component = { tmdeUncertaintySourceId: 'secondary', tmdeUncertaintySourceName: name };
    expect(formatTmdeBudgetLabel(source, component, 'Accuracy')).toBe(`${name} – ${identity}`);
    expect(component.tmdeUncertaintySourceName).toBe(name);
  }
  expect(formatTmdeBudgetLabel(source, { tmdeUncertaintySourceName: 'Legacy source' })).toBe(`Legacy source – ${identity}`);
  expect(formatTmdeBudgetLabel(source, { tmdeUncertaintySourceId: 'primary' }, 'Accuracy')).toBe(`${identity} - TMDE Error`);
  expect(formatTmdeBudgetLabel(source, { isResolution: true }, 'Resolution')).toBe(`${identity} - Resolution`);
  expect(formatTmdeBudgetLabel(source, {}, 'Set tolerance')).toBe(`${identity} - Set error limit`);
});
it('identifies a single instrument with its displayed identity and a batch by count', () => {
  const instruments=[{id:7,description:'Flowmeter',instrument:{manufacturer:'Cox',model:'CPT',nickname:'T1'}}];
  expect(instrumentDeleteTarget(['7'],instruments)).toBe('“(T1) Cox CPT Flowmeter”');
  expect(instrumentDeleteTarget([7,8,9],instruments)).toBe('3 selected instruments');
  expect(instrumentDeleteTarget([42],[])).toBe('“Instrument”');
});

it.each([
  'NIST reference AC shunt · 20 A',
  'Fluke Y5020 · 5965004 NIST reference AC shunt · 20 A',
  'Fluke Y5020 · 5965004 Fluke Y5020 · 5965004 NIST reference AC shunt · 20 A',
])('shows one make/model/serial for imported TMDE label %s', name => {
  const item={name,instrument:{manufacturer:'Fluke',model:'Y5020 · 5965004'}};
  const expected='Fluke Y5020 · 5965004 NIST reference AC shunt · 20 A';
  expect(formatInstrumentIdentity(item)).toBe(expected);
  expect(formatErrorSourceDescription(item)).toBe(expected);
  expect(item.name).toBe(name);
});

it('retains tags and distinct model text without truncating partial prefix matches', () => {
  expect(formatInstrumentIdentity({manufacturer:'Fluke',model:'Y5020',description:'Fluke Y5020B adapter',nickname:'Reference'}))
    .toBe('(Reference) Fluke Y5020 Fluke Y5020B adapter');
  expect(formatInstrumentIdentity({manufacturer:'Fluke',model:'Y5020',description:'Y5020'})).toBe('Fluke Y5020');
});
