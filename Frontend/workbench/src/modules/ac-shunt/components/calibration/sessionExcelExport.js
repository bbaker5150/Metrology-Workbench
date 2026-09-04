/**
 * Single-file session export: styled Excel workbook (ExcelJS) —
 * AC–DC summary, cycle stability tracking (PPM), and raw readings.
 */
import axios from "axios";
import { API_BASE_URL } from "../../constants/constants";

const READING_TYPES = [
  { label: "AC Open", value: "ac_open_readings" },
  { label: "DC+", value: "dc_pos_readings" },
  { label: "DC-", value: "dc_neg_readings" },
  { label: "AC Close", value: "ac_close_readings" },
];

const READING_KEY_NAMES = [
  "std_ac_open_readings",
  "std_dc_pos_readings",
  "std_dc_neg_readings",
  "std_ac_close_readings",
  "ti_ac_open_readings",
  "ti_dc_pos_readings",
  "ti_dc_neg_readings",
  "ti_ac_close_readings",
];

const FREQ_LABELS = new Map([
  [10, "10 Hz"],
  [20, "20 Hz"],
  [50, "50 Hz"],
  [60, "60 Hz"],
  [100, "100 Hz"],
  [200, "200 Hz"],
  [500, "500 Hz"],
  [1000, "1 kHz"],
  [2000, "2 kHz"],
  [5000, "5 kHz"],
  [10000, "10 kHz"],
  [20000, "20 kHz"],
  [50000, "50 kHz"],
  [100000, "100 kHz"],
]);

/* Modern neutral palette (slate / sky / emerald / warm accent) */
const HDR_FILL = "FF1E293B";
const HDR_TXT = "FFF8FAFC";
const TITLE_COLOR = "FF0F172A";
const MUTED_TEXT = "FF64748B";
const SUBHDR_UUT_BG = "FFE0F2FE";
const SUBHDR_UUT_TXT = "FF0369A1";
const ZEBRA = "FFF8FAFC";
const BORDER = "FFE2E8F0";
const TITLE_BAND = "FFF8FAFC";
const TAB_SUMMARY = "FF475569";
const TAB_STABILITY = "FF10B981"; // Emerald Green for stability tracking
const TAB_RAW = "FF6366F1";

function formatFrequency(value) {
  const n = typeof value === "string" ? Number(value) : value;
  return FREQ_LABELS.get(n) || `${n} Hz`;
}

function mergeApiPointsToUniqueTestPoints(apiPoints) {
  if (!Array.isArray(apiPoints)) return [];
  const pointMap = new Map();
  apiPoints.forEach((point) => {
    const key = `${point.current}-${point.frequency}`;
    if (!pointMap.has(key)) {
      pointMap.set(key, {
        key,
        current: point.current,
        frequency: point.frequency,
        forward: null,
        reverse: null,
      });
    }
    const entry = pointMap.get(key);
    if (point.direction === "Forward") entry.forward = point;
    else if (point.direction === "Reverse") entry.reverse = point;
  });
  return Array.from(pointMap.values());
}

function buildCombinedReadingsAndResults(pt) {
  const { forward, reverse } = pt;
  if (!forward?.readings || !reverse?.readings) {
    return null;
  }
  const combinedReadings = {};
  READING_KEY_NAMES.forEach((key) => {
    combinedReadings[key] = [
      ...(forward.readings[key] || []),
      ...(reverse.readings[key] || []),
    ];
  });
  const combinedResults = {};
  if (forward?.results && reverse?.results) {
    READING_KEY_NAMES.forEach((key) => {
      const readings = combinedReadings[key]
        .filter((r) => r.is_stable !== false)
        .map((r) => (typeof r === "object" ? r.value : r));
      if (readings.length > 0) {
        const sum = readings.reduce((a, b) => a + b, 0);
        combinedResults[key.replace("_readings", "_avg")] = sum / readings.length;
        const stddevKey = key.replace("_readings", "_stddev");
        const sf = forward.results?.[stddevKey];
        const sr = reverse.results?.[stddevKey];
        if (typeof sf === "number" && typeof sr === "number") {
          combinedResults[stddevKey] = (sf + sr) / 2;
        }
      }
    });
    combinedResults.delta_uut_ppm = forward.results.delta_uut_ppm_avg;
  }
  return { readings: combinedReadings, results: combinedResults };
}

