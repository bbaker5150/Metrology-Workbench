import { rgb } from "pdf-lib";
import {
  resolveSessionFunctions,
  functionLabelOf,
  rangesForFunction,
} from "./functionGrouping";
import { getUnitDisplayLabel, unitSystem } from "./uncertaintyMath";

const PAGE = {
  width: 841.89,
  height: 595.28,
  margin: 30,
};
const BASE_PAGE_WIDTH = 841.89; // A4 landscape
const MAX_PAGE_WIDTH = 1683.78; // A2 landscape for dense, fully-filtered reports

const COLORS = {
  ink: rgb(0.08, 0.12, 0.2),
  muted: rgb(0.38, 0.43, 0.5),
  line: rgb(0.82, 0.85, 0.89),
  header: rgb(0.11, 0.22, 0.38),
  headerFill: rgb(0.93, 0.95, 0.98),
  areaFill: rgb(0.88, 0.93, 0.98),
  uutFill: rgb(0.95, 0.97, 0.99),
  white: rgb(1, 1, 1),
};

const column = (key, label, width, align = "right") => ({ key, label, width, align });

export const PDF_COLUMN_GROUPS = [
  {
    key: "measurement",
    label: "Measurement",
    columns: [
      column("section", "Section", 60, "left"), column("value", "Value", 70),
      column("qualifier", "Qualifier", 65, "left"), column("tolerance", "Tolerance", 110, "left"),
      column("lowLimit", "UUT Low", 65), column("highLimit", "UUT High", 65),
      column("standardUncertainty", "Combined u", 75), column("measurementUncertainty", "Expanded U", 75),
      column("tmdeLow", "TMDE Low", 65), column("tmdeHigh", "TMDE High", 65),
      column("tur", "TUR", 48), column("tar", "TAR", 48),
    ],
  },
  {
    key: "risk",
    label: "Risk",
    columns: [
      column("observedReop", "REOP @ TUR %", 90), column("pfa", "PFA %", 70),
      column("pfr", "PFR %", 70), column("maxReop", "Max REOP %", 90),
      column("trueReop", "R_meas %", 85),
    ],
  },
  {
    key: "mitigation-gb",
    label: "Mitigation (GB + Interval)",
    columns: [
      column("gbMult", "GB Mult %", 75), column("gbLow", "GB Low", 80),
      column("gbHigh", "GB High", 80), column("gbPfa", "PFA + GB %", 80),
      column("gbPfr", "PFR + GB %", 80), column("gbCalInt", "Cal Int + GB", 85),
      column("gbMeasRel", "Target REOP + GB %", 105),
    ],
  },
  {
    key: "mitigation-int",
    label: "Mitigation (Interval Only)",
    columns: [
      column("noGbPfa", "PFA w/o GB %", 90), column("noGbPfr", "PFR w/o GB %", 90),
      column("noGbCalInt", "Cal Int w/o GB", 100), column("noGbMeasRel", "Target REOP w/o GB %", 115),
    ],
  },
];

export const resolvePdfColumnGroups = (visibleColumns) => {
  const effective = {
    ...(visibleColumns || Object.fromEntries(
    PDF_COLUMN_GROUPS.flatMap((group) => group.columns.map((item) => [item.key, true])),
    )),
    // Every result row needs its measurement identity even if the screen's
    // Value checkbox is off. All other report columns follow the live filter.
    value: true,
  };
  return PDF_COLUMN_GROUPS.map((group) => ({
    ...group,
    columns: group.columns.filter((item) => effective[item.key]),
  })).filter((group) => group.columns.length > 0);
};

