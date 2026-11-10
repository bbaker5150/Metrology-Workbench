import { afterEach, expect, it } from 'vitest';
import { alignEmptyHintArrows } from './alignEmptyHintArrows';

afterEach(() => document.body.replaceChildren());

it.each([0.8, 1, 1.25])('reserves text space before the measured add-button arrow at zoom %s', scale => {
  document.body.innerHTML = '<div class="measurement-group-container"><button class="function-point-add-button"></button><div class="measurement-point-empty-hint"><div class="empty-hint-label">Click + to add a measurement point</div><span>↑</span></div></div>';
  const hint = document.querySelector('.measurement-point-empty-hint'), button = document.querySelector('button');
  let width = 400, center = 330;
  Object.defineProperty(hint, 'offsetWidth', { get: () => width });
  Object.defineProperty(hint.lastElementChild, 'offsetWidth', { value: 24 });
  hint.getBoundingClientRect = () => ({ left: 100, width: width * scale });
  button.getBoundingClientRect = () => ({ left: 100 + (center - 12) * scale, width: 24 * scale });
  alignEmptyHintArrows(document.body);
  expect(hint.style.getPropertyValue('--hint-arrow-left')).toBe('330px');
  expect(hint.style.getPropertyValue('--hint-content-right')).toBe('90px');
  width = 180; center = 145;
  alignEmptyHintArrows(document.body);
  expect(hint.style.getPropertyValue('--hint-arrow-left')).toBe('145px');
  expect(hint.style.getPropertyValue('--hint-content-right')).toBe('55px');
});
