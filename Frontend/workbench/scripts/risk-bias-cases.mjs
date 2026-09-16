// Independent Excel inputs for the native bias workflow audit. This file must
// not import an app calculator: expected bias totals/normalized columns below
// are hand-derived, and expected risk OUTPUTS come only from Excel's own VBA.
import fs from 'node:fs';

// Fixture: I=V/R, V=1 V, R=.1 Ohm. bV=.01 V, bR=.002 Ohm.
// bI=(1/R)bV-(V/R^2)bR=.1-.2=-.1 A. Every tolerance below has
// half-span (or nominal-to-limit distance) 2 A, hence K=bUUT/2, L=bI/2.
export const workflows = [
  { id: 'range-percent', nominal: 10, uut: .1, system: -.1, mu: .05, xcal: -.05 },
  { id: 'point-negative', nominal: 10, uut: -.4, system: -.1, mu: -.2, xcal: -.05 },
  { id: 'point-zero', nominal: 10, uut: 0, system: -.1, mu: 0, xcal: -.05 },
  { id: 'source-corrected', nominal: 10, uut: .1, system: .1, mu: .05, xcal: .05 },
  { id: 'manual-net', nominal: 10, uut: .1, system: -.3, mu: .05, xcal: -.15 },
  { id: 'manual-corrected', nominal: 10, uut: .1, system: 0, mu: .05, xcal: 0 },
  // A copied 1% voltage bias tracks V=2 then 3 V. R stays .1 Ohm.
  // bI=.2-.4=-.2 A, then .3-.6=-.3 A; destination UUT override stays .4 A.
  { id: 'copied-point', nominal: 20, uut: .4, system: -.2, mu: .2, xcal: -.1 },
  { id: 'edited-copy', nominal: 30, uut: .4, system: -.3, mu: .2, xcal: -.15 },
];
const common = { initialGB: 1, uCal: .5, tur: 4, reop: .85, turNeeded: 4,
  originalInterval: 12, pfaTarget: .02, reopTarget: .85, decayModel: 'E1', weibullBeta: 2, resolution: .01 };
export const cases = [];
for (const workflow of workflows) {
  const n = workflow.nominal;
  for (const [shape, lowerLimit, upperLimit] of [
    ['symmetric', n - 2, n + 2], ['asymmetric', n - 3, n + 1],
    ['lower', n - 2, ''], ['upper', '', n + 2],
  ]) cases.push({ id: `${workflow.id}/${shape}`,
    input: { ...common, nominal: n, lowerLimit, upperLimit, mu: workflow.mu, xcal: workflow.xcal } });
}
// Unknown-value nonzero system bias is an app extension. Capture BOTH original
// and translated physical inputs so tests cannot silently label this 1:1 parity.
// The workbook ignores its bias columns for these branches; the app translates
// the physical limit by bCal BEFORE inward resolution rounding.
for (const direction of ['low', 'high']) for (const bias of [-.013, .013]) for (const resolution of ['', .01]) {
  for (const frame of ['original', 'translated']) {
    const limit = frame === 'translated' ? 10 + bias : 10;
    cases.push({ id: `unknown/${direction}/${bias}/res${resolution || 'none'}/${frame}`,
      input: { ...common, nominal: '', lowerLimit: direction === 'low' ? limit : '', upperLimit: direction === 'high' ? limit : '',
        uCal: .1, tur: '', reop: '', reopTarget: '', turNeeded: '', originalInterval: '',
        decayModel: '', weibullBeta: '', mu: '', xcal: bias, resolution } });
  }
}
if (process.argv[1]?.replaceAll('\\', '/').endsWith('/risk-bias-cases.mjs') && process.argv[2]) {
  fs.writeFileSync(process.argv[2], JSON.stringify(cases, null, 2));
  console.log(`Prepared ${cases.length} independent bias workflow cases.`);
}