export const resolvePdfTableLayout = (visibleColumns) => {
  const groups = resolvePdfColumnGroups(visibleColumns);
  const naturalColumns = groups.flatMap((group) =>
    group.columns.map((item) => ({
      ...item,
      groupKey: group.key,
      groupLabel: group.label,
    })),
  );
  const naturalWidth = naturalColumns.reduce((sum, item) => sum + item.width, 0);
  const pageWidth = Math.min(
    MAX_PAGE_WIDTH,
    Math.max(BASE_PAGE_WIDTH, naturalWidth + PAGE.margin * 2),
  );
  const availableWidth = pageWidth - PAGE.margin * 2;
  const scale = naturalWidth > availableWidth ? availableWidth / naturalWidth : 1;
  return {
    pageWidth,
    columns: naturalColumns.map((item) => ({ ...item, width: item.width * scale })),
  };
};

const replaceUnicode = (value) =>
  String(value ?? "")
    .replace(/\u00b1/g, "+/-")
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u00b7/g, "*")
    .replace(/\u03c1/g, "rho")
    .replace(/[^\x20-\x7e]/g, "");

const finite = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const formatNumber = (value, digits = 4) => {
  const number = finite(value);
  if (number === null) return "-";
  if (number === 0) return "0";
  const abs = Math.abs(number);
  return abs >= 10000 || abs < 0.001
    ? number.toExponential(Math.max(1, digits - 1))
    : Number(number.toPrecision(digits)).toString();
};

const formatPercent = (value) => {
  const number = finite(value);
  return number === null ? "-" : number.toFixed(2);
};

const formatRatio = (value) => {
  const number = finite(value);
  return number === null ? "-" : number.toFixed(2);
};

// Human-facing UUT/TMDE label matching the sidebar's formatInstrumentIdentity,
// so a UUT reads identically in the report and on screen.
const formatInstrumentIdentity = (item = {}) => {
  const inst = item.instrument || item;
  const make = String(inst.manufacturer || item.manufacturer || "").trim();
  const model = String(inst.model || item.model || "").trim();
  const name = String(
    item.description || item.name || inst.description || inst.name || "",
  ).trim();
  const prefix = [make, model].filter(Boolean).join(" ");
  if (!prefix) return name || "Unnamed UUT";
  if (!name) return prefix;
  return name.toLowerCase().startsWith(prefix.toLowerCase())
    ? name
    : `${prefix} ${name}`;
};

const rangeLabel = (range) => {
  const unit = range.unit ? ` ${range.unit}` : "";
  if (range.min !== undefined && range.max !== undefined) {
    return `${formatNumber(range.min, 7)} to ${formatNumber(range.max, 7)}${unit}`;
  }
  return `${range.range || "Range"}${unit}`;
};

// The ranges a UUT exposes for a single function, decorated with a stable id and
// display label. Scoped to the function so a range only appears under the
// subsection whose points it can hold — the same source of truth
// (rangesForFunction) the instrument tables render from.
const getFunctionRanges = (uut, functionKey, functionUnit) =>
  rangesForFunction(uut, functionKey).map((range, index) => {
    const decorated = { ...range, unit: range.unit || functionUnit };
    return {
      ...decorated,
      _reportId: range.id ?? range._id ?? index,
      label: rangeLabel(decorated),
    };
  });

const pointMatchesRange = (point, range) => {
  const tolerance = point.uutTolerance;
  if (tolerance && Object.keys(tolerance).length) {
    return (
      tolerance.min == range.min &&
      tolerance.max == range.max &&
      (tolerance.unit || "") === (range.unit || "") &&
      (!range.functionName || tolerance.functionName === range.functionName)
    );
  }

  const parameter = point.testPointInfo?.parameter;
  const value = Number(parameter?.value);
  const min = Number(range.min);
  const max = Number(range.max);
  const unitMatches =
    !parameter?.unit ||
    !range.unit ||
    parameter.unit.toLowerCase() === range.unit.toLowerCase();
  return (
    Number.isFinite(value) &&
    Number.isFinite(min) &&
    Number.isFinite(max) &&
    unitMatches &&
    value >= min &&
    value <= max
  );
};

