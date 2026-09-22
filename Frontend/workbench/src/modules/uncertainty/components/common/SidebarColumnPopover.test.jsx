import React, { useRef, useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import SidebarColumnPopover from './SidebarColumnPopover';

it('cycles keyboard focus through column settings and restores the trigger on Escape', () => {
  function Harness() {
    const anchorRef = useRef(null);
    const [open, setOpen] = useState(false);
    return <><div ref={anchorRef}><button onClick={() => setOpen(true)}>Columns</button></div>
      {open && <SidebarColumnPopover anchorRef={anchorRef} onClose={() => setOpen(false)}>
        <button>Reset Columns</button><button>Set as Default</button>
      </SidebarColumnPopover>}</>;
  }
  render(<Harness />);
  const trigger = screen.getByRole('button', { name: 'Columns', exact: true });
  fireEvent.click(trigger);
  const dialog = screen.getByRole('dialog');
  expect(dialog).toHaveAttribute('popover', 'manual');
  const buttons = within(dialog).getAllByRole('button');
  // jsdom has no layout. Mark these rendered controls as visible for tabbing.
  const mocks = buttons.map(button => vi.spyOn(button, 'getClientRects').mockReturnValue([{}]));
  try {
    buttons[0].focus();
    fireEvent.keyDown(buttons[0], { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(buttons.at(-1));
    fireEvent.keyDown(buttons.at(-1), { key: 'Tab' });
    expect(document.activeElement).toBe(buttons[0]);
    fireEvent.keyDown(buttons[0], { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.activeElement).toBe(trigger);
  } finally {
    mocks.forEach(mock => mock.mockRestore());
  }
});
