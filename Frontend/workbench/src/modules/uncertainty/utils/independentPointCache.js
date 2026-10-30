const EMPTY_INPUTS = Object.freeze([]);

// For evaluations that read one point and shared session definitions, never
// other points. Retain only the current session's points; replacing any shared
// field conservatively invalidates all entries. Edits are immutable throughout
// the workspace, so editing one point need not recalculate its neighbours.
export function createIndependentPointCache(evaluate) {
  let shared = null;
  let entries = new Map();
  return (points, session, inputsForPoint = () => EMPTY_INPUTS) => {
    const { testPoints: _testPoints, ...nextShared } = session || {};
    const keys = Object.keys(nextShared);
    if (!shared || keys.length !== Object.keys(shared).length ||
      keys.some(key => !Object.is(shared[key], nextShared[key]))) entries.clear();
    shared = nextShared;
    const nextEntries = new Map();
    const values = new Map();
    for (const point of points || []) {
      const inputs = inputsForPoint(point);
      const previous = entries.get(point.id);
      const unchanged = previous?.point === point &&
        previous.inputs.length === inputs.length &&
        inputs.every((input, index) => Object.is(input, previous.inputs[index]));
      const value = unchanged ? previous.value : evaluate(point, session, ...inputs);
      nextEntries.set(point.id, { point, inputs, value });
      values.set(point.id, value);
    }
    entries = nextEntries;
    return values;
  };
}
