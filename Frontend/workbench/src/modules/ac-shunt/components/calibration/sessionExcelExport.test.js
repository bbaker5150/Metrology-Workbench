import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import axios from "axios";
import ExcelJS from "exceljs";
import { downloadFullSessionExcel } from "./sessionExcelExport";

vi.mock("axios", () => ({ default: { get: vi.fn() } }));

// ---------------------------------------------------------------------------
// The session export is the lab's deliverable artifact, so these tests read the
// workbook back with ExcelJS and assert on real cell values rather than just
// checking that the function resolved.
// ---------------------------------------------------------------------------

let downloadedBlob;
let anchorClicks;

const cycle = (cycleIndex, deltaPpm) => ({
  cycle_index: cycleIndex,
  delta_uut_ppm: deltaPpm,
});

const direction = (deltaStd, cycles) => ({
  results: { delta_std: deltaStd, delta_uut_ppm: cycles[0]?.delta_uut_ppm, cycles },
  readings: {},
});

const testPoint = ({ current = 1, frequency = 1000, fwd = [10, 12], rev = [11, 13] } = {}) => ({
  key: `${current}-${frequency}`,
  current,
  frequency,
  forward: direction(1.5, fwd.map((v, i) => cycle(i + 1, v))),
  reverse: direction(1.7, rev.map((v, i) => cycle(i + 1, v))),
});

/** Run the export and parse whatever workbook it handed to the download. */
async function exportAndParse(args) {
  const result = await downloadFullSessionExcel(args);
  if (!result.ok) return { result, workbook: null };
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(downloadedBlob.buffer);
  return { result, workbook };
}

