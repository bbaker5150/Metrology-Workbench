export const generic5790 = {
  id: 'fluke-5790b-generic', manufacturer: 'Fluke', model: '5790B', description: '',
  type: 'tmde', scope: 'validated', measurementArea: 'Voltage',
  generic5790: { version: 1, serialIndependent: true },
  functions: ['medium-slow', 'fast'].map(mode => ({
    id: `fluke-5790b-generic-${mode}`, name: `Voltage (${mode})`, unit: 'V',
    ranges: [.22, 2.2].map(value => ({
      id: `fluke-5790b-generic-${mode}-${value}`, min: 0, max: value, unit: 'V',
      resolution: mode === 'fast' && value === 2.2 ? 1e-6 : 1e-7, resolutionUnit: 'V',
      resolutionDistribution: '3.464', includeResolutionInBudget: true, tolerances: {},
    })),
  })),
};
export const nominalY5020Resolution = current => ({
  method: 'independent-phase-rounding-max-cycle', nominalVoltageFallback: true,
  cases: [{ functionId: 'fluke-5790b-generic-medium-slow', rangeId: 'fluke-5790b-generic-medium-slow-2.2',
    ppmPerVolt: Math.SQRT2 * 1e6 / (current * .01) }],
});

// v2 keeps one voltage function and uses qualifiers for mode/condition/interval.
export const qualified5790 = {...generic5790, generic5790:{version:2,serialIndependent:true},
  qualifierColumnNames:['Resolution Mode','Measurement Mode','Frequency','Calibration Interval'],
  functions:[{id:'fluke-5790b-generic-voltage',name:'Voltage',unit:'V',
    ranges:[.22,2.2].flatMap(value => generic5790.functions.flatMap(fn => {
      const original=fn.ranges.find(row=>row.max===value);
      return ['90 Days','1 Year','2 Years'].map((interval,i)=>({...original,
        id:i===1?original.id:`${original.id}-interval-${i}`,
        qualifierGroupId:`voltage-${value}`,
        qualifier:{name:'Resolution Mode',text:fn.id.endsWith('-fast')?'Fast/Off, HIRES Off':'Medium/Slow or HIRES On',
          qualifier:{name:'Measurement Mode',text:'AC',
            qualifier:{name:'Frequency',min:40,max:20000,unit:'Hz',
              qualifier:{name:'Calibration Interval',text:interval}}}},
        tolerances:{reading:{high:(value===.22?[37,38,43]:[22,24,29])[i],low:-(value===.22?[37,38,43]:[22,24,29])[i],unit:'ppm',symmetric:true,distribution:'2.580'},
          ...(value===.22?{floor:{high:1.5e-6,low:-1.5e-6,unit:'V',symmetric:true,distribution:'2.580'}}:{})},
      }));
    }))}],
};
