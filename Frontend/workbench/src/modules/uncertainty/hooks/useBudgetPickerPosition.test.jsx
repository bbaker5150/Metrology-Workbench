import React, { useRef } from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import useBudgetPickerPosition from './useBudgetPickerPosition';

afterEach(() => { cleanup(); document.body.style.zoom = ''; vi.unstubAllGlobals(); });
const bounds = (left, top) => ({ left, right: left + 24, top, bottom: top + 24 });
const zero = { left: 0, top: 0, right: 0, bottom: 0 };
function Picker({ picker }) {
  const menu = useRef(null);
  useBudgetPickerPosition(menu, picker);
  return <div ref={menu} role="dialog" />;
}

it.each([1, 1.5])('keeps the last visible anchor through replacement and viewport resize at zoom %s', zoom => {
  document.body.style.zoom = String(zoom);
  const anchor = document.createElement('button'); document.body.append(anchor);
  let rect = bounds(750, 100);
  anchor.getBoundingClientRect = () => rect;
  const { getByRole } = render(<Picker picker={{ anchor, rect }} />);
  const menu = getByRole('dialog');
  expect(parseFloat(menu.style.top)).toBeCloseTo(130 / zoom);
  rect = bounds(700, 160); fireEvent(window, new Event('resize'));
  const last = { left: menu.style.left, top: menu.style.top };
  expect(parseFloat(last.top)).toBeCloseTo(190 / zoom);
  anchor.remove(); rect = zero;
  fireEvent(window, new Event('resize'));
  expect(menu.style.left).toBe(last.left);
  expect(menu.style.top).toBe(last.top);
});

it('uses the opening rectangle if the trigger is already detached before placement', () => {
  const anchor = document.createElement('button'); anchor.getBoundingClientRect = () => zero;
  const { getByRole } = render(<Picker picker={{ anchor, rect: bounds(700, 160) }} />);
  const menu = getByRole('dialog');
  expect(menu.style.top).toBe('190px');
  expect(menu.style.left).toBe('304px');
});

it('ignores a hidden trigger zero rectangle and follows it again when visible', () => {
  const anchor = document.createElement('button'); document.body.append(anchor);
  let rect = bounds(700, 100); anchor.getBoundingClientRect = () => rect;
  const { getByRole } = render(<Picker picker={{ anchor, rect }} />);
  const menu = getByRole('dialog');
  rect = zero; fireEvent(window, new Event('resize'));
  expect(menu.style.top).toBe('130px');
  rect = bounds(650, 180); fireEvent(window, new Event('resize'));
  expect(menu.style.top).toBe('210px');
  expect(menu.style.left).toBe('254px');
  anchor.remove();
});
