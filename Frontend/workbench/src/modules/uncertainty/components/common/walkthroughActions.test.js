import { validateEquation } from "../../utils/equationValidation";
import { validateBudgetEquation } from "../../utils/dynamicBudgetComponents";
import { describe, it, expect } from 'vitest';
import { walkthroughActions as actions } from './walkthroughActions';
const context = session => ({session});
const initial = context({testPoints:[],tmdes:[],uuts:[]});

describe('tutorial action requirements', () => {
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
    expect(action.complete(after,action.snapshot(before))).toBe(true);
    const custom=actions['custom-columns'];
    expect(custom.complete(context({instrumentCustomColumns:{uut:[{id:'new'}]}}),custom.snapshot(initial))).toBe(true);
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
