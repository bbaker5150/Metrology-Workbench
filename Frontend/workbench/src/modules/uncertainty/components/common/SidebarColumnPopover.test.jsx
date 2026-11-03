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

it('reopens a dragged column dialog at its last position', () => {
  function Harness() {
    const anchorRef = useRef(null);
    const [position, setPosition] = useState(null);
    const [open, setOpen] = useState(false);
    return <><div ref={anchorRef}><button onClick={() => setOpen(true)}>Columns</button></div>
      {open && <SidebarColumnPopover anchorRef={anchorRef} savedPosition={position} onMove={setPosition} onClose={() => setOpen(false)}>
        <div className="point-column-menu-actions">Move</div>
      </SidebarColumnPopover>}</>;
  }
  render(<Harness />);
  fireEvent.click(screen.getByText('Columns'));
  const dialog = screen.getByRole('dialog');
  const original = parseFloat(dialog.style.left);
  const pointer = (type, target, x, y) => fireEvent(target, new MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y }));
  pointer('pointerdown', screen.getByText('Move'), 400, 240);
  pointer('pointermove', window, 440, 265);
  pointer('pointerup', window, 440, 265);
  const { left, top } = dialog.style;
  expect(parseFloat(left)).toBe(original + 40);
  fireEvent.keyDown(dialog, { key: 'Escape' });
  fireEvent.click(screen.getByText('Columns'));
  expect(screen.getByRole('dialog').style.left).toBe(left);
  expect(screen.getByRole('dialog').style.top).toBe(top);
});
