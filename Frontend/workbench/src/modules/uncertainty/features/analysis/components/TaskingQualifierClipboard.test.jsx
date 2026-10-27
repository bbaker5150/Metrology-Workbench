import React, { useState } from 'react';
import { render, fireEvent, screen, within } from '@testing-library/react';
import { it, expect, vi } from 'vitest';
import UncertaintyPanel, { collectRangeClipboard, pasteRangeClipboard } from './UncertaintyPanel';
import { cutQualifierRows } from '../../../utils/qualifierRanges';
vi.mock('plotly.js-dist', () => ({ default: {} }));

const source = () => ({ id: 'u1', description: 'Shunt', instrument: { functions: [{ id: 'f', name: 'Current', unit: 'A', ranges: [
  ...[60, 300, 1000].map((frequency, i) => ({ id: `r${i}`, min: 20, max: 20, unit: 'A', isSingleValue: true,
    qualifierGroupId: 'twenty', qualifier: { id: `q${i}`, value: frequency, unit: 'Hz' }, tolerances: { floor: { value: 49-i, unit: 'ppm', distribution: '2' } } })),
  { id: 'destination', min: 40, max: 40, unit: 'A', isSingleValue: true, tolerances: {} },
] }] } });
const rangesOf = item => item.instrument.functions[0].ranges;
function Harness({ viewMode }) {
  const [session, save] = useState({ id: 's', name: 'Test', uuts: [source()], tmdes: [], testPoints: [], uncReq: {} });
  const [selected, setSelected] = useState([]);
  const point = { id: 'p', viewMode, testPointInfo: { parameter: { name: 'Current', value: 20, unit: 'A' } }, associatedUutIds: ['u1'], components: [], tmdeTolerances: [], specifications: {} };
  return <><UncertaintyPanel testPointData={point} sessionData={session} onSessionSave={save} currentUutSelection={selected} setCurrentUutSelection={setSelected} uutNominal={point.testPointInfo.parameter} tmdeTolerancesData={[]} setNotification={() => {}} onInstrumentSynced={() => {}} /><output data-testid="state">{JSON.stringify(session)}</output></>;
}
const stateRanges = () => rangesOf(JSON.parse(screen.getByTestId('state').textContent).uuts[0]);
const row = id => document.querySelector(`tr[data-range-id="${id}"]`);
const expand = () => {
  const button = within(row('r0')).queryByRole('button', { name: 'Edit ranges' });
  if (button) fireEvent.click(button);
};

it.each(['session', 'point'])('copies a parent once with every qualifier in %s view', viewMode => {
  render(<Harness viewMode={viewMode} />); expand();
  fireEvent.contextMenu(row('r0').querySelector('[data-range-cell]'));
  fireEvent.click(screen.getByText('Copy Range'));
  fireEvent.contextMenu(row('destination').querySelector('[data-range-cell]'));
  fireEvent.click(screen.getByText('Paste Range'));
  const ranges = stateRanges(), copied = ranges.slice(4);
  expect(ranges).toHaveLength(7);
  expect(copied.map(r => r.qualifier.value)).toEqual([60, 300, 1000]);
  expect(new Set(copied.map(r => r.qualifierGroupId)).size).toBe(1);
  expect(copied[0].qualifierGroupId).not.toBe('twenty');
  expect(row(copied[0].id).querySelector('[data-range-cell]')).toHaveAttribute('rowspan', '3');
  expect(copied.map(r => r.tolerances.floor.value)).toEqual([49, 48, 47]);
});

it.each(['session', 'point'])('copies multiple selected qualifiers to a different range with shortcuts in %s', viewMode => {
  render(<Harness viewMode={viewMode} />); expand();
  fireEvent.mouseDown(row('r0').querySelector('[data-qualifier-cell]'));
  fireEvent.mouseDown(row('r1').querySelector('[data-qualifier-cell]'), { ctrlKey: true });
  fireEvent.keyDown(window, { key: 'c', ctrlKey: true });
  fireEvent.mouseDown(row('destination').querySelector('[data-range-cell]'));
  fireEvent.keyDown(window, { key: 'v', ctrlKey: true });
  const ranges = stateRanges(), pasted = ranges.filter(r => r.min === 40);
  expect(ranges.map(r => [r.min, r.qualifier?.value])).toEqual([[20,60],[20,300],[20,1000],[40,60],[40,300]]);
  expect(pasted.map(r => r.qualifier.value)).toEqual([60, 300]);
  expect(pasted.map(r => r.tolerances.floor.value)).toEqual([49, 48]);
  expect(ranges.filter(r => r.min === 20)).toHaveLength(3);
  expect(row(pasted[0].id).querySelector('[data-range-cell]')).toHaveAttribute('rowspan','2');
});

