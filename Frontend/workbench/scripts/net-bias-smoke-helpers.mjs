// Author the currently displayed source total without changing its numeric
// value. Focusing alone must preserve inheritance; a deliberate edit freezes
// the net value. Both direct and derived points use the same always-live field.
export async function editNetBias(frame) {
  const summary = frame.getByRole('button', { name: 'Edit net measurement system bias', exact: true });
  if (await summary.count()) await summary.click();
  return frame.getByRole('textbox', { name: 'Net measurement system bias', exact: true });
}
export async function authorNetBias(frame) {
  await editNetBias(frame);
  const input = frame.getByRole('textbox', { name: 'Net measurement system bias', exact: true });
  const value = await input.inputValue();
  await input.fill(''); await input.fill(value); await input.press('Enter');
}
