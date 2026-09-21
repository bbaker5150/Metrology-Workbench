// Author the currently displayed source total without changing its numeric
// value. Focusing alone must preserve inheritance; a deliberate edit freezes
// the net value. Both direct and derived points use the same always-live field.
export async function authorNetBias(frame) {
  const input = frame.getByRole('textbox', { name: 'Net measurement system bias', exact: true });
  const value = await input.inputValue();
  await input.fill(''); await input.fill(value); await input.press('Enter');
}
