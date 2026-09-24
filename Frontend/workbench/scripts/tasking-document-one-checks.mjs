import { mkdirSync } from 'node:fs';

export async function audit({page,frame,check,until}) {
  mkdirSync('tmp/document-one-audit', {recursive:true});
  await frame.locator('.instrument-equipment-table').first().waitFor();
  const sidebar=frame.locator('.results-sidebar'),list=frame.locator('.measurement-point-list');
  const actions=frame.locator('.sidebar-global-actions'),add=frame.locator('.function-point-add-button').first();
  const divider=frame.getByRole('separator',{name:'Resize measurement point list'});
  for(const theme of ['light','dark']) {
    await frame.locator('body').evaluate((b,t)=>{b.classList.toggle('light-mode',t==='light');b.classList.toggle('dark-mode',t==='dark');},theme);
    const header=frame.locator('.instrument-equipment-table th.instrument-resizable-header').first();
    await header.hover();await page.waitForTimeout(150);
    check(`${theme}: custom-column plus is fully exposed above the header`,await header.evaluate(n=>{
      const b=n.querySelector('.instrument-column-insert-button'),r=b.getBoundingClientRect(),h=n.getBoundingClientRect();
      return h.top-r.top>=r.height/2 && [2,r.height-2].every(y=>b.contains(document.elementFromPoint(r.x+r.width/2,r.y+y)));
    }));
    check(`${theme}: point add keeps its transparent styling`,await add.evaluate(n=>getComputedStyle(n.parentElement).backgroundColor==='rgba(0, 0, 0, 0)'));
    if(theme==='light')check('light header separators',await header.evaluate(n=>getComputedStyle(n).borderRightWidth==='1px'));
    await page.screenshot({path:`tmp/document-one-audit/${theme}-headers.png`});
  }
  await frame.locator('body').evaluate(b=>{b.classList.remove('dark-mode');b.classList.add('light-mode');});
  for(const zoom of [1,.8,1.25]) {
    await frame.locator('.measurement-points-zoom-surface > .scoped-zoom-content').evaluate((n,z)=>{n.style.zoom=String(z);n.style.setProperty('--scoped-content-zoom',String(z));},zoom);
    for(const edge of ['left','right']) {
      await list.evaluate((n,e)=>n.scrollLeft=e==='left'?0:n.scrollWidth,edge);await page.waitForTimeout(100);
      const v=await list.boundingBox(),bar=await actions.boundingBox(),button=await add.boundingBox();
      check(`right-aligned controls (${zoom}, ${edge})`,Math.abs(bar.x+bar.width-v.x-v.width)<3,JSON.stringify({viewport:v,bar}));
      check(`visible add point (${zoom}, ${edge})`,button.x>=v.x&&button.x+button.width<=v.x+v.width+1,JSON.stringify(button));
    }
  }
  await frame.locator('.measurement-points-zoom-surface > .scoped-zoom-content').evaluate(n=>{n.style.zoom='1';n.style.setProperty('--scoped-content-zoom','1');});await list.evaluate(n=>n.scrollLeft=0);
  const info=frame.getByRole('button',{name:'Session Info',exact:true}),risk=frame.getByRole('button',{name:'Risk & Mitigation Inputs',exact:true});
  await info.click();check('Risk remains independently open',await risk.getAttribute('aria-expanded')==='true');
  await risk.click();await info.click();check('Session Info does not reopen Risk',await risk.getAttribute('aria-expanded')==='false');await risk.click();
  check('compact fields show units',await frame.locator('.session-header-field--requirement').evaluateAll(ns=>ns.every(n=>{const b=n.querySelector('.session-field-size');return b.getBoundingClientRect().width<=60&&(!b.dataset.unit||n.querySelector('.session-header-value').textContent.endsWith(b.dataset.unit));})));
  const start=await divider.boundingBox();await page.mouse.move(start.x+5,start.y+50);await page.mouse.down();await page.mouse.move(1000,start.y+50,{steps:5});await page.mouse.up();
  check('wide sidebar caps metadata spacing',await frame.locator('.session-header-grid,.session-default-input-fields').evaluateAll(ns=>ns.every(n=>n.getBoundingClientRect().width<=441)));
  await divider.dblclick();check('double click enters auto-fit',await until(async()=>await frame.locator('.workspace-pane-autofit').count()===1));
  await divider.dblclick();check('second double click hides sidebar',!await sidebar.isVisible());
  const c=await divider.boundingBox();await page.mouse.move(c.x+5,c.y+50);await page.mouse.down();await page.mouse.move(550,c.y+50,{steps:5});await page.mouse.up();
  check('drag restores free-hand',await sidebar.isVisible()&&await frame.locator('.workspace-pane-autofit').count()===0);
  const expand=frame.getByRole('button',{name:'Expand measurement area',exact:true});if(await expand.count())await expand.first().click();
  await frame.locator('[data-point-id="point"] [data-sidebar-column="value"]').click({position:{x:2,y:2}});
  const equation=frame.getByRole('button',{name:'Edit measurement equation',exact:true});await equation.waitFor();
  const t=await equation.boundingBox(),card=await frame.locator('.measurement-equation-card').boundingBox();
  check('equation hitbox hugs equation',t.width<card.width/2);await page.mouse.click(card.x+20,t.y+t.height/2);
  check('click beside equation leaves it closed',await equation.isVisible());
  await page.screenshot({path:'tmp/document-one-audit/equation-target.png'});
}

