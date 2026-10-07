export async function checkQualifierRanges({frame, page, saved, until, check}) {
  for (const view of ['overview','point']) {
    if (view==='overview') await frame.locator('[data-tour="tab-overview"]').click();
    else await frame.locator('[data-point-id="point"]').locator('[data-sidebar-column="pfa"]').click();
    for (const [tableIndex,kind] of ['uut','tmde'].entries()) {
      const table=frame.locator('.instrument-equipment-table').nth(tableIndex);
      const first=table.locator('tr[data-selection-key][data-range-id]').first();
      const group=await first.getAttribute('data-selection-key');
      const baseRange=first.locator('[data-range-cell]').first();
      await baseRange.click();
      await baseRange.locator('.inline-tolerance-summary').click();
      check(`${view} ${kind} range width settles with qualifier controls`, await table.evaluate(async table => {
        const widths=[];
        for(let i=0;i<30;i++) {
          await new Promise(requestAnimationFrame);
          widths.push(table.getBoundingClientRect().width);
        }
        return Math.max(...widths.slice(-10))-Math.min(...widths.slice(-10))<1;
      }));
      await first.getByRole('button',{name:'Add qualifier',exact:true}).click();
      check(`${view} ${kind} adds Qualifier header`,await table.locator('thead [data-instrument-column="qualifier"]').count()===1);
      const qualifier=first.locator('[data-qualifier-cell]');
      await qualifier.getByPlaceholder('min',{exact:true}).press('Control+z');
      check(`${view} ${kind} Ctrl+Z undoes qualifier creation while its empty editor is focused`,await until(async()=>await table.locator('thead [data-instrument-column="qualifier"]').count()===0));
      await baseRange.click();
      if (await first.getByRole('button',{name:'Add qualifier',exact:true}).count()===0) await baseRange.locator('.inline-tolerance-summary').click();
      await first.getByRole('button',{name:'Add qualifier',exact:true}).click();
      check(`${view} ${kind} new qualifier opens focused`, await qualifier.getByPlaceholder('min',{exact:true}).evaluate(node=>node===document.activeElement));
      await qualifier.getByPlaceholder('min',{exact:true}).fill('100');
      await qualifier.getByPlaceholder('min',{exact:true}).press('Tab');
      check(`${view} ${kind} qualifier Tab preserves focus`, await qualifier.getByPlaceholder('max',{exact:true}).evaluate(node=>node===document.activeElement));
      await qualifier.getByPlaceholder('max',{exact:true}).fill('1000');
      await qualifier.getByPlaceholder('max',{exact:true}).press('Enter');
      await qualifier.hover();
      await first.getByRole('button',{name:'Add qualifier range',exact:true}).click();
      const rows=table.locator(`tr[data-selection-key="${group}"]:has([data-qualifier-cell])`);
      check(`${view} ${kind} shares the parent range`,await rows.count()===2 && await baseRange.getAttribute('rowspan')==='2');
      const second=rows.nth(1).locator('[data-qualifier-cell]');
      check(`${view} ${kind} added qualifier opens focused`, await second.getByPlaceholder('min',{exact:true}).evaluate(node=>node===document.activeElement));
      await second.getByPlaceholder('min',{exact:true}).fill('1000');
      await second.getByPlaceholder('max',{exact:true}).fill('10000');
      await second.getByPlaceholder('max',{exact:true}).press('Enter');
      await table.locator('thead').click();
      check(`${view} ${kind} qualifier controls align beside inputs`,await second.evaluate(cell=>{
        const editor=cell.querySelector('.inline-range-editor').getBoundingClientRect();
        const add=cell.querySelector('.range-row-add').getBoundingClientRect();
        const remove=cell.querySelector('.range-row-delete').getBoundingClientRect();
        return add.left>=editor.right-1 && remove.left>=add.right && remove.right<=cell.getBoundingClientRect().right && Math.abs(add.top-remove.top)<1;
      }));
      check(`${view} ${kind} instrument delete remains visible during scroll`, await table.evaluate(async table=>{
        await new Promise(requestAnimationFrame);
        const container=table.parentElement, cell=table.querySelector('td.cell-sync');
        const previous=container.scrollLeft;
        let visible=true;
        for (const position of [0,container.scrollWidth-container.clientWidth]) {
          container.scrollLeft=position;
          await new Promise(requestAnimationFrame);
          await new Promise(requestAnimationFrame);
          const button=cell.querySelector('.instrument-row-delete').getBoundingClientRect(), box=container.getBoundingClientRect();
          visible &&= button.left>=box.left && button.right<=box.right+1;
        }
        container.scrollLeft=previous;
        return visible;
      }));
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
      await rows.nth(1).locator('[data-qualifier-cell]').hover();
      await rows.nth(1).getByRole('button',{name:'Delete qualifier range'}).click();
      await first.locator('[data-qualifier-cell]').hover();
      await first.getByRole('button',{name:'Delete qualifier range'}).click();
      check(`${view} ${kind} removes the unused qualifier column`,await table.locator('thead [data-instrument-column="qualifier"]').count()===0);
    }
  }
}
