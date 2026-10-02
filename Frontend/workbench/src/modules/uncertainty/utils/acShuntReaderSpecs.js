// Verified against supplied 34420A Service Guide p.12 (PDF 14) and
// 5790B Service Manual pp.1-6 through 1-8 and 1-12 (PDF 12-14, 18).
export const READER_SOURCES = {
  keysight: 'https://www.keysight.com/us/en/assets/7018-06838/data-sheets/5968-0161.pdf',
  fluke: 'https://s3.amazonaws.com/download.flukecal.com/pub/literature/6005014a-5790b-ext-specs-w.pdf',
};
const bands = [10, 20, 40, 20000, 50000, 100000, 300000, 500000, 1000000];
// Measurement mode, 1 year: ppm of reading. No AC/DC transfer-mode substitution.
const acPpm = {
  0.0022: [1700,740,420,810,1200,2300,2400,3500],
  0.007: [850,370,210,400,600,1200,1300,2300],
  0.022: [290,190,110,210,310,810,890,1700],
  0.07: [240,120,65,130,260,510,670,1100],
  0.22: [210,85,38,69,160,250,380,1000],
  0.7: [210,76,33,51,79,180,300,960],
  2.2: [200,66,24,46,71,160,260,900],
  7: [200,67,24,48,81,190,400,1200],
  22: [200,67,27,48,81,190,400,1200],
};
const dcPpm = {0.22:38, 0.7:33, 2.2:24, 7:24, 22:27};
const ranges = Object.keys(acPpm).map(Number).sort((a,b) => a-b);
const valid = x => x !== null && x !== '' && Number.isFinite(Number(x));

export function readerSpec(model, voltage, frequency, rangeMode, isDc = false) {
  if (!valid(voltage) || Math.abs(Number(voltage)) === 0) throw new Error('Saved reader voltage is missing or zero.');
  const v = Math.abs(Number(voltage));
  if (/34420A?$/i.test(model || '')) {
    if (v > 1.2) throw new Error('34420A reading exceeds the 1 V range.');
    return {range:1, readingPpm:35, floorVolts:4e-6, limitVolts:35e-6*v+4e-6,
      divisor:Math.sqrt(3), source:READER_SOURCES.keysight, functionName:'DC Voltage',
      conditions:'1 year; 23 ±5 °C; 2-hour warm-up; 100 NPLC; filters off. Rectangular error limit.'};
  }
  if (!/5790B$/i.test(model || '')) throw new Error(`No verified reader specifications for ${model || 'unspecified model'}.`);
  const auto = /^auto$/i.test(String(rangeMode));
  const selected = auto ? ranges.find(r => v <= r) : Number(rangeMode);
  if (!selected || !acPpm[selected]) throw new Error('Saved 5790B range is missing or unsupported.');
  // The 5790B has no DC ranges below 220 mV.
  const range = isDc ? Math.max(.22, selected) : selected;
  if (v > range * (auto ? 1 : 1.01)) throw new Error(`Saved voltage exceeds the ${range} V range.`);
  let readingPpm, floorVolts;
  if (isDc) {
    readingPpm = dcPpm[range]; floorVolts = range < 2.2 ? 1.5e-6 : 0;
  } else {
    if (!valid(frequency) || frequency < 10 || frequency > 1e6) throw new Error('Frequency is outside verified 5790B specifications (10 Hz–1 MHz).');
    // At a shared endpoint take the larger adjacent specification.
    const indexes = bands.slice(0,-1).flatMap((low,i) => frequency >= low && frequency <= bands[i+1] ? [i] : []);
    const floors = range < .07 ? [1.3,1.3,1.3,2,2.5,4,8,8] : [1.5,1.5,1.5,2,2.5,4,8,8];
    const i = indexes.reduce((best,i) => acPpm[range][i]*v+(range<2.2?floors[i]:0) > acPpm[range][best]*v+(range<2.2?floors[best]:0) ? i : best);
    readingPpm = acPpm[range][i]; floorVolts = range < 2.2 ? floors[i]*1e-6 : 0;
  }
  return {range, readingPpm, floorVolts, limitVolts:readingPpm*1e-6*v+floorVolts,
    divisor:2.58, source:READER_SOURCES.fluke, functionName:isDc?'DC Voltage':'AC Voltage',
    conditions:'1 year; within ±5 °C of calibration; warm-up ≥30 minutes or twice off-time; DC zero every 30 days; normal k=2.58.'};
}

// Conservative bound on the existing (Vac/Vdc - 1)/eta measurement equation.
// Sum absolute sensitivities: no assumed cancellation or averaging-down of
// systematic reader errors across phases, cycles, directions, or shared readers.
export function readerContribution(model, side, point, frequency) {
  const phaseNames = ['ac_open','ac_close','dc_pos','dc_neg'];
  const values = phaseNames.map(p => point.phases[`${side}_${p}`]);
  if (values.some(v => !valid(v))) throw new Error('Saved reader phase averages are incomplete.');
  const [ao,ac,dp,dn] = values.map(v => Math.abs(Number(v)));
  const dc = (dp+dn)/2, av = (ao+ac)/2;
  const eta = Number(point[`eta_${side}`]);
  if (!dc || !Number.isFinite(eta) || eta <= 0) throw new Error('Saved DC voltage or sensitivity coefficient is missing.');
  const specs = values.map((v,i) => {
    const spec=readerSpec(model,v,frequency,point.rangeMode,i>=2);
    // Conservatively include the manual's +0.002% reading allowance for AC
    // phases whenever the saved configuration requested the analog filter.
    if (/34420/i.test(model || '') && point.analogFilterRequested && frequency <= 40 && i<2) {
      return {...spec,readingPpm:spec.readingPpm+20,limitVolts:spec.limitVolts+Math.abs(v)*20e-6,
        conditions:spec.conditions+' Includes +20 ppm reading for requested analog filtering.'};
    }
    return spec;
  });
  const sensitivities = [1/(2*eta*dc),1/(2*eta*dc),av/(2*eta*dc*dc),av/(2*eta*dc*dc)];
  const standardPpm = specs.reduce((sum,s,i) => sum + sensitivities[i]*s.limitVolts/s.divisor*1e6,0);
  return {standardPpm, specs, eta, voltages:values, direction:point.direction};
}