function getExportBundleForDirection(pt, direction) {
  if (!pt) return null;
  if (direction === "Combined") {
    return buildCombinedReadingsAndResults(pt);
  }
  const point = direction === "Forward" ? pt.forward : pt.reverse;
  if (!point?.readings) return null;
  return { readings: point.readings, results: point.results || null };
}

function thinBorder() {
  return {
    top: { style: "thin", color: { argb: BORDER } },
    left: { style: "thin", color: { argb: BORDER } },
    bottom: { style: "thin", color: { argb: BORDER } },
    right: { style: "thin", color: { argb: BORDER } },
  };
}

function thickBottomBorder() {
  return {
    top: { style: "thin", color: { argb: BORDER } },
    left: { style: "thin", color: { argb: BORDER } },
    bottom: { style: "medium", color: { argb: "FF94A3B8" } },
    right: { style: "thin", color: { argb: BORDER } },
  };
}

function styleDataRow(row, isAlt, colCount, customFill = null) {
  row.eachCell({ includeEmpty: true }, (cell, col) => {
    if (col > colCount) return;
    cell.border = thinBorder();
    cell.font = { name: "Calibri", size: 11, color: { argb: TITLE_COLOR } };
    
    if (customFill) {
      cell.fill = customFill;
    } else if (isAlt) {
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: ZEBRA },
      };
    }
  });
}

function coerceSampleValue(raw) {
  if (raw === null || raw === undefined) return "";
  const n = Number(raw);
  return Number.isFinite(n) ? n : String(raw);
}

function formatSampleTimestamp(ts) {
  if (ts == null || ts === "") return "";
  const n = Number(ts);
  if (!Number.isFinite(n)) return "";
  const ms = n < 1e12 ? n * 1000 : n;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (x) => String(x).padStart(2, "0");
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const mon = months[d.getMonth()];
  const day = d.getDate();
  const year = d.getFullYear();
  const h = d.getHours();
  const m = d.getMinutes();
  const s = d.getSeconds();
  return `${mon} ${day}, ${year}  ${pad(h)}:${pad(m)}:${pad(s)}`;
}

function collectRawRows(uniqueTestPoints) {
  const rows = [];
  const directions = ["Forward", "Reverse", "Combined"];

  for (const pt of uniqueTestPoints) {
    const freqLabel = formatFrequency(pt.frequency);
    const currentDisp = pt.current != null && pt.current !== "" ? Number(pt.current) : pt.current;

    for (const dir of directions) {
      const bundle = getExportBundleForDirection(pt, dir);
      if (!bundle?.readings) continue;

      for (const inst of ["std", "ti"]) {
        const prefix = inst === "std" ? "std_" : "ti_";
        const instLabel = inst === "std" ? "Standard" : "UUT";

        const acOpenArr = bundle.readings[`${prefix}ac_open_readings`] || [];
        const dcPosArr  = bundle.readings[`${prefix}dc_pos_readings`] || [];
        const dcNegArr  = bundle.readings[`${prefix}dc_neg_readings`] || [];
        const acCloseArr = bundle.readings[`${prefix}ac_close_readings`] || [];

        const maxCycles = Math.max(acOpenArr.length, dcPosArr.length, dcNegArr.length, acCloseArr.length);

        for (let cIdx = 0; cIdx < maxCycles; cIdx++) {
          const acOpenSample = acOpenArr[cIdx];
          const dcPosSample  = dcPosArr[cIdx];
          const dcNegSample  = dcNegArr[cIdx];
          const acCloseSample = acCloseArr[cIdx];

          const getVal = (s) => (s && typeof s === "object" ? s.value : s);
          const getTs = (s) => (s && typeof s === "object" ? s.timestamp : null);

          const rawTs = getTs(acOpenSample) || getTs(dcPosSample) || getTs(dcNegSample) || getTs(acCloseSample);
          const timeLabel = rawTs ? formatSampleTimestamp(rawTs) : "";

          rows.push({
            current_a: Number.isFinite(Number(currentDisp)) ? Number(currentDisp) : pt.current,
            frequency: freqLabel,
            cycle_num: cIdx + 1,
            direction: dir,
            instrument: instLabel,
            ac_open: coerceSampleValue(getVal(acOpenSample)),
            dc_pos: coerceSampleValue(getVal(dcPosSample)),
            dc_neg: coerceSampleValue(getVal(dcNegSample)),
            ac_close: coerceSampleValue(getVal(acCloseSample)),
            timestamp_local: timeLabel,
          });
        }
      }
    }
  }
  return rows;
}

