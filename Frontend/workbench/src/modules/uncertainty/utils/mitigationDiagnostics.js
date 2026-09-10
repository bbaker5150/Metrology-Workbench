const finite = (value) =>
  value !== "" && value != null && Number.isFinite(Number(value));

export const riskStatusFromResult = (result) => ({
  core: result?.out?.statusCore || "",
  gb: result?.out?.statusMit || "",
  interval: result?.out?.statusInt || "",
  maxReop: finite(result?.out?.maxReop)
    ? Number(result.out.maxReop) * 100
    : null,
});

const groups = [
  {
    key: "gb",
    label: "GB + Int",
    fields: {
      gbMult: "GB multiplier",
      gbLow: "lower limit",
      gbHigh: "upper limit",
      gbPfa: "PFA",
      gbPfr: "PFR",
      gbMeasRel: "targeted REOP",
      gbCalInt: "calibration interval",
    },
  },
  {
    key: "interval",
    label: "Int Only",
    fields: {
      noGbPfa: "PFA",
      noGbPfr: "PFR",
      noGbMeasRel: "targeted REOP",
      noGbCalInt: "calibration interval",
    },
  },
];

const intervalReasons = {
  "interval missing":
    "Enter Cal Int for assumed REOP in session mitigation inputs (a positive number of months).",
  "interval input error":
    "Set Cal Int for assumed REOP to a positive number of months in session mitigation inputs.",
  "interval model error":
    "The selected reliability-decay model is not supported. Choose a supported interval model.",
  "beta missing": "The Weibull interval model requires a positive beta value.",
  "beta input error": "Set the Weibull beta value to a positive number.",
  "original R outside (0,1)":
    "The interval model requires the calculated starting reliability to be strictly between 0% and 100%. Review the assumed REOP, uncertainty, and tolerance.",
  "target R outside (0,1)":
    "The interval model requires the calculated target reliability to be strictly between 0% and 100%. Review the mitigation targets and measurement capability.",
  "diffusion sigma error":
    "The diffusion interval model cannot use the calculated population spread. Review the uncertainty, tolerance, and reliability inputs.",
  "interval recompute error":
    "Risk could not be evaluated at the recommended reliability. Review the mitigation targets and measurement capability.",
  "interval result error":
    "The interval model did not produce a valid calibration interval for these reliability values. Review the interval and mitigation inputs.",
};

// Only explain blank columns the user has requested. Zero is a valid result;
// successful solutions (including already-compliant inputs) need no warning.
export function getMitigationDiagnostics({
  metrics,
  status = {},
  requirements = {},
  visibleColumns = {},
  tolerance = {},
  includeCategories = false,
} = {}) {
  const messages = [];
  const add = (message, category = "warning") => messages.push(includeCategories ? { message, category } : message);
  const single = tolerance.singleSided || tolerance.tolerances?.singleSided;
  const unknown =
    String(single?.measurement || "")
      .trim()
      .toLowerCase() === "unknown" ||
    metrics?.riskAvailability === "pfa-boundary-only";
  for (const group of groups) {
    const missing = Object.keys(group.fields).filter(
      (key) => visibleColumns[key] && !finite(metrics?.[key]),
    );
    if (!missing.length) continue;
    const unusedSide =
      single && (single.direction === "low" ? "gbHigh" : "gbLow");
    if (missing.includes(unusedSide)) {
      add(
        `${group.label} — ${group.fields[unusedSide]}: This single-sided tolerance has only ${single.direction === "low" ? "a lower" : "an upper"} limit; the other bound is not used.`, "info",
      );
      missing.splice(missing.indexOf(unusedSide), 1);
      if (!missing.length) continue;
    }
    if (unknown) {
      const boundaryFields = new Set([
        "gbPfa",
        single?.direction === "low" ? "gbLow" : "gbHigh",
      ]);
      const unsupported = missing.filter((key) => !boundaryFields.has(key));
      if (unsupported.length)
        add(
          `${group.label} — ${unsupported.map((key) => group.fields[key]).join(", ")}: A single-sided tolerance with an unknown measurement uses PFA-only acceptance-boundary results. REOP-based guard-band and interval mitigation are not calculated for this case.`, "info",
        );
      const failed = missing.filter((key) => boundaryFields.has(key));
      if (failed.length)
        add(
          `${group.label} — ${failed.map((key) => group.fields[key]).join(", ")}: The PFA acceptance boundary could not be calculated. Check PFA Required, the single-sided limit, and the point's expanded uncertainty.`,
        );
      continue;
    }
    const details = [];
    const raw = status[group.key] || "";
    const issues = raw
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean);
    const pfa = requirements.reqPFA;
    const reop = requirements.reliability;
    if (!finite(pfa) || Number(pfa) < 0 || Number(pfa) >= 100)
      details.push(
        "Set PFA Required from 0% up to (but not including) 100% in session mitigation inputs.",
      );
    if (!finite(reop) || Number(reop) <= 0 || Number(reop) >= 100)
      details.push(
        "Set REOP Required strictly between 0% and 100% in session mitigation inputs.",
      );
    const intervalMissing = missing.includes(
      group.key === "gb" ? "gbCalInt" : "noGbCalInt",
    );
    if (
      intervalMissing &&
      (!finite(requirements.calInt) || Number(requirements.calInt) <= 0)
    )
      details.push(
        intervalReasons[
          finite(requirements.calInt)
            ? "interval input error"
            : "interval missing"
        ],
      );
    for (const issue of issues) {
      if (intervalReasons[issue] && intervalMissing) {
        if (
          !(issue === "interval missing" || issue === "interval input error") ||
          (finite(requirements.calInt) && Number(requirements.calInt) > 0)
        )
          details.push(intervalReasons[issue]);
      } else if (issue === "solution not found")
        details.push(
          group.key === "gb"
            ? `No feasible guard-band and interval solution was found for PFA Required ${pfa}% and REOP Required ${reop}% with the current uncertainty and tolerance. Review measurement capability and the targets.`
            : `No interval-only solution was found for PFA Required ${pfa}% and REOP Required ${reop}% while holding the current guard band fixed. Review measurement capability and the targets, or inspect GB + Int.`,
        );
      else if (
        (issue === "target input error" ||
          issue === "mitigation target missing") &&
        !details.length
      )
        details.push(
          "Enter valid PFA Required and REOP Required targets in session mitigation inputs.",
        );
      else if (issue === "input error" || issue === "check inputs")
        details.push(
          "The mitigation solver could not evaluate these inputs. Review the point's uncertainty, acceptance limits, TUR, and reliability inputs.",
        );
    }
    if (!metrics && !details.length)
      details.push(
        "Mitigation requires a calculated risk result. Resolve this point's calculation warnings first.",
      );
    if (!details.length)
      details.push(
        "The calculation did not produce these mitigation results. Review the point's uncertainty, tolerance, and session mitigation inputs.",
      );
    add(
      `${group.label} — ${missing.map((key) => group.fields[key]).join(", ")}: ${[...new Set(details)].join(" ")}`,
    );
  }
  return messages;
}
