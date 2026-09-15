// Run against the actual HTML frame. In headed Chromium, classic scrollbars
// occupy space; overlay-only tests cannot detect a changing scrollbar gutter.
export async function checkInstrumentAutoHeight({ frame, page, check, view }) {
  const table = frame.locator('.instrument-equipment-table').first();
  const heightHandle = frame.getByRole('button', { name: 'Resize UUT table height', exact: true });
  const columnHandle = table.getByRole('button', { name: 'Resize Range column', exact: true });
  const snapshot = () => table.evaluate(async t => {
    for (let i = 0; i < 5; i++) await new Promise(requestAnimationFrame);
    const c = t.parentElement;
    return { gutter: c.getBoundingClientRect().height - t.getBoundingClientRect().height,
      overflow: c.scrollWidth > c.clientWidth, height: c.getBoundingClientRect().height };
  });

  await heightHandle.dblclick();
  // At reduced UI scale the outer half of a divider lies beneath the next
  // header. Click its in-column edge, as a user can, instead of that overlap.
  await columnHandle.dblclick({ position: { x: 1, y: 1 } });
  const fitted = await snapshot();
  for (let i = 0; i < 12; i++) await columnHandle.press('ArrowRight');
  const widened = await snapshot();
  check(`${view} horizontal overflow does not change auto-height gutter`,
    Math.abs(fitted.gutter - widened.gutter) < 1,
    JSON.stringify({ fitted, widened }));
  check(`${view} widened table remains horizontally scrollable`, widened.overflow);
  await columnHandle.dblclick({ position: { x: 1, y: 1 } });

  // Exercise a genuinely constrained height before handing it back to CSS.
  if (fitted.height > 220) {
    await heightHandle.scrollIntoViewIfNeeded();
    const box = await heightHandle.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - 40, { steps: 5 });
    await page.mouse.up();
    check(`${view} dragging the height handle selects manual height`,
      await heightHandle.getAttribute('data-sizing-mode') === 'manual');
  }
  await heightHandle.dblclick();
  check(`${view} double-click restores automatic height`,
    await heightHandle.getAttribute('data-sizing-mode') === 'auto');
  check(`${view} auto height shows the full table`, await table.evaluate(t =>
    ['', 'auto'].includes(t.parentElement.style.height) &&
    t.parentElement.clientHeight >= Math.floor(t.getBoundingClientRect().height)));
  await table.locator('tr.instrument-function-row td').first().hover();
  await snapshot();

  // Start recording BEFORE moving the pointer, including transitional frames.
  // Use offsets relative to the first card so intentional page scrolling does
  // not masquerade as movement of the downstream sections.
  await frame.evaluate(() => {
    const tables = [...document.querySelectorAll('.instrument-equipment-table')];
    window.__instrumentHoverGeometry = { frames: [], running: true };
    const record = () => {
      const state = window.__instrumentHoverGeometry;
      if (!state.running) return;
      const origin = tables[0].closest('.panel-card').getBoundingClientRect().top;
      state.frames.push(tables.flatMap(t => {
        const c = t.parentElement.getBoundingClientRect();
        return [c.height, t.getBoundingClientRect().height,
          t.closest('.panel-card').getBoundingClientRect().top - origin];
      }));
      requestAnimationFrame(record);
    };
    record();
  });
  const rows = table.locator('tr.instrument-function-row');
  for (const index of [...new Set([0, Math.min(1, await rows.count() - 1)])]) {
    for (const cell of await rows.nth(index).locator('td').all()) await cell.hover({ force: true });
  }
  const frames = await frame.evaluate(async () => {
    for (let i = 0; i < 12; i++) await new Promise(requestAnimationFrame);
    window.__instrumentHoverGeometry.running = false;
    return window.__instrumentHoverGeometry.frames;
  });
  const spread = frames[0].map((_, index) =>
    Math.max(...frames.map(f => f[index])) - Math.min(...frames.map(f => f[index])));
  check(`${view} hovering UUT cells leaves both panel heights and downstream positions stable`,
    spread.every(delta => delta < 1), JSON.stringify(spread));
}