it.each(['session', 'point'])('cuts only selected qualifiers through the context menu in %s', viewMode => {
  render(<Harness viewMode={viewMode} />); expand();
  fireEvent.mouseDown(row('r0').querySelector('[data-qualifier-cell]'));
  fireEvent.mouseDown(row('r1').querySelector('[data-qualifier-cell]'), { ctrlKey: true });
  fireEvent.contextMenu(row('r1').querySelector('[data-qualifier-cell]'));
  fireEvent.click(screen.getByText('Cut Qualifier'));
  expect(stateRanges().filter(r => r.min === 20).map(r => r.id)).toEqual(['r2']);
  fireEvent.contextMenu(row('destination').querySelector('[data-range-cell]'));
  fireEvent.click(screen.getByText('Paste Qualifiers'));
  expect(stateRanges().filter(r => r.min === 40).map(r => r.qualifier.value)).toEqual([60,300]);
});

it('makes repeated pasted parent groups independent and preserves nested branches', () => {
  const item = source();
  rangesOf(item)[0].qualifier.qualifier = { id: 'nested', text: '90 days' };
  const clip = collectRangeClipboard([{ kind: 'uut', source: item, id: 'r0' }]);
  const first = pasteRangeClipboard(item, 'r1', clip);
  const second = pasteRangeClipboard(first.item, first.newRangeId, clip);
  const ranges = rangesOf(second.item);
  expect(ranges).toHaveLength(10);
  const groups = new Set(ranges.filter(r => r.qualifier).map(r => r.qualifierGroupId));
  expect(groups.size).toBe(3);
  expect(new Set(ranges.filter(r => r.qualifier?.qualifier).map(r => r.qualifier.qualifier.id)).size).toBe(3);
  expect(rangesOf(item)).toHaveLength(4);
});

it('keeps the parent range when every qualifier is cut', () => {
  const result = cutQualifierRows(source(), ['r0','r1','r2']);
  expect(rangesOf(result)).toHaveLength(2);
  expect(rangesOf(result)[0]).toMatchObject({ min: 20, max: 20, unit: 'A', tolerances: {} });
  expect(rangesOf(result)[0].qualifier).toBeUndefined();
});

it('pastes a nested qualifier under the destination ancestor with independent uncertainty', () => {
  const item = source();
  rangesOf(item)[0].qualifier.qualifier = { id: 'nested', text: '90 days' };
  rangesOf(item)[1].qualifier.qualifier = { id: 'existing', text: '1 year' };
  const clip = collectRangeClipboard([{ kind: 'uut', source: item, id: 'r0' }], 2);
  const pasted = pasteRangeClipboard(item, 'r1', clip, 2);
  const ranges = rangesOf(pasted.item);
  expect(ranges[2]).toMatchObject({ min:20, qualifierGroupId:'twenty', qualifier:{ id:'q1', value:300, qualifier:{text:'90 days'} }, tolerances:{floor:{value:49}} });
  expect(ranges[2].qualifier.qualifier.id).not.toBe('nested');
  expect(ranges[3].id).toBe('r2');
});

it('joins an existing legacy destination group without splitting its original qualifiers', () => {
  const item = source();
  rangesOf(item).forEach(row => { delete row.qualifierGroupId; });
  const clip = collectRangeClipboard([{ kind: 'uut', source: item, id: 'r0' }], 1);
  const pasted = pasteRangeClipboard(item, 'r1', clip);
  const saved = JSON.parse(JSON.stringify(pasted.item));
  const qualified = rangesOf(saved).filter(row => row.qualifier);
  expect(qualified.map(row => row.qualifier.value)).toEqual([60,300,1000,60]);
  expect(new Set(qualified.map(row => row.qualifierGroupId)).size).toBe(1);
  expect(qualified.every(row => row.qualifierGroupId)).toBe(true);
});
