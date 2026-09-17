import { prepareInstrumentInteractions, checkInstrumentInteractions } from './instrument-interaction-checks.mjs';
import { prepareBiasSession } from './measurement-bias-checks.mjs';

export function prepareSeptember17Interactions(session) {
  prepareInstrumentInteractions(session);
  prepareBiasSession(session);
  for (const kind of ['uut', 'tmde']) {
    const copy = structuredClone(session[`${kind}s`][0]);
    copy.id = `${kind}-reorder`;
    copy.name = copy.description = `${kind} reorder target`;
    copy.instrument.model = copy.id;
    copy.ranges = copy.ranges.map((range, i) => ({ ...range, id: `${copy.id}-${i}` }));
    copy.rangeId = copy.ranges[0].id;
    session[`${kind}s`].push(copy);
  }
}

export async function checkSeptember17Interactions(context) {
  const { frame, page, saved, until, check } = context;
  // Retain coverage for cross-area transfer, cancellation, native-drag blocking
  // and hover geometry while testing the new same-area reorder path.
  await checkInstrumentInteractions(context);
  for (const view of ['overview', 'point']) {
    if (view === 'overview') await frame.locator('[data-tour="tab-overview"]').click();
    else {
      const expand = frame.getByRole('button', { name: 'Expand measurement area', exact: true });
      if (await expand.count()) await expand.first().click();
      await frame.locator('.point-grid-item').first().click();
    }
    for (const [tableIndex, kind] of ['uut', 'tmde'].entries()) {
      const table = frame.locator('.instrument-equipment-table').nth(tableIndex);
      const original = JSON.stringify(saved()[`${kind}s`].map(item => ({ id: item.id, ranges: item.ranges, instrument: item.instrument })));
      const drag = async position => {
        const source = table.locator(`tr[data-instrument-id="${kind}"]`).first().locator('.cell-description');
        const targets = table.locator(`tr[data-instrument-id="${kind}-reorder"]`);
        const target = position === 'after' ? targets.last() : targets.first();
        await source.scrollIntoViewIfNeeded();
        const bounds = await source.boundingBox();
        await page.mouse.move(bounds.x + 3, bounds.y + 8); await page.mouse.down();
        await page.mouse.move(bounds.x + 28, bounds.y + 18, { steps: 4 });
        await target.scrollIntoViewIfNeeded();
        const destination = await target.boundingBox();
        await page.mouse.move(destination.x + 100, destination.y + (position === 'after' ? destination.height - 3 : 3), { steps: 8 });
        await page.mouse.up();
      };
      const order = () => saved()[`${kind}s`].map(item => item.id);
      await drag('after');
      check(`${view} ${kind} pointer drag reorders below a same-area instrument`,
        await until(() => order().indexOf(kind) > order().indexOf(`${kind}-reorder`)));
      await drag('before');
      check(`${view} ${kind} pointer drag reorders above and retains instrument identities/ranges`,
        await until(() => JSON.stringify(saved()[`${kind}s`].map(item => ({ id: item.id, ranges: item.ranges, instrument: item.instrument }))) === original));
    }
  }

  await frame.getByRole('button', { name: 'Columns', exact: true }).click();
  const menu = frame.locator('.point-column-menu-body');
  const rows = menu.locator('.point-column-order-row');
  const keysBefore = await rows.evaluateAll(nodes => nodes.map(row => row.dataset.columnKey));
  const source = await rows.first().boundingBox();
  await page.mouse.move(source.x + 12, source.y + 8); await page.mouse.down();
  const target = rows.nth(1);
  const bounds = await target.boundingBox();
  const samples = [];
  for (const y of [bounds.y + 3, bounds.y + bounds.height / 2, bounds.y + bounds.height - 3]) {
    await page.mouse.move(bounds.x + 25, y, { steps: 4 }); await page.waitForTimeout(40);
    samples.push(await target.evaluate(row => ({ color: getComputedStyle(row).backgroundColor,
      shadow: getComputedStyle(row).boxShadow, opacity: getComputedStyle(row.querySelector('button')).opacity,
      line: getComputedStyle(row, '::after').height, height: row.getBoundingClientRect().height })));
  }
  check('column sorting keeps destination fills/buttons steady while the insertion line remains visible',
    samples.every(sample => sample.color === 'rgba(0, 0, 0, 0)' && sample.shadow === 'none' && sample.opacity === '0' && sample.line === '2px' && sample.height === samples[0].height), JSON.stringify(samples));
  await page.mouse.up();
  check('column sorting commits the indicated order on release', await until(async () => {
    const keys = await rows.evaluateAll(nodes => nodes.map(row => row.dataset.columnKey));
    return keys[0] === keysBefore[1] && keys[1] === keysBefore[0];
  }));
  await frame.getByRole('button', { name: 'Columns', exact: true }).click();

  const cards = frame.locator('.budget-decision-card dd[aria-label]');
  check('populated budget has live PFA/PFR values', await until(async () =>
    await cards.count() === 2 && (await cards.evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label')))).every(label => !label.includes('Unavailable'))));
  const remove = frame.locator('[title="Remove Component"]').first();
  // The app deliberately exposes the delete control only while its row is
  // hovered. Enter the row first, just as a user does, then click the control.
  await remove.locator('xpath=ancestor::tr[1]').hover();
  await remove.click();
  check('deleting the final component saves an empty budget on the current point', await until(() => saved().testPoints[0].components.length === 0));
  check('both risk cards clear without navigating away from the point', await until(async () =>
    await cards.count() === 2 && (await cards.evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label')))).every(label => label.includes('Unavailable'))));
  check('no trusted native drag was introduced by instrument reordering', await frame.evaluate(() => window.__nativeInstrumentDrags === 0));
}