const getPointRow = (point, risk, helpers) => {
  const parameter = point.testPointInfo?.parameter || {};
  const tolerance = point.uutTolerance || {};
  const toleranceSummary = helpers.getToleranceErrorSummary(
    tolerance,
    parameter,
  );
  const limits = helpers.getAbsoluteLimits(tolerance, parameter);
  const stripUnit = (value) =>
    replaceUnicode(value)
      .replace(new RegExp(`\\s*${replaceUnicode(parameter.unit)}\\s*$`), "")
      .trim();
  const tmdeLimits = helpers.getTmdeAbsoluteLimits?.(
    point.tmdeTolerances,
    parameter,
  );
  const nativeUnit = parameter.unit || "";
  const absoluteUncertainty = (baseValue, fallback) => {
    const base = finite(baseValue);
    if (base !== null && nativeUnit) {
      try {
        return `${formatNumber(unitSystem.fromBaseUnit(base, nativeUnit), 7)} ${nativeUnit}`;
      } catch {
        return `${formatNumber(base, 7)} ${nativeUnit}`;
      }
    }
    const value = finite(fallback);
    return value === null ? "-" : `${formatNumber(value, 7)} ppm`;
  };

  return {
    id: point.id,
    section: point.section || "-",
    value: `${formatNumber(parameter.value, 7)}${parameter.unit ? ` ${parameter.unit}` : ""}`,
    unit: parameter.unit || "-",
    qualifier: point.testPointInfo?.qualifier?.value == null
      ? "-"
      : `${point.testPointInfo.qualifier.value} ${point.testPointInfo.qualifier.unit || ""}`.trim(),
    tolerance:
      toleranceSummary === "Not Set" || toleranceSummary === "Not Calculated"
        ? "-"
        : toleranceSummary,
    lowLimit: limits?.low === "N/A" ? "-" : stripUnit(limits.low),
    highLimit: limits?.high === "N/A" ? "-" : stripUnit(limits.high),
    standardUncertainty: absoluteUncertainty(
      point.combined_uncertainty_absolute_base,
      point.combined_uncertainty,
    ),
    measurementUncertainty: absoluteUncertainty(
      point.expanded_uncertainty_absolute_base,
      point.expanded_uncertainty,
    ),
    tmdeLow: tmdeLimits?.low === "N/A" ? "-" : stripUnit(tmdeLimits?.low || "-"),
    tmdeHigh: tmdeLimits?.high === "N/A" ? "-" : stripUnit(tmdeLimits?.high || "-"),
    pfa: formatPercent(risk?.pfa),
    pfr: formatPercent(risk?.pfr),
    tur: formatRatio(risk?.tur),
    tar: formatRatio(risk?.tar),
    gbPfa: formatPercent(risk?.gbPfa),
    gbPfr: formatPercent(risk?.gbPfr),
    gbMult: formatPercent(risk?.gbMult),
    gbLow: formatNumber(risk?.gbLow),
    gbHigh: formatNumber(risk?.gbHigh),
    observedReop: formatPercent(risk?.observedReop),
    maxReop: formatPercent(risk?.maxReop),
    trueReop: formatPercent(risk?.trueReop),
    gbCalInt: formatNumber(risk?.gbCalInt, 7),
    gbMeasRel: formatPercent(risk?.gbMeasRel),
    noGbPfa: formatPercent(risk?.noGbPfa),
    noGbPfr: formatPercent(risk?.noGbPfr),
    noGbCalInt: formatNumber(risk?.noGbCalInt, 7),
    noGbMeasRel: formatPercent(risk?.noGbMeasRel),
  };
};

