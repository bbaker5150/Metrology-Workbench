import { describe, expect, it } from "vitest";
import {
  buildSessionReportModel,
  resolvePdfColumnGroups,
  resolvePdfTableLayout,
} from "./pdfGenerator";

const helpers = {
  getToleranceErrorSummary: () => "+/- 0.5 in-oz",
  getAbsoluteLimits: () => ({
    low: "9.5 in-oz",
    high: "10.5 in-oz",
  }),
};

describe("buildSessionReportModel", () => {
  it("uses exactly the active measurement-point filter columns in report groups", () => {
    const groups = resolvePdfColumnGroups({ value: true, pfa: true, gbPfr: true });
    expect(groups.map((group) => group.label)).toEqual([
      "Measurement",
      "Risk",
      "Mitigation (GB + Interval)",
    ]);
    expect(groups.flatMap((group) => group.columns.map((item) => item.key))).toEqual([
      "value",
      "pfa",
      "gbPfr",
    ]);
  });

  it("lays only selected fields into one continuous table", () => {
    const layout = resolvePdfTableLayout({ value: false, pfa: true, gbPfr: true });
    expect(layout.columns.map((item) => item.key)).toEqual(["pfa", "gbPfr"]);
    expect(layout.columns.map((item) => item.groupLabel)).toEqual([
      "Risk",
      "Mitigation (GB + Interval)",
    ]);
  });

  it("does not silently restore a column when every filter is disabled", () => {
    expect(resolvePdfTableLayout({}).columns).toEqual([]);
  });

  it("groups by function -> UUT -> range with all risk fields", () => {
    const session = {
      name: "Torque Session",
      uuts: [
        {
          id: "uut-1",
          name: "Torque Analyzer",
          instrument: {
            functions: [
              {
                id: "fn-1",
                name: "Torque",
                unit: "in-oz",
                ranges: [{ id: "range-1", min: 6.000000001, max: 20 }],
              },
            ],
          },
        },
      ],
      testPoints: [
        {
          id: "point-1",
          section: "4.1",
          associatedUutIds: ["uut-1"],
          uutTolerance: {
            min: 6.000000001,
            max: 20,
            unit: "in-oz",
          },
          testPointInfo: {
            parameter: { name: "Torque", value: 10, unit: "in-oz" },
          },
        },
      ],
    };
    const risk = {
      "point-1": {
        pfa: 1.25,
        pfr: 0.5,
        tur: 4.2,
        tar: 5.1,
        gbPfa: 0.9,
        gbPfr: 0.4,
        gbMult: 87.5,
        gbLow: 9.6,
        gbHigh: 10.4,
      },
    };

    const report = buildSessionReportModel(session, risk, helpers);
    const fn = report.functions[0];
    const uut = fn.uuts[0];
    const range = uut.ranges[0];
    const row = range.rows[0];

    expect(fn.name).toBe("Torque");
    expect(fn.unit).toBe("in-oz");
    expect(uut.name).toBe("Torque Analyzer");
    expect(range.label).toBe("6 to 20 in-oz");
    expect(row).toMatchObject({
      section: "4.1",
      value: "10 in-oz",
      unit: "in-oz",
      tolerance: "+/- 0.5 in-oz",
      lowLimit: "9.5",
      highLimit: "10.5",
      pfa: "1.25",
      pfr: "0.50",
      tur: "4.20",
      tar: "5.10",
      gbPfa: "0.90",
      gbPfr: "0.40",
      gbMult: "87.50",
      gbLow: "9.6",
      gbHigh: "10.4",
    });
  });

  it("places points whose owning UUT is missing under an Unassigned Points function", () => {
    const session = {
      name: "Orphan Session",
      uuts: [],
      testPoints: [
        {
          id: "point-1",
          section: "1.0",
          associatedUutIds: ["gone"],
          testPointInfo: { parameter: { name: "Voltage", value: 5, unit: "V" } },
        },
      ],
    };

    const report = buildSessionReportModel(session, {}, helpers);

    expect(report.functions).toHaveLength(1);
    expect(report.functions[0].name).toBe("Unassigned Points");
    expect(report.functions[0].uuts[0].ranges[0].rows[0].section).toBe("1.0");
  });

  it("keeps two functions on the same UUT as separate report sections", () => {
    const session = {
      name: "Multi-Function Session",
      uuts: [
        {
          id: "dmm",
          name: "Multimeter",
          instrument: {
            functions: [
              { id: "f1", name: "DC Voltage", unit: "V", ranges: [] },
              { id: "f2", name: "DC Current", unit: "A", ranges: [] },
            ],
          },
        },
      ],
      testPoints: [
        {
          id: "p-v",
          associatedUutIds: ["dmm"],
          testPointInfo: { parameter: { name: "DC Voltage", value: 1, unit: "V" } },
        },
        {
          id: "p-a",
          associatedUutIds: ["dmm"],
          testPointInfo: { parameter: { name: "DC Current", value: 2, unit: "A" } },
        },
      ],
    };

    const report = buildSessionReportModel(session, {}, helpers);

    expect(report.functions.map((fn) => fn.name)).toEqual([
      "DC Current",
      "DC Voltage",
    ]);
    // Every point lands in exactly one function section (none dropped).
    const rowCount = report.functions.reduce(
      (sum, fn) =>
        sum +
        fn.uuts.reduce(
          (uSum, uut) =>
            uSum + uut.ranges.reduce((rSum, r) => rSum + r.rows.length, 0),
          0,
        ),
      0,
    );
    expect(rowCount).toBe(2);
  });
});
