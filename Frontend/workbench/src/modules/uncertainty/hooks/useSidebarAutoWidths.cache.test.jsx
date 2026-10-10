import React, { useRef } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import useSidebarAutoWidths from './useSidebarAutoWidths';

it('remeasures changed cells without cloning the whole table, and invalidates on a theme change', async () => {
  const rects = vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([{ width: 80 }]);
  const size = vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function () {
    return this.textContent.length * 8;
  });
  const clone = vi.spyOn(Node.prototype, 'cloneNode');
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
    view.rerender(<Harness text="Section" tick={1} />);
    expect(clone).not.toHaveBeenCalled();
    view.rerender(<Harness text="Longer section" tick={2} />);
    await waitFor(() => expect(screen.getByTestId('widths').textContent).toBe('{"section":114,"pfa":44}'));
    expect(clone).toHaveBeenCalledOnce();
    clone.mockClear();
    document.body.classList.toggle('dark-mode');
    view.rerender(<Harness text="Longer section" tick={3} />);
    expect(clone).toHaveBeenCalledTimes(2);
  } finally {
    unmount?.(); document.body.className = originalTheme;
    clone.mockRestore(); size.mockRestore(); rects.mockRestore();
  }
});
