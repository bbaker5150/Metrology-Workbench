import React from "react";

const magnitudePattern = "(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+−-]?\\d+)?";
const numberPattern = `[+−-]?${magnitudePattern}`;
const intervalPattern = new RegExp(`^(${numberPattern})\\s+to\\s+(${numberPattern})(\\s.*)?$`);
const pairedPattern = `[+−-]${magnitudePattern}\\/${numberPattern}`;
const pairedLimits = new RegExp(`^([+−-]${magnitudePattern})\\/(${numberPattern})$`);

const signedLimit = (text, lower = false) => {
  const value = String(text).replaceAll("−", "-");
  if (Number(value) === 0) return lower ? "−0" : "+0";
  return Number(value) < 0 ? value : `+${value.replace(/^\+/, "")}`;
};

const Limits = ({ high, low }) => <span className="stacked-tolerance-limits" role="img"
  aria-label={`Upper limit ${high}; lower limit ${low}`}><span>{high}</span><span>{low}</span></span>;

// Keep authored/calculated strings intact for exports and tooltips. Only the
// visible summary places the upper bound above the lower bound, beside units.
export default function StackedToleranceSummary({ text }) {
  const summary = String(text || "");
  const interval = summary.match(intervalPattern);
  if (interval) return <><Limits high={signedLimit(interval[2])} low={signedLimit(interval[1], true)} />{interval[3] || ""}</>;
  return <>{summary.replace(new RegExp(`\\((${pairedPattern})\\)`, "g"), "$1").split(new RegExp(`(${pairedPattern})`)).map((part, index) => {
    const match = part.match(pairedLimits);
    return match ? <Limits key={index} high={match[1]} low={signedLimit(match[2], true)} /> : part;
  })}</>;
}
