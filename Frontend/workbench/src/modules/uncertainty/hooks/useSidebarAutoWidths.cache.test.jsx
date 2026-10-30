import React, { useRef } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import useSidebarAutoWidths from './useSidebarAutoWidths';

it('caches unchanged cells but remeasures theme and same-viewport typography changes', async () => {
  const rects = vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([{ width: 80 }]);
  let characterWidth = 8;
  const size = vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function () {
    return this.textContent.length * characterWidth;
  });
  const clone = vi.spyOn(Node.prototype, 'cloneNode');
  const appendToBody = vi.spyOn(document.body, 'appendChild');
  const originalTheme = document.body.className;
  function Harness({ text, tick }) {
    const root = useRef(null);
    const widths = useSidebarAutoWidths(root);
    return <div ref={root}><div className="point-grid-item">
      <span data-sidebar-column="section">{text}</span>
      <span data-sidebar-column="pfa">1.00%</span>
    </div><output data-testid="widths">{JSON.stringify(widths)}</output><span>{tick}</span></div>;
  }
  let unmount;
  try {
    const view = render(<Harness text="Section" tick={0} />);
    unmount = view.unmount;
    await waitFor(() => expect(screen.getByTestId('widths').textContent).toBe('{"section":58,"pfa":44}'));
    clone.mockClear();
    appendToBody.mockClear();
    view.rerender(<Harness text="Section" tick={1} />);
    expect(clone).not.toHaveBeenCalled();
    expect(appendToBody).not.toHaveBeenCalled();
    view.rerender(<Harness text="Longer section" tick={2} />);
    await waitFor(() => expect(screen.getByTestId('widths').textContent).toBe('{"section":114,"pfa":44}'));
    expect(clone).toHaveBeenCalledOnce();
    clone.mockClear();
    document.body.classList.toggle('dark-mode');
    view.rerender(<Harness text="Longer section" tick={3} />);
    expect(clone).toHaveBeenCalledTimes(2);
    clone.mockClear();
    characterWidth = 12;
    act(() => window.dispatchEvent(new Event('resize')));
    await waitFor(() => expect(screen.getByTestId('widths').textContent).toBe('{"section":170,"pfa":62}'));
    expect(clone).toHaveBeenCalledTimes(2);
    clone.mockClear();
    appendToBody.mockClear();
    view.rerender(<Harness text="Longer section" tick={4} />);
    expect(clone).not.toHaveBeenCalled();
    expect(appendToBody).not.toHaveBeenCalled();
  } finally {
    unmount?.(); document.body.className = originalTheme;
    clone.mockRestore(); appendToBody.mockRestore(); size.mockRestore(); rects.mockRestore();
  }
});

it('batches large-session probes and does not walk point cells for unrelated owner renders', async () => {
  const rects = vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([{ width: 80 }]);
  const batches = [];
  const size = vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function () {
    if (this.parentElement?.hasAttribute('data-sidebar-width-probe')) {
      batches.push(this.parentElement.parentElement.childElementCount);
      expect(this.parentElement.children).toHaveLength(1);
    }
    return this.textContent.length * 8;
  });
  function IndependentEditor() {
    const [label, setLabel] = React.useState('Editable');
    return <span data-sidebar-column="section"><button onClick={() => setLabel('Independently edited longer section')}>{label}</button></span>;
  }
  function Harness({ tick }) {
    const root = useRef(null);
    const widths = useSidebarAutoWidths(root);
    return <div ref={root} data-testid="root">
      {Array.from({ length: 200 }, (_, i) => <div className="point-grid-item" key={i}><span data-sidebar-column="section">Section {i}</span></div>)}
      <div className="point-grid-item"><IndependentEditor/></div>
      <output data-testid="large-widths">{widths.section}</output><span>{tick}</span>
    </div>;
  }
  let unmount;
  try {
    const view = render(<Harness tick={0}/>); unmount = view.unmount;
    expect(batches).toHaveLength(201);
    expect(new Set(batches)).toEqual(new Set([201]));
    const query = vi.spyOn(screen.getByTestId('root'), 'querySelectorAll');
    view.rerender(<Harness tick={1}/>);
    expect(query).not.toHaveBeenCalled();
    const cell = screen.getByTestId('root').querySelector('[data-sidebar-column]');
    await act(async () => {
      cell.classList.add('is-cell-hovered', 'point-grouped-cell--highlighted');
      cell.parentElement.classList.add('active', 'active-point', 'table-highlight');
      cell.parentElement.setAttribute('style', '--point-hover-left: 0px; --point-hover-right: 50px;');
      await Promise.resolve();
    });
    expect(query).not.toHaveBeenCalled();
    expect(batches).toHaveLength(201);
    fireEvent.click(screen.getByRole('button', { name: 'Editable' }));
    await waitFor(() => expect(screen.getByTestId('large-widths').textContent).toBe('282'));
    expect(batches.at(-1)).toBe(1);
    query.mockRestore();
  } finally { unmount?.(); size.mockRestore(); rects.mockRestore(); }
});
