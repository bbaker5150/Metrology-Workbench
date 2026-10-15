import { validateEquation } from "../../utils/equationValidation";
import { validateBudgetEquation } from "../../utils/dynamicBudgetComponents";
import { describe, it, expect } from 'vitest';
import { walkthroughActions as actions } from './walkthroughActions';
const context = session => ({session});
const initial = context({testPoints:[],tmdes:[],uuts:[]});

describe('tutorial action requirements', () => {
  it('allows reviewing risk defaults and checks the active Overview tab', () => {
    expect(actions['session-requirements']).toBeUndefined();
    expect(actions['overview-tab'].complete({analysisMode:'overview'})).toBe(true);
    expect(actions['overview-tab'].complete({analysisMode:'notes'})).toBe(false);
  });
  it('requires the new instrument identity while keeping Tag optional', () => {
    const action=actions['uut-description'];
    const existing={id:'old',name:'Old',instrument:{manufacturer:'Fluke',model:'8588A'}};
    const created={id:'new',name:'',instrument:{manufacturer:'',model:''}};
    const data=context({uuts:[existing,created]});
    expect(action.complete(data)).toBe(false);
    created.instrument.manufacturer='Keysight';created.instrument.model='34461A';
    expect(action.complete(data)).toBe(false);
    created.name='Reference meter';expect(action.complete(data)).toBe(true);
  });
  it.each(['direct','derived'])('walks through %s creation, assignment and numeric value separately', mode => {
    const action=actions[mode==='direct'?'measurement-point':'derived-point'];
    const baseline=action.snapshot(initial);
    const point={id:'new',measurementType:mode,testPointInfo:{parameter:{value:''}}};
    expect(action.complete(context({testPoints:[point]}),baseline)).toBe(true);
    expect(action.complete(context({testPoints:[point]}),['new'])).toBe(false);
    expect(actions['point-uut'].complete({point})).toBe(false);
    point.associatedUutIds=['uut'];
    expect(actions['point-uut'].complete({point})).toBe(true);
    expect(actions['point-value'].complete({point})).toBe(false);
    point.testPointInfo.parameter.value='invalid';
    expect(actions['point-value'].complete({point})).toBe(false);
    point.testPointInfo.parameter.value=0;
    expect(actions['point-value'].complete({point})).toBe(true);
  });
  it('does not count opening the budget menu as adding a contributor', () => {
    const action=actions['budget-component'];
    const baseline=action.snapshot({point:{components:[{id:'existing'}]}});
    expect(action.complete({point:{components:[{id:'existing'}]}},baseline)).toBe(false);
    expect(action.complete({point:{components:[{id:'existing'},{id:'new'}]}},baseline)).toBe(true);
  });
  it('requires saved repeatability readings, including valid zero', () => {
    const action=actions.repeatability, baseline=action.snapshot(initial);
    const component={id:'repeatability',type:'A',savedInputs:{readings:[]}};
    expect(action.complete({point:{components:[component]}},baseline)).toBe(false);
    component.savedInputs.readings=[0];
    expect(action.complete({point:{components:[component]}},baseline)).toBe(true);
  });
  it('observes canonical instrument range edits and custom columns', () => {
    const action=actions['uut-columns'];
    const before=context({uuts:[{instrument:{functions:[{ranges:[{min:0,max:1}]}]}}]});
    const after=context({uuts:[{instrument:{functions:[{ranges:[{min:0,max:2}]}]}}]});
    expect(action.complete(after,action.snapshot(before),{evidence:true})).toBe(true);
    expect(action.complete(after,action.snapshot(before),{evidence:false})).toBe(false);
    const custom=actions['custom-columns'];
    expect(custom.complete(context({instrumentCustomColumns:{uut:[{id:'new'}]}}),custom.snapshot(initial))).toBe(true);
  });
  it('tracks TMDE specifications without treating UUT changes as TMDE edits', () => {
    const action=actions['tmde-columns'];
    const before=context({tmdes:[{instrument:{functions:[{ranges:[{min:0,max:10,tolerances:{bandDistribution:'1'}}]}]}}]});
    const baseline=action.snapshot(before);
    expect(action.complete({...before,session:{...before.session,uuts:[{ranges:[{max:20}]}]}},baseline,{evidence:true})).toBe(false);
    const after=structuredClone(before);
    after.session.tmdes[0].instrument.functions[0].ranges[0].tolerances.bandDistribution='1.732';
    expect(action.complete(after,baseline,{evidence:true})).toBe(true);
    expect(action.complete(after,baseline,{evidence:false})).toBe(false);
  });
  it('requires a newly saved, named library definition', () => {
    const action=actions['library-create'], old={id:'old',manufacturer:'',model:'',description:''};
    const baseline=action.snapshot({instruments:[old]});
    const named={manufacturer:'Fluke',model:'8588A',description:'Reference meter',scope:'local'};
    expect(action.complete({instruments:[{...old,...named}]},baseline)).toBe(false);
    expect(action.complete({instruments:[{id:'new',...named,description:''}]},baseline)).toBe(false);
    expect(action.complete({instruments:[{id:'new',...named}]},baseline)).toBe(true);
    expect(action.autoAdvance).toBe(false);
  });
  it('allows continuing after viewing and hiding library specifications', () => {
    const action=actions['library-specs'],ui={seen:new Set(),visible:()=>false};
    expect(action.complete(initial,null,ui)).toBe(false);
    ui.visible=()=>true;
    expect(action.complete(initial,null,ui)).toBe(true);
    ui.visible=()=>false;
    expect(action.complete(initial,null,ui)).toBe(true);
    expect(action.autoAdvance).toBe(false);
  });
  it.each(['uuts','tmdes'])('requires both a library drop and a new %s instance', kind => {
    const action=actions['library-drag'], baseline=action.snapshot(initial);
    const added=context({[kind]:[{id:'new'}]});
    expect(action.complete(initial,baseline,{evidence:true})).toBe(false);
    expect(action.complete(added,baseline,{evidence:false})).toBe(false);
    expect(action.complete(added,baseline,{evidence:true})).toBe(true);
    const table=document.createElement('table');table.dataset.tour=kind==='uuts'?'uut-table':'tmde-table';
    const event={type:'drop',target:table,dataTransfer:{types:['application/x-workbench-library-instruments']}};
    expect(action.acceptEvent(event)).toBe(true);
    expect(action.acceptEvent({...event,dataTransfer:{types:['text/plain']}})).toBe(false);
    const library=document.createElement('div');library.className='instrument-library-window';library.append(table);
    expect(action.acceptEvent(event)).toBe(false);
  });
  it('requires table values rather than merely changing uncertainty type', () => {
    const action=actions['source-table'], baseline=action.snapshot(initial);
    const definition={kind:'table',rows:[{point:0,values:{a:{value:''}}}]};
    const data=context({tmdes:[{instrument:{tmdeSecondaryUncertainties:[{id:'source',dynamicDefinition:definition}]}}]});
    expect(action.complete(data,baseline)).toBe(false);
    definition.rows[0].values.a.value='invalid';
    expect(action.complete(data,baseline)).toBe(false);
    definition.rows[0].values.a.value=0;
    expect(action.complete(data,baseline)).toBe(true);
  });
  it('requires valid equations and populated uncertainty variables', () => {
    const action=actions['derived-equation'];
    const baseline=action.snapshot(initial);
    const data={validateEquation,point:{equationString:'a +'}};
    expect(action.complete(data,baseline)).toBe(false);
    data.point.equationString='a + b';
    expect(action.complete(data,baseline)).toBe(true);
    const sourceAction=actions['source-equation'];
    const definition={kind:'equation',equation:'a * x',pointVariable:'x',variables:{a:{value:''},x:{value:''}}};
    const sourceData={validateBudgetEquation,session:{tmdes:[{instrument:{tmdeSecondaryUncertainties:[{dynamicDefinition:definition}]}}]}};
    expect(sourceAction.complete(sourceData,sourceAction.snapshot(initial))).toBe(false);
    definition.variables.a.value=.1;
    expect(sourceAction.complete(sourceData,sourceAction.snapshot(initial))).toBe(true);
  });
  it('distinguishes Direct and Derived settings', () => {
    const ui={find:()=>({textContent:'Direct'})};
    expect(actions['function-settings'].complete(initial,null,ui)).toBe(true);
    expect(actions['derived-settings'].complete(initial,null,ui)).toBe(false);
  });
});
