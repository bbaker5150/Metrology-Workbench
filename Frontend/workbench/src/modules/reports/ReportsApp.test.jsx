import { describe, test, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import ReportsApp from "./ReportsApp";

describe("ReportsApp", () => {
  test("renders the module placeholder", () => {
    render(
      <MemoryRouter>
        <ReportsApp />
      </MemoryRouter>
    );
    expect(screen.getByText(/Report of Calibration/i)).toBeInTheDocument();
    expect(screen.getByText(/Coming soon/i)).toBeInTheDocument();
  });
});
