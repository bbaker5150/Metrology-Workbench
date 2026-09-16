export const biasFixture = () => {
  const instrument = (id, unit, bias) => ({ id, instrument: { functions: [{ id, name: id, unit, ranges: [{ id: `${id}-range`, unit, min: 0, max: 100, tolerances: { floor: { low: -.001, high: .001, unit, distribution: "1.732" }, bias } }] }] } });
  const session = { uncReq: { uncertaintyConfidence: 95, reliability: 85, reqPFA: 2, calInt: 12, neededTUR: 4, measRelCalcAssumed: 85 },
    tmdes: [instrument("voltage", "V", { value: .01, unit: "V" }), instrument("resistance", "Ohm", { value: .002, unit: "Ohm" })] };
  const point = { id: "point", measurementType: "derived", equationString: "V/R", variableMappings: { V: "Voltage", R: "Resistance" },
    variableNominals: { V: { value: 1, unit: "V" }, R: { value: .1, unit: "Ohm" } }, testPointInfo: { parameter: { value: 10, unit: "A" } },
    uutTolerance: { floor: { low: -2, high: 2, unit: "A", distribution: "1.732" } }, tmdeTolerances: [],
    components: ["voltage", "resistance"].map(id => ({ id, name: id, type: "B", variableType: id === "voltage" ? "Voltage" : "Resistance", tmdeBudgetSourceId: id, tmdeBudgetRangeId: `${id}-range`, tmdeBudgetComponentKind: "Accuracy" })) };
  return { point, session };
};
