import { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import UncertaintyPanel, { EditableDescriptionCell, buildFunctionGroupedRows } from './UncertaintyPanel';

const lengthInstrument = { id: 'length-library', manufacturer: 'Acme', model: 'L100', description: 'Rule', scope: 'validated',
  functions: [{ id: 'length', name: 'Length', ranges: [{ id: 'length-range', min: 0, max: 10, unit: 'm', resolution: '0.01' }] },
    { id: 'angle', name: 'Angle', ranges: [{ id: 'angle-range', min: 0, max: 90, unit: 'deg', resolution: '0.1' }] }] };
const weightInstrument = { id: 'weight-library', manufacturer: 'Other', model: 'W200', description: 'Mass standard', scope: 'validated',
  functions: [{ id: 'weight', name: 'Weight', ranges: [{ id: 'weight-range', min: 0, max: 5, unit: 'kg' }] }] };
const instruments = [weightInstrument, lengthInstrument];

describe('description function search', () => {
  it('finds functions across the library, without area ranking or selecting on blur or Enter', () => {
    const pick = vi.fn();
    render(<EditableDescriptionCell functionKey="torque" onCommit={vi.fn()} instruments={instruments} onPickLibrary={pick} />);
    fireEvent.click(screen.getByRole('button', { name: 'Click to add description' }));
    const input = screen.getByPlaceholderText('Mfr.');
    fireEvent.change(input, { target: { value: 'length' } });
    expect(screen.getByText('Acme L100 Rule')).toBeInTheDocument();
    expect(screen.queryByText('Other W200 Mass standard')).not.toBeInTheDocument();
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.blur(input);
    expect(pick).not.toHaveBeenCalled();
    fireEvent.mouseDown(screen.getByText('Acme L100 Rule'));
    expect(pick).toHaveBeenCalledWith(lengthInstrument);
  });
});

const Harness = ({ viewMode, save, initialSession }) => {
  const [session, setSession] = useState(initialSession || { id: 'areas', name: 'Areas',
    measurementAreaGroups: [{ name: 'Torque', kind: 'uut', color: '#abcdef' }, { name: 'Torque', kind: 'tmde', color: '#abcdef' }],
    uuts: [], tmdes: [], testPoints: [], measurementAreas: [], uncReq: {},
  });
  const [selected, setSelected] = useState([]);
  return <UncertaintyPanel
    sessionData={session} onSessionSave={next => { save(next); setSession(next); }}
    testPointData={{ id: 'point', viewMode, measurementType: 'derived',
      testPointInfo: { measurementArea: 'Torque', parameter: { name: 'Moment', unit: 'N·m' } },
      associatedUutIds: [], tmdeTolerances: [], components: [], specifications: {} }}
    instruments={instruments} currentUutSelection={selected} setCurrentUutSelection={setSelected}
    tmdeTolerancesData={[]} onUpdateTestPoint={vi.fn()} setNotification={vi.fn()}
    uutNominal={{ value: 5, unit: 'N·m' }}
  />;
};

describe.each(['session', 'point'])('independent Measurement Areas in %s view', viewMode => {
  it('adds an area directly from the inline UUT name field', async () => {
    const save = vi.fn();
    render(<Harness viewMode={viewMode} save={save} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'New UUT measurement area name' }), { target: { value: 'Inspection' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add Measurement Area from UUT table' }));
    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ measurementAreaGroups: expect.arrayContaining([expect.objectContaining({ name: 'Inspection' })]) })));
    expect(screen.getByRole('textbox', { name: 'New UUT measurement area name' })).toHaveValue('');
    expect(document.querySelector('[data-tour="uut-function-menu"]')).toBeNull();
  });

  it('drops into another measurement area without editing the library definition', () => {
    const save = vi.fn();
    const original = { id: 'source', description: 'Source rule', measurementAreaNames: ['Torque'], instrument: lengthInstrument };
    render(<Harness viewMode={viewMode} save={save} initialSession={{
      id: 'drag', measurementAreaGroups: [{ name: 'Torque', kind: 'uut' }, { name: 'Inspection', kind: 'uut' }],
      uuts: [original, { id: 'target', description: 'Target standard', measurementAreaNames: ['Inspection'], instrument: weightInstrument }],
      tmdes: [], testPoints: [], uncReq: {},
    }} />);
    if (viewMode === 'point') fireEvent.click(screen.getByRole('button', { name: 'Show all UUT measurement areas' }));
    const target = viewMode === 'session'
      ? screen.getByRole('button', { name: 'Other W200 Target standard' }).closest('tr')
      : screen.getAllByLabelText('Measurement area subsection name').find(node => node.textContent === 'Inspection').closest('tr');
    fireEvent.drop(target, { dataTransfer: { getData: () => JSON.stringify({ items: [{ item: original, kind: 'uut', sourceFunctionKey: 'torque' }] }) } });
    expect(save.mock.lastCall[0].uuts.find(item => item.id === 'source').measurementAreaNames).toEqual(['Inspection']);
    expect(save.mock.lastCall[0].uuts.find(item => item.id === 'source').instrument).toEqual(lengthInstrument);
  });

  it('adds explicitly chosen Length and Weight instruments to Torque and preserves both function trees', async () => {
    const save = vi.fn();
    render(<Harness viewMode={viewMode} save={save} />);
    for (const [kind, instrument, search] of [['UUT', lengthInstrument, 'length'], ['TMDE', weightInstrument, 'weight']]) {
      fireEvent.click(screen.getByRole('button', { name: `Add ${kind} to this measurement area` }));
      let session = save.mock.lastCall[0];
      const key = kind === 'UUT' ? 'uuts' : 'tmdes';
      expect(session[key][0].measurementAreaNames).toEqual(['Torque']);
      expect(session[key][0].instrument.manufacturer).toBe('');
      const blank = screen.getByRole('button', { name: 'Click to add description' });
      fireEvent.click(blank);
      const input = screen.getByPlaceholderText('Mfr.');
      fireEvent.change(input, { target: { value: search } });
      const identity = `${instrument.manufacturer} ${instrument.model} ${instrument.description}`;
      fireEvent.mouseDown(screen.getByText(identity));
      await waitFor(() => expect(save.mock.lastCall[0][key][0].instrument.manufacturer).toBe(instrument.manufacturer));
      session = save.mock.lastCall[0];
      expect(session[key][0].measurementAreaNames).toEqual(['Torque']);
      expect(session[key][0].instrument.functions).toEqual(instrument.functions);
      expect(session[key][0].instrument.scope).toBe('validated');
      // Leave the editor so the next table can be edited unambiguously.
      fireEvent.keyDown(input, { key: 'Escape' });
      const rows = buildFunctionGroupedRows(session[key].map((item, index) => ({ type: 'item', item, index })), session, kind.toLowerCase());
      expect(rows.filter(row => row.type === 'function').map(row => row.fn.name)).toEqual(['Torque']);
    }
    // Rename the organization from the table, preserving function metadata.
    const name = screen.getAllByLabelText('Measurement area subsection name')[0];
    name.textContent = 'Lever calibration';
    fireEvent.blur(name);
    const session = save.mock.lastCall[0];
    expect(session.uuts[0].measurementAreaNames).toEqual(['Lever calibration']);
    expect(session.tmdes[0].measurementAreaNames).toEqual(['Lever calibration']);
    expect(session.uuts[0].instrument.functions).toEqual(lengthInstrument.functions);
    expect(session.tmdes[0].instrument.functions).toEqual(weightInstrument.functions);
  });
});
