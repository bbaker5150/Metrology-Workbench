import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getHistoryForField,
  mergeSuggestions,
  recordSessionFormHistory,
} from "./sessionFieldHistory";

const STORAGE_KEY = "acshunt_session_field_history_v1";

const readMap = () => JSON.parse(localStorage.getItem(STORAGE_KEY));

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("getHistoryForField", () => {
  it("returns an empty list when nothing has been stored", () => {
    expect(getHistoryForField("sessionName")).toEqual([]);
  });

  it("returns an empty list when the stored blob is not valid JSON", () => {
    localStorage.setItem(STORAGE_KEY, "{not json");
    expect(getHistoryForField("sessionName")).toEqual([]);
  });

  it("returns an empty list when the stored blob is JSON but not an object", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify("a string"));
    expect(getHistoryForField("sessionName")).toEqual([]);
  });

  it("ignores a field whose stored value is not an array", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ sessionName: "oops" }));
    expect(getHistoryForField("sessionName")).toEqual([]);
  });

  it("filters out non-string and empty entries from a stored list", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ sessionName: ["good", "", null, 42, "also good"] }),
    );
    expect(getHistoryForField("sessionName")).toEqual(["good", "also good"]);
  });
});

describe("recordSessionFormHistory", () => {
  it("stores trimmed values for the known form fields", () => {
    recordSessionFormHistory({ sessionName: "  Cal Run A  ", temperature: "23.1" });
    expect(getHistoryForField("sessionName")).toEqual(["Cal Run A"]);
    expect(getHistoryForField("temperature")).toEqual(["23.1"]);
  });

  it("puts the most recent value first and de-duplicates earlier uses", () => {
    recordSessionFormHistory({ sessionName: "first" });
    recordSessionFormHistory({ sessionName: "second" });
    recordSessionFormHistory({ sessionName: "first" });
    expect(getHistoryForField("sessionName")).toEqual(["first", "second"]);
  });

  it("skips null, undefined, and whitespace-only values", () => {
    recordSessionFormHistory({ sessionName: null });
    recordSessionFormHistory({ sessionName: undefined });
    recordSessionFormHistory({ sessionName: "   " });
    expect(getHistoryForField("sessionName")).toEqual([]);
  });

  it("ignores keys that are not part of the session form", () => {
    recordSessionFormHistory({ sessionName: "keep", somethingElse: "drop" });
    expect(readMap()).toEqual({ sessionName: ["keep"] });
  });

  it("only records fields actually present on the payload", () => {
    recordSessionFormHistory({ sessionName: "only-this" });
    expect(Object.keys(readMap())).toEqual(["sessionName"]);
  });

  it("caps a field's history at 30 entries, dropping the oldest", () => {
    for (let i = 1; i <= 35; i += 1) {
      recordSessionFormHistory({ sessionName: `run-${i}` });
    }
    const history = getHistoryForField("sessionName");
    expect(history).toHaveLength(30);
    expect(history[0]).toBe("run-35");
    expect(history.at(-1)).toBe("run-6");
    expect(history).not.toContain("run-5");
  });

  it("truncates long notes to 160 characters but leaves other fields intact", () => {
    const longNote = "n".repeat(200);
    const longName = "s".repeat(200);
    recordSessionFormHistory({ notes: longNote, sessionName: longName });
    expect(getHistoryForField("notes")[0]).toHaveLength(160);
    expect(getHistoryForField("sessionName")[0]).toHaveLength(200);
  });

  it("survives localStorage being unavailable (quota / private mode)", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    expect(() => recordSessionFormHistory({ sessionName: "x" })).not.toThrow();
  });
});

describe("mergeSuggestions", () => {
  it("keeps history first, then appends extras that are not already present", () => {
    expect(mergeSuggestions(["a", "b"], ["b", "c"])).toEqual(["a", "b", "c"]);
  });

  it("trims both sources and de-duplicates across them", () => {
    expect(mergeSuggestions([" a ", "a"], ["  a  ", " d "])).toEqual(["a", "d"]);
  });

  it("drops empty and whitespace-only values from history and extras alike", () => {
    expect(mergeSuggestions(["", "  ", "keep"], ["", "   ", "also"])).toEqual([
      "keep",
      "also",
    ]);
  });

  it("drops null and undefined extras without throwing", () => {
    expect(mergeSuggestions(["a"], [null, undefined, "b"])).toEqual(["a", "b"]);
  });

  it("coerces non-string extras (e.g. numeric serials) to trimmed strings", () => {
    expect(mergeSuggestions([], [1234, 5678])).toEqual(["1234", "5678"]);
  });

  it("defaults extras to an empty list", () => {
    expect(mergeSuggestions(["a"])).toEqual(["a"]);
  });

  it("returns an empty list when both sources are empty", () => {
    expect(mergeSuggestions([], [])).toEqual([]);
  });
});