// Split a UUT's points (already scoped to one function) into its function
// ranges, then a trailing bucket for anything that doesn't fall in a declared
// range. Mirrors the sidebar's UUT node: points live under their owning UUT,
// grouped by the ranges that UUT exposes for the function.
const buildUutModel = (uut, uutPoints, functionKey, functionUnit, riskMetricsMap, helpers) => {
  const categorized = new Set();
  const ranges = getFunctionRanges(uut, functionKey, functionUnit)
    .map((range) => {
      const rangePoints = uutPoints.filter((point) => {
        if (categorized.has(point.id) || !pointMatchesRange(point, range)) {
          return false;
        }
        categorized.add(point.id);
        return true;
      });
      return {
        id: range._reportId,
        label: range.label,
        rows: rangePoints.map((point) =>
          getPointRow(point, riskMetricsMap[point.id], helpers),
        ),
      };
    })
    .filter((range) => range.rows.length);

  const uncategorized = uutPoints.filter((point) => !categorized.has(point.id));
  if (uncategorized.length) {
    ranges.push({
      id: "uncategorized",
      label: ranges.length ? "Other Points" : "All Points",
      rows: uncategorized.map((point) =>
        getPointRow(point, riskMetricsMap[point.id], helpers),
      ),
    });
  }

  return {
    id: uut.id,
    name: formatInstrumentIdentity(uut),
    ranges,
  };
};

// Organize the report the same way the app now organizes the workspace:
// Function (name + unit) -> owning UUT -> range -> points. Functions are the
// primary axis (matching the sidebar and instrument tables via
// resolveSessionFunctions); measurement areas are no longer a grouping level.
export const buildSessionReportModel = (
  session,
  riskMetricsMap = {},
  helpers,
) => {
  const uuts = session.uuts || [];
  const points = session.testPoints || [];
  const uutById = new Map(uuts.map((uut) => [String(uut.id), uut]));

  // Ordered function identities from the shared source of truth, so report
  // sections appear in the same order as the on-screen function groups.
  const functionOrder = resolveSessionFunctions(session);
  const functionMeta = new Map(functionOrder.map((fn) => [fn.key, fn]));

  // functionKey -> Map(uutId -> { uut, points })
  const grouped = new Map();
  const ensureFn = (key) => {
    if (!grouped.has(key)) grouped.set(key, new Map());
    return grouped.get(key);
  };
  const ensureUut = (fnMap, uut) => {
    const id = String(uut.id);
    if (!fnMap.has(id)) fnMap.set(id, { uut, points: [] });
    return fnMap.get(id);
  };

  // Place each point under its own function -> owning UUT (matches sidebarData).
  const unassignedPoints = [];
  points.forEach((point) => {
    const ownerId = (point.associatedUutIds || [])
      .map((id) => String(id))
      .find((id) => uutById.has(id));
    if (!ownerId) {
      unassignedPoints.push(point);
      return;
    }
    const { key } = functionLabelOf(point);
    ensureUut(ensureFn(key), uutById.get(ownerId)).points.push(point);
  });

  // Emit functions in the resolved order, then any grouped keys not in that set
  // (defensive) so no point is ever silently dropped from the report.
  const orderedKeys = [
    ...functionOrder.map((fn) => fn.key).filter((key) => grouped.has(key)),
    ...Array.from(grouped.keys()).filter((key) => !functionMeta.has(key)),
  ];

  const functionModels = orderedKeys
    .map((key) => {
      const meta = functionMeta.get(key);
      const unit = meta?.unit || "";
      const uutModels = Array.from(grouped.get(key).values())
        .map(({ uut, points: uutPoints }) =>
          buildUutModel(uut, uutPoints, key, unit, riskMetricsMap, helpers),
        )
        .filter((uut) => uut.ranges.length);
      return {
        id: key,
        name: meta?.name || "Measurement",
        unit,
        uuts: uutModels,
      };
    })
    .filter((fn) => fn.uuts.length);

  if (unassignedPoints.length) {
    functionModels.push({
      id: "unassigned-function",
      name: "Unassigned Points",
      unit: "",
      uuts: [
        {
          id: "unassigned-uut",
          name: "No UUT",
          ranges: [
            {
              id: "unassigned-range",
              label: "No UUT / Range",
              rows: unassignedPoints.map((point) =>
                getPointRow(point, riskMetricsMap[point.id], helpers),
              ),
            },
          ],
        },
      ],
    });
  }

  return {
    title: session.name || session.uutDescription || "Uncertainty Session",
    pointCount: points.length,
    functions: functionModels,
  };
};

