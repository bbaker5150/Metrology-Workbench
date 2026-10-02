// Fluke A40B Instruction Manual, printed p.4, and Y5020 manual Table 1, p.1.
// Current-accuracy acceptance limits; independent of reference RoC uncertainties.
const a40b = {
  .001:[55,75,75,150], .01:[26,26,26,26], .02:[26,26,26,26],
  .05:[23,23,23,23], .1:[24,24,24,24], .2:[26,26,26,26],
  .5:[27,27,27,28], 1:[27,28,28,31], 2:[27,30,30,48],
  5:[31,32,40,71], 10:[37,60,61,92], 20:[43,52,70,113],
  50:[55,80,81,144], 100:[65,90,98,174],
};
export function acShuntUutSpec(model, range, frequency, current, humidity) {
  if (!(current > 0) || !(frequency > 0)) throw Error('A positive AC current and frequency are required for UUT limits.');
  if (/Y5020/i.test(model)) {
    if (current > 20 || frequency > 5000) throw Error('Y5020 manufacturer limits cover up to 20 A and 5 kHz.');
    return {ppm:frequency <= 1000 ? 250 : 350, distribution:'1.732',
      source:'https://assets.fluke.com/manuals/y5020___imeng0000.pdf',
      conditions:'Y5020 Table 1: accuracy of calibrated value, 250 ppm through 1 kHz; 350 ppm above 1 kHz through 5 kHz. Cooling fan operating.'};
  }
  const specs = a40b[Number(range)];
  if (!specs || current > Number(range) || frequency > 100000) throw Error('A40B UUT limits require a supported nominal shunt range and a point within that range, up to 100 kHz.');
  const frequencies = [1000,10000,30000,100000];
  let ppm = specs[0];
  for (let i=1;i<frequencies.length;i++) {
    if (frequency > frequencies[i-1] && frequency <= frequencies[i]) {
      ppm=specs[i-1]+(frequency-frequencies[i-1])*(specs[i]-specs[i-1])/(frequencies[i]-frequencies[i-1]);
    }
  }
  if (humidity != null && Number(humidity)>50) ppm+=20;
  return {ppm,distribution:'2.000',source:'https://assets.fluke.com/manuals/A40B____imeng0000.pdf',
    conditions:'A40B p.4: 1-year absolute current accuracy, k=2; Tcal ±1 °C; ≤50% RH (add 20 ppm above 50% RH). 1 kHz limit below 1 kHz; linear frequency interpolation above 1 kHz per note 2. Calibrated resistance and AC/DC correction applied; no detector loading.'};
}
