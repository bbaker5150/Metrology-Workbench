export function prepareSeptember29(session) {
  const point=structuredClone(session.testPoints.find(p=>p.id==='direct-polish'));
  Object.assign(point,{id:'manual-units',activeUutId:null,associatedUutIds:[],uutTolerance:null,tmdeTolerances:[],budgetComponentOrder:['manual-fs','other-manual']});
  point.testPointInfo.parameter={value:10,unit:'',unitless:true,unitSelectionExplicit:true};
  point.components=['manual-fs','other-manual'].map((id,index)=>({id,name:index?'Other manual':'Full scale test',type:'B',isManual:true,isInlineManual:true,inlineDraft:false,
    originalInput:{name:index?'Other manual':'Full scale test',type:'B',unit:'V',inputMode:'tolerance',errorDistributionDivisor:'1.732',
      tolerance:{floor:{high:'1',low:'-1',unit:'V',distribution:'1.732'},range:{high:'1',low:'-1',value:'100',unit:'%',distribution:'1.732'}}}}));
  session.testPoints.push(point);
}
export async function checkSeptember29({ frame, page, saved, until, check }) {
  await page.setViewportSize({width:1600,height:1000});
  const expand=frame.getByRole('button',{name:'Expand measurement area',exact:true});
  if(await expand.count()) await expand.first().click();
  const point=frame.locator('[data-point-id="point"]');
  await point.locator('[data-sidebar-column="pfa"]').click();
  const summary=point.getByRole('button',{name:'Edit measurement point value',exact:true});
  check('value is one collapsed field with its unit',await summary.innerText().then(s=>s.includes('5')&&s.includes('V')) && await point.locator('.point-unit-control').count()===0);
  await summary.click();
  const unit=point.getByRole('button',{name:'Measurement point unit base unit',exact:true});
  const prefix=point.getByRole('button',{name:'Measurement point unit prefix',exact:true});
  check('one click exposes value, searchable unit and prefix',await point.getByPlaceholder('Value').isVisible()&&await unit.isVisible()&&await prefix.isVisible());
  const choose=async(name)=>{await unit.click();await frame.locator('.inline-unit-search').fill(name);await frame.getByRole('option',{name:new RegExp(`^${name}\\s`)}).first().click();};
  await choose('Units');
  await prefix.click();await frame.getByRole('option',{name:/^Kilo\s/}).click();
  check('Units supports a persisted prefix',await until(()=>saved().testPoints[0].testPointInfo.parameter.unit==='kUnits'));
  check('the editor stays open after changing unit and prefix',await point.getByPlaceholder('Value').isVisible());
  await point.getByPlaceholder('Value').press('Enter');
  check('Enter collapses to the value and prefixed unit',await summary.isVisible()&&await summary.innerText().then(s=>s.includes('kUnits')));
  await summary.click();await choose('V');await point.getByPlaceholder('Value').press('Enter');

  await frame.getByRole('button',{name:'Edit nominal for equation variable a',exact:true}).click();
  const inputUnit=frame.getByRole('button',{name:'Nominal unit for equation variable a base unit',exact:true});
  await inputUnit.click();await frame.locator('.inline-unit-search').fill('A');await frame.getByRole('option',{name:/^A\s+Current$/}).click();
  const status=frame.locator('.measurement-equation-status');
  check('unit mismatch still displays the calculated number and target',await until(()=>status.innerText().then(s=>s.includes('Calculated:')&&s.includes('5.00000')&&s.includes('Target 5.00000 V'))));
  check('unit mismatch does not show the green check',await status.locator('[data-icon="circle-check"]').count()===0);
  await inputUnit.click();await frame.locator('.inline-unit-search').fill('V');await frame.getByRole('option',{name:/^V\s+Voltage$/}).click();
  check('matching value and units restore the green check',await until(()=>status.locator('[data-icon="circle-check"]').count().then(n=>n===1)));
  const notice=frame.getByRole('button',{name:'Close',exact:true});
  if(await notice.count()) await notice.last().click();
  for(const theme of ['light','dark']) {
    await frame.evaluate(theme=>{document.body.classList.toggle('light-mode',theme==='light');document.body.classList.toggle('dark-mode',theme==='dark');},theme);
    await summary.click();
    check(`${theme} selected unit label fits its control`,await unit.evaluate(node=>{const label=node.querySelector('span');return label.scrollWidth<=label.clientWidth+1;}));
    if(process.env.FEEDBACK_SCREENSHOT_DIRECTORY) await page.screenshot({path:`${process.env.FEEDBACK_SCREENSHOT_DIRECTORY}/value-editor-${theme}.png`});
    await point.getByPlaceholder('Value').press('Enter');
  }
  await frame.locator('[data-point-id="manual-units"] [data-sidebar-column="pfa"]').click();
  const row=frame.locator('.component-group-tbody > tr').filter({hasText:'Full scale test'});
  await row.getByRole('button',{name:'Edit tolerance',exact:true}).click();
  await row.getByRole('button',{name:'Tolerance unit base unit',exact:true}).click();
  await frame.locator('.inline-unit-search').fill('A');await frame.getByRole('option',{name:/^A\s+Current$/}).click();
  check('manual FS label follows the changed unit on an unassigned point',await row.locator('.inline-tolerance-fs').innerText().then(s=>s.includes('A')));
  await frame.locator('.analysis-tabs').click({position:{x:5,y:5}});
  check('manual unit changes retain calculated standard uncertainty',await until(()=>row.locator('td:nth-last-child(2)').innerText().then(s=>s.includes('A')&&!s.includes('Not Set'))));
  await row.hover();
  await row.getByRole('button',{name:'Move component down',exact:true}).click();
  check('budget down arrow changes and saves displayed row order',await until(()=>saved().testPoints.find(p=>p.id==='manual-units').budgetComponentOrder[0]==='other-manual')&&await frame.locator('.component-group-tbody > tr').first().innerText().then(s=>s.includes('Other manual')));
  await frame.evaluate(()=>location.reload());await frame.getByRole('combobox',{name:'Analysis Session'}).waitFor();
  await frame.locator('[data-point-id="manual-units"] [data-sidebar-column="pfa"]').click();
  check('budget ordering survives reload',await frame.locator('.component-group-tbody > tr').first().innerText().then(s=>s.includes('Other manual')));
}
