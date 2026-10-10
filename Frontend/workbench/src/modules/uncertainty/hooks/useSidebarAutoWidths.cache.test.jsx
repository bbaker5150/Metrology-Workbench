import React, { useRef } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
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
