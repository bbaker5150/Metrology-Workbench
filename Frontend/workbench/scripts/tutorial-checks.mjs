import { prepareWorkspacePolish } from './workspace-polish-checks.mjs';
import { createWalkthroughSteps } from '../src/modules/uncertainty/components/common/walkthroughSteps.js';

export function prepareTutorial(session) {
  prepareWorkspacePolish(session);
  Object.assign(session.testPoints[0], {
    equationString: 'a + b', variableMappings: {a:'Voltage',b:'Offset'},
    variableNominals: {a:{value:4,unit:'V'},b:{value:1,unit:'V'}},
  });
  session.testPoints[0].components.push({id:'tutorial-offset',name:'Offset uncertainty',type:'B',isManual:true,isInlineManual:true,
    variableType:'Offset',variableSymbol:'b',originalInput:{inputMode:'standard',standardUncertainty:'.01',unit:'V'},value_native:.01,unit_native:'V',value:.01,distribution:'Rectangular',dof:Infinity});
  session.tmdes[0].instrument.tmdeSecondaryUncertainties = [
    {id:'thermal',name:'Temperature effect',kind:'parametric',tolerance:{floor:{high:'.1',unit:'V',distribution:'1.732'}}},
  ];
}

export async function checkTutorial({frame,page,until,check}) {
  await page.setViewportSize({width:1600,height:1050});
  await page.locator('iframe#app').evaluate(node => { node.style.height = '100vh'; });
  const steps=createWalkthroughSteps(2);
  const card=frame.getByRole('dialog',{name:'Uncertalytics walkthrough',exact:true});
  const open=()=>frame.getByRole('button',{name:'Open walkthrough',exact:true}).click();
  const close=()=>card.getByRole('button',{name:'Close walkthrough'}).click();
  const selectStep=async id=>{
    const index=steps.findIndex(step=>step.id===id);
    await card.getByRole('combobox',{name:'Walkthrough workflow'}).selectOption(steps[index].workflow);
    await card.getByRole('combobox',{name:'Walkthrough step'}).selectOption(String(index));
    await until(()=>card.locator('h3').textContent().then(text=>text===steps[index].title));
  };
  const assertCard=async label=>check(label,await until(()=>card.evaluate(node=>{
    const rect=node.getBoundingClientRect();
    const controls=[...node.querySelectorAll('select, .guided-walkthrough-card-header button')];
    return rect.top>=0 && rect.bottom<=innerHeight && rect.left>=0 && rect.right<=innerWidth && controls.every(control=>{
      const r=control.getBoundingClientRect();return control.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2));
    });
  })));
  const expand=frame.getByRole('button',{name:'Expand measurement area',exact:true});
  if(await expand.count()) await expand.first().click();
  await frame.locator('[data-point-id="direct-polish"] [data-sidebar-column="pfa"]').click();
  await open();
  for(const step of steps.filter(step=>step.workflow!=='Derived measurement')) {
    await selectStep(step.id);
    check(`tutorial ${step.id}: current control is available`,await until(async()=>await frame.locator(step.target).evaluateAll(nodes=>nodes.some(node=>{const r=node.getBoundingClientRect(),s=getComputedStyle(node);return r.width>0 && r.height>0 && s.visibility!=='hidden' && s.display!=='none';})) && await card.locator('.guided-walkthrough-waiting').count()===0 && await frame.locator('.guided-walkthrough-highlight').count()===1));
  }
  await selectStep('session-information');
  const next=card.locator('.guided-walkthrough-primary');
  check('tutorial requires a saved action before Next',await next.isDisabled());
  const currentTitle=await card.locator('h3').textContent();
  await frame.locator('[data-tour="tab-notes"]').click({force:true});
  check('tutorial blocks unrelated tab clicks while an action is pending',await frame.locator('[data-tour="tab-notes"]').evaluate(node=>!node.classList.contains('active')));
  const sessionFields=frame.locator('[data-tour="session-information"]');
  const editable=sessionFields.locator('input').first();
  if(!await editable.count()) await sessionFields.locator('.session-header-name').click();
  const field=sessionFields.locator('input').first();
  const original=await field.inputValue();
  await field.fill(original+' tutorial');
  await field.press('Enter');
  check('tutorial unlocks Next after the session edit is saved',await until(()=>next.isEnabled()));
  check('completed actions pulse the highlighted region green',await frame.locator('.guided-walkthrough-highlight.is-action-complete').count()===1);
  check('completed actions also highlight the tutorial card green',await card.evaluate(node=>node.classList.contains('is-action-complete') && getComputedStyle(node).borderTopColor==='rgb(34, 197, 94)'));
  check('completed edits advance automatically',await until(()=>card.locator('h3').textContent().then(title=>title!==currentTitle)));
  check('jumping starts the new action with its own completion state',await next.isDisabled());
  await card.getByRole('button',{name:'Back',exact:true}).click();
  check('Back remembers a completed action without requiring another edit',await until(()=>next.isEnabled()));
  await selectStep('session-requirements');
  await card.getByRole('button',{name:'Skip',exact:true}).click();
  check('Skip advances an incomplete step',await until(()=>card.locator('h3').textContent().then(title=>title==='Open Instrument Overview')));
  await close();
  await frame.locator('[data-tour="tab-notes"]').click();
  check('closing the tutorial restores ordinary tab interaction',await frame.locator('[data-tour="tab-notes"]').evaluate(node=>node.classList.contains('active')));
  await frame.locator('[data-tour="tab-overview"]').click();
  await open();
  await selectStep('instrument-units');
  const uutTable=frame.locator('[data-tour="uut-table"]');
  await uutTable.locator('[data-range-cell] .inline-tolerance-summary').first().click();
  await uutTable.getByRole('button',{name:'Range unit prefix',exact:true}).first().click();
  const unitMenu=frame.locator('.inline-unit-menu');
  await unitMenu.waitFor();
  check('opening a unit menu alone does not complete the action',await next.isDisabled());
  const highlightContains = locator => locator.evaluate(node=>{
    const r=node.getBoundingClientRect(), h=document.querySelector('.guided-walkthrough-highlight').getBoundingClientRect();
    return r.left>=h.left-1 && r.right<=h.right+1 && r.top>=h.top-1 && r.bottom<=h.bottom+1;
  });
  check('prefix menu is fully inside the spotlight',await until(()=>highlightContains(unitMenu)));
  for(const zoom of [1.25, .8, 1]) {
    await frame.locator('html').evaluate((node,value)=>{node.style.zoom=String(value);},zoom);
    check(`spotlight tracks whole-app zoom ${zoom}`,await until(()=>highlightContains(unitMenu)));
    await assertCard(`tutorial navigation remains inside the viewport at zoom ${zoom}`);
  }
  await uutTable.evaluate(node=>{node.style.zoom='1.15';});
  check('spotlight tracks independent table scaling',await until(()=>highlightContains(uutTable)));
  await uutTable.evaluate(node=>{node.style.zoom='';});

  await unitMenu.locator('[role="option"][aria-selected="true"]').first().click();
  check('required action permits portal options and completes after selection',await until(()=>next.isEnabled()));
  check('unit selection advances automatically',await until(()=>card.locator('h3').textContent().then(title=>title==='Add measuring equipment')));
  await selectStep('custom-columns');
  check('custom-column plus buttons remain inside the expanded spotlight',await until(()=>uutTable.locator('.instrument-column-insert-button').evaluateAll(nodes=>{
    const h=document.querySelector('.guided-walkthrough-highlight').getBoundingClientRect();
    return nodes.every(node=>{const r=node.getBoundingClientRect();return !r.width || (r.top>=h.top-1 && r.bottom<=h.bottom+1 && r.left>=h.left-1 && r.right<=h.right+1);});
  })));

  await selectStep('derived-equation');
  check('tutorial explains derived prerequisites on a direct point',await until(async()=>await card.locator('.guided-walkthrough-waiting').count()===1));
  await close();
  await frame.locator('[data-point-id="point"] [data-sidebar-column="pfa"]').click();
  await open();
  for(const step of steps.filter(step=>step.workflow==='Derived measurement')) {
    await selectStep(step.id);
    check(`tutorial ${step.id}: derived control is available`,await until(async()=>await frame.locator(step.target).evaluateAll(nodes=>nodes.some(node=>{const r=node.getBoundingClientRect(),s=getComputedStyle(node);return r.width>0 && r.height>0 && s.visibility!=='hidden' && s.display!=='none';})) && await card.locator('.guided-walkthrough-waiting').count()===0 && await frame.locator('.guided-walkthrough-highlight').count()===1));
  }

  await selectStep('derived-correlation');
  await frame.getByRole('button',{name:'Input correlation matrix',exact:true}).click();
  check('correlation permits continuing while its window is open',await until(()=>next.isEnabled()));
  await next.click();
  check('leaving correlation dismisses its window',await until(()=>frame.getByRole('dialog',{name:'Input correlation matrix',exact:true}).count().then(count=>count===0)));
  check('propagation controls remain accessible after correlation',await frame.locator('.budget-propagation-control').evaluate(node=>{
    const r=node.getBoundingClientRect(),hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return node.contains(hit);
  }));
  await selectStep('column-menu');
  await frame.getByRole('button',{name:'Columns',exact:true}).click();
  const menu=frame.getByRole('dialog',{name:'Visible measurement point columns',exact:true});
  await menu.waitFor();
  await assertCard('tutorial navigation remains clickable above the native column popover');
  check('tutorial spotlights the current column menu',await until(()=>menu.evaluate(node=>{
    const r=node.getBoundingClientRect(),h=document.querySelector('.guided-walkthrough-highlight').getBoundingClientRect();
    return r.left>=h.left && r.right<=h.right && r.top>=h.top && r.bottom<=h.bottom;
  })));
  const bar=menu.locator('.point-column-menu-actions');
  const before=await bar.boundingBox();
  await page.mouse.move(before.x+15,before.y+before.height/2);await page.mouse.down();await page.mouse.move(before.x+70,before.y+before.height/2+20);await page.mouse.up();
  check('tutorial highlight follows a dragged column popover',await until(()=>menu.evaluate(node=>{
    const r=node.getBoundingClientRect(),h=document.querySelector('.guided-walkthrough-highlight').getBoundingClientRect();
    return r.left>=h.left && r.right<=h.right && r.top>=h.top && r.bottom<=h.bottom;
  })));
  await assertCard('tutorial controls remain reachable after dragging the menu');
  await page.waitForTimeout(350);
  if(process.env.FEEDBACK_SCREENSHOT_DIRECTORY) await page.screenshot({path:`${process.env.FEEDBACK_SCREENSHOT_DIRECTORY}/tutorial-columns-light.png`});
  await menu.getByRole('button',{name:'Close column settings',exact:true}).click();
  await selectStep('source-types');
  await frame.locator('[data-tour="tmde-table"] .cell-tolerance .inline-tolerance-summary').first().click();
  await frame.getByRole('button',{name:'Change uncertainty type',exact:true}).first().click();
  await assertCard('tutorial stays usable with the uncertainty type editor open');
  await close();
  await frame.locator('.analysis-tabs').click({position:{x:5,y:5}});
  await frame.getByRole('button',{name:'Switch to dark mode',exact:true}).click();
  await open();
  await selectStep('session-requirements');
  check('tutorial opens the current combined requirements section',await frame.getByLabel('Default Risk & Mitigation Inputs',{exact:true}).isVisible());
  await page.setViewportSize({width:900,height:600});
  await assertCard('tutorial card and navigation fit a short viewport');
  await page.waitForTimeout(350);
  if(process.env.FEEDBACK_SCREENSHOT_DIRECTORY) await page.screenshot({path:`${process.env.FEEDBACK_SCREENSHOT_DIRECTORY}/tutorial-dark-short.png`});
  await close();
  await page.setViewportSize({width:1600,height:1050});
  const divider=frame.getByRole('separator',{name:'Resize measurement point list'});
  await divider.dblclick();await divider.dblclick();
  await open();
  await selectStep('overview-tab');
  check('tutorial reveals the instrument pane from full-width points',await until(()=>frame.locator('.results-content').isVisible()));
  await selectStep('notes');
  check('tutorial navigates to Notes',await frame.locator('[data-tour="tab-notes"]').evaluate(node=>node.classList.contains('active')));
  await close();
  await frame.getByRole('button',{name:'Switch to light mode',exact:true}).click();
  await frame.locator('[data-tour="tab-overview"]').click();
  await page.locator('iframe#app').evaluate(node => { node.style.height = '900px'; });
}
