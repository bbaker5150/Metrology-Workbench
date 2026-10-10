import React from 'react';
import { act, render } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import PointSelectionOutline from './PointSelectionOutline';

it('skips geometry reads for hover but redraws immediately for selection and column changes', async () => {
  const bounds = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function () {
    const left = this.dataset.sidebarColumn === 'value' ? 100 : 0;
    const width = this.hasAttribute('data-sidebar-column') ? 100 : 200;
    return { left, right: left + width, top: 0, bottom: 30, width, height: 30 };
  });
  const rects = vi.spyOn(Element.prototype, 'getClientRects').mockReturnValue([{}]);
  const offset = vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(200);
  let unmount;
  try {
    const view = render(<div className="measurement-point-list"><div>
      <div className="measurement-area-points"><div className="point-grid-item"
        style={{ gridTemplateAreas: '"section value"' }}>
        <span data-sidebar-column="section">Section</span><span data-sidebar-column="value">1</span>
      </div></div><PointSelectionOutline />
    </div></div>);
    unmount = view.unmount;
    const row = view.container.querySelector('.point-grid-item');
    const cell = row.firstElementChild;
    const overlay = view.container.querySelector('svg');
    expect(overlay.querySelectorAll('.point-column-guide')).toHaveLength(1);
    expect(overlay.querySelector('path')).toBeNull();
    bounds.mockClear();
    await act(async () => {
      cell.classList.add('is-cell-hovered');
      row.style.setProperty('--point-hover-left', '100px');
      row.style.setProperty('--point-hover-right', '0px');
    });
    expect(bounds).not.toHaveBeenCalled();
    await act(async () => row.classList.add('active'));
    expect(bounds).toHaveBeenCalled();
    expect(overlay.querySelector('path').getAttribute('d')).toBeTruthy();
    bounds.mockClear();
    await act(async () => {
      cell.classList.remove('is-cell-hovered');
      row.style.removeProperty('--point-hover-left');
      row.style.removeProperty('--point-hover-right');
    });
    expect(bounds).not.toHaveBeenCalled();
    await act(async () => { row.style.gridTemplateColumns = '120px 80px'; });
    expect(bounds).toHaveBeenCalled();
    await act(async () => row.classList.remove('active'));
    expect(overlay.querySelector('path')).toBeNull();
    await act(async () => cell.classList.add('point-grouped-cell--highlighted'));
    expect(overlay.querySelector('path')).not.toBeNull();
  } finally {
    unmount?.(); bounds.mockRestore(); rects.mockRestore(); offset.mockRestore();
  }
});
