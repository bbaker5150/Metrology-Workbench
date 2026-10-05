export async function checkQualifierRanges({frame, page, saved, until, check}) {
  for (const view of ['overview','point']) {
    if (view==='overview') await frame.locator('[data-tour="tab-overview"]').click();
    else await frame.locator('[data-point-id="point"]').locator('[data-sidebar-column="pfa"]').click();
    for (const [tableIndex,kind] of ['uut','tmde'].entries()) {
      const table=frame.locator('.instrument-equipment-table').nth(tableIndex);
      const first=table.locator('tr[data-selection-key][data-range-id]').first();
      const group=await first.getAttribute('data-selection-key');
      const baseRange=first.locator('[data-range-cell]').first();
      await first.getByRole('button',{name:'Add qualifier',exact:true}).click();
      check(`${view} ${kind} adds Qualifier header`,await table.locator('thead [data-instrument-column="qualifier"]').count()===1);
      const qualifier=first.locator('[data-qualifier-cell]');
      await qualifier.locator('.inline-range-summary').click();
      await qualifier.getByPlaceholder('min',{exact:true}).fill('100');
      await qualifier.getByPlaceholder('max',{exact:true}).fill('1000');
      await qualifier.getByPlaceholder('max',{exact:true}).press('Enter');
      await first.getByRole('button',{name:'Add qualifier range',exact:true}).click();
      const rows=table.locator(`tr[data-selection-key="${group}"]:has([data-qualifier-cell])`);
      check(`${view} ${kind} shares the parent range`,await rows.count()===2 && await baseRange.getAttribute('rowspan')==='2');
      const second=rows.nth(1).locator('[data-qualifier-cell]');
      await second.locator('.inline-range-summary').click();
      await second.getByPlaceholder('min',{exact:true}).fill('1000');
      await second.getByPlaceholder('max',{exact:true}).fill('10000');
      await second.getByPlaceholder('max',{exact:true}).press('Enter');
      await table.locator('thead').click();
      check(`${view} ${kind} saves independent qualifier bounds`,await until(()=>{
        const item=saved()[kind==='uut'?'uuts':'tmdes'].find(item=>`${kind}:${item.id}`===group);
        const ranges=item?.ranges || item?.instrument?.functions?.flatMap(fn=>fn.ranges||[]) || item?.instrument?.ranges || [];
        return ranges.some(r=>Number(r.qualifier?.min)===100 && Number(r.qualifier?.max)===1000) && ranges.some(r=>Number(r.qualifier?.min)===1000 && Number(r.qualifier?.max)===10000);
      }));
      for (const theme of ['light','dark']) {
        await frame.evaluate(theme=>{document.body.classList.toggle('light-mode',theme==='light');document.body.classList.toggle('dark-mode',theme==='dark');},theme);
        await second.click({position:{x:5,y:5}});
        check(`${view} ${kind} qualifier-only selection in ${theme}`,await until(async()=>await table.getAttribute('data-selection-mode')==='range' && await rows.nth(1).getAttribute('data-range-selected')==='true'));
        await rows.nth(1).locator('.cell-tolerance').click({position:{x:4,y:4}});
        check(`${view} ${kind} shared cells highlight in ${theme}`,await until(async()=>await first.locator('.cell-description').getAttribute('data-cell-selected')!==null && await baseRange.getAttribute('data-cell-selected')!==null));
        check(`${view} ${kind} qualifier columns align in ${theme}`,await table.evaluate(table=>{
          const header=table.querySelector('[data-instrument-column="qualifier"]').getBoundingClientRect();
          return [...table.querySelectorAll('[data-qualifier-cell]')].every(cell=>{const box=cell.getBoundingClientRect();return Math.abs(box.left-header.left)<2 && Math.abs(box.right-header.right)<2;});
        }));
        if(process.env.FEEDBACK_SCREENSHOT_DIRECTORY) await table.screenshot({path:`${process.env.FEEDBACK_SCREENSHOT_DIRECTORY}/qualifier-${view}-${kind}-${theme}.png`});
      }
      await rows.nth(1).getByRole('button',{name:'Delete qualifier range'}).click();
      await first.getByRole('button',{name:'Delete qualifier range'}).click();
      check(`${view} ${kind} removes the unused qualifier column`,await table.locator('thead [data-instrument-column="qualifier"]').count()===0);
    }
  }
}