export async function auditFinal({page,frame,check,until,saved}) {
  await frame.locator('.analysis-tabs').getByText('Instrument Overview', {exact:true}).click();
  const panel=frame.locator('.instrument-panel-table-container').first();await panel.waitFor();
  const original=await panel.getAttribute('style');
  await panel.evaluate(n=>{n.style.height='110px';n.style.maxHeight='110px';n.scrollTop=70;});
  const header=panel.locator('th.instrument-resizable-header').first();await header.hover();await page.waitForTimeout(150);
  check('scrolled header keeps the entire custom-column button reachable',await header.evaluate(n=>{
    const b=n.querySelector('.instrument-column-insert-button'),r=b.getBoundingClientRect();
    return [2,r.height-2].every(y=>b.contains(document.elementFromPoint(r.x+r.width/2,r.y+y)));
  }));
  const positions=[];
  for(const top of [20,90,35,80]) {await panel.evaluate((n,t)=>n.scrollTop=t,top);await page.waitForTimeout(50);positions.push((await header.boundingBox()).y);}
  check('header remains fixed through rapid table scrolling',Math.max(...positions)-Math.min(...positions)<1,JSON.stringify(positions));
  await panel.evaluate((n,s)=>{if(s===null)n.removeAttribute('style');else n.setAttribute('style',s);n.scrollTop=0;},original);
  const expand=frame.getByRole('button',{name:'Expand measurement area',exact:true});if(await expand.count())await expand.first().click();
  await frame.locator('[data-point-id="point"] [data-sidebar-column="value"]').click({position:{x:2,y:2}});
  await frame.getByRole('button',{name:'Edit measurement equation',exact:true}).click();
  await frame.getByLabel('Measurement equation',{exact:true}).fill('Y = Z + µ * V + α');
  await frame.locator('.analysis-tabs').click({position:{x:5,y:5}});
  const inputRows=frame.locator('.measurement-inputs-table tbody tr:not(.measurement-output-row)');
  check('micro sign survives saving the equation',await until(()=>saved().testPoints[0].equationString==='Y = Z + µ * V + α'));
  check('input rows follow equation appearance',JSON.stringify(await inputRows.locator('td:first-child').allTextContents())===JSON.stringify(['Z','µ','V','α']));
  check('input heading is Symbol',await frame.locator('.measurement-inputs-table th').first().textContent()==='Symbol');
  await frame.getByRole('button',{name:'Rename equation variable µ',exact:true}).click();
  const symbol=frame.getByRole('textbox',{name:'Equation variable µ',exact:true});await symbol.fill('β');await symbol.press('Enter');
  check('renaming leaves the input in its existing position',await until(async()=>JSON.stringify(await inputRows.locator('td:first-child').allTextContents())===JSON.stringify(['Z','β','V','α'])));
  await page.screenshot({path:'tmp/document-one-audit/greek-inputs.png'});
}