class ReportRenderer {
  constructor(pdfDoc, fonts, session) {
    this.pdfDoc = pdfDoc;
    this.font = fonts.regular;
    this.bold = fonts.bold;
    this.session = session;
    this.page = null;
    this.y = 0;
    this.addPage();
  }

  addPage() {
    this.page = this.pdfDoc.addPage([PAGE.width, PAGE.height]);
    this.y = PAGE.height - PAGE.margin;
    this.page.drawText(replaceUnicode(this.session.name || "Session Report"), {
      x: PAGE.margin,
      y: PAGE.height - 19,
      size: 7,
      font: this.bold,
      color: COLORS.muted,
    });
  }

  ensure(height, onNewPage) {
    if (this.y - height >= PAGE.margin + 12) return;
    this.addPage();
    onNewPage?.();
  }

  text(value, x, y, size = 8, font = this.font, color = COLORS.ink) {
    this.page.drawText(replaceUnicode(value), { x, y, size, font, color });
  }

  fit(value, maxWidth, size = 8, font = this.font) {
    const text = replaceUnicode(value);
    if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
    let shortened = text;
    while (
      shortened.length > 1 &&
      font.widthOfTextAtSize(`${shortened}...`, size) > maxWidth
    ) {
      shortened = shortened.slice(0, -1);
    }
    return `${shortened}...`;
  }

  banner(text, fill, size = 9) {
    this.ensure(22);
    this.page.drawRectangle({
      x: PAGE.margin,
      y: this.y - 17,
      width: PAGE.width - PAGE.margin * 2,
      height: 17,
      color: fill,
    });
    this.text(
      this.fit(text, PAGE.width - PAGE.margin * 2 - 14, size, this.bold),
      PAGE.margin + 7,
      this.y - 12,
      size,
      this.bold,
    );
    this.y -= 22;
  }

  alignedText(
    value,
    x,
    width,
    y,
    align = "left",
    size = 8,
    font = this.font,
    color = COLORS.ink,
  ) {
    const text = this.fit(value, width - 6, size, font);
    const textWidth = font.widthOfTextAtSize(text, size);
    const textX =
      align === "right"
        ? x + width - textWidth - 3
        : align === "center"
          ? x + (width - textWidth) / 2
          : x + 3;
    this.text(text, textX, y, size, font, color);
  }

  metadataGrid(items) {
    const columns = 3;
    const gap = 8;
    const cellWidth =
      (PAGE.width - PAGE.margin * 2 - gap * (columns - 1)) / columns;
    const cellHeight = 29;
    const rows = Math.ceil(items.length / columns);
    this.ensure(rows * cellHeight + (rows - 1) * gap);

    items.forEach(([label, value], index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      const x = PAGE.margin + column * (cellWidth + gap);
      const y = this.y - row * (cellHeight + gap);
      this.page.drawRectangle({
        x,
        y: y - cellHeight,
        width: cellWidth,
        height: cellHeight,
        color: rgb(0.975, 0.982, 0.992),
        borderColor: COLORS.line,
        borderWidth: 0.45,
      });
      this.text(label.toUpperCase(), x + 7, y - 10, 5.8, this.bold, COLORS.muted);
      this.text(
        this.fit(value, cellWidth - 14, 8.5, this.bold),
        x + 7,
        y - 23,
        8.5,
        this.bold,
      );
    });

    this.y -= rows * cellHeight + (rows - 1) * gap + 13;
  }

  requirementGrid(items) {
    const gap = 6;
    const cellWidth =
      (PAGE.width - PAGE.margin * 2 - gap * (items.length - 1)) / items.length;
    const cellHeight = 25;
    this.ensure(cellHeight);

    items.forEach(([label, value], index) => {
      const x = PAGE.margin + index * (cellWidth + gap);
      this.page.drawRectangle({
        x,
        y: this.y - cellHeight,
        width: cellWidth,
        height: cellHeight,
        color: COLORS.headerFill,
        borderColor: COLORS.line,
        borderWidth: 0.4,
      });
      this.text(label.toUpperCase(), x + 6, this.y - 9, 5.5, this.bold, COLORS.muted);
      this.text(
        this.fit(value, cellWidth - 12, 8, this.bold),
        x + 6,
        this.y - 20,
        8,
        this.bold,
      );
    });
    this.y -= cellHeight + 9;
  }

