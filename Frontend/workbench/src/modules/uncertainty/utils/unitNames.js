import { SI_PREFIX_OPTIONS } from "./siPrefixes";
// Search names are separate from symbols and conversion factors.
const bases = {
  V: "volt", A: "ampere", Ohm: "ohm", F: "farad", H: "henry", Hz: "hertz",
  s: "second", min: "minute", h: "hour", hr: "hour", K: "kelvin", degC: "degree Celsius", degF: "degree Fahrenheit",
  m: "meter", in: "inch", inch: "inch", ft: "foot", yd: "yard", mi: "mile", g: "gram", lb: "pound", oz: "ounce", t: "tonne",
  rad: "radian", deg: "degree", arcmin: "arcminute", arcsec: "arcsecond", rev: "revolution",
  L: "liter", gal: "gallon", kn: "knot", Pa: "pascal", bar: "bar", torr: "torr", atm: "atmosphere",
  N: "newton", lbf: "pound force", kgf: "kilogram force", ozf: "ounce force",
  J: "joule", Wh: "watt hour", W: "watt", BTU: "British thermal unit", cal: "calorie",
  lx: "lux", fc: "foot candle", cd: "candela", mol: "mole", T: "tesla", G: "gauss",
  '%': "percent", ppm: "parts per million", ppb: "parts per billion", dB: "decibel",
};
const special = {
  dBm: "decibels relative to one milliwatt", rpm: "revolutions per minute", mph: "miles per hour", 'fl-oz': "fluid ounce", G_accel: "standard gravity",
  psi: "pounds per square inch", psig: "pounds per square inch gauge", psia: "pounds per square inch absolute",
  inHg: "inches of mercury", mmHg: "millimeters of mercury", inH2O: "inches of water", inWa: "inches of water",
  ftH2O: "feet of water", cmH2O: "centimeters of water", mmH2O: "millimeters of water",
  cfm: "cubic feet per minute", gpm: "gallons per minute", sccm: "standard cubic centimeters per minute",
  slpm: "standard liters per minute", scfh: "standard cubic feet per hour", scfm: "standard cubic feet per minute",
  '%RH': "percent relative humidity", 'degC dp': "degrees Celsius dew point", 'degF dp': "degrees Fahrenheit dew point",
  ppmv: "parts per million by volume", '%v': "percent by volume", 'in-oz': "inch ounce force",
};
const prefixes = SI_PREFIX_OPTIONS.filter(p => p.key).sort((a, b) => b.key.length - a.key.length);
const tokenName = token => {
  if (bases[token]) return bases[token];
  const prefix = prefixes.find(p => token.startsWith(p.key) && bases[token.slice(p.key.length)]);
  return prefix ? prefix.label.toLowerCase() + bases[token.slice(prefix.key.length)] : token;
};
const fullName = unit => {
  if (special[unit]) return special[unit];
  if (bases[unit]) return bases[unit];
  const scaled = prefixes.find(p => unit.startsWith(p.key) && special[unit.slice(p.key.length)]);
  if (scaled) return scaled.label.toLowerCase() + " " + special[unit.slice(scaled.key.length)];
  if (/^1\//.test(unit)) return "inverse " + fullName(unit.slice(2));
  return unit.replace(/[A-Za-z%_]+(?:\^-?\d+)?/g, token => {
    const [symbol, power] = token.split('^');
    const name = tokenName(symbol);
    return power === '2' ? "square " + name : power === '3' ? "cubic " + name : power ? name + " to power " + power : name;
  }).replaceAll('/', ' per ').replaceAll('-', ' ').replace(/[()]/g, '').replace(/\s+/g, ' ').trim();
};
export const getUnitSearchNames = unit => {
  const name = fullName(String(unit || '').replace(/[µμ]/g, 'u').replace('Ω', 'Ohm'));
  const plural = name.replace(/(meter|liter|gram|volt|ampere|ohm|farad|henry|second|minute|hour|radian|degree|yard|mile|pound|ounce|pascal|newton|joule|watt|mole|tesla|gallon)\b/g, '$1s').replace(/\bfoot\b/g, 'feet').replace(/\binch\b/g, 'inches');
  return [...new Set([name, name + 's', plural, plural.replace(/ per .*/, name.match(/ per .*/)?.[0] || ''), name.replaceAll('meter', 'metre').replaceAll('liter', 'litre'), ...(unit === 'um' ? ['micron', 'microns'] : [])])];
};
