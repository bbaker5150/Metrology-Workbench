import { describe, test, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import ReportsApp from "./ReportsApp";

describe("ReportsApp", () => {
  test("renders the Report of Calibration module body", () => {
    render(
      <MemoryRouter>
        <ReportsApp />
      </MemoryRouter>
    );
    expect(screen.getAllByText(/Data Source/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Report Sections/i)).toBeInTheDocument();
    expect(screen.getByText(/AC-Shunt Pull/i)).toBeInTheDocument();
  });
});