  tableHeader(columns) {
    const groupHeight = 12;
    const columnHeight = 18;
    const height = groupHeight + columnHeight;
    let x = PAGE.margin;
    const tableWidth = columns.reduce((sum, item) => sum + item.width, 0);
    this.page.drawRectangle({
      x,
      y: this.y - height,
      width: tableWidth,
      height: columnHeight,
      color: COLORS.header,
    });
    let groupStart = x;
    let groupKey = columns[0]?.groupKey;
    columns.forEach((item, index) => {
      const next = columns[index + 1];
      if (!next || next.groupKey !== groupKey) {
        const groupWidth = x + item.width - groupStart;
        this.page.drawRectangle({
          x: groupStart,
          y: this.y - groupHeight,
          width: groupWidth,
          height: groupHeight,
          color: COLORS.headerFill,
          borderColor: COLORS.line,
          borderWidth: 0.35,
        });
        this.alignedText(
          item.groupLabel || "Measurement",
          groupStart,
          groupWidth,
          this.y - 8.5,
          "center",
          5.8,
          this.bold,
          COLORS.header,
        );
        groupStart = x + item.width;
        groupKey = next?.groupKey;
      }
      x += item.width;
    });
    x = PAGE.margin;
    columns.forEach((column) => {
      this.alignedText(
        column.label,
        x,
        column.width,
        this.y - groupHeight - 12,
        column.align,
        6.2,
        this.bold,
        COLORS.white,
      );
      x += column.width;
      this.page.drawLine({
        start: { x, y: this.y - height },
        end: { x, y: this.y - groupHeight },
        thickness: 0.25,
        color: rgb(0.35, 0.45, 0.58),
      });
    });
    this.y -= height;
  }

  wrap(value, width, size = 6.5) {
    const words = replaceUnicode(value).split(/\s+/).filter(Boolean);
    if (!words.length) return [""];
    const lines = [];
    let current = "";
    words.forEach((word) => {
      const candidate = current ? `${current} ${word}` : word;
      if (this.font.widthOfTextAtSize(candidate, size) <= width - 6) {
        current = candidate;
      } else {
        if (current) lines.push(current);
        current = word;
      }
    });
    if (current) lines.push(current);
    return lines.slice(0, 3);
  }

  row(row, index, repeatContext, columns) {
    const linesByColumn = Object.fromEntries(
      columns.map((column) => [
        column.key,
        this.wrap(row[column.key], column.width),
      ]),
    );
    const lineCount = Math.max(
      1,
      ...Object.values(linesByColumn).map((lines) => lines.length),
    );
    const height = Math.max(15, lineCount * 8 + 5);
    this.ensure(height, repeatContext);

    let x = PAGE.margin;
    const tableWidth = columns.reduce((sum, item) => sum + item.width, 0);
    this.page.drawRectangle({
      x,
      y: this.y - height,
      width: tableWidth,
      height,
      color: index % 2 ? COLORS.white : rgb(0.985, 0.99, 1),
      borderColor: COLORS.line,
      borderWidth: 0.35,
    });

    columns.forEach((column) => {
      const lines = linesByColumn[column.key];
      lines.forEach((line, lineIndex) => {
        this.alignedText(
          line,
          x,
          column.width,
          this.y - 10 - lineIndex * 8,
          column.align,
          6.5,
        );
      });
      x += column.width;
      this.page.drawLine({
        start: { x, y: this.y - height },
        end: { x, y: this.y },
        thickness: 0.25,
        color: COLORS.line,
      });
    });
    this.y -= height;
  }

