import { describe, it, expect } from 'vitest';
import { editQualifierRange, qualifierRowSpan, hasQualifierRanges } from './qualifierRanges';
import { assessRangeCompatibility } from './tmdeCompatibility';
import { applyItemRangePatch, resolveUutRangeHelper } from '../features/analysis/components/UncertaintyPanel';
const instrument = () => ({ id:'u', instrument:{functions:[{id:'f',name:'Current',unit:'A',ranges:[{id:'r',min:10,max:100,unit:'A',tolerances:{reading:{value:1,unit:'%'}}}]}]} });
const rows = item => item.instrument.functions[0].ranges;
describe('qualifier ranges',()=>{
 it('adds independent qualifier errors and shares parent bounds',()=>{
  let item=editQualifierRange(instrument(),'r','enable',{min:100,max:1000}).item;
  const added=editQualifierRange(item,'r','add'); item=added.item;
  expect(rows(item)).toHaveLength(2);
  expect(rows(item)[0].tolerances.reading.value).toBe(1);
  expect(rows(item)[1].tolerances).toEqual({});
  expect(qualifierRowSpan(rows(item),rows(item)[0])).toBe(2);
  expect(qualifierRowSpan(rows(item),rows(item)[1])).toBe(0);
  item=applyItemRangePatch(item,'r',{max:120});
  expect(rows(item).map(r=>r.max)).toEqual([120,120]);
  item=applyItemRangePatch(item,added.newRangeId,{tolerances:{reading:{value:2,unit:'%'}}});
  expect(rows(item).map(r=>r.tolerances.reading.value)).toEqual([1,2]);
  item=editQualifierRange(item,added.newRangeId,'remove').item;
  item=editQualifierRange(item,'r','remove').item;
  expect(hasQualifierRanges([item])).toBe(false);
  expect(rows(item)[0].tolerances.reading.value).toBe(1);
 });
 it('matches both dimensions including qualifier prefix conversions',()=>{
  let item=editQualifierRange(instrument(),'r','enable',{min:100,max:1000}).item;
  const added=editQualifierRange(item,'r','add'); item=editQualifierRange(added.item,added.newRangeId,'patch',{min:1000,max:10000}).item;
  const nominal={value:50,unit:'A',qualifier:{value:2,unit:'kHz'}};
  expect(assessRangeCompatibility(rows(item)[0],nominal).compatible).toBe(false);
  expect(assessRangeCompatibility(rows(item)[1],nominal).compatible).toBe(true);
  expect(resolveUutRangeHelper(item,{},null,nominal).activeRange.id).toBe(added.newRangeId);
  expect(assessRangeCompatibility(rows(item)[1],{value:50,unit:'A'}).reason).toMatch(/qualifier/);
 });
});
