import { prepareSeptember16Layout } from './september16-checks.mjs';
export function prepareFieldStability(session) {
  prepareSeptember16Layout(session);
  session.testPoints[0].section='1.2';
  session.testPoints[0].testPointInfo.qualifier={value:1000,unit:'Hz',name:'Frequency'};
  const equation={id:'focus-equation',kind:'equation',name:'Equation source',measurementUnit:'V',outputUnit:'V',mode:'standard',equation:'a*x+b',pointVariable:'x',variables:{a:{value:.01,unit:'',name:'Scale'},b:{value:.02,unit:'V',name:'Offset'}},columns:[{id:'u',name:'Uncertainty'}]};
  session.dynamicBudgetDefinitions.push(equation);
  session.testPoints[0].components.push({id:'focus-equation-component',dynamicDefinitionId:equation.id,dynamicOutputId:'u',dynamicDefinition:equation,type:'B',isManual:true});
  const term=(high,unit)=>({high,low:-high,unit,symmetric:true,distribution:'1.732'});
  for (const kind of ['uuts','tmdes']) Object.assign(session[kind][0].ranges[0], {
    tolerances:{reading:term(1,'%'),floor:term(.1,'V')}, resolution:.01,
  });
}

// Measure browser layout rather than CSS declarations: inherited typography,
// native controls, and swapped read/edit elements all affect the result.
export async function checkFieldStability({ frame, page, check }) {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const settle = () => page.waitForTimeout(200);
  const metrics = locator => locator.evaluate(node => {
    const r = node.getBoundingClientRect(), s = getComputedStyle(node);
    const row = node.closest('.point-grid-item, tr, .session-header-field') || node.parentElement;
    return { x: r.x, y: r.y, width: r.width, height: r.height, rowHeight: row.getBoundingClientRect().height,
      textX: r.x + parseFloat(s.paddingLeft) + parseFloat(s.borderLeftWidth), cellX: node.closest('td')?.getBoundingClientRect().x,
      font: s.font, fontSize:s.fontSize, fontWeight:s.fontWeight, lineHeight: s.lineHeight };
  });
  const expand = frame.getByRole('button', { name: 'Expand measurement area', exact: true });
  if (await expand.count()) await expand.first().click();
  await frame.getByRole('button',{name:'Columns',exact:true}).click();
  for(const label of ['Section','Qualifier']) {
    const add=frame.getByRole('button',{name:`Add ${label} column`,exact:true});
    if(await add.count()) await add.click();
  }
  await frame.getByRole('button',{name:'Columns',exact:true}).click();
  for (const theme of ['light', 'dark']) {
    await frame.evaluate(theme => document.body.classList.toggle('dark-mode', theme === 'dark'), theme);
    if(theme==='dark') { await frame.locator('body').press('Control+-'); await settle(); }
    const row = frame.locator('.point-grid-item').first();
    await row.scrollIntoViewIfNeeded();
    const before = await metrics(row.locator('.point-value-number'));
    const unitBefore = await metrics(row.locator('.point-unit-control'));
    await row.locator('.point-value-number').click(); await settle();
    const after = await metrics(row.locator('.sidebar-inline-input.value'));
    const unitAfter = await metrics(row.locator('.point-unit-control'));
    check(`${theme} point value keeps row height, font, and text origin on edit`, Math.abs(before.rowHeight-after.rowHeight)<.6 && Math.abs(before.textX-after.textX)<.6 && before.font===after.font, JSON.stringify({before,after}));
    check(`${theme} point unit stays in place on value edit`, Math.abs(unitBefore.x-unitAfter.x)<.6 && Math.abs(unitBefore.y-unitAfter.y)<.6, JSON.stringify({unitBefore,unitAfter}));
    await row.locator('.sidebar-inline-input.value').press('Escape');
  }
  await frame.locator('body').press('Control+='); await settle();
  for(const name of ['section','qualifier']) {
    const cell=frame.locator('.point-grid-item').first().locator(`.point-${name}`);
    await cell.scrollIntoViewIfNeeded(); await settle();
    const before=await metrics(cell.locator('.point-grouped-cell-label'));
    await cell.locator('.point-grouped-cell-label').click(); await settle();
    const after=await metrics(cell.locator('input'));
    check(`${name} edit preserves row height and typography`,Math.abs(before.rowHeight-after.rowHeight)<.6 && before.font===after.font,JSON.stringify({before,after}));
    await cell.locator('input').press('Escape');
  }
  await frame.locator('[data-tour="tab-budget"]').click();
  const resize=frame.locator('.budget-resizable-table').first().locator('.budget-column-resize-handle').first();
  await resize.scrollIntoViewIfNeeded();
  const handle=await resize.boundingBox();
  await page.mouse.move(handle.x+handle.width/2,handle.y+handle.height/2);
  await page.mouse.down(); await page.mouse.move(handle.x-380,handle.y+handle.height/2,{steps:10}); await page.mouse.up(); await settle();
  for (const selector of ['.budget-dynamic-row', '.budget-inline-manual-row:not(.budget-dynamic-row)']) {
    const row = frame.locator(selector).first();
    await row.scrollIntoViewIfNeeded(); await settle();
    const trigger=row.getByRole('button', {name:'Edit error source name',exact:true});
    await trigger.scrollIntoViewIfNeeded(); await settle();
    const before = await metrics(trigger);
    // Use a real pointer once positioned. Locator.click may itself scroll a
    // wide field after the baseline was recorded, disguising the app's result.
    const box=await trigger.boundingBox();
    await page.mouse.click(box.x+8,box.y+box.height/2); await settle();
    const input = row.getByRole('textbox', {name:'Error source name',exact:true});
    const after = await metrics(input);
    check(`${selector} editing name preserves wrapping, height, and text origin`, Math.abs(before.rowHeight-after.rowHeight)<.6 && Math.abs(before.textX-after.textX)<.6 && before.lineHeight===after.lineHeight, JSON.stringify({before,after}));
    await input.press('Enter'); await settle();
    check(`${selector} Enter still closes source editor`, await input.count()===0);
  }
  for (let componentIndex=0;componentIndex<2;componentIndex++) {
  const dynamic = frame.locator('.budget-dynamic-row').nth(componentIndex);
  await dynamic.locator('.dynamic-tolerance-cell button').click(); await settle();
  const fields = dynamic.locator('.dynamic-budget-editor input:not([type="checkbox"]):visible');
  const bounds = () => fields.evaluateAll(nodes => nodes.map(n => {const r=n.getBoundingClientRect(), row=n.closest('.budget-dynamic-row').getBoundingClientRect();return [r.x-row.x,r.y-row.y,r.width,r.height,row.height];}));
  const before = await bounds();
  check(`${componentIndex ? 'equation' : 'tabular'} editor exposes testable inputs`,before.length>0);
  for (let i=0;i<await fields.count();i++) {
    await fields.nth(i).click(); await settle();
    check(`${componentIndex ? 'equation' : 'tabular'} field ${i} focus changes no control geometry`, JSON.stringify(before)===JSON.stringify(await bounds()));
  }
  await page.keyboard.press('Escape');
  }

  // Session metadata swaps divs for native inputs. Both states must reserve
  // identical line boxes, including the heavier session title typography.
  const toggle=frame.getByRole('button',{name:'Session Info',exact:true});
  if(await toggle.getAttribute('aria-expanded')==='false') await toggle.click();
  for (let i=0;i<5;i++) {
    const label=frame.locator('.session-header-value').nth(i);
    await label.scrollIntoViewIfNeeded(); await settle();
    const before=await metrics(label);
    await label.click(); await settle();
    const input=frame.locator('.session-header-input');
    const after=await metrics(input);
    check(`session field ${i} preserves line box, font, and indent`,Math.abs(before.height-after.height)<.6 && Math.abs(before.textX-after.textX)<.6 && before.font===after.font,JSON.stringify({before,after}));
    await input.press('Escape');
  }
  await frame.locator('[data-tour="tab-overview"]').click();
  for (const index of [0,1]) {
    const table=frame.locator('.instrument-equipment-table').nth(index);
    const row=table.locator('tr.instrument-function-row').first();
    for (const [cellClass,selector] of [['range','td.cell-value >> nth=0'],['tolerance','td.cell-tolerance'],['resolution','td.cell-value >> nth=1']]) {
      const cell=row.locator(selector).first();
      const summary=cell.locator('.inline-tolerance-summary').first();
      check(`instrument ${index} ${cellClass} read field exists`,await summary.count()>0);
      if(!await summary.count()) continue;
      await summary.scrollIntoViewIfNeeded(); await summary.click(); await settle();
      const inputs=cell.locator('input:not([type="checkbox"]):visible');
      const geometry=()=>inputs.evaluateAll(nodes=>nodes.map(n=>{
        const r=n.getBoundingClientRect(), row=n.closest('tr').getBoundingClientRect(), s=getComputedStyle(n);
        return [r.x-row.x,r.y-row.y,r.width,r.height,row.height,s.font,s.padding,s.borderWidth];
      }));
      const before=await geometry();
      check(`instrument ${index} ${cellClass} opens its inputs`,before.length>0);
      for(let i=0;i<await inputs.count();i++) {
        await inputs.nth(i).click(); await settle();
        check(`instrument ${index} ${cellClass} field ${i} focus is paint-only`,JSON.stringify(before)===JSON.stringify(await geometry()));
      }
      await frame.locator('.analysis-tabs').click({position:{x:5,y:5}}); await settle();
    }
    if(index===1) {
      const trigger=table.locator('.cell-distribution .inline-tolerance-summary').first();
      check('TMDE distribution field exists',await trigger.count()>0);
      if(await trigger.count()) {
        await trigger.scrollIntoViewIfNeeded(); await settle();
        const before=await metrics(trigger);
        await trigger.click(); await settle();
        const after=await metrics(table.getByRole('button',{name:'Spec band distribution',exact:true}).first());
        check('distribution read/edit preserves text size and inset',before.fontSize===after.fontSize && before.lineHeight===after.lineHeight && Math.abs(before.textX-before.cellX-after.textX+after.cellX)<.6,JSON.stringify({before,after}));
        await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
      }
    }
  }
}