  finish() {
    const pages = this.pdfDoc.getPages();
    pages.forEach((page, index) => {
      page.drawLine({
        start: { x: PAGE.margin, y: 22 },
        end: { x: PAGE.width - PAGE.margin, y: 22 },
        thickness: 0.5,
        color: COLORS.line,
      });
      page.drawText(
        replaceUnicode(
          `Uncertalytics session report | Page ${index + 1} of ${pages.length}`,
        ),
        {
          x: PAGE.margin,
          y: 11,
          size: 6.5,
          font: this.font,
          color: COLORS.muted,
        },
      );
    });
  }
}

export const generateOverviewReport = async (
  pdfDoc,
  session,
  fonts,
  helpers,
  riskMetricsMap = {},
  visibleColumns,
) => {
  const report = buildSessionReportModel(
    session,
    riskMetricsMap,
    helpers,
  );
  const tableLayout = resolvePdfTableLayout(visibleColumns);
  PAGE.width = tableLayout.pageWidth;
  const renderer = new ReportRenderer(pdfDoc, fonts, session);
  const reportColumns = tableLayout.columns;
  const metadata = [
    ["Analyst", session.analyst || "-"],
    ["Organization", session.organization || "-"],
    ["Document", session.document || "-"],
    ["Document Date", session.documentDate || "-"],
    ["Functions", report.functions.length],
    ["Measurement Points", report.pointCount],
  ];

  renderer.text(
    renderer.fit(
      report.title,
      PAGE.width - PAGE.margin * 2,
      18,
      renderer.bold,
    ),
    PAGE.margin,
    renderer.y - 18,
    18,
    renderer.bold,
  );
  renderer.y -= 29;
  renderer.page.drawLine({
    start: { x: PAGE.margin, y: renderer.y },
    end: { x: PAGE.width - PAGE.margin, y: renderer.y },
    thickness: 1.5,
    color: COLORS.header,
  });
  renderer.y -= 17;

  renderer.metadataGrid(metadata);

  const requirements = session.uncReq || {};
  renderer.text(
    "RISK AND GUARDBAND REQUIREMENTS",
    PAGE.margin,
    renderer.y - 3,
    6.5,
    renderer.bold,
    COLORS.muted,
  );
  renderer.y -= 11;
  renderer.requirementGrid([
    ["Reliability", `${requirements.reliability ?? "-"}%`],
    ["Required PFA", `${requirements.reqPFA ?? "-"}%`],
    ["Required TUR", requirements.neededTUR ?? "-"],
    ["Confidence", `${requirements.uncertaintyConfidence ?? "-"}%`],
    ["Calibration Interval", requirements.calInt ?? "-"],
  ]);

  if (!report.functions.length) {
    renderer.banner("No measurement points", COLORS.areaFill);
    renderer.finish();
    return;
  }

  const functionHeading = (fn) => {
    const unit = fn.unit ? ` (${getUnitDisplayLabel(fn.unit)})` : "";
    return `Function: ${fn.name}${unit}`;
  };

  report.functions.forEach((fn) => {
    renderer.banner(functionHeading(fn), COLORS.areaFill, 10);
    fn.uuts.forEach((uut) => {
      renderer.banner(`UUT: ${uut.name}`, COLORS.uutFill, 8.5);
      uut.ranges.forEach((range) => {
        renderer.ensure(48);
        renderer.text(`Range: ${range.label}`, PAGE.margin + 5, renderer.y - 8, 8, renderer.bold);
        renderer.y -= 16;
        renderer.tableHeader(reportColumns);
        const repeatContext = () => {
          renderer.text(functionHeading(fn), PAGE.margin, renderer.y - 8, 8, renderer.bold);
          renderer.y -= 13;
          renderer.text(`UUT: ${uut.name} | Range: ${range.label}`, PAGE.margin, renderer.y - 8, 7.5, renderer.bold);
          renderer.y -= 14;
          renderer.tableHeader(reportColumns);
        };
        range.rows.forEach((row, index) =>
          renderer.row(row, index, repeatContext, reportColumns),
        );
        renderer.y -= 9;
      });
    });
  });

  renderer.finish();
};
