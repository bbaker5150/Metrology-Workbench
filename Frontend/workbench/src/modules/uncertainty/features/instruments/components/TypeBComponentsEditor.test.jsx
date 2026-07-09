import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import TypeBComponentsEditor from "./TypeBComponentsEditor";

describe("TypeBComponentsEditor", () => {
  it("offers the rectangular resolution distribution for tolerance Type B entries", () => {
    render(
      <TypeBComponentsEditor
        components={[
          {
            id: "typeb-1",
            name: "Head Pressure",
            unit: "psig",
            inputMode: "tolerance",
            toleranceLimit: "0.01",
            distribution: "3.464",
          },
        ]}
        onChange={vi.fn()}
        showIntro={false}
      />,
    );

    expect(
      screen.getByRole("option", {
        name: "Rectangular (resolution) (k=3.464)",
      }),
    ).toBeInTheDocument();
  });
});
