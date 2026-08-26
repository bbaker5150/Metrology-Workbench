import { describe, expect, it } from "vitest";
import { formatDefaultSessionName } from "./SessionDetailsForm";

describe("AC shunt default session names", () => {
  it("includes the session number, TI model, TI serial, and date", () => {
    const date = new Date(2026, 7, 25);
    expect(formatDefaultSessionName(12, "5790B", "3575301", date)).toBe(
      "#12, 5790B, 3575301, (08-25-2026)",
    );
  });
});