function collectStabilityRows(uniqueTestPoints) {
  const rows = [];
  const directions = ["Forward", "Reverse"];

  for (const pt of uniqueTestPoints) {
    const freqLabel = formatFrequency(pt.frequency);
    const currentDisp = pt.current != null && pt.current !== "" ? Number(pt.current) : pt.current;

    directions.forEach((dirName) => {
      const pointDir = dirName === "Forward" ? pt.forward : pt.reverse;
      const cyclesArr = (pointDir?.results?.cycles || []).slice().sort((a, b) => (a.cycle_index || 0) - (b.cycle_index || 0));

      cyclesArr.forEach((c) => {
        const cNum = c.cycle_index || 1;

        // Dynamic formula to scale raw deviation volts to relative PPM metrics
        const convertToPpm = (stddev, avg) => {
          if (stddev == null || avg == null || avg === 0) return null;
          return (Math.abs(stddev) / Math.abs(avg)) * 1e6;
        };

        // 1. Standard Reference Instrument Row
        rows.push({
          current_a: Number.isFinite(Number(currentDisp)) ? Number(currentDisp) : pt.current,
          frequency: freqLabel,
          cycle_num: cNum,
          direction: dirName,
          instrument: "Standard",
          ac_open_stable: convertToPpm(c.std_ac_open_stddev, c.std_ac_open_avg),
          dc_pos_stable: convertToPpm(c.std_dc_pos_stddev, c.std_dc_pos_avg),
          dc_neg_stable: convertToPpm(c.std_dc_neg_stddev, c.std_dc_neg_avg),
          ac_close_stable: convertToPpm(c.std_ac_close_stddev, c.std_ac_close_avg),
        });

        // 2. Test Instrument (TI/UUT) Row
        rows.push({
          current_a: Number.isFinite(Number(currentDisp)) ? Number(currentDisp) : pt.current,
          frequency: freqLabel,
          cycle_num: cNum,
          direction: dirName,
          instrument: "UUT",
          ac_open_stable: convertToPpm(c.ti_ac_open_stddev, c.ti_ac_open_avg),
          dc_pos_stable: convertToPpm(c.ti_dc_pos_stddev, c.ti_dc_pos_avg),
          dc_neg_stable: convertToPpm(c.ti_dc_neg_stddev, c.ti_dc_neg_avg),
          ac_close_stable: convertToPpm(c.ti_ac_close_stddev, c.ti_ac_close_avg),
        });
      });
    });
  }
  return rows;
}

function safeFileName(name) {
  const base = name ? name.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "") : "Session";
  return base.slice(0, 80) || "Session";
}

function applyHeaderRow(row, colCount) {
  row.height = 26;
  row.eachCell({ includeEmpty: true }, (cell, col) => {
    if (col > colCount) return;
    cell.font = { bold: true, color: { argb: "FFF8FAFC" }, size: 10, name: "Calibri" };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E293B" } };
    cell.border = thinBorder();
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: false };
  });
}

function applySectionBar(cell, label, bgArgb, fgArgb) {
  cell.value = label;
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bgArgb } };
  cell.font = { bold: true, size: 11, color: { argb: fgArgb }, name: "Calibri" };
  cell.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
}

