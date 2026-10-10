import React from 'react';
import { fireEvent, render } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import usePointBreakdownCursor from './usePointBreakdownCursor';

it('tracks Ctrl/Cmd for cursor styling without rerendering and clears stale modifiers', () => {
  const rendered = vi.fn();
  function Harness() { usePointBreakdownCursor(); rendered(); return null; }
  const { unmount } = render(<Harness />);
  const attribute = 'data-point-breakdown-enabled';
  expect(document.body).not.toHaveAttribute(attribute);
  fireEvent.keyDown(window, { key: 'Control', ctrlKey: true });
  expect(document.body).toHaveAttribute(attribute);
  fireEvent.keyUp(window, { key: 'Control' });
  expect(document.body).not.toHaveAttribute(attribute);
  fireEvent.keyDown(window, { key: 'Meta', metaKey: true });
  expect(document.body).toHaveAttribute(attribute);
  fireEvent.blur(window);
  expect(document.body).not.toHaveAttribute(attribute);
  fireEvent(window, new MouseEvent('pointermove', { ctrlKey: true }));
  expect(document.body).toHaveAttribute(attribute);
  fireEvent(document, new Event('visibilitychange'));
  expect(document.body).not.toHaveAttribute(attribute);
  fireEvent.keyDown(window, { key: 'Control', ctrlKey: true });
  expect(rendered).toHaveBeenCalledOnce();
  unmount();
  expect(document.body).not.toHaveAttribute(attribute);
});
