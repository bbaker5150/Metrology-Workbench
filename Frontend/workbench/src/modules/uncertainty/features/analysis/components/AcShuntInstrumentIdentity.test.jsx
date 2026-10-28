import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { EditableDescriptionCell } from './UncertaintyPanel';

it.each([
  'NIST reference AC shunt · 20 A',
  'Fluke Y5020 · 5965004 Fluke Y5020 · 5965004 NIST reference AC shunt · 20 A',
])('displays one TMDE identity for new and previously imported names: %s', name => {
  const onCommit = vi.fn();
  render(<EditableDescriptionCell make="Fluke" model="Y5020 · 5965004" name={name} onCommit={onCommit}/>);
  const label = screen.getByRole('button', {name:'Fluke Y5020 · 5965004 NIST reference AC shunt · 20 A'});
  expect(label.textContent.match(/Fluke Y5020 · 5965004/g)).toHaveLength(1);
  expect(onCommit).not.toHaveBeenCalled();
});