beforeEach(() => {
  downloadedBlob = undefined;
  anchorClicks = [];
  axios.get.mockReset();

  // jsdom's Blob has no arrayBuffer(), so capture the raw ExcelJS buffer the
  // export hands over rather than round-tripping through a real Blob.
  vi.stubGlobal(
    "Blob",
    class CapturingBlob {
      constructor(parts, options = {}) {
        this.buffer = parts[0];
        this.type = options.type;
      }
    },
  );

  // jsdom implements neither object URLs nor a real download.
  vi.stubGlobal("URL", {
    ...URL,
    createObjectURL: vi.fn((blob) => {
      downloadedBlob = blob;
      return "blob:mock-url";
    }),
    revokeObjectURL: vi.fn(),
  });

  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function click() {
    anchorClicks.push({ href: this.href, download: this.download });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("guard clauses", () => {
  it("refuses to export when there are no test points", async () => {
    const result = await downloadFullSessionExcel({ uniqueTestPoints: [], sessionName: "S" });
    expect(result).toEqual({ ok: false, error: "No test points to export." });
  });

  it("refuses to export when the point list is missing entirely", async () => {
    const result = await downloadFullSessionExcel({ sessionName: "S" });
    expect(result).toEqual({ ok: false, error: "No test points to export." });
  });

  it("does not trigger a download when the export is refused", async () => {
    await downloadFullSessionExcel({ uniqueTestPoints: [], sessionName: "S" });
    expect(anchorClicks).toHaveLength(0);
  });
});

describe("workbook structure", () => {
  it("builds the three expected tabs", async () => {
    const { workbook } = await exportAndParse({
      uniqueTestPoints: [testPoint()],
      sessionName: "Shunt A",
    });
    expect(workbook.worksheets.map((w) => w.name)).toEqual([
      "AC_DC_Summary",
      "Stability",
      "Raw_readings",
    ]);
  });

  it("titles the summary sheet and stamps the session name", async () => {
    const { workbook } = await exportAndParse({
      uniqueTestPoints: [testPoint()],
      sessionName: "Shunt A",
    });
    const sheet = workbook.getWorksheet("AC_DC_Summary");
    expect(String(sheet.getCell("A1").value)).toContain("AC–DC Difference Analysis Summary");
    expect(String(sheet.getCell("A3").value)).toContain("Shunt A");
  });

  it("falls back to a generic ledger title when no session name is given", async () => {
    const { workbook } = await exportAndParse({ uniqueTestPoints: [testPoint()] });
    const sheet = workbook.getWorksheet("AC_DC_Summary");
    expect(String(sheet.getCell("A3").value)).toContain("Calibration Session Summary Ledger");
  });

  it("writes the summary header row the lab reads the ledger by", async () => {
    const { workbook } = await exportAndParse({
      uniqueTestPoints: [testPoint()],
      sessionName: "S",
    });
    const header = workbook.getWorksheet("AC_DC_Summary").getRow(4).values.slice(1);
    expect(header).toContain("Current (A)");
    expect(header).toContain("Frequency");
    expect(header).toContain("Type A Standard Uncertainty (k=1, ppm)");
  });

  it("records the producing application on the workbook", async () => {
    const { workbook } = await exportAndParse({
      uniqueTestPoints: [testPoint()],
      sessionName: "S",
    });
    expect(workbook.creator).toBe("AC Shunt Calibration");
  });
});

describe("summary content", () => {
  it("emits a block per test point", async () => {
    const points = [
      testPoint({ current: 1, frequency: 1000 }),
      testPoint({ current: 5, frequency: 10000 }),
    ];
    const { workbook } = await exportAndParse({ uniqueTestPoints: points, sessionName: "S" });
    const text = JSON.stringify(workbook.getWorksheet("AC_DC_Summary").getSheetValues());
    expect(text).toContain("1 kHz");
    expect(text).toContain("10 kHz");
  });

  it("reports the forward mean of the cycle deltas", async () => {
    // Forward cycles 10 and 12 -> mean 11.
    const { workbook } = await exportAndParse({
      uniqueTestPoints: [testPoint({ fwd: [10, 12], rev: [20, 22] })],
      sessionName: "S",
    });
    const values = workbook
      .getWorksheet("AC_DC_Summary")
      .getSheetValues()
      .flat()
      .filter((v) => typeof v === "number");
    expect(values.some((v) => Math.abs(v - 11) < 1e-9)).toBe(true);
  });

  it("reports the reverse mean of the cycle deltas", async () => {
    // Reverse cycles 20 and 22 -> mean 21.
    const { workbook } = await exportAndParse({
      uniqueTestPoints: [testPoint({ fwd: [10, 12], rev: [20, 22] })],
      sessionName: "S",
    });
    const values = workbook
      .getWorksheet("AC_DC_Summary")
      .getSheetValues()
      .flat()
      .filter((v) => typeof v === "number");
    expect(values.some((v) => Math.abs(v - 21) < 1e-9)).toBe(true);
  });

  it("handles a point with a single cycle, where Type A is undefined", async () => {
    const { workbook } = await exportAndParse({
      uniqueTestPoints: [testPoint({ fwd: [10], rev: [11] })],
      sessionName: "S",
    });
    expect(workbook.getWorksheet("AC_DC_Summary")).toBeTruthy();
  });

  it("handles a forward-only point without throwing", async () => {
    const pt = testPoint();
    pt.reverse = null;
    const { result } = await exportAndParse({ uniqueTestPoints: [pt], sessionName: "S" });
    expect(result.ok).toBe(true);
  });

  it("handles a point with no cycle data at all", async () => {
    const pt = testPoint({ fwd: [], rev: [] });
    const { result } = await exportAndParse({ uniqueTestPoints: [pt], sessionName: "S" });
    expect(result.ok).toBe(true);
  });
});

describe("download", () => {
  it("clicks a download anchor with a timestamped .xlsx filename", async () => {
    await exportAndParse({ uniqueTestPoints: [testPoint()], sessionName: "Shunt A" });
    expect(anchorClicks).toHaveLength(1);
    expect(anchorClicks[0].download).toMatch(/^Shunt.A_\d{4}-\d{2}-\d{2}_[\d-]+\.xlsx$/);
  });

  it("sanitizes a session name containing path-hostile characters", async () => {
    await exportAndParse({ uniqueTestPoints: [testPoint()], sessionName: "A/B:C*?" });
    expect(anchorClicks[0].download).not.toMatch(/[/:*?]/);
    expect(anchorClicks[0].download).toMatch(/\.xlsx$/);
  });

  it("hands over a spreadsheet-typed blob and revokes the object URL", async () => {
    await exportAndParse({ uniqueTestPoints: [testPoint()], sessionName: "S" });
    expect(downloadedBlob.type).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:mock-url");
  });

  it("leaves no anchor behind in the document", async () => {
    await exportAndParse({ uniqueTestPoints: [testPoint()], sessionName: "S" });
    expect(document.querySelectorAll("a[download]")).toHaveLength(0);
  });

  it("reports success", async () => {
    const { result } = await exportAndParse({
      uniqueTestPoints: [testPoint()],
      sessionName: "S",
    });
    expect(result).toEqual({ ok: true });
  });
});

describe("server refresh", () => {
  it("prefers freshly fetched points over the in-memory list", async () => {
    axios.get.mockImplementation((url) => {
      if (url.includes("/test_points/")) {
        return Promise.resolve({
          data: {
            test_points: [
              { current: 9, frequency: 10000, direction: "Forward", results: { cycles: [cycle(1, 5)] }, readings: {} },
              { current: 9, frequency: 10000, direction: "Reverse", results: { cycles: [cycle(1, 6)] }, readings: {} },
            ],
          },
        });
      }
      return Promise.resolve({ data: {} });
    });

    const { workbook } = await exportAndParse({
      uniqueTestPoints: [testPoint({ frequency: 1000 })],
      sessionName: "S",
      sessionId: 42,
    });

    const text = JSON.stringify(workbook.getWorksheet("AC_DC_Summary").getSheetValues());
    expect(text).toContain("10 kHz");
    expect(text).not.toContain("1 kHz");
  });

  it("pairs Forward and Reverse rows of the same current/frequency into one point", async () => {
    axios.get.mockResolvedValue({
      data: {
        test_points: [
          { current: 1, frequency: 1000, direction: "Forward", results: { cycles: [cycle(1, 10)] }, readings: {} },
          { current: 1, frequency: 1000, direction: "Reverse", results: { cycles: [cycle(1, 12)] }, readings: {} },
        ],
      },
    });
    const { result } = await exportAndParse({
      uniqueTestPoints: [testPoint()],
      sessionName: "S",
      sessionId: 42,
    });
    expect(result.ok).toBe(true);
  });

  it("keeps the in-memory points when the server returns an empty list", async () => {
    axios.get.mockResolvedValue({ data: { test_points: [] } });
    const { workbook } = await exportAndParse({
      uniqueTestPoints: [testPoint({ frequency: 5000 })],
      sessionName: "S",
      sessionId: 42,
    });
    expect(
      JSON.stringify(workbook.getWorksheet("AC_DC_Summary").getSheetValues()),
    ).toContain("5 kHz");
  });

  it("still exports when the refresh request fails", async () => {
    axios.get.mockRejectedValue(new Error("offline"));
    const { result } = await exportAndParse({
      uniqueTestPoints: [testPoint()],
      sessionName: "S",
      sessionId: 42,
    });
    expect(result.ok).toBe(true);
  });

  it("reads the ABBA pairing configuration from the session information endpoint", async () => {
    axios.get.mockImplementation((url) => {
      if (url.includes("/information/")) {
        return Promise.resolve({ data: { configurations: { use_abba_pairing: false } } });
      }
      return Promise.resolve({ data: {} });
    });
    const { result } = await exportAndParse({
      uniqueTestPoints: [testPoint()],
      sessionName: "S",
      sessionId: 42,
    });
    expect(result.ok).toBe(true);
    expect(axios.get).toHaveBeenCalledWith(expect.stringContaining("/information/"));
  });

  it("skips both requests entirely when no session id is supplied", async () => {
    await exportAndParse({ uniqueTestPoints: [testPoint()], sessionName: "S" });
    expect(axios.get).not.toHaveBeenCalled();
  });
});
