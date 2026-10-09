import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { InstrumentTableViewport, InstrumentDeleteAction } from './InstrumentTableActions';

it('keeps delete outside table cells, preserves its handler, and removes it with its instrument', () => {
  const remove = vi.fn(), select = vi.fn();
  function Harness({present = true}) {
    return <InstrumentTableViewport enabled><div><table><tbody>
      {present && <React.Fragment><InstrumentDeleteAction instrumentId="a" measurementArea="area">
        <button onClick={remove}>Delete Instrument</button>
      </InstrumentDeleteAction><tr onClick={select}><td>Instrument</td><td>Sync</td></tr></React.Fragment>}
    </tbody></table></div></InstrumentTableViewport>;
  }
  const {container, rerender} = render(<Harness/>);
  const button = screen.getByRole('button',{name:'Delete Instrument'});
  expect(button.closest('table')).toBeNull();
  expect(button.closest('.instrument-action-layer')).not.toBeNull();
  expect(container.querySelectorAll('td')).toHaveLength(2);
  fireEvent.click(button);
  expect(remove).toHaveBeenCalledOnce();
  expect(select).not.toHaveBeenCalled();
  rerender(<Harness present={false}/>);
  expect(screen.queryByRole('button',{name:'Delete Instrument'})).toBeNull();
});
