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

it('edits ancestors, adds sibling branches and removes only the selected subtree',()=>{
 let item=editQualifierRange(instrument(),'r','enable',{min:'AC'}).item;
 item=editQualifierRange(item,'r','enable',{min:'90 days'},2).item;
 const child=editQualifierRange(item,'r','add',{},2); item=child.item;
 item=editQualifierRange(item,'r','patch',{min:'DC'}).item;
 expect(rows(item).map(r=>r.qualifier.min)).toEqual(['DC','DC']);
 expect(qualifierRowSpan(rows(item),rows(item)[0],1)).toBe(2);
 const sibling=editQualifierRange(item,'r','add'); item=sibling.item;
 expect(rows(item)).toHaveLength(3);
 expect(rows(item)[2].qualifier.qualifier).toBeUndefined();
 item=editQualifierRange(item,'r','remove').item;
 expect(rows(item)).toHaveLength(1);
 expect(rows(item)[0].id).toBe(sibling.newRangeId);
});

it('requires each nested categorical qualifier when selecting uncertainty',()=>{
 let item=editQualifierRange(instrument(),'r','enable',{min:100,max:1000}).item;
 item=editQualifierRange(item,'r','enable',{min:'90 days'},2).item;
 const nominal={value:50,unit:'A',qualifier:{value:200,unit:'Hz',qualifier:{value:'90 days'}}};
 expect(assessRangeCompatibility(rows(item)[0],nominal).compatible).toBe(true);
 expect(assessRangeCompatibility(rows(item)[0],{...nominal,qualifier:{value:200,unit:'Hz'}}).compatible).toBe(false);
 expect(assessRangeCompatibility(rows(item)[0],{...nominal,qualifier:{...nominal.qualifier,qualifier:{value:'1 year'}}}).compatible).toBe(false);
});

it('matches a literal free-text qualifier without treating its digits as bounds',()=>{
 const item=editQualifierRange(instrument(),'r','enable',{text:'90 days'}).item;
 expect(assessRangeCompatibility(rows(item)[0],{value:50,unit:'A',qualifier:{value:'90 days'}}).compatible).toBe(true);
 expect(assessRangeCompatibility(rows(item)[0],{value:50,unit:'A',qualifier:{value:'180 days'}}).compatible).toBe(false);
});

it('groups adjacent equal qualifier values and edits the shared value without changing uncertainty',()=>{
 const ranges=['Test','Test','Test','Other','Test',''].map((text,index)=>({id:`r${index}`,min:index,max:index+1,unit:'A',qualifierGroupId:`g${index}`,qualifier:{id:`q${index}`,text},tolerances:{reading:{value:index+1,unit:'%'}}}));
 expect(ranges.map(range=>qualifierRowSpan(ranges,range,1))).toEqual([3,0,0,1,1,1]);
 const item=editQualifierRange({instrument:{ranges}},'r0','patch',{text:'Shared'}).item;
 expect(item.instrument.ranges.map(range=>range.qualifier.text)).toEqual(['Shared','Shared','Shared','Other','Test','']);
 expect(item.instrument.ranges.map(range=>range.tolerances.reading.value)).toEqual([1,2,3,4,5,6]);
});
it('groups nested qualifiers by value while leaving separate blank inputs editable',()=>{
 const ranges=['Test','Test','Test','',''].map((text,index)=>({id:`r${index}`,qualifierGroupId:'g',qualifier:{id:`parent${index}`,text:`Frequency ${index}`,qualifier:{id:`q${index}`,text}}}));
 expect(ranges.map(range=>qualifierRowSpan(ranges,range,2))).toEqual([3,0,0,1,1]);
});