export async function downloadFullSessionExcel({ uniqueTestPoints, sessionName, sessionId }) {
  let points = uniqueTestPoints;
  let useAbba = true;

  if (sessionId) {
    try {
      const { data } = await axios.get(`${API_BASE_URL}/calibration_sessions/${sessionId}/test_points/`);
      const list = data?.test_points;
      if (Array.isArray(list) && list.length > 0) {
        points = mergeApiPointsToUniqueTestPoints(list);
      }
    } catch { }

    try {
      const infoResponse = await axios.get(`${API_BASE_URL}/calibration_sessions/${sessionId}/information/`);
      if (infoResponse.data?.configurations?.use_abba_pairing === false) {
        useAbba = false;
      }
    } catch { }
  }

  if (!points || points.length === 0) {
    return { ok: false, error: "No test points to export." };
  }

  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "AC Shunt Calibration";
  workbook.created = new Date();

  // ==========================================
  // TAB 1: AC_DC_Summary
  // ==========================================
  const sumSheet = workbook.addWorksheet("AC_DC_Summary", {
    properties: { tabColor: { argb: TAB_SUMMARY } },
    views: [{ showGridLines: false, state: "frozen", ySplit: 4, activeCell: "A5" }],
  });

  sumSheet.mergeCells("A1:H1");
  const sumTitle = sumSheet.getCell("A1");
  sumTitle.value = "AC–DC Difference Analysis Summary (ppm)";
  sumTitle.font = { size: 16, bold: true, color: { argb: TITLE_COLOR }, name: "Calibri" };
  sumTitle.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TITLE_BAND } };
  sumTitle.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
  sumTitle.border = { bottom: { style: "medium", color: { argb: "FFCBD5E1" } } };
  sumSheet.getRow(1).height = 34;
  sumSheet.getRow(2).height = 6;

  sumSheet.mergeCells("A3:H3");
  applySectionBar(sumSheet.getCell("A3"), sessionName || "Calibration Session Summary Ledger", SUBHDR_UUT_BG, SUBHDR_UUT_TXT);
  sumSheet.getRow(3).height = 26;

  const hdrUut = sumSheet.getRow(4);
  hdrUut.values = [
    "Current (A)",
    "Frequency",
    "Analysis Component",
    "Standard Correction (ppm)",
    "TI Forward δ (ppm)",
    "TI Reverse δ (ppm)",
    "TI Paired/Avg δ (ppm)",
    "Type A Standard Uncertainty (k=1, ppm)"
  ];
  applyHeaderRow(hdrUut, 8);

  let r = 5;
  const SUM_COLS = 8;

  points.forEach((pt, idx) => {
    const isAltBlock = idx % 2 === 1;
    const startRow = r;

    const fwdCycles = (pt.forward?.results?.cycles || []).slice().sort((a, b) => (a.cycle_index || 0) - (b.cycle_index || 0));
    const revCycles = (pt.reverse?.results?.cycles || []).slice().sort((a, b) => (a.cycle_index || 0) - (b.cycle_index || 0));
    const nPairs = Math.min(fwdCycles.length, revCycles.length);

    const stdFwd = pt.forward?.results?.delta_std != null ? parseFloat(pt.forward.results.delta_std) : null;
    const stdRev = pt.reverse?.results?.delta_std != null ? parseFloat(pt.reverse.results.delta_std) : null;
    let stdAvg = null;
    if (stdFwd != null && stdRev != null) {
      stdAvg = (stdFwd + stdRev) / 2;
    } else {
      stdAvg = stdFwd ?? stdRev;
    }

    let fwdMean = null, fwdUA = null;
    if (fwdCycles.length > 0) {
      const vals = fwdCycles.map(c => parseFloat(c.delta_uut_ppm)).filter(v => !isNaN(v));
      if (vals.length > 0) {
        fwdMean = vals.reduce((a, b) => a + b, 0) / vals.length;
        if (vals.length > 1) {
          const variance = vals.reduce((a, b) => a + Math.pow(b - fwdMean, 2), 0) / (vals.length - 1);
          fwdUA = Math.sqrt(variance) / Math.sqrt(vals.length);
        }
      }
    } else {
      fwdMean = pt.forward?.results?.delta_uut_ppm != null ? parseFloat(pt.forward.results.delta_uut_ppm) : null;
    }

    let revMean = null, revUA = null;
    if (revCycles.length > 0) {
      const vals = revCycles.map(c => parseFloat(c.delta_uut_ppm)).filter(v => !isNaN(v));
      if (vals.length > 0) {
        revMean = vals.reduce((a, b) => a + b, 0) / vals.length;
        if (vals.length > 1) {
          const variance = vals.reduce((a, b) => a + Math.pow(b - revMean, 2), 0) / (vals.length - 1);
          revUA = Math.sqrt(variance) / Math.sqrt(vals.length);
        }
      }
    } else {
      revMean = pt.reverse?.results?.delta_uut_ppm != null ? parseFloat(pt.reverse.results.delta_uut_ppm) : null;
    }

    const legacyCombined = (pt.forward?.results?.delta_uut_ppm != null && pt.reverse?.results?.delta_uut_ppm != null)
        ? (parseFloat(pt.forward.results.delta_uut_ppm) + parseFloat(pt.reverse.results.delta_uut_ppm)) / 2
        : null;

    const pairMean = pt.forward?.results?.pair_delta_uut_ppm ?? pt.reverse?.results?.pair_delta_uut_ppm ?? legacyCombined;
    const pairUA = pt.forward?.results?.pair_type_a_uncertainty_ppm ?? pt.reverse?.results?.pair_type_a_uncertainty_ppm ?? null;

    const writeLedgerRow = (componentName, stdVal, tiFwdVal, tiRevVal, tiAvgVal, uncertVal, isHeadline = false) => {
      const row = sumSheet.getRow(r);
      row.values = [
        Number(pt.current),
        formatFrequency(pt.frequency),
        componentName,
        stdVal != null ? parseFloat(stdVal) : null,
        tiFwdVal != null ? parseFloat(tiFwdVal) : null,
        tiRevVal != null ? parseFloat(tiRevVal) : null,
        tiAvgVal != null ? parseFloat(tiAvgVal) : null,
        uncertVal != null ? parseFloat(uncertVal) : null
      ];

      row.getCell(1).numFmt = "0.###";
      row.getCell(2).alignment = { horizontal: "left" };
      row.getCell(3).alignment = { horizontal: "left" };

      [4, 5, 6, 7, 8].forEach((c) => {
        const cell = row.getCell(c);
        if (cell.value != null && cell.value !== "") {
          cell.numFmt = "0.000";
          cell.alignment = { horizontal: "right" };
        } else {
          cell.value = "—";
          cell.alignment = { horizontal: "center" };
        }
      });

      let customFill = null;
      if (isHeadline) {
        for (let colIdx = 3; colIdx <= 8; colIdx++) {
          row.getCell(colIdx).font = { name: "Calibri", bold: true, size: 11, color: { argb: "FF0F172A" } };
        }
        customFill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F5F9" } };
      }

      styleDataRow(row, isAltBlock, SUM_COLS, customFill);
      r += 1;
    };

    writeLedgerRow("Final Pass Summary", stdAvg, fwdMean, revMean, pairMean, pairUA, true);

    if (nPairs > 0) {
      for (let i = 0; i < nPairs; i++) {
        const fwdVal = parseFloat(fwdCycles[i]?.delta_uut_ppm);
        const revIdx = useAbba ? (nPairs - 1 - i) : i;
        const revVal = parseFloat(revCycles[revIdx]?.delta_uut_ppm);
        let cycleAvg = null;
        if (!isNaN(fwdVal) && !isNaN(revVal)) {
          cycleAvg = (fwdVal + revVal) / 2;
        }

        writeLedgerRow(
          `Cycle ${i + 1}`,
          null,
          !isNaN(fwdVal) ? fwdVal : null,
          !isNaN(revVal) ? revVal : null,
          cycleAvg,
          null,
          false
        );
      }
    }

    const endRow = r - 1;
    if (endRow >= startRow) {
      sumSheet.mergeCells(`A${startRow}:A${endRow}`);
      sumSheet.mergeCells(`B${startRow}:B${endRow}`);
      sumSheet.getCell(`A${startRow}`).alignment = { vertical: "middle", horizontal: "center" };
      sumSheet.getCell(`B${startRow}`).alignment = { vertical: "middle", horizontal: "center" };
    }

    if (endRow >= 5) {
      sumSheet.getRow(endRow).eachCell({ includeEmpty: true }, (cell, col) => {
        if (col <= SUM_COLS) cell.border = thickBottomBorder();
      });
    }
  });

  sumSheet.getColumn(1).width = 14;
  sumSheet.getColumn(2).width = 14;
  sumSheet.getColumn(3).width = 26;
  sumSheet.getColumn(4).width = 26;
  sumSheet.getColumn(5).width = 20;
  sumSheet.getColumn(6).width = 20;
  sumSheet.getColumn(7).width = 24;
  sumSheet.getColumn(8).width = 24;

  // ==========================================
  // TAB 2: Stability (Calculated PPM Results)
  // ==========================================
  const stabSheet = workbook.addWorksheet("Stability", {
    properties: { tabColor: { argb: TAB_STABILITY } },
    views: [{ showGridLines: false, state: "frozen", ySplit: 3, activeCell: "A4" }],
  });
  const stabilityRows = collectStabilityRows(points);
  const STAB_COLS = 10;

  stabSheet.mergeCells("A1:J1");
  const stabTitle = stabSheet.getCell("A1");
  stabTitle.value = "Measurement Loop Stability History Log (ppm)";
  stabTitle.font = { size: 16, bold: true, color: { argb: TITLE_COLOR }, name: "Calibri" };
  stabTitle.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TITLE_BAND } };
  stabTitle.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
  stabTitle.border = { bottom: { style: "medium", color: { argb: "FFCBD5E1" } } };
  stabSheet.getRow(1).height = 32;

  stabSheet.mergeCells("A2:J2");
  stabSheet.getCell("A2").value = "Captures the standard deviation noise metrics (PPM) evaluated across cycle windows. Matches UI live tracker computations.";
  stabSheet.getCell("A2").font = { size: 10, color: { argb: MUTED_TEXT }, name: "Calibri" };
  stabSheet.getCell("A2").alignment = { wrapText: true, vertical: "top" };
  stabSheet.getRow(2).height = 24;

  const stabHeaders = [
    "Current (A)",
    "Frequency",
    "Cycle #",
    "Direction",
    "Instrument",
    "AC Open Stability (ppm)",
    "DC+ Stability (ppm)",
    "DC- Stability (ppm)",
    "AC Close Stability (ppm)",
    "Timestamp (local)"
  ];
  const stabHdrRow = stabSheet.getRow(3);
  stabHdrRow.values = stabHeaders;
  applyHeaderRow(stabHdrRow, STAB_COLS);

  if (stabilityRows.length === 0) {
    stabSheet.mergeCells("A4:J5");
    stabSheet.getCell("A4").value = "No validation cycles found.";
    stabSheet.getCell("A4").alignment = { wrapText: true, vertical: "center", horizontal: "center" };
    stabSheet.getRow(4).height = 40;
  } else {
    stabilityRows.forEach((row, idx) => {
      const excelRow = stabSheet.addRow([
        row.current_a,
        row.frequency,
        row.cycle_num,
        row.direction,
        row.instrument,
        row.ac_open_stable,
        row.dc_pos_stable,
        row.dc_neg_stable,
        row.ac_close_stable,
        ""
      ]);

      excelRow.getCell(1).numFmt = "0.###";
      excelRow.getCell(3).numFmt = "0";
      excelRow.getCell(2).alignment = { horizontal: "left" };

      [4, 5].forEach((c) => { excelRow.getCell(c).alignment = { horizontal: "center" }; });

      // Clean alignment logic processing standard deviation PPM parameters
      [6, 7, 8, 9].forEach((colIdx) => {
        const cell = excelRow.getCell(colIdx);
        if (cell.value != null && cell.value !== "" && !isNaN(Number(cell.value))) {
          cell.value = Number(cell.value);
          cell.numFmt = "0.00"; // Output cleanly formatted PPM limits (e.g., 1.48)
          cell.alignment = { horizontal: "right" };
        } else {
          cell.value = "—";
          cell.alignment = { horizontal: "center" };
        }
      });

      styleDataRow(excelRow, idx % 2 === 1, STAB_COLS);
    });

    stabSheet.autoFilter = {
      from: { row: 3, column: 1 },
      to: { row: stabilityRows.length + 3, column: STAB_COLS },
    };
  }

  stabSheet.getColumn(1).width = 12;
  stabSheet.getColumn(2).width = 12;
  stabSheet.getColumn(3).width = 10;
  stabSheet.getColumn(4).width = 12;
  stabSheet.getColumn(5).width = 12;
  stabSheet.getColumn(6).width = 22;
  stabSheet.getColumn(7).width = 22;
  stabSheet.getColumn(8).width = 22;
  stabSheet.getColumn(9).width = 22;
  stabSheet.getColumn(10).width = 30;

  // ==========================================
  // TAB 3: Raw_readings
  // ==========================================
  const raw = workbook.addWorksheet("Raw_readings", { properties: { tabColor: { argb: TAB_RAW } } });
  const rawRows = collectRawRows(points);
  const RAW_COLS = 10;

  raw.mergeCells("A1:J1");
  const rawTitle = raw.getCell("A1");
  rawTitle.value = "Raw Voltage Samples Ledger";
  rawTitle.font = { size: 16, bold: true, color: { argb: TITLE_COLOR }, name: "Calibri" };
  rawTitle.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TITLE_BAND } };
  rawTitle.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
  rawTitle.border = { bottom: { style: "medium", color: { argb: "FFCBD5E1" } } };
  raw.getRow(1).height = 32;

  raw.mergeCells("A2:J2");
  raw.getCell("A2").value = "Each row contains side-by-side values for all 4 channels per measurement loop. Use column filter controls to drill down into specific data points.";
  raw.getCell("A2").font = { size: 10, color: { argb: MUTED_TEXT }, name: "Calibri" };
  raw.getCell("A2").alignment = { wrapText: true, vertical: "top" };
  raw.getRow(2).height = 24;

  const rawHeaders = [
    "Current (A)",
    "Frequency",
    "Cycle #",
    "Direction",
    "Instrument",
    "AC Open (V)",
    "DC+ (V)",
    "DC- (V)",
    "AC Close (V)",
    "Timestamp (local)"
  ];
  const hdrRow = raw.getRow(3);
  hdrRow.values = rawHeaders;
  applyHeaderRow(hdrRow, RAW_COLS);

  const headerRowIndex = 3;
  if (rawRows.length === 0) {
    raw.mergeCells("A4:J6");
    raw.getCell("A4").value = "No raw samples were exported.";
    raw.getRow(4).height = 72;
  } else {
    rawRows.forEach((row, idx) => {
      const excelRow = raw.addRow([
        row.current_a,
        row.frequency,
        row.cycle_num,
        row.direction,
        row.instrument,
        row.ac_open,
        row.dc_pos,
        row.dc_neg,
        row.ac_close,
        row.timestamp_local
      ]);

      excelRow.getCell(1).numFmt = "0.###";
      excelRow.getCell(3).numFmt = "0";
      
      [6, 7, 8, 9].forEach((colIdx) => {
        const vCell = excelRow.getCell(colIdx);
        if (typeof vCell.value === "number") {
          vCell.numFmt = "0.00000000";
          vCell.alignment = { horizontal: "right" };
        }
      });
      
      excelRow.getCell(2).alignment = { horizontal: "left" };
      [3, 4, 5].forEach((c) => { excelRow.getCell(c).alignment = { horizontal: "center" }; });
      excelRow.getCell(10).alignment = { horizontal: "left" };
      styleDataRow(excelRow, idx % 2 === 1, RAW_COLS);
    });
  }

  raw.views = [{ showGridLines: false, state: "frozen", ySplit: headerRowIndex, activeCell: "A4" }];
  const lastDataRow = rawRows.length === 0 ? 4 : rawRows.length + headerRowIndex;
  if (lastDataRow > headerRowIndex) {
    raw.autoFilter = { from: { row: headerRowIndex, column: 1 }, to: { row: lastDataRow, column: RAW_COLS } };
  }

  raw.getColumn(1).width = 12;
  raw.getColumn(2).width = 12;
  raw.getColumn(3).width = 10;
  raw.getColumn(4).width = 12;
  raw.getColumn(5).width = 12;
  raw.getColumn(6).width = 16;
  raw.getColumn(7).width = 16;
  raw.getColumn(8).width = 16;
  raw.getColumn(9).width = 16;
  raw.getColumn(10).width = 30;

  // ==========================================
  // Workbook Assembly & Export
  // ==========================================
  const buffer = await workbook.xlsx.writeBuffer();
  const ts = new Date().toISOString().replace(/T/, "_").replace(/\..+/, "").replace(/:/g, "-");
  const filename = `${safeFileName(sessionName)}_${ts}.xlsx`;

  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  return { ok: true };
}
