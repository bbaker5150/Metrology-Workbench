import { prepareWorkspacePolish } from './workspace-polish-checks.mjs';
export function prepareSeptember28(session) {
  prepareWorkspacePolish(session);
  session.tmdes[0].instrument ||= {};
  session.tmdes[0].instrument.tmdeSecondaryUncertainties = [
    { id: 'thermal', name: 'Thermal Expansion', kind: 'parametric', tolerance: {floor:{high:'.15',unit:'V',distribution:'1.732'}} },
    { id: 'alignment', name: 'Misalignment Error', kind: 'parametric', tolerance: {floor:{high:'.2',unit:'V',distribution:'1.732'}} },
  ];
  const point = session.testPoints[0];
  Object.assign(point, {measurementType:'direct',equationString:'',variableMappings:{},variableNominals:{}});
  point.components = [
    {id:'repeatability_1',name:'Repeatability',type:'A',value_native:.25,unit_native:'V',value:.25,dof:1,distribution:'Normal',savedInputs:{readings:[4.5,5]}},
    {id:'manual-one',name:'Manual reference',type:'B',isManual:true,isInlineManual:true,originalInput:{inputMode:'standard',standardUncertainty:'.1',unit:'V'},value_native:.1,unit_native:'V',value:.1,distribution:'Rectangular',dof:Infinity}
  ];
}
export async function checkSeptember28({frame,page,until,check}) {
  await page.setViewportSize({width:1600,height:1050});
  const table = frame.locator('.instrument-equipment-table').nth(1);
  const sourceRows = table.locator('tr[data-uncertainty-source-id]');
  const checkRail = async mode => {
    check(`${mode}: one rail labels both additional uncertainties`, await sourceRows.count() === 2 && await table.getByLabel('Additional uncertainty',{exact:true}).count() === 1);
    check(`${mode}: rail has a bottom divider and a white background in light mode`, await table.locator('.instrument-uncertainty-rail').evaluate(node=>{
      const style=getComputedStyle(node);
      return parseFloat(style.borderBottomWidth)>0 && style.borderBottomStyle==='solid' && (!document.body.classList.contains('light-mode') || style.backgroundColor==='rgb(255, 255, 255)');
    }));
    check(`${mode}: old parenthetical range notes are absent`, !/Range N\/A|Point Dependent/.test(await sourceRows.allTextContents()));
    check(`${mode}: rail spans exactly the additional rows`, await until(async()=>table.evaluate(node=>{
      const rows=[...node.querySelectorAll('tr[data-uncertainty-source-id]')];
      const rail=node.querySelector('.instrument-uncertainty-rail');
      if(!rail || rows.length!==2)return false;
      const box=rail.getBoundingClientRect(),first=rows[0].getBoundingClientRect(),last=rows.at(-1).getBoundingClientRect();
      const text=rail.firstElementChild.getBoundingClientRect();
      return Math.abs(box.top-first.top)<2 && Math.abs(box.bottom-last.bottom)<2 && text.top>=box.top-1 && text.bottom<=box.bottom+1 && getComputedStyle(rail.parentElement).overflowY === 'visible';
    })));
  };
  const checkSelection = async mode => {
    for (let index = 0; index < 2; index++) {
      const row = sourceRows.nth(index);
      await row.locator('.cell-range').click({position:{x:26,y:3}});
      check(`${mode}: source ${index + 1} range selection excludes the label rail and shared description`, await until(()=>table.evaluate((node,index)=>{
        const row=node.querySelectorAll('tr[data-uncertainty-source-id]')[index];
        const cell=row.querySelector('.cell-range');
        const rail=node.querySelector('.instrument-uncertainty-rail');
        const overlay=node.parentElement.querySelector('.instrument-selection-outline');
        if(!overlay || node.dataset.selectionMode!=='range' || node.querySelector('.cell-description[data-cell-selected]')) return false;
        const box=cell.getBoundingClientRect(), origin=overlay.getBoundingClientRect();
        const scale=origin.width/parseFloat(overlay.style.width);
        const x=(rail.getBoundingClientRect().right-origin.left)/scale;
        const y1=(box.top-origin.top)/scale,y2=(box.bottom-origin.top)/scale;
        return [...overlay.querySelectorAll('path')].some(path=>[...path.getAttribute('d').matchAll(/M([\d.-]+),([\d.-]+)L([\d.-]+),([\d.-]+)/g)].some(m=>Math.abs(+m[1]-x)<1 && Math.abs(+m[3]-x)<1 && Math.abs(+m[2]-y1)<1 && Math.abs(+m[4]-y2)<1));
      },index)));
      for(const column of ['tolerance','distribution','resolution']) {
        await row.locator(`.cell-${column}`).click({position:{x:3,y:3}});
        check(`${mode}: source ${index + 1} ${column} selects shared instrument cells`, await until(()=>table.evaluate(node=>node.dataset.selectionMode==='instrument' && Boolean(node.querySelector('.cell-description[data-cell-selected]')) && Boolean(node.querySelector('.cell-sync[data-cell-selected]')))));
      }
      check(`${mode}: source ${index + 1} instrument outline wraps the shared rail without crossing its text`, await until(()=>table.evaluate(node=>{
        const rail=node.querySelector('.instrument-uncertainty-rail'), cell=rail.parentElement;
        const overlay=node.parentElement.querySelector('.instrument-selection-outline');
        const origin=overlay.getBoundingClientRect(),scale=origin.width/parseFloat(overlay.style.width);
        const box=cell.getBoundingClientRect(),width=parseFloat(getComputedStyle(cell).getPropertyValue('--instrument-uncertainty-rail-width'));
        const left=(box.left-origin.left)/scale, right=left+width, top=(box.top-origin.top)/scale, bottom=top+rail.getBoundingClientRect().height/scale;
        const edges=[...overlay.querySelectorAll('path')].flatMap(path=>[...path.getAttribute('d').matchAll(/M([\d.-]+),([\d.-]+)L([\d.-]+),([\d.-]+)/g)].map(m=>m.slice(1).map(Number)));
        return edges.some(([x1,y1,x2,y2])=>Math.abs(y1-top)<1 && Math.abs(y2-top)<1 && x1<=left+1 && x2>=right-1) && !edges.some(([x1,y1,x2,y2])=>Math.abs(y1-y2)<.1 && y1>top+1 && y1<bottom-1 && x1<right-.5 && x2>left+.5);
      })));
      if(mode==='overview light' && process.env.FEEDBACK_SCREENSHOT_DIRECTORY) await page.screenshot({path:`${process.env.FEEDBACK_SCREENSHOT_DIRECTORY}/source-${index + 1}-instrument-outline.png`});
    }
    check(`${mode}: label retains an apostrophe in horizontally composed rotated text`, await table.locator('.instrument-uncertainty-rail > span').evaluate(node=>node.textContent==='ADD’L UNCERTAINTY' && getComputedStyle(node).writingMode==='horizontal-tb'));
  };
  await checkRail('overview light');
  await checkSelection('overview light');
  await frame.getByRole('button',{name:'Switch to dark mode',exact:true}).click();
  await checkRail('overview dark');
  await checkSelection('overview dark');
  await sourceRows.first().locator('.instrument-source-row-name button').click();
  await sourceRows.first().getByRole('textbox',{name:'Uncertainty name'}).press('Tab');
  await checkRail('expanded editor');
  const unit=sourceRows.first().getByRole('button',{name:'Tolerance unit base unit',exact:true});
  await unit.click();
  check('shared unit menu names the empty unit Units', await frame.getByRole('option',{name:/^Units(?:\s|$)/}).count()===1 && await frame.getByRole('option',{name:/Unitless/}).count()===0);
  await frame.getByPlaceholder('Search units...', {exact:true}).press('Escape');
  await frame.locator('.analysis-tabs').click({position:{x:5,y:5}});
  if(process.env.FEEDBACK_SCREENSHOT_DIRECTORY) await page.screenshot({path:`${process.env.FEEDBACK_SCREENSHOT_DIRECTORY}/additional-uncertainties-dark.png`});
  await frame.getByRole('button',{name:'Switch to light mode',exact:true}).click();
  const expand=frame.getByRole('button',{name:'Expand measurement area',exact:true});
  if(await expand.count()) await expand.first().click();
  await frame.locator('[data-point-id="point"] [data-sidebar-column="pfa"]').click();
  await checkRail('measurement point');
  await checkSelection('measurement point');
  check('budget A and B text share the same column center',await until(async()=>frame.locator('.uncertainty-budget-table').first().evaluate(table=>{
    const cells=[...table.querySelectorAll('td.budget-component-type')];
    if(!table.querySelector('.budget-component-type button') || !cells.some(c=>c.textContent.trim()==='A') || !cells.some(c=>c.textContent.trim()==='B')) return false;
    return cells.every(cell=>{
      const text=document.createTreeWalker(cell,NodeFilter.SHOW_TEXT).nextNode();
      if(!text)return false;
      const range=document.createRange();range.selectNodeContents(text);
      const glyph=range.getBoundingClientRect(),box=cell.getBoundingClientRect();
      return Math.abs((glyph.left+glyph.right)/2-(box.left+box.right)/2)<1.5 && Math.abs((glyph.top+glyph.bottom)/2-(box.top+box.bottom)/2)<3;
    });
  })));
  await frame.locator('.uncertainty-budget-table').first().scrollIntoViewIfNeeded();
  if(process.env.FEEDBACK_SCREENSHOT_DIRECTORY) await page.screenshot({path:`${process.env.FEEDBACK_SCREENSHOT_DIRECTORY}/budget-types-light.png`});
}
